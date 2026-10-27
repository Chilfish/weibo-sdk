import type { ITweet, ITweetComment, TweetAttachment, TweetMedia } from '~/types/domain/ITweet'
import type {
  ITweetContext,
  TweetContextAttachment,
  TweetContextAuthor,
  TweetContextComment,
  TweetContextFlags,
  TweetContextMedia,
  TweetContextMediaDownload,
  TweetContextMediaRelation,
  TweetContextPost,
  TweetContextRepostEntry,
  TweetContextVisibility,
} from '~/types/domain/ITweetContext'
import { MediaType, TweetVisible } from '~/types/domain/ITweet'
import { TWEET_CONTEXT_SCHEMA } from '~/types/domain/ITweetContext'

type UnknownRecord = Record<string, unknown>

/** `buildTweetContext` 的选项（全部可选；builder 本身不发请求）。 */
export interface BuildTweetContextOptions {
  /** 已补拉的作者资料（不传时只使用 `ITweet.user` 的简版信息） */
  author?: TweetContextAuthor
  /** 已拉取的评论（按给定顺序输出） */
  comments?: ITweetComment[]
  /** 上游 raw 响应（读取 `isAd` / `isLongText` / `is_paid` / `content_auth`） */
  raw?: unknown
  /** 转发的原微博 raw（读取原微博的 flags） */
  quotedRaw?: unknown
  /** 补拉的长微博全文（传入时替换 `post.text`） */
  longText?: string
  /** 是否已补拉长文（用于 `unknowns` 与 provenance） */
  longTextFetched?: boolean
  /** 单个文本字段的字符上限；`0` / 缺省 = 不限 */
  maxChars?: number
  /** 最多列出的媒体数；缺省 = 全部 */
  maxMedia?: number
  /** 是否展开转发的原微博（默认 `true`，只展开一层） */
  includeQuoted?: boolean
  /** 是否展开转发链（默认 `true`） */
  includeRepostChain?: boolean
  /** 当前 context 的媒体归属（根上下文为 `self`，原微博为 `quoted`） */
  mediaRelation?: TweetContextMediaRelation
  /** 递归深度（内部使用；默认 0） */
  depth?: number
  /** 作者资料拉取失败时的错误信息（写入 `unknowns`，不伪造作者资料） */
  authorError?: string
  /** 抓取时间（毫秒时间戳；测试注入） */
  now?: number
  /** 鉴权模式 */
  authMode?: 'cookie' | 'guest'
}

const MONTHS: Record<string, string> = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
}

const VISIBILITY: Record<number, TweetContextVisibility> = {
  [TweetVisible.PUBLIC]: 'public',
  [TweetVisible.PRIVATE]: 'private',
  [TweetVisible.FRIENDS]: 'friends',
  [TweetVisible.FOLLOWERS]: 'followers',
  [TweetVisible.GROUP]: 'group',
}

const MEDIA_TYPE: Record<MediaType, TweetContextMedia['type']> = {
  [MediaType.PIC]: 'pic',
  [MediaType.GIF]: 'gif',
  [MediaType.LIVEPHOTO]: 'livephoto',
  [MediaType.VIDEO]: 'video',
  [MediaType.UNKNOWN]: 'unknown',
}

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g
const TCN_RE = /https?:\/\/t\.cn\/[A-Za-z0-9]+/g

/**
 * 微博时间格式 → UTC ISO + 带偏移本地时间。
 *
 * 微博网页 / m 站的 `created_at` 常见两种形态：
 * - `Tue Oct 20 15:40:07 +0800 2026`（空格分隔，年份在最后）
 * - ISO `2026-10-20T15:40:07+08:00`
 *
 * 解析失败时原样返回，不猜测时区。
 */
