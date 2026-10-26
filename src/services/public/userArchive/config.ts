import type {
  UserArchiveContentOptions,
  UserArchiveMeta,
  UserArchiveOptions,
  UserArchiveResumeMode,
  UserArchiveRunConfig,
} from '~/types/archive/IUserArchive'
import { InvalidConfigError, ResumeMismatchError } from '~/models/errors/ConfigError'
import { USER_ARCHIVE_JOURNAL_SCHEMA } from '~/types/archive/IUserArchive'
import { resolveTimeInput } from '~/utils/timeInput'
import { planUserArchiveSlices } from './slices'

const WEIBO_EPOCH = '2009-08-14'
export const DEFAULT_USER_ARCHIVE_SLICE_DAYS = 30
export const DEFAULT_USER_ARCHIVE_CONCURRENCY = 6
export const MAX_USER_ARCHIVE_CONCURRENCY = 32
/** 默认最多拉取的一级评论页数；0 / 显式 all 才表示不限。 */
export const DEFAULT_USER_ARCHIVE_COMMENT_PAGES = 2
/** 默认每条一级评论最多拉取的楼中楼页数；0 / 显式 all 才表示不限。 */
export const DEFAULT_USER_ARCHIVE_REPLY_PAGES = 2

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

/** 页数上限：缺省用默认值，`0` 表示不限。 */
function pageLimit(value: unknown, fallback: number, field: string): number | undefined {
  if (value === undefined || value === null)
    return fallback
  if (typeof value === 'string' && value.trim() === '')
    return fallback
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < 0)
    throw configError(field, value, 'Expected a non-negative integer (0 = all pages).')
  return parsed === 0 ? undefined : parsed
}

export function resolveUserArchiveConcurrency(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value))
    return DEFAULT_USER_ARCHIVE_CONCURRENCY
  if (value < 1)
    throw configError('concurrency', value, `Expected an integer >= 1 (max ${MAX_USER_ARCHIVE_CONCURRENCY}).`)
  return Math.min(MAX_USER_ARCHIVE_CONCURRENCY, Math.floor(value))
}

export function resolveUserArchiveResume(value: unknown): UserArchiveResumeMode {
  if (value === undefined || value === null || value === '')
    return 'strict'
  if (value === 'strict' || value === 'merge')
    return value
  throw configError('resume', value, 'Expected "strict" or "merge".')
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
    maxCommentPages: pageLimit(options.maxCommentPages, DEFAULT_USER_ARCHIVE_COMMENT_PAGES, 'maxCommentPages'),
    maxReplies: positiveInt(options.maxReplies, 'maxReplies'),
    maxReplyPages: pageLimit(options.maxReplyPages, DEFAULT_USER_ARCHIVE_REPLY_PAGES, 'maxReplyPages'),
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

/**
 * 续跑时用 journal 里的配置补齐未显式传入的选项。
 *
 * `strict` 连范围一起沿用，保证与 journal 可比较；`merge` 只沿用内容选项和切片天数，
 * 范围按本次传入值 / 默认值重新解析，这样「最近 N 天」这类相对范围每次都能推进。
 */
export function applyUserArchiveResumeDefaults(
  options: UserArchiveOptions,
  existing?: UserArchiveRunConfig,
  resume: UserArchiveResumeMode = 'strict',
): UserArchiveOptions {
  if (!existing)
    return options

  const inheritRange = resume === 'strict'
  return {
    ...options,
    ...(inheritRange ? { since: options.since ?? existing.range.since.input } : {}),
    ...(inheritRange ? { until: options.until ?? existing.range.until.input } : {}),
    sliceDays: options.sliceDays ?? existing.sliceDays,
    includeComments: options.includeComments ?? existing.options.includeComments,
    includeReplies: options.includeReplies ?? existing.options.includeReplies,
    includeReposts: options.includeReposts ?? existing.options.includeReposts,
    commentOrder: options.commentOrder ?? existing.options.commentOrder,
    maxComments: options.maxComments ?? existing.options.maxComments,
    // 旧 journal 没有页数上限字段，按当时的「不限」语义补 0（build 时再转成 undefined）。
    maxCommentPages: options.maxCommentPages ?? existing.options.maxCommentPages ?? 0,
    maxReplies: options.maxReplies ?? existing.options.maxReplies,
    maxReplyPages: options.maxReplyPages ?? existing.options.maxReplyPages ?? 0,
    maxReposts: options.maxReposts ?? existing.options.maxReposts,
    maxRepostPages: options.maxRepostPages ?? existing.options.maxRepostPages,
  }
}

function resumeError(mismatch: string, message: string, actual: unknown, expected: unknown): ResumeMismatchError {
  return new ResumeMismatchError(message, { field: 'resume', mismatch, actual, expected })
}

function assertSame(field: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw resumeError(
      field,
      `Resume config mismatch for ${field}: got ${JSON.stringify(actual)}, journal has ${JSON.stringify(expected)}. `
      + 'Use the original options, pass resume: "merge" (CLI: --resume merge) to keep records, or clear the store before starting over.',
      actual,
      expected,
    )
  }
}

/**
 * 续跑时校验 journal 与本次配置。
 *
 * `strict` 要求 uid / 范围 / 切片天数 / 内容选项 / 切片计划全部一致；
 * `merge` 只校验 uid —— 账号不能混归档，范围与选项可以变。
 */
export function validateUserArchiveResume(
  meta: UserArchiveMeta,
  config: UserArchiveRunConfig,
  resume: UserArchiveResumeMode = 'strict',
): void {
  if (meta.config.uid !== config.uid) {
    throw resumeError(
      'uid',
      `Journal belongs to uid ${meta.config.uid}, got ${config.uid}. Clear the store before archiving another account.`,
      config.uid,
      meta.config.uid,
    )
  }
  if (resume === 'merge')
    return

  assertSame('since', config.range.since.unix, meta.config.range.since.unix)
  assertSame('until', config.range.until.unix, meta.config.range.until.unix)
  assertSame('sliceDays', config.sliceDays, meta.config.sliceDays)
  assertSame('options', config.options, meta.config.options)

  const planned = planUserArchiveSlices(config.range.since.unix, config.range.until.unix, config.sliceDays)
  const samePlan = planned.length === meta.slices.length
    && planned.every((slice, index) => slice.key === meta.slices[index].key)
  if (!samePlan) {
    throw resumeError(
      'slices',
      'Resume slice plan does not match the journal. '
      + 'Pass resume: "merge" (CLI: --resume merge) to keep records and re-plan the slices, or clear the store to start over.',
      planned.map(slice => slice.key),
      meta.slices.map(slice => slice.key),
    )
  }
}

/**
 * `merge` 续跑：用新配置重建 meta，保留用户快照与 createdAt，切片计划按新范围重算。
 * 进度（totals）只保留 key 仍存在的部分，其余切片重新枚举。
 */
export function mergeUserArchiveMeta(meta: UserArchiveMeta, config: UserArchiveRunConfig): UserArchiveMeta {
  const slices = planUserArchiveSlices(config.range.since.unix, config.range.until.unix, config.sliceDays)
  const keys = new Set(slices.map(slice => slice.key))
  const totals = Object.fromEntries(
    Object.entries(meta.totals ?? {}).filter(([key]) => keys.has(key)),
  )

  return {
    type: 'meta',
    schema: USER_ARCHIVE_JOURNAL_SCHEMA,
    createdAt: meta.createdAt,
    config,
    slices,
    user: meta.user,
    ...(Object.keys(totals).length === 0 ? {} : { totals }),
  }
}
