import type {
  UserArchiveContentOptions,
  UserArchiveMeta,
  UserArchiveOptions,
  UserArchiveRunConfig,
} from '~/types/archive/IUserArchive'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { resolveTimeInput } from '~/utils/timeInput'
import { planUserArchiveSlices } from './slices'

const WEIBO_EPOCH = '2009-08-14'
export const DEFAULT_USER_ARCHIVE_SLICE_DAYS = 30
export const DEFAULT_USER_ARCHIVE_CONCURRENCY = 6
export const MAX_USER_ARCHIVE_CONCURRENCY = 16

function configError(field: string, value: unknown, reason: string): InvalidConfigError {
  return new InvalidConfigError(`Invalid ${field}: ${JSON.stringify(value)}. ${reason}`, { field, value, reason })
}

/** 非负整数；`0` 与缺省都表示「不限制」。 */
function positiveInt(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null)
    return undefined
  if (typeof value === 'string' && value.trim() === '')
    return undefined
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < 0)
    throw configError(field, value, 'Expected a non-negative integer.')
  return parsed === 0 ? undefined : parsed
}

export function resolveUserArchiveConcurrency(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value))
    return DEFAULT_USER_ARCHIVE_CONCURRENCY
  if (value < 1)
    throw configError('concurrency', value, `Expected an integer >= 1 (max ${MAX_USER_ARCHIVE_CONCURRENCY}).`)
  return Math.min(MAX_USER_ARCHIVE_CONCURRENCY, Math.floor(value))
}

export function resolveUserArchiveSliceDays(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value))
    return DEFAULT_USER_ARCHIVE_SLICE_DAYS
  if (value < 0 || value > 3660 || !Number.isInteger(value))
    throw configError('sliceDays', value, 'Expected an integer between 0 and 3660.')
  return value
}

function parseCommentOrder(value: unknown): 'time' | 'hot' {
  if (value === undefined)
    return 'time'
  if (value === 'time' || value === 'hot')
    return value
  throw configError('commentOrder', value, 'Expected "time" or "hot".')
}

/** 把 SDK 选项解析成可持久化、可比较的运行配置。 */
export function buildUserArchiveConfig(uid: string, options: UserArchiveOptions): UserArchiveRunConfig {
  const sinceInput = options.since === undefined ? WEIBO_EPOCH : String(options.since)
  const untilInput = options.until === undefined
    ? String(Math.floor(Date.now() / 1000))
    : String(options.until)
  const sinceUnix = resolveTimeInput(sinceInput, { boundary: 'start', field: 'since' })
  const untilUnix = resolveTimeInput(untilInput, { boundary: 'end', field: 'until' })
  if (sinceUnix > untilUnix)
    throw configError('since', sinceInput, `--since (${sinceInput}) must not be later than until (${untilInput}).`)

  const contentOptions: UserArchiveContentOptions = {
    includeComments: options.includeComments ?? true,
    includeReplies: options.includeReplies ?? true,
    includeReposts: options.includeReposts ?? false,
    commentOrder: parseCommentOrder(options.commentOrder),
    maxComments: positiveInt(options.maxComments, 'maxComments'),
    maxCommentPages: positiveInt(options.maxCommentPages, 'maxCommentPages'),
    maxReplies: positiveInt(options.maxReplies, 'maxReplies'),
    maxReplyPages: positiveInt(options.maxReplyPages, 'maxReplyPages'),
    maxReposts: positiveInt(options.maxReposts, 'maxReposts'),
    maxRepostPages: positiveInt(options.maxRepostPages, 'maxRepostPages'),
  }

  return {
    uid,
    range: {
      since: { input: sinceInput, unix: sinceUnix },
      until: { input: untilInput, unix: untilUnix },
    },
    sliceDays: resolveUserArchiveSliceDays(options.sliceDays),
    options: contentOptions,
  }
}

/** 续跑时用 journal 里的配置补齐未显式传入的选项。 */
export function applyUserArchiveResumeDefaults(
  options: UserArchiveOptions,
  existing?: UserArchiveRunConfig,
): UserArchiveOptions {
  if (!existing)
    return options

  return {
    ...options,
    since: options.since ?? existing.range.since.input,
    until: options.until ?? existing.range.until.input,
    sliceDays: options.sliceDays ?? existing.sliceDays,
    includeComments: options.includeComments ?? existing.options.includeComments,
    includeReplies: options.includeReplies ?? existing.options.includeReplies,
    includeReposts: options.includeReposts ?? existing.options.includeReposts,
    commentOrder: options.commentOrder ?? existing.options.commentOrder,
    maxComments: options.maxComments ?? existing.options.maxComments,
    maxCommentPages: options.maxCommentPages ?? existing.options.maxCommentPages,
    maxReplies: options.maxReplies ?? existing.options.maxReplies,
    maxReplyPages: options.maxReplyPages ?? existing.options.maxReplyPages,
    maxReposts: options.maxReposts ?? existing.options.maxReposts,
    maxRepostPages: options.maxRepostPages ?? existing.options.maxRepostPages,
  }
}

function assertSame(field: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new InvalidConfigError(
      `Resume config mismatch for ${field}: got ${JSON.stringify(actual)}, journal has ${JSON.stringify(expected)}. `
      + 'Use the original options or clear the store before starting over.',
      { field, actual, expected },
    )
  }
}

/** 续跑时校验 uid / 范围 / 切片计划 / 内容选项；不一致直接拒绝。 */
export function validateUserArchiveResume(meta: UserArchiveMeta, config: UserArchiveRunConfig): void {
  if (meta.config.uid !== config.uid) {
    throw new InvalidConfigError(
      `Journal belongs to uid ${meta.config.uid}, got ${config.uid}. Clear the store before archiving another account.`,
      { field: 'uid', actual: config.uid, expected: meta.config.uid },
    )
  }

  assertSame('since', config.range.since.unix, meta.config.range.since.unix)
  assertSame('until', config.range.until.unix, meta.config.range.until.unix)
  assertSame('sliceDays', config.sliceDays, meta.config.sliceDays)
  assertSame('options', config.options, meta.config.options)

  const planned = planUserArchiveSlices(config.range.since.unix, config.range.until.unix, config.sliceDays)
  const samePlan = planned.length === meta.slices.length
    && planned.every((slice, index) => slice.key === meta.slices[index].key)
  if (!samePlan) {
    throw new InvalidConfigError('Resume slice plan does not match the journal; clear the store to start over.', {
      field: 'slices',
      expected: meta.slices.map(slice => slice.key),
      actual: planned.map(slice => slice.key),
    })
  }
}
