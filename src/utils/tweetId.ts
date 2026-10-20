import { InvalidConfigError } from '../models/errors/ConfigError'

/**
 * 微博 id 形态。
 *
 * - `mblogid`：字母/数字混合的 9 位形式，如 `QqsYymYOS`（网页端常用）
 * - `mid`：纯数字形式，如 `5356120103455672`（`m.weibo.cn/status/<mid>` 复制出来的形式）
 */
export type TweetIdKind = 'mblogid' | 'mid'

/** `parseTweetIdInput` 的解析结果。 */
export interface ParsedTweetId {
  /** 提取出的 id（不含 URL、查询串、空白） */
  id: string
  /** id 形态；纯数字视为 `mid`，其余视为 `mblogid` */
  kind: TweetIdKind
  /** 输入来源：直接传 id 还是从 URL / 分享文案中提取 */
  source: 'bare' | 'url'
}

const TOKEN_PATTERN = /^[0-9a-z]+$/i
const NUMERIC_PATTERN = /^\d+$/
const WEIBO_HOSTS = new Set([
  'weibo.com',
  'www.weibo.com',
  's.weibo.com',
  'weibo.cn',
  'www.weibo.cn',
  'm.weibo.cn',
])

/** 匹配完整 URL（含协议），或分享文案里不带协议的 `weibo.com/...`。 */
const URL_PATTERN = /https?:\/\/[^\s"'<>]+|(?:[a-z0-9-]+\.)*weibo\.(?:com|cn)\/[^\s"'<>]+/i

function invalid(input: string, reason: string): never {
  throw new InvalidConfigError(
    `无法识别微博 id：${reason}。支持 mblogId（如 QqsYymYOS）、数字 mid（如 5356120103455672）或微博状态 URL（如 https://m.weibo.cn/status/5356120103455672）。`,
    {
      field: 'tweetId',
      input: input.length > 200 ? `${input.slice(0, 200)}…` : input,
    },
  )
}

function token(value: string, input: string): string {
  if (!TOKEN_PATTERN.test(value))
    invalid(input, 'URL 中的 id 只能包含字母和数字')
  return value
}

function fromUrl(candidate: string, input: string): string | undefined {
  let text = candidate.trim()
  if (text.startsWith('//'))
    text = `https:${text}`
  else if (!/^[a-z][a-z\d+.-]*:\/\//i.test(text))
    text = `https://${text}`

  let url: URL
  try {
    url = new URL(text)
  }
  catch {
    return undefined
  }

  if (!WEIBO_HOSTS.has(url.hostname.toLowerCase()))
    return undefined

  const segments = url.pathname.split('/').filter(Boolean)
  const [first, second] = segments

  // m.weibo.cn/status/<id>, m.weibo.cn/detail/<id>, weibo.com/detail/<id>, weibo.com/status/<id>
  if ((first === 'status' || first === 'detail') && second)
    return token(second, input)

  // weibo.com/<uid>/<mblogid>
  if (first && NUMERIC_PATTERN.test(first) && second)
    return token(second, input)

  // m.weibo.cn/statuses/show?id=<id>, weibo.com/ajax/statuses/show?id=<id>
  const last = segments[segments.length - 1]
  const queryId = url.searchParams.get('id')
  if (
    queryId
    && last
    && segments.includes('statuses')
    && (last === 'show' || last === 'extend' || last === 'longtext')
  ) {
    return token(queryId, input)
  }

  return undefined
}

function classify(id: string): TweetIdKind {
  return NUMERIC_PATTERN.test(id) ? 'mid' : 'mblogid'
}

/**
 * 解析用户可能传入的微博 id。
 *
 * 支持：
 * - 裸 mblogId：`QqsYymYOS`
 * - 裸数字 mid：`5356120103455672`
 * - 状态 URL：`https://m.weibo.cn/status/<mid>`、`https://m.weibo.cn/detail/<mid>`、
 *   `https://weibo.com/<uid>/<mblogid>`、`https://weibo.com/detail/<mblogid>`、
 *   `https://weibo.com/status/<mblogid>`（可带 query / fragment / 尾斜杠）
 * - 分享文案中夹带的上述 URL（取第一个）
 *
 * @param input 用户输入
 * @returns `{ id, kind, source }`
 * @throws `InvalidConfigError`（`CONFIG_INVALID`）输入为空、URL 无法提取 id、或不是微博域名
 */
export function parseTweetIdInput(input: string): ParsedTweetId {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (raw === '')
    invalid(typeof input === 'string' ? input : String(input), '输入为空')

  const matched = raw.match(URL_PATTERN)
  if (matched) {
    const id = fromUrl(matched[0], raw)
    if (!id)
      invalid(raw, '无法从微博状态 URL 中提取 id（不支持用户主页、文章页或 t.cn 短链接）')
    return { id, kind: classify(id), source: 'url' }
  }

  if (!TOKEN_PATTERN.test(raw))
    invalid(raw, '既不是微博状态 URL，也不是只含字母/数字的 id')

  return { id: raw, kind: classify(raw), source: 'bare' }
}

/**
 * `parseTweetIdInput` 的便捷版本：只返回提取出的 id。
 *
 * @throws `InvalidConfigError`（`CONFIG_INVALID`）输入无法识别时
 */
export function normalizeTweetIdInput(input: string): string {
  return parseTweetIdInput(input).id
}