export function normalizeTweetDate(value: string): { publishedAt: string, publishedAtLocal?: string } {
  const raw = value.trim()
  const weibo = raw.match(/^[a-z]{3} ([a-z]{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2}) (\d{4})$/i)
  if (weibo) {
    const [, mon, day, hh, mm, ss, sign, offH, offM, year] = weibo
    const month = MONTHS[mon]
    if (month) {
      const local = `${year}-${month}-${String(day).padStart(2, '0')}T${hh}:${mm}:${ss}${sign}${offH}:${offM}`
      const parsed = new Date(local)
      if (!Number.isNaN(parsed.getTime()))
        return { publishedAt: parsed.toISOString(), publishedAtLocal: local }
    }
  }

  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) {
    const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/.test(raw)
    return hasOffset
      ? { publishedAt: parsed.toISOString(), publishedAtLocal: raw }
      : { publishedAt: parsed.toISOString() }
  }

  return { publishedAt: raw }
}

/** 清理正文：去零宽字符、HTML 实体、行尾空格与多余空行。 */
export function cleanTweetText(value: string): string {
  return value
    .replace(ZERO_WIDTH, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function truncate(value: string, maxChars: number | undefined): { text: string, truncated: boolean } {
  if (!maxChars || maxChars <= 0 || value.length <= maxChars)
    return { text: value, truncated: false }
  return { text: `${value.slice(0, maxChars)}…`, truncated: true }
}

function booleanFlag(raw: UnknownRecord, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = raw[key]
    if (typeof value === 'boolean')
      return value
  }
  return undefined
}

/** 追加一条 unknowns / hints，已存在则跳过（同一附件出现两次时不重复说同一句话）。 */
function pushUnique(list: string[], message: string): void {
  if (!list.includes(message))
    list.push(message)
}

function toRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {}
}

function authorFromUser(tweet: ITweet, author?: TweetContextAuthor): TweetContextAuthor {
  if (author)
    return author
  return {
    id: tweet.user.id,
    name: tweet.user.name,
    verified: tweet.user.verified,
    verifiedType: tweet.user.verifiedType,
  }
}

function collectMentions(tweet: ITweet, ownText: string): string[] {
  const out: string[] = []
  for (const user of tweet.atUsers ?? []) {
    if (user.name && ownText.includes(`@${user.name}`) && !out.includes(user.name))
      out.push(user.name)
  }
  return out
}

function collectLinks(tweet: ITweet, ownText: string, unknowns: string[]): TweetContextPost['links'] {
  const out: TweetContextPost['links'] = []
  const shortUrls = new Set<string>()
  for (const card of tweet.linkCards ?? []) {
    if (!card.url)
      continue
    if (card.shortUrl)
      shortUrls.add(card.shortUrl)
    // 转发链场景：只保留当前作者正文引用到的卡片，避免把原微博的卡片算到作者头上
    if (card.shortUrl && !ownText.includes(card.shortUrl))
      continue
    out.push({ title: card.title, url: card.url })
  }

  const unresolved = ownText.match(TCN_RE)?.filter(url => !shortUrls.has(url)) ?? []
  if (unresolved.length > 0)
    unknowns.push(`正文有 ${unresolved.length} 个未解析的 t.cn 短链`)

  return out
}

function textReferencesImages(text: string): boolean {
  return /图\s*[1-9一二三四五六七八九]|左图|右图|上图|下图|配图/.test(text)
}

function mediaType(type: MediaType): TweetContextMedia['type'] {
  return MEDIA_TYPE[type] ?? 'unknown'
}

function mediaHints(media: TweetMedia): string[] {
  const hints: string[] = []
  const ratio = media.height > 0 ? media.width / media.height : 0
  if (ratio > 0 && ratio < 0.45)
    hints.push('tall_image:likely_long_screenshot')
  if (media.type === MediaType.VIDEO)
    hints.push('video:needs_transcript')
  if (media.type === MediaType.GIF || media.type === MediaType.LIVEPHOTO)
    hints.push('animated:static_cover_only')
  return hints
}

function buildMedia(
  media: TweetMedia[],
  owner: TweetContextMedia['owner'],
  maxMedia: number | undefined,
  unknowns: string[],
): TweetContextMedia[] {
  const limited = maxMedia && maxMedia > 0 ? media.slice(0, maxMedia) : media
  if (limited.length < media.length)
    unknowns.push(`媒体只列出了前 ${limited.length} 个（共 ${media.length} 个）`)

  return limited.map((item, index) => {
    const out: TweetContextMedia = {
      index: index + 1,
      mediaId: item.id,
      owner,
      type: mediaType(item.type),
      url: item.videoUrl ?? item.imageUrl,
      width: item.width,
      height: item.height,
      aspectRatio: item.height > 0 ? Number((item.width / item.height).toFixed(2)) : 0,
      temporary: true,
      hints: mediaHints(item),
    }
    if (item.videoUrl && item.imageUrl)
      out.coverUrl = item.imageUrl
    if (item.duration !== undefined)
      out.duration = item.duration
    return out
  })
}

