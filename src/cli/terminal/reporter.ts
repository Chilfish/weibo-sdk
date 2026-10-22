import type { LogFormat } from './format'
import type { ArchiveIssue } from '~/types/archive/IArchiveFile'
import type { UserArchiveProgress, UserArchiveRecord, UserArchiveSummary } from '~/types/archive/IUserArchive'

export interface ArchiveReporterStart {
  uid: string
  outPath: string
  range?: string
  /** 是否从已有 journal 续跑。 */
  resumed?: boolean
  /** 续跑时已加载的记录数。 */
  loadedRecords?: number
}

export interface ArchiveReporterFinish {
  outPath: string
  complete: boolean
  summary: UserArchiveSummary
  elapsedMs: number
}

export interface ArchiveRawSummary {
  path: string
  lines: number
  error?: string
}

/** `archive user` 的诊断输出端口；实现决定 pretty / NDJSON / silent。 */
export interface ArchiveReporter {
  start: (info: ArchiveReporterStart) => void
  progress: (progress: UserArchiveProgress) => void
  record: (entry: UserArchiveRecord) => void
  issue: (issue: ArchiveIssue, slice?: string) => void
  notice: (message: string) => void
  partsKept: (path: string) => void
  rawSummary: (info: ArchiveRawSummary) => void
  finish: (info: ArchiveReporterFinish) => void
  close: () => void
}

export interface ReporterStream {
  write: (chunk: string) => unknown
  /** 终端宽度；非 TTY / 测试替身可缺省。 */
  readonly columns?: number
}

export interface ArchiveReporterOptions {
  format: LogFormat
  stream: ReporterStream
  interactive: boolean
  color: boolean
  noProgress: boolean
}

const ANSI = {
  reset: '\x1B[0m',
  bold: '\x1B[1m',
  dim: '\x1B[2m',
  red: '\x1B[31m',
  green: '\x1B[32m',
  yellow: '\x1B[33m',
  cyan: '\x1B[36m',
} as const

function paint(enabled: boolean, code: string, text: string): string {
  return enabled ? `${code}${text}${ANSI.reset}` : text
}

function truncate(text: string, max = 120): string {
  const singleLine = text.replace(/\s+/g, ' ').trim()
  return singleLine.length <= max ? singleLine : `${singleLine.slice(0, max - 1)}…`
}

