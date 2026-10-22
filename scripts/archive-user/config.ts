import type { CliValues } from './cli'
import type { RunConfig, RunOptions } from './types'
import { resolveTimeInput } from '../../src/utils/timeInput'
import {
  DEFAULT_BURST,
  DEFAULT_CONCURRENCY,
  DEFAULT_DELAY_MS,
  DEFAULT_SLICE_DAYS,
  MAX_BURST,
  MAX_CONCURRENCY,
  WEIBO_EPOCH,
} from './constants'

export function positiveInt(value: unknown, name: string): number | undefined {
  if (typeof value !== 'string' || value.trim() === '')
    return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0)
    throw new Error(`--${name} 需要非负整数，收到 ${JSON.stringify(value)}`)
  return parsed === 0 ? undefined : parsed
}

export function resolveConcurrency(value: unknown): number {
  if (typeof value !== 'string' || value.trim() === '')
    return DEFAULT_CONCURRENCY
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`--concurrency 需要正整数，收到 ${JSON.stringify(value)}`)
  return Math.min(MAX_CONCURRENCY, parsed)
}

export function resolveSliceDays(value: unknown): number {
  if (typeof value !== 'string' || value.trim() === '')
    return DEFAULT_SLICE_DAYS
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3660)
    throw new Error(`--slice-days 需要 0–3660 的整数，收到 ${JSON.stringify(value)}`)
  return parsed
}

export function resolveDelay(value: unknown): number {
  if (typeof value !== 'string' || value.trim() === '')
    return DEFAULT_DELAY_MS
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`--delay 需要正整数毫秒，收到 ${JSON.stringify(value)}`)
  return parsed
}

export function resolveBurst(value: unknown): number {
  if (typeof value !== 'string' || value.trim() === '')
    return DEFAULT_BURST
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`--burst 需要正整数，收到 ${JSON.stringify(value)}`)
  return Math.min(MAX_BURST, parsed)
}

export function normalizeUid(input: string): string {
  const value = input.trim()
  const fromUrl = value.match(/weibo\.(?:com|cn)\/(?:u\/)?(\d{5,})/i)?.[1]
  const uid = fromUrl ?? value
  if (!/^\d+$/.test(uid))
    throw new Error(`UID 必须是数字（也接受 https://weibo.com/u/<uid>），收到 ${JSON.stringify(input)}`)
  return uid
}

function parseCommentOrder(value: unknown): 'time' | 'hot' {
  if (value === 'time' || value === 'hot')
    return value
  throw new Error(`--comment-order 只接受 time / hot，收到 ${JSON.stringify(value)}`)
}

export function buildConfig(uid: string, values: CliValues): RunConfig {
  const sinceInput = typeof values.since === 'string' && values.since.trim() !== ''
    ? values.since
    : WEIBO_EPOCH
  const untilInput = typeof values.until === 'string' && values.until.trim() !== ''
    ? values.until
    : String(Math.floor(Date.now() / 1000))
  const sinceUnix = resolveTimeInput(sinceInput, { boundary: 'start', field: 'since' })
  const untilUnix = resolveTimeInput(untilInput, { boundary: 'end', field: 'until' })
  if (sinceUnix > untilUnix)
    throw new Error(`--since（${sinceInput}）不能晚于 --until（${untilInput}）`)

  const options: RunOptions = {
    includeComments: values['no-comments'] !== true,
    includeReplies: values['no-replies'] !== true,
    includeReposts: values.reposts === true,
    commentOrder: parseCommentOrder(values['comment-order'] ?? 'time'),
    maxComments: positiveInt(values['max-comments'], 'max-comments'),
    maxCommentPages: positiveInt(values['max-comment-pages'], 'max-comment-pages'),
    maxReplies: positiveInt(values['max-replies'], 'max-replies'),
    maxReplyPages: positiveInt(values['max-reply-pages'], 'max-reply-pages'),
    maxReposts: positiveInt(values['max-reposts'], 'max-reposts'),
    maxRepostPages: positiveInt(values['max-repost-pages'], 'max-repost-pages'),
  }

  return {
    uid,
    range: {
      since: { input: sinceInput, unix: sinceUnix },
      until: { input: untilInput, unix: untilUnix },
    },
    sliceDays: resolveSliceDays(values['slice-days']),
    options,
  }
}

function assertSameOption(name: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `--${name}=${JSON.stringify(actual)} 与断点日志不一致（已有 ${JSON.stringify(expected)}）。`
      + ' 去掉该参数继续，或加 --fresh 重新开始。',
    )
  }
}

/** 续跑时只允许省略参数（沿用 journal），显式传入的值必须与第一次一致。 */
export function assertResumeConfig(
  config: RunConfig,
  uid: string,
  provided: Set<string>,
  values: CliValues,
): void {
  if (config.uid !== uid)
    throw new Error(`journal 属于 uid ${config.uid}，当前是 ${uid}（加 --fresh 重新开始）`)

  if (provided.has('since') && values.since !== undefined) {
    const since = resolveTimeInput(values.since, { boundary: 'start', field: 'since' })
    assertSameOption('since', since, config.range.since.unix)
  }
  if (provided.has('until') && values.until !== undefined) {
    const until = resolveTimeInput(values.until, { boundary: 'end', field: 'until' })
    assertSameOption('until', until, config.range.until.unix)
  }
  if (provided.has('slice-days'))
    assertSameOption('slice-days', resolveSliceDays(values['slice-days']), config.sliceDays)
  if (provided.has('comment-order'))
    assertSameOption('comment-order', values['comment-order'], config.options.commentOrder)
  if (provided.has('no-comments') && config.options.includeComments)
    throw new Error('断点日志是包含评论的归档，不能再加 --no-comments（加 --fresh 重新开始）')
  if (provided.has('no-replies') && config.options.includeReplies)
    throw new Error('断点日志包含楼中楼，不能再加 --no-replies（加 --fresh 重新开始）')
  if (provided.has('reposts') && !config.options.includeReposts)
    throw new Error('断点日志没有归档转发，不能中途加 --reposts（加 --fresh 重新开始）')

  const maxOptions: Array<[string, number | undefined, number | undefined]> = [
    ['max-comments', positiveInt(values['max-comments'], 'max-comments'), config.options.maxComments],
    ['max-comment-pages', positiveInt(values['max-comment-pages'], 'max-comment-pages'), config.options.maxCommentPages],
    ['max-replies', positiveInt(values['max-replies'], 'max-replies'), config.options.maxReplies],
    ['max-reply-pages', positiveInt(values['max-reply-pages'], 'max-reply-pages'), config.options.maxReplyPages],
    ['max-reposts', positiveInt(values['max-reposts'], 'max-reposts'), config.options.maxReposts],
    ['max-repost-pages', positiveInt(values['max-repost-pages'], 'max-repost-pages'), config.options.maxRepostPages],
  ]
  for (const [name, actual, expected] of maxOptions) {
    if (provided.has(name))
      assertSameOption(name, actual, expected)
  }
}