function buildComments(
  comments: ITweetComment[],
  tweet: ITweet,
  maxChars: number | undefined,
  unknowns: string[],
): TweetContextComment[] {
  const out = comments.map((comment) => {
    const item: TweetContextComment = {
      author: comment.user.name,
      text: truncate(cleanTweetText(comment.text), maxChars).text,
      likes: comment.likes,
    }
    if (comment.user.id)
      item.userId = comment.user.id
    if (comment.totalReplies !== undefined)
      item.replies = comment.totalReplies
    if (comment.user.id === tweet.user.id)
      item.isAuthor = true
    return item
  })

  if (out.length > 0)
    unknowns.push(`评论只抽样了 ${out.length} 条，不代表整体舆论`)

  return out
}

/**
 * 把 `ITweet.attachments` 投影为 Agent 视角的最小字段集（纯函数，不发请求）。
 *
 * 与 `media` / `links` 一致：能确定性展开的就展开（投票选项、直播状态），
 * 展开不了的写进 `unknowns`；同一句话只写一次（去重），保持 `attachments` 顺序不变。
 */
function buildAttachments(
  attachments: TweetAttachment[],
  unknowns: string[],
  hints: string[],
): TweetContextAttachment[] {
  type AttachmentOption = NonNullable<TweetContextAttachment['options']>[number]

  const out: TweetContextAttachment[] = []

  for (const attachment of attachments) {
    const item: TweetContextAttachment = {
      kind: attachment.kind,
      title: attachment.title,
      url: attachment.url,
    }

    switch (attachment.kind) {
      case 'article': {
        if (attachment.summary)
          item.summary = attachment.summary
        if (attachment.author)
          item.author = attachment.author
        if (attachment.isPaid !== undefined) {
          item.isPaid = attachment.isPaid
          if (attachment.isPaid)
            pushUnique(unknowns, '付费文章，正文可能不完整')
        }
        // 正文默认不抓（见 docs §5）；只说「没抓」，不假装读过。
        pushUnique(unknowns, '文章正文未抓取（只有元数据）')
        break
      }
      case 'vote': {
        item.multiSelect = attachment.multiSelect
        if (attachment.totalVotes !== undefined)
          item.totalVotes = attachment.totalVotes
        if (attachment.expiresAt !== undefined)
          item.expiresAt = attachment.expiresAt
        if (attachment.options.length > 0) {
          item.options = attachment.options.map((option) => {
            const projected: AttachmentOption = { text: option.text }
            if (option.votes !== undefined)
              projected.votes = option.votes
            if (option.ratio !== undefined)
              projected.ratio = option.ratio
            if (option.selected !== undefined)
              projected.selected = option.selected
            return projected
          })
        }
        pushUnique(hints, '投票票数是抓取时快照，不代表实时')
        break
      }
      case 'live': {
        if (attachment.status !== undefined) {
          item.liveStatus = attachment.status
          // 样本 3 = 已结束/有回放，但没有官方文档：原样保留 + 明确标注语义未确认
          pushUnique(unknowns, '直播状态码语义未确认')
        }
        if (attachment.startedAt !== undefined)
          item.startedAt = attachment.startedAt
        if (attachment.viewerCount !== undefined)
          item.viewerCount = attachment.viewerCount
        if (attachment.streamUrl)
          item.streamUrl = attachment.streamUrl
        if (attachment.replayUrl)
          item.replayUrl = attachment.replayUrl
        pushUnique(hints, '直播流/回放地址是临时地址，需要及时处理')
        break
      }
      case 'lottery': {
        // 抽奖详情页是 HTML，没有结构化接口：只给链接
        pushUnique(unknowns, '抽奖详情未抓取（只有链接）')
        break
      }
    }

    out.push(item)
  }

  return out
}

