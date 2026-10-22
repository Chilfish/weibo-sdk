import type { UserArchiveProgress } from '~/types/archive/IUserArchive'
import { makeArchiveComment } from 'tests/testkit/userArchive'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isInteractiveOutput,
  resolveLogFormat,
  supportsColor,
} from '~/cli/terminal/format'
import { createArchiveReporter } from '~/cli/terminal/reporter'

function collector(): { chunks: string[], stream: { write: (chunk: string) => void } } {
  const chunks: string[] = []
  const write = (chunk: string): void => {
    chunks.push(chunk)
  }
  return { chunks, stream: { write } }
}

afterEach(() => {
  vi.useRealTimers()
})

function progress(overrides: Partial<UserArchiveProgress> = {}): UserArchiveProgress {
  return {
    uid: '123',
    slice: 's000-1-2',
    phase: 'enumerate',
    processed: 3,
    source: 'search',
    page: 2,
    total: 10,
    remaining: 4,
    ...overrides,
  }
}

describe('resolveLogFormat', () => {
  it('explicitFormatWins', () => {
    expect(resolveLogFormat({ 'log-format': 'pretty' }, { env: { CI: '1' }, isTTY: false })).toBe('pretty')
    expect(resolveLogFormat({ 'log-format': ' NDJSON ' }, { env: {}, isTTY: true })).toBe('ndjson')
    expect(resolveLogFormat({ 'log-format': 'silent' }, { env: {}, isTTY: true })).toBe('silent')
  })

  it('invalidFormatThrows', () => {
    expect(() => resolveLogFormat({ 'log-format': 'colorful' }, { env: {}, isTTY: true })).toThrow(/Unknown log format/)
  })

  it('quietMeansSilent', () => {
    expect(resolveLogFormat({ quiet: true }, { env: {}, isTTY: true })).toBe('silent')
  })

  it('fallsBackToNdjsonWhenNotInteractive', () => {
    expect(resolveLogFormat({}, { env: {}, isTTY: false })).toBe('ndjson')
    expect(resolveLogFormat({}, { env: { CI: '1' }, isTTY: true })).toBe('ndjson')
    expect(resolveLogFormat({}, { env: { TERM: 'dumb' }, isTTY: true })).toBe('ndjson')
  })

  it('usesPrettyOnCleanTty', () => {
    expect(resolveLogFormat({}, { env: {}, isTTY: true })).toBe('pretty')
  })
})

describe('isInteractiveOutput', () => {
  it('onlyEnablesForCleanPrettyTty', () => {
    expect(isInteractiveOutput('pretty', { env: {}, isTTY: true })).toBe(true)
    expect(isInteractiveOutput('pretty', { env: {}, isTTY: true, noProgress: true })).toBe(false)
    expect(isInteractiveOutput('pretty', { env: { CI: '1' }, isTTY: true })).toBe(false)
    expect(isInteractiveOutput('pretty', { env: {}, isTTY: false })).toBe(false)
    expect(isInteractiveOutput('ndjson', { env: {}, isTTY: true })).toBe(false)
  })
})

describe('supportsColor', () => {
  it('respectsNoColorAndForceColor', () => {
    expect(supportsColor({ env: { NO_COLOR: '1' }, isTTY: true })).toBe(false)
    expect(supportsColor({ env: { FORCE_COLOR: '1' }, isTTY: false })).toBe(true)
    expect(supportsColor({ env: { FORCE_COLOR: '0' }, isTTY: true })).toBe(false)
    expect(supportsColor({ env: {}, isTTY: true })).toBe(true)
    expect(supportsColor({ env: {}, isTTY: false })).toBe(false)
  })
})

