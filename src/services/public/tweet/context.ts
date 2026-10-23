import type { StatusShowResponse } from '../../endpoints/tweet'
import type { ITweetComment, TweetLongText, TweetUser } from '~/types/domain/ITweet'
import type { ITweetContext, TweetContextAuthor } from '~/types/domain/ITweetContext'
import { Tweet } from '~/models/data/Tweet'
import { buildTweetContext } from '~/models/view/TweetContext'
import { normalizeTweetIdInput } from '~/utils/tweetId'

/**
 * `context()` 的可选行为开关。
 *
 * 默认只发 1 次请求（`statuses/show`）；以下开关会按需增加请求：
 * `longText`（+1，仅 `isLongText` 时）、`author`（+1）、`comments`（≥1 页）。
 */
export interface TweetContextOptions {
  /** 是否补拉作者资料（简介 / 粉丝数 / 认证说明 / 关注关系）；默认 `true` */
  author?: boolean
  /** 抽样评论条数；默认 `0`（不拉评论） */
  comments?: number
  /** 评论排序；默认 `hot`（上游 `flow=0`） */
  commentFlow?: 'hot' | 'time'
  /** `isLongText` 时是否补拉长文全文；默认 `true` */
  longText?: boolean
  /** 单个文本字段字符上限；缺省 = 不限 */
  maxChars?: number
  /** 最多列出的媒体数；缺省 = 全部 */
  maxMedia?: number
  /** 是否展开转发的原微博（只展开一层）；默认 `true` */
  includeQuoted?: boolean
  /** 是否展开转发链；默认 `true` */
  includeRepostChain?: boolean
  /** 测试注入的当前时间（毫秒时间戳） */
  now?: number
  /** 鉴权模式（仅用于 provenance，不改变请求行为） */
  authMode?: 'cookie' | 'guest'
}

/** `context()` 的跨领域依赖（由 `WeiboSDK` 注入，避免 TweetService 直接依赖 UserService）。 */
export interface TweetContextDeps {
  /** 拉取作者资料（`ajax/profile/info` 的 `data.user`） */
  authorProfile?: (uid: string) => Promise<unknown>
}

/** `context()` 需要的数据源（由 `TweetService` 适配，避免把整门服务传进投影层）。 */
export interface TweetContextSource {
  fetchRawStatus: (mblogId: string, isGetLongText?: boolean) => Promise<StatusShowResponse>
  longText: (mblogId: string) => Promise<TweetLongText>
  streamComments: (
    mblogId: string,
    options: { maxItems?: number, flow?: 0 | 1 },
  ) => AsyncIterable<ITweetComment>
}

/** 把作者 raw 资料归一化为 `TweetContextAuthor`；缺失字段省略，不填假值。 */
export function normalizeContextAuthor(raw: unknown, fallback: TweetUser): TweetContextAuthor {
  const record = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}
  const author: TweetContextAuthor = {
    id: String(record.idstr || record.id || fallback.id),
    name: String(record.screen_name || fallback.name),
    verified: typeof record.verified === 'boolean' ? record.verified : fallback.verified,
    verifiedType: typeof record.verified_type === 'number' ? record.verified_type : fallback.verifiedType,
  }

  const profileUrl = typeof record.profile_url === 'string' ? record.profile_url : ''
  if (profileUrl)
    author.url = /^https?:\/\//.test(profileUrl) ? profileUrl : `https://weibo.com${profileUrl}`
  if (typeof record.verified_reason === 'string' && record.verified_reason.length > 0)
    author.verifiedReason = record.verified_reason
  if (typeof record.description === 'string' && record.description.length > 0)
    author.description = record.description
  const followers = Number(record.followers_count)
  if (Number.isFinite(followers))
    author.followers = followers
  if (typeof record.following === 'boolean')
    author.following = record.following
  if (typeof record.follow_me === 'boolean')
    author.followedBy = record.follow_me

  return author
}

/**
 * 构造 Agent 视角的单条微博上下文（`weibo.tweet-context/v1`）。
 *
 * 只负责按需补数据；纯投影在 `buildTweetContext` 中完成。
 * 语义要点：
 * - 转发微博的 `post.text` 只取当前作者（`repostChain[0]`），不是拍平的 `//@` 链；
 * - `mentions` 只保留当前作者正文里的 @；
 * - 当前微博的媒体与转发的原微博媒体分开归属；
 * - 不调用任何 LLM；OCR / 视觉描述 / 转写由调用方回填。
 */
export async function loadTweetContext(
  source: TweetContextSource,
  deps: TweetContextDeps,
  mblogId: string,
  options: TweetContextOptions = {},
): Promise<ITweetContext> {
  const id = normalizeTweetIdInput(mblogId)
  const raw = await source.fetchRawStatus(id, true)
  const tweet = new Tweet(raw)
  const rawRecord = raw as unknown as Record<string, unknown>

  // show 之后的长文 / 作者 / 评论互不依赖，并行拉取；评论自身分页仍是串行游标。
  const wantsLongText = options.longText !== false && rawRecord.isLongText === true
  const longTextPromise = wantsLongText
    ? source.longText(id).then(response => response.text)
    : undefined

  const authorProfile = deps.authorProfile
  const authorPromise: Promise<{ author?: TweetContextAuthor, authorError?: string }> | undefined
    = options.author !== false && tweet.user.id && authorProfile
      ? authorProfile(tweet.user.id)
          .then(profile => ({ author: normalizeContextAuthor(profile, tweet.user) }))
          .catch((error: unknown) => ({ authorError: error instanceof Error ? error.message : String(error) }))
      : undefined

  const limit = options.comments !== undefined && Number.isFinite(options.comments)
    ? Math.max(0, Math.floor(options.comments))
    : 0
  const commentsPromise = limit > 0
    ? (async () => {
        const collected: ITweetComment[] = []
        // 时间序需要数字 mid；直接用 idstr 可避免 streamComments 内部的第二次 show 请求。
        const commentsId = options.commentFlow === 'time' ? tweet.id : tweet.mblogId
        for await (const comment of source.streamComments(commentsId, {
          maxItems: limit,
          flow: options.commentFlow === 'time' ? 1 : 0,
        })) {
          collected.push(comment)
        }
        return collected
      })()
    : undefined

  const [longText, authorResult, comments] = await Promise.all([
    longTextPromise,
    authorPromise,
    commentsPromise,
  ])
  const author = authorResult?.author
  const authorError = authorResult?.authorError

  return buildTweetContext(tweet, {
    ...(author ? { author } : {}),
    ...(comments && comments.length > 0 ? { comments } : {}),
    raw,
    quotedRaw: rawRecord.retweeted_status,
    ...(longText !== undefined ? { longText } : {}),
    ...(wantsLongText ? { longTextFetched: true } : {}),
    ...(options.maxChars !== undefined ? { maxChars: options.maxChars } : {}),
    ...(options.maxMedia !== undefined ? { maxMedia: options.maxMedia } : {}),
    ...(options.includeQuoted !== undefined ? { includeQuoted: options.includeQuoted } : {}),
    ...(options.includeRepostChain !== undefined ? { includeRepostChain: options.includeRepostChain } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.authMode ? { authMode: options.authMode } : {}),
    ...(authorError ? { authorError } : {}),
  })
}