/**
 * 把 `ITweet` 投影为 Agent 视角的 `ITweetContext`（纯函数）。
 *
 * 语义保证：
 * - `post.text` 只包含当前作者本人的发言（转发时取 `repostChain[0]`）；
 * - `mentions` 只包含当前作者正文里的 @；
 * - `media[]` 只包含当前微博自己的媒体，原微博媒体在 `quoted.media[]`；
 * - 无法确定的信息写入 `unknowns`，可推导的确定性提示写入 `hints`。
 */
export function buildTweetContext(tweet: ITweet, options: BuildTweetContextOptions = {}): ITweetContext {
  const depth = options.depth ?? 0
  const relation = options.mediaRelation ?? (depth === 0 ? 'self' : 'quoted')
  const maxChars = options.maxChars
  const unknowns: string[] = []
  const hints: string[] = []
  const raw = toRecord(options.raw)

  // 转发链是「谁说的哪一句」的唯一依据：即使不展示 chain，也不能回退到拍平的 text。
  const chain = tweet.repostChain
  const ownTextRaw = chain && chain.length > 0 ? (chain[0]?.text ?? '') : tweet.text
  const longTextValue = options.longText && options.longText.length > 0 ? options.longText : undefined
  const longTextApplied = longTextValue !== undefined
  const ownTextCleaned = cleanTweetText(longTextValue ?? ownTextRaw)
  const ownText = truncate(ownTextCleaned, maxChars)
  if (ownText.truncated)
    unknowns.push(`正文超过 ${maxChars} 字符，已截断`)

  const { publishedAt, publishedAtLocal } = normalizeTweetDate(tweet.createdAt)

  const flags: TweetContextFlags = {}
  const isAd = booleanFlag(raw, 'isAd', 'is_ad')
  const isPaid = booleanFlag(raw, 'is_paid', 'isPaid')
  const isLongText = booleanFlag(raw, 'isLongText', 'is_long_text')
  if (isAd !== undefined)
    flags.isAd = isAd
  if (isPaid !== undefined)
    flags.isPaid = isPaid
  if (typeof raw.content_auth === 'number' && raw.content_auth !== 0)
    flags.contentAuth = raw.content_auth
  if (tweet.stats.edits !== undefined && tweet.stats.edits > 0)
    flags.edited = true
  if (tweet.flags?.pinned)
    flags.pinned = true
  if (isLongText && !longTextApplied) {
    flags.textTruncated = true
    unknowns.push('上游标记 isLongText=true：当前正文可能被截断')
  }
  if (isAd)
    hints.push('advertisement')
  if (options.authorError)
    unknowns.push(`作者资料未拉取：${options.authorError}`)

  const links = collectLinks(tweet, ownText.text, unknowns)
  const media = buildMedia(tweet.media, { mblogId: tweet.mblogId, relation }, options.maxMedia, unknowns)
  const attachments = buildAttachments(tweet.attachments ?? [], unknowns, hints)

  const post: TweetContextPost = {
    kind: tweet.retweetedStatus ? 'repost' : chain && chain.length > 0 ? 'repost' : 'original',
    id: tweet.id,
    mblogId: tweet.mblogId,
    author: authorFromUser(tweet, options.author),
    publishedAt,
    source: tweet.source,
    visibility: VISIBILITY[tweet.visible] ?? 'unknown',
    text: ownText.text,
    topics: tweet.topics ?? [],
    mentions: collectMentions(tweet, ownText.text),
    links,
    attachments,
    stats: { ...tweet.stats },
    flags,
  }
  if (tweet.sourceUrl)
    post.url = tweet.sourceUrl
  if (publishedAtLocal)
    post.publishedAtLocal = publishedAtLocal
  if (tweet.regionName)
    post.location = tweet.regionName.replace(/^发布于\s*/, '')
  if (tweet.stats.reads !== undefined)
    post.stats.reads = tweet.stats.reads

  if (post.text.length === 0 && media.length > 0)
    hints.push('no_text:content_is_in_media_only')

  const repostChain: TweetContextRepostEntry[] | undefined = chain && chain.length > 0 && options.includeRepostChain !== false
    ? chain.map((entry) => {
        const item: TweetContextRepostEntry = {
          index: entry.index,
          text: truncate(cleanTweetText(entry.text), maxChars).text,
          role: 'commentary',
        }
        if (entry.authorName)
          item.author = entry.authorName
        return item
      })
    : undefined
  if (repostChain && repostChain.length > 1)
    hints.push('repost_chain:each_level_is_commentary_not_original')

  const quoted = options.includeQuoted !== false && depth < 1 && tweet.retweetedStatus
    ? buildTweetContext(tweet.retweetedStatus, {
        ...options,
        depth: depth + 1,
        mediaRelation: 'quoted',
        raw: options.quotedRaw,
        author: undefined,
        comments: undefined,
        longText: undefined,
        longTextFetched: false,
      })
    : undefined

  if (tweet.retweetedStatus && !quoted)
    unknowns.push('转发的原微博未展开')
  if (quoted && quoted.media.length > 0 && media.length === 0)
    hints.push('media_from_quoted_post:not_the_poster_own_media')
  if (media.length >= 6 || (quoted?.media.length ?? 0) >= 6)
    hints.push('photo_dump:order_matters')
  if ((media.length > 0 || (quoted?.media.length ?? 0) > 0) && textReferencesImages(ownText.text))
    hints.push('text_references_images')
  if (quoted)
    hints.push('quoted_post:author_is_not_the_poster')

  const effectiveMedia = [...media, ...(quoted?.media ?? [])]
  if (effectiveMedia.length > 0) {
    unknowns.push(`有 ${effectiveMedia.length} 个媒体：只给了 URL/尺寸，没有画面内容描述或 OCR 文本`)
    if (effectiveMedia.some(item => item.type === 'video'))
      unknowns.push('视频没有字幕/转写')
  }
  else if (!quoted) {
    // 转发但未展开原微博时，媒体可能在原微博里；不能简单说「没有媒体」。
    hints.push(tweet.retweetedStatus
      ? 'no_media_in_context:quoted_post_not_expanded'
      : 'no_media')
  }

  const discussion = options.comments && options.comments.length > 0
    ? buildComments(options.comments, tweet, maxChars, unknowns)
    : undefined

  const context: ITweetContext = {
    schema: TWEET_CONTEXT_SCHEMA,
    post,
    media,
    provenance: {
      fetchedAt: new Date(options.now ?? Date.now()).toISOString(),
      via: options.authMode ? `sdk.tweets.context (${options.authMode})` : 'sdk.tweets.context',
      ...(discussion ? { commentsSampled: discussion.length } : {}),
      ...(options.longTextFetched ? { longTextFetched: true } : {}),
      ...(options.authMode ? { authMode: options.authMode } : {}),
    },
    unknowns,
    hints,
  }
  if (repostChain)
    context.repostChain = repostChain
  if (quoted)
    context.quoted = quoted
  if (discussion)
    context.discussion = discussion

  return context
}