function formatDuration(ms: number): string {
  if (ms < 1000)
    return `${Math.max(0, Math.round(ms))}ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60)
    return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60)
    return `${minutes}m ${rest}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function bar(completed: number, total: number, width = 10): string {
  const ratio = total <= 0 ? 0 : Math.min(1, Math.max(0, completed / total))
  const filled = Math.round(ratio * width)
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`
}

function headerLines(info: ArchiveReporterStart, color: boolean): string[] {
  return [
    paint(color, ANSI.bold, `weibo-cli archive user ${info.uid}`),
    `  out      ${info.outPath}`,
    ...(info.range === undefined ? [] : [`  range    ${info.range}`]),
    ...(info.resumed === true ? [`  resume   ${info.loadedRecords ?? 0} records loaded`] : []),
  ]
}

function summaryLines(info: ArchiveReporterFinish, color: boolean): string[] {
  const icon = info.complete
    ? paint(color, ANSI.green, '✔')
    : paint(color, ANSI.yellow, '⚠')
  const expected = info.summary.estimatedTotal === undefined
    ? []
    : [`  expected ${info.summary.estimatedTotal}${info.summary.coverage === undefined ? '' : ` (coverage ${(info.summary.coverage * 100).toFixed(1)}%)`}`]
  const missing = info.summary.estimatedTotal === undefined || info.summary.tweets >= info.summary.estimatedTotal
    ? []
    : [
        `  missing  ${info.summary.estimatedTotal - info.summary.tweets}`,
        '  note     total 可能包含已删除 / 不可见微博',
      ]
  return [
    `${icon} archive ${info.complete ? 'complete' : 'incomplete'}`,
    `  out      ${info.outPath}`,
    `  tweets   ${info.summary.tweets}`,
    ...expected,
    ...missing,
    `  comments ${info.summary.comments}`,
    `  replies  ${info.summary.replies}`,
    `  errors   ${info.summary.errors}`,
    `  took     ${formatDuration(info.elapsedMs)}`,
  ]
}

function countReplies(entry: UserArchiveRecord): number {
  return entry.record.comments.reduce((sum, comment) => sum + (comment.replies?.length ?? 0), 0)
}

class SilentReporter implements ArchiveReporter {
  start(): void {}
  progress(): void {}
  record(): void {}
  issue(): void {}
  notice(): void {}
  partsKept(): void {}
  rawSummary(): void {}
  finish(): void {}
  close(): void {}
}

class NdjsonReporter implements ArchiveReporter {
  constructor(private readonly stream: ReporterStream) {}

  private write(value: unknown): void {
    this.stream.write(`${JSON.stringify(value)}\n`)
  }

  start(): void {}
  record(): void {}
  finish(): void {}
  close(): void {}

  progress(progress: UserArchiveProgress): void {
    this.write({ event: 'progress', ...progress })
  }

  issue(issue: ArchiveIssue): void {
    this.write({ event: 'issue', ...issue })
  }

  notice(message: string): void {
    this.write({ event: 'notice', message })
  }

  partsKept(path: string): void {
    this.write({ event: 'parts-kept', path })
  }

  rawSummary(info: ArchiveRawSummary): void {
    this.write({ event: 'raw', ...info })
  }
}

interface SliceStats {
  tweets: number
  comments: number
  replies: number
  errors: number
  startedAt: number
}

class LineReporter implements ArchiveReporter {
  protected comments = 0
  protected replies = 0
  protected errors = 0
  protected readonly sliceStats = new Map<string, SliceStats>()
  private currentSlice?: string

  constructor(
    protected readonly stream: ReporterStream,
    protected readonly color: boolean,
  ) {}

  protected write(line: string): void {
    this.stream.write(`${line}\n`)
  }

  protected ensureSlice(slice: string): SliceStats {
    let stats = this.sliceStats.get(slice)
    if (!stats) {
      stats = { tweets: 0, comments: 0, replies: 0, errors: 0, startedAt: Date.now() }
      this.sliceStats.set(slice, stats)
    }
    return stats
  }

  protected sliceLabel(progress: UserArchiveProgress): string {
    const base = progress.slice.startsWith('s') ? progress.slice.split('-')[0] : progress.slice
    return progress.sliceTotal === undefined ? base : `${base}/${progress.sliceTotal}`
  }

  protected sliceDoneLine(progress: UserArchiveProgress): string {
    const label = this.sliceLabel(progress)
    const stats = this.sliceStats.get(progress.slice)
    const details = stats && stats.tweets > 0
      ? `  tweets=${stats.tweets}  comments=${stats.comments}  replies=${stats.replies}  errors=${stats.errors}  ${formatDuration(Date.now() - stats.startedAt)}`
      : ''
    return `  ${paint(this.color, ANSI.green, '✓')} ${label} done${details}`
  }

  protected trackIssue(issue: ArchiveIssue, slice?: string): void {
    this.errors += 1
    if (slice !== undefined)
      this.ensureSlice(slice).errors += 1
  }

  start(info: ArchiveReporterStart): void {
    for (const line of headerLines(info, this.color))
      this.write(line)
  }

  progress(progress: UserArchiveProgress): void {
    this.ensureSlice(progress.slice)
    if (progress.phase === 'slice-done') {
      this.write(this.sliceDoneLine(progress))
      return
    }
    // 切片开始的那次进度没有 page / source；每页的进度不单独刷行，避免噪音。
    if (progress.phase === 'enumerate' && progress.page === undefined && progress.source === undefined) {
      if (this.currentSlice !== progress.slice) {
        this.currentSlice = progress.slice
        this.write(`  ${paint(this.color, ANSI.cyan, '→')} ${this.sliceLabel(progress)} start`)
      }
    }
  }

  record(entry: UserArchiveRecord): void {
    const stats = this.ensureSlice(entry.slice)
    const comments = entry.record.comments.length
    const replies = countReplies(entry)
    stats.tweets += 1
    stats.comments += comments
    stats.replies += replies
    this.comments += comments
    this.replies += replies
  }

  issue(issue: ArchiveIssue, slice?: string): void {
    this.trackIssue(issue, slice)
    this.write(`  ${paint(this.color, ANSI.red, '✖')} ${issue.stage} ${issue.code}: ${truncate(issue.message)}`)
  }

  notice(message: string): void {
    this.write(`  ${paint(this.color, ANSI.dim, '!')} ${message}`)
  }

  partsKept(path: string): void {
    this.write(`  ${paint(this.color, ANSI.yellow, '!')} parts kept: ${path}`)
  }

  rawSummary(info: ArchiveRawSummary): void {
    const suffix = info.error === undefined ? '' : ` (${truncate(info.error)})`
    this.write(`  raw      ${info.path} lines=${info.lines}${suffix}`)
  }

  finish(info: ArchiveReporterFinish): void {
    this.write('')
    for (const line of summaryLines(info, this.color))
      this.write(line)
  }

  close(): void {}
}

function truncateLine(text: string, max: number): string {
  const oneLine = text.replace(/[\r\n]+/g, ' ')
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`
}

class InteractiveReporter extends LineReporter {
  private timer?: ReturnType<typeof setTimeout>
  private closed = false
  private finished = false
  private cursorHidden = false
  private statusVisible = false
  private lastStatus?: string
  private slice = '—'
  private phase: UserArchiveProgress['phase'] = 'enumerate'
  private source?: string
  private page?: number
  private processed = 0
  private total?: number
  private remaining?: number
  private overallTotal?: number
  private sliceTotal?: number
  private startedAt = Date.now()
  private runStartProcessed?: number

  private readonly onExit = (): void => this.restore()
  private readonly onSigint = (): void => {
    this.restore()
    process.exit(130)
  }

  constructor(stream: ReporterStream, color: boolean) {
    super(stream, color)
    process.once('exit', this.onExit)
    process.once('SIGINT', this.onSigint)
  }

  private hideCursor(): void {
    if (this.cursorHidden)
      return
    this.stream.write('\x1B[?25l')
    this.cursorHidden = true
  }

  private restore(): void {
    this.clearTimer()
    this.clearStatus()
    if (this.cursorHidden) {
      this.stream.write('\x1B[?25h')
      this.cursorHidden = false
    }
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  private schedule(): void {
    if (this.closed || this.finished || this.timer !== undefined)
      return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.renderStatus()
    }, 100)
  }

  private clearStatus(): void {
    if (!this.statusVisible)
      return
    this.stream.write('\r\x1B[2K')
    this.statusVisible = false
  }

  private statusText(): string {
    const base = this.slice.startsWith('s') ? this.slice.split('-')[0] : this.slice
    const slice = this.sliceTotal === undefined ? base : `${base}/${this.sliceTotal}`
    const phase = this.phase === 'enumerate'
      ? (this.source === undefined ? 'enumerate' : `enumerate/${this.source}`)
      : this.phase
    const parts = [slice, phase]

    if (this.total !== undefined && this.remaining !== undefined && this.total > 0) {
      const completed = Math.max(0, this.total - this.remaining)
      parts.push(`${bar(completed, this.total)} ${completed}/${this.total}`)
    }

    const percent = this.overallTotal !== undefined && this.overallTotal > 0
      ? ` (${((this.processed / this.overallTotal) * 100).toFixed(1)}%)`
      : ''
    parts.push(`tweets ${this.processed}${this.overallTotal === undefined ? '' : `/${this.overallTotal}${percent}`}`)

    if (this.overallTotal !== undefined && this.runStartProcessed !== undefined) {
      const completedThisRun = this.processed - this.runStartProcessed
      const remaining = this.overallTotal - this.processed
      if (completedThisRun > 0 && remaining > 0) {
        const elapsed = Date.now() - this.startedAt
        parts.push(`eta ${formatDuration((elapsed / completedThisRun) * remaining)}`)
      }
    }

    if (this.comments > 0)
      parts.push(`comments ${this.comments}`)
    if (this.replies > 0)
      parts.push(`replies ${this.replies}`)
    if (this.page !== undefined)
      parts.push(`page ${this.page}`)
    parts.push(`errors ${this.errors}`)
    return parts.join('  ')
  }

  private renderStatus(): void {
    if (this.closed || this.finished)
      return
    const width = Math.max(20, (this.stream.columns ?? 100) - 1)
    const line = truncateLine(this.statusText(), width)
    if (this.statusVisible && this.lastStatus === line)
      return
    this.stream.write('\r\x1B[2K')
    this.stream.write(paint(this.color, ANSI.cyan, line))
    this.lastStatus = line
    this.statusVisible = true
  }

  private append(line: string): void {
    if (this.closed || this.finished)
      return
    this.clearStatus()
    this.write(line)
    this.renderStatus()
  }

  override start(info: ArchiveReporterStart): void {
    this.startedAt = Date.now()
    super.start(info)
    this.hideCursor()
    this.renderStatus()
  }

  override progress(progress: UserArchiveProgress): void {
    this.ensureSlice(progress.slice)
    if (progress.sliceTotal !== undefined)
      this.sliceTotal = progress.sliceTotal
    if (this.runStartProcessed === undefined)
      this.runStartProcessed = progress.processed
    if (progress.slice !== this.slice) {
      this.slice = progress.slice
      this.source = undefined
      this.page = undefined
      this.total = undefined
      this.remaining = undefined
    }
    this.phase = progress.phase
    if (progress.source !== undefined)
      this.source = progress.source
    if (progress.page !== undefined)
      this.page = progress.page
    this.processed = progress.processed
    if (progress.total !== undefined)
      this.total = progress.total
    if (progress.remaining !== undefined)
      this.remaining = progress.remaining
    if (progress.overallTotal !== undefined)
      this.overallTotal = progress.overallTotal

    if (progress.phase === 'slice-done') {
      this.append(this.sliceDoneLine(progress))
      return
    }
    this.schedule()
  }

  override record(entry: UserArchiveRecord): void {
    super.record(entry)
    this.schedule()
  }

  override issue(issue: ArchiveIssue, slice?: string): void {
    this.trackIssue(issue, slice)
    this.append(`  ${paint(this.color, ANSI.red, '✖')} ${issue.stage} ${issue.code}: ${truncate(issue.message)}`)
  }

  override notice(message: string): void {
    this.append(`  ${paint(this.color, ANSI.dim, '!')} ${message}`)
  }

  override partsKept(path: string): void {
    this.append(`  ${paint(this.color, ANSI.yellow, '!')} parts kept: ${path}`)
  }

  override rawSummary(info: ArchiveRawSummary): void {
    const suffix = info.error === undefined ? '' : ` (${truncate(info.error)})`
    this.append(`  raw      ${info.path} lines=${info.lines}${suffix}`)
  }

  override finish(info: ArchiveReporterFinish): void {
    if (this.finished)
      return
    this.finished = true
    this.restore()
    for (const line of summaryLines(info, this.color))
      this.write(line)
  }

  override close(): void {
    if (this.closed)
      return
    this.closed = true
    this.restore()
    process.removeListener('exit', this.onExit)
    process.removeListener('SIGINT', this.onSigint)
  }
}

/** 按格式创建 reporter；invalid 格式由 `resolveLogFormat` 提前拦截。 */
export function createArchiveReporter(options: ArchiveReporterOptions): ArchiveReporter {
  if (options.format === 'silent')
    return new SilentReporter()
  if (options.format === 'ndjson')
    return new NdjsonReporter(options.stream)
  if (options.interactive && !options.noProgress)
    return new InteractiveReporter(options.stream, options.color)
  return new LineReporter(options.stream, options.color)
}