describe('reporter', () => {
  it('ndjsonKeepsMachineReadableLines', () => {
    const { chunks, stream } = collector()
    const reporter = createArchiveReporter({ format: 'ndjson', stream, interactive: false, color: false, noProgress: false })

    reporter.start({ uid: '123', outPath: 'out.json' })
    reporter.progress(progress())
    reporter.issue({ stage: 'comments', code: 'RATE_LIMITED', message: 'slow down' })
    reporter.notice('clamped')
    reporter.partsKept('out.json.slices')
    reporter.rawSummary({ path: 'out.raw.ndjson', lines: 2 })
    reporter.finish({ outPath: 'out.json', complete: true, summary: { uid: '123', tweets: 3, comments: 1, replies: 2, errors: 0, complete: true }, elapsedMs: 1000 })
    reporter.close()

    expect(chunks).toHaveLength(5)
    expect(JSON.parse(chunks[0])).toMatchObject({ event: 'progress', slice: 's000-1-2', processed: 3 })
    expect(JSON.parse(chunks[1])).toMatchObject({ event: 'issue', code: 'RATE_LIMITED' })
    expect(JSON.parse(chunks[2])).toEqual({ event: 'notice', message: 'clamped' })
    expect(JSON.parse(chunks[3])).toEqual({ event: 'parts-kept', path: 'out.json.slices' })
    expect(JSON.parse(chunks[4])).toEqual({ event: 'raw', path: 'out.raw.ndjson', lines: 2 })
  })

  it('silentWritesNothing', () => {
    const { chunks, stream } = collector()
    const reporter = createArchiveReporter({ format: 'silent', stream, interactive: false, color: false, noProgress: true })
    reporter.start({ uid: '123', outPath: 'out.json' })
    reporter.progress(progress())
    reporter.finish({ outPath: 'out.json', complete: true, summary: { uid: '123', tweets: 0, comments: 0, replies: 0, errors: 0, complete: true }, elapsedMs: 10 })
    reporter.close()
    expect(chunks).toEqual([])
  })

  it('prettyLineModeWritesHeaderSliceAndSummary', () => {
    const { chunks, stream } = collector()
    const reporter = createArchiveReporter({ format: 'pretty', stream, interactive: false, color: false, noProgress: true })

    reporter.start({ uid: '123', outPath: 'out.json', range: '2025-01-01 → 2025-01-31' })
    reporter.progress(progress({ phase: 'enumerate', page: undefined, source: undefined }))
    reporter.progress(progress({ phase: 'slice-done' }))
    reporter.issue({ stage: 'comments', code: 'UNKNOWN', message: 'boom' })
    reporter.finish({
      outPath: 'out.json',
      complete: false,
      summary: { uid: '123', tweets: 3, comments: 1, replies: 2, errors: 1, complete: false, estimatedTotal: 10, coverage: 0.3 },
      elapsedMs: 65_000,
    })
    reporter.close()

    const text = chunks.join('')
    expect(text).toContain('weibo-cli archive user 123')
    expect(text).toContain('2025-01-01 → 2025-01-31')
    expect(text).toContain('→ s000 start')
    expect(text).toContain('✓ s000 done')
    expect(text).toContain('✖ comments UNKNOWN: boom')
    expect(text).toContain('archive incomplete')
    expect(text).toContain('expected 10 (coverage 30.0%)')
    expect(text).toContain('missing  7')
    expect(text).toContain('1m 5s')
    expect(text).not.toContain('\x1B[?25l')
  })

  it('interactivePrettyModeHidesCursorAndRestoresIt', () => {
    const { chunks, stream } = collector()
    const reporter = createArchiveReporter({ format: 'pretty', stream, interactive: true, color: true, noProgress: false })

    reporter.start({ uid: '123', outPath: 'out.json' })
    reporter.progress(progress())
    reporter.progress(progress({ phase: 'slice-done' }))
    reporter.record({
      slice: 's000-1-2',
      mblogId: 'A',
      record: {
        mblogId: 'A',
        source: 'timeline',
        tweet: {} as never,
        comments: [makeArchiveComment('c1', { replies: [makeArchiveComment('r1')] })],
      },
      issues: [],
    })
    reporter.finish({
      outPath: 'out.json',
      complete: true,
      summary: { uid: '123', tweets: 1, comments: 1, replies: 1, errors: 0, complete: true },
      elapsedMs: 1200,
    })
    reporter.close()

    const text = chunks.join('')
    expect(text).toContain('\x1B[?25l')
    expect(text).toContain('\x1B[?25h')
    expect(text).toContain('archive complete')
    expect(text).toContain('s000 done')
    expect(text).toContain('tweets')
  })

  it('colorToggleRemovesAnsiInLineMode', () => {
    const plain = collector()
    const colored = collector()
    const opts = { format: 'pretty' as const, interactive: false, noProgress: true }
    const info = { uid: '123', outPath: 'out.json' }

    createArchiveReporter({ ...opts, stream: plain.stream, color: false }).start(info)
    createArchiveReporter({ ...opts, stream: colored.stream, color: true }).start(info)

    expect(plain.chunks.join('')).not.toContain('\x1B[')
    expect(colored.chunks.join('')).toContain('\x1B[')
  })

  it('printsResumeHeader', () => {
    const { chunks, stream } = collector()
    const reporter = createArchiveReporter({ format: 'pretty', stream, interactive: false, color: false, noProgress: true })
    reporter.start({ uid: '123', outPath: 'out.json', resumed: true, loadedRecords: 752 })
    reporter.close()
    expect(chunks.join('')).toContain('resume   752 records loaded')
  })

  it('interactiveProgressKeepsBarWhenTotalsAreOmitted', () => {
    vi.useFakeTimers()
    const { chunks, stream } = collector()
    const reporter = createArchiveReporter({ format: 'pretty', stream, interactive: true, color: false, noProgress: false })

    reporter.start({ uid: '123', outPath: 'out.json' })
    reporter.progress(progress({ overallTotal: 10, total: 10, remaining: 4, page: 1 }))
    vi.advanceTimersByTime(100)
    expect(chunks.join('')).toContain('6/10')
    expect(chunks.join('')).toContain('tweets 3/10')

    const before = chunks.length
    reporter.progress(progress({ phase: 'complete', page: undefined, source: undefined, total: undefined, remaining: undefined }))
    vi.advanceTimersByTime(100)
    const second = chunks.slice(before).join('')
    expect(second).toContain('6/10')

    reporter.close()
  })

  it('interactiveProgressRedrawsInPlace', () => {
    vi.useFakeTimers()
    const { chunks, stream } = collector()
    const reporter = createArchiveReporter({ format: 'pretty', stream, interactive: true, color: false, noProgress: false })

    reporter.start({ uid: '123', outPath: 'out.json' })
    reporter.progress(progress())
    vi.advanceTimersByTime(100)

    const before = chunks.length
    reporter.progress(progress({ processed: 4 }))
    vi.advanceTimersByTime(100)
    const second = chunks.slice(before).join('')
    expect(second).toContain('\r\x1B[2K')
    expect(second).not.toContain('\n')

    reporter.close()
  })
})