/** 下载项的最小形状（与 `MediaDownloadItem` 结构兼容，避免视图层依赖下载实现）。 */
export interface TweetContextDownloadLike {
  mediaId: string
  variant: 'image' | 'video'
  status: 'downloaded' | 'skipped' | 'planned' | 'failed'
  path: string
  bytes?: number
  contentType?: string
}

/**
 * 把媒体下载结果挂回 context（原地修改）。
 *
 * 只匹配 `mediaId` 相同的条目；LivePhoto 的 `video` 变体不会覆盖图片主资源。
 */
export function attachMediaDownloads(
  context: ITweetContext,
  relation: TweetContextMediaRelation,
  items: readonly TweetContextDownloadLike[],
): void {
  const target = relation === 'quoted' ? (context.quoted?.media ?? []) : context.media

  for (const item of items) {
    if (item.path.length === 0)
      continue
    const media = target.find(entry => entry.mediaId === item.mediaId)
    if (!media)
      continue
    if (item.variant === 'video' && media.type !== 'video')
      continue
    const download: TweetContextMediaDownload = { path: item.path, status: item.status }
    if (item.bytes !== undefined)
      download.bytes = item.bytes
    if (item.contentType)
      download.contentType = item.contentType
    media.download = download
  }
}

/** 收集 context 中所有媒体所属的微博（用于下载时逐个刷新临时 URL）。 */
export function collectMediaOwners(context: ITweetContext): Array<{ mblogId: string, relation: TweetContextMediaRelation }> {
  const owners: Array<{ mblogId: string, relation: TweetContextMediaRelation }> = []
  const add = (mblogId: string, relation: TweetContextMediaRelation): void => {
    if (mblogId.length === 0)
      return
    if (owners.some(owner => owner.mblogId === mblogId))
      return
    owners.push({ mblogId, relation })
  }

  if (context.media.length > 0)
    add(context.post.mblogId, 'self')
  if (context.quoted?.media.length)
    add(context.quoted.post.mblogId, 'quoted')
  return owners
}

const VISIBILITY_LABEL: Record<TweetContextVisibility, string> = {
  public: '公开',
  private: '仅自己可见',
  friends: '仅互关好友可见',
  followers: '仅粉丝可见',
  group: '仅群组可见',
  unknown: '未知',
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined)
    return ''
  if (bytes < 1024)
    return `${bytes} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function renderMediaLines(media: TweetContextMedia[], prefix = ''): string[] {
  const lines: string[] = []
  const readHints = new Set<string>()
  for (const item of media) {
    const kind = item.type === 'video'
      ? '视频'
      : item.type === 'gif'
        ? '动图'
        : item.type === 'livephoto'
          ? '实况照片'
          : item.type === 'unknown' ? '未知媒体' : '图片'
    const duration = item.duration !== undefined ? ` · ${item.duration}s` : ''
    const owner = item.owner.relation === 'self' ? '当前微博' : '转发的原微博'
    lines.push(`${prefix}- 图${item.index}：${kind} ${item.width}×${item.height}（比例 ${item.aspectRatio}）${duration} · 归属：${owner}${item.hints.length > 0 ? ` · ${item.hints.join(', ')}` : ''}`)
    lines.push(`${prefix}  URL（临时签名，需及时下载）：${item.url}`)
    if (item.coverUrl)
      lines.push(`${prefix}  封面：${item.coverUrl}`)
    if (item.download?.path) {
      const size = formatBytes(item.download.bytes)
      const type = item.download.contentType ? `, ${item.download.contentType}` : ''
      lines.push(`${prefix}  本地文件：${item.download.path}${size ? `（${size}${type}）` : ''}`)
    }
    else {
      const ownerKey = `${item.owner.mblogId}:${item.owner.relation}`
      if (!readHints.has(ownerKey)) {
        readHints.add(ownerKey)
        lines.push(`${prefix}  读取方式：weibo-cli media download ${item.owner.mblogId} -o <dir>`)
      }
    }
    if (item.description)
      lines.push(`${prefix}  描述：${item.description}`)
    if (item.ocrText)
      lines.push(`${prefix}  OCR：${item.ocrText}`)
    if (item.transcript)
      lines.push(`${prefix}  转写：${item.transcript}`)
  }
  return lines
}

/**
 * 把 `ITweetContext` 渲染成确定性的 Markdown 上下文卡片。
 *
 * 这是给提示词 / 人阅读的视图，不是总结：章节固定、事实与未知分开。
 */
export function renderTweetContextMarkdown(context: ITweetContext): string {
  const { post } = context
  const lines: string[] = []
  const when = post.publishedAtLocal ?? post.publishedAt
  lines.push(`# 微博上下文：@${post.author.name} · ${when}`)
  lines.push('')

  lines.push('## 谁发的')
  const identity = [`${post.author.name}（uid ${post.author.id}）`]
  if (post.author.verified) {
    identity.push(post.author.verifiedReason
      ? `已认证（${post.author.verifiedReason}）`
      : '已认证')
  }
  if (post.author.followers !== undefined)
    identity.push(`粉丝 ${post.author.followers.toLocaleString('en-US')}`)
  if (post.author.following === true)
    identity.push('你关注了 TA')
  if (post.author.followedBy === true)
    identity.push('TA 关注了你')
  lines.push(identity.join(' · '))
  if (post.author.description)
    lines.push(`简介：${post.author.description}`)
  if (post.author.url)
    lines.push(`主页：${post.author.url}`)
  lines.push('')

  lines.push('## 说了什么')
  lines.push('')
  lines.push(post.text || '（无正文）')
  lines.push('')

  const flags: string[] = []
  if (post.flags.isAd)
    flags.push('广告')
  if (post.flags.isPaid)
    flags.push('付费内容')
  if (post.flags.textTruncated)
    flags.push('正文可能被截断')
  if (post.flags.edited)
    flags.push('已编辑')
  if (post.flags.pinned)
    flags.push('置顶')
  if (post.flags.contentAuth !== undefined)
    flags.push(`contentAuth=${post.flags.contentAuth}`)

  const meta = [
    `类型：${post.kind === 'repost' ? '转发' : '原创'}`,
    `来源：${post.source}`,
    `可见性：${VISIBILITY_LABEL[post.visibility]}`,
  ]
  if (flags.length > 0)
    meta.push(`标记：${flags.join(' / ')}`)
  if (post.location)
    meta.push(`发布地：${post.location}`)
  const reads = post.stats.reads !== undefined ? ` · 阅读 ${post.stats.reads}` : ''
  meta.push(`互动（快照）：赞 ${post.stats.likes} · 评论 ${post.stats.comments} · 转发 ${post.stats.reposts}${reads}`)
  lines.push(meta.join('  \n'))

  if (post.topics.length > 0)
    lines.push('', `话题：${post.topics.map(topic => `#${topic}#`).join(' ')}`)
  if (post.mentions.length > 0)
    lines.push(`提及：${post.mentions.map(name => `@${name}`).join(' ')}`)
  if (post.links.length > 0) {
    lines.push('')
    for (const link of post.links)
      lines.push(`链接：${link.title ? `[${link.title}](${link.url})` : link.url}`)
  }
  lines.push('')

  if (context.quoted) {
    const quoted = context.quoted
    lines.push('## 转发的原微博（不是当前作者的正文）')
    lines.push(`> 原作者：@${quoted.post.author.name} · ${quoted.post.publishedAtLocal ?? quoted.post.publishedAt}`)
    lines.push('>')
    for (const line of quoted.post.text.split('\n'))
      lines.push(`> ${line}`)
    if (quoted.media.length > 0) {
      lines.push('>')
      lines.push('> 原微博媒体（以下图片属于原微博，不是当前作者的配图）：')
      for (const line of renderMediaLines(quoted.media, '> '))
        lines.push(line)
    }
    lines.push('')
  }

  if (context.repostChain) {
    lines.push('## 转发链（由近到远，每层都是转发者的话，不是原文）')
    for (const entry of context.repostChain)
      lines.push(`${entry.index + 1}. @${entry.author ?? '未知'}：${entry.text || '（无文字）'}`)
    lines.push('')
  }

  if (context.media.length > 0) {
    lines.push('## 配了什么（媒体属于谁、怎么读）')
    lines.push(...renderMediaLines(context.media))
    lines.push('')
  }

  if (context.discussion && context.discussion.length > 0) {
    lines.push('## 讨论（按热度抽样，不代表全部）')
    for (const comment of context.discussion) {
      const author = comment.isAuthor ? `@${comment.author}（作者）` : `@${comment.author}`
      const replies = comment.replies !== undefined ? `，回复 ${comment.replies}` : ''
      lines.push(`- ${author}（赞 ${comment.likes}${replies}）：${comment.text}`)
    }
    lines.push('')
  }

  lines.push('## 抓取信息与未知项')
  lines.push(`- 抓取时间：${context.provenance.fetchedAt}`)
  lines.push(`- 来源：${context.provenance.via}`)
  if (context.provenance.longTextFetched)
    lines.push('- 长微博全文：已补拉')
  if (post.url)
    lines.push(`- 原文：${post.url}`)
  if (context.unknowns.length > 0) {
    for (const unknown of context.unknowns)
      lines.push(`- 未知：${unknown}`)
  }
  else {
    lines.push('- 未知：无')
  }
  if (context.hints.length > 0)
    lines.push(`- 提示：${context.hints.join('; ')}`)

  return lines.join('\n')
}
