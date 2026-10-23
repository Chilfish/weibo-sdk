import type {
  AlbumListResult,
  AlbumPhotoPageResult,
  ArchiveCheckpoint,
  ArchivedTweet,
  ArchiveFile,
  ArchiveIssue,
  ArchiveIssueStage,
  ArchiveItem,
  ArchiveUserItem,
  BeforeRetryResult,
  CapabilityFilter,
  CommentHistoryPageResult,
  CommentNotification,
  CommentNotificationPageResult,
  ErrorContext,
  FavoritePageResult,
  FavoriteTag,
  FavoriteTagList,
  FollowingPageResult,
  Gender,
  ImageWallPageResult,
  IProxyProvider,
  IProxyRequestContext,
  ISelfProfile,
  ITweet,
  ITweetComment,
  ITweetContext,
  IUser,
  IUserAlbum,
  IUserLabel,
  IUserMediaAsset,
  IUserVerification,
  IWeiboGuestConfig,
  IWeiboRetryConfig,
  JsonlLogger,
  JsonlTelemetry,
  LikeNotification,
  LikeNotificationPageResult,
  LikePageResult,
  MblogGroup,
  MediaDownloadItem,
  MediaDownloadItemBase,
  MediaDownloadTotals,
  MediaItemErrorContext,
  MediaSkipReason,
  MediaVariant,
  MergeArchiveResult,
  RequestContext,
  ResponseContext,
  RetryContext,
  SearchTweetPageResult,
  SearchUserPageResult,
  SuperTopic,
  SuperTopicCategory,
  SuperTopicPageResult,
  TelemetryEvent,
  TelemetryEventBase,
  TelemetryJsonlInput,
  TelemetryPrimitive,
  TransportMethod,
  TransportRequest,
  TransportRequestMeta,
  TrendItem,
  TweetArticleAttachment,
  TweetAttachment,
  TweetAtUser,
  TweetAudio,
  TweetCommentPic,
  TweetCommentsPageResult,
  TweetContextAttachment,
  TweetContextAttachmentKind,
  TweetContextAuthor,
  TweetContextComment,
  TweetContextFlags,
  TweetContextKind,
  TweetContextLink,
  TweetContextMedia,
  TweetContextMediaDownload,
  TweetContextMediaRelation,
  TweetContextPost,
  TweetContextProvenance,
  TweetContextRepostEntry,
  TweetContextStats,
  TweetContextVisibility,
  TweetContractVersion,
  TweetEnrichResult,
  TweetGeo,
  TweetLiker,
  TweetLikersPageResult,
  TweetLinkCard,
  TweetLiveAttachment,
  TweetLongText,
  TweetLotteryAttachment,
  TweetMedia,
  TweetMediaDownloadResult,
  TweetPageCard,
  TweetPageResult,
  TweetRepostEntry,
  TweetRepostsPageResult,
  TweetSearchByDatePageResult,
  TweetUser,
  TweetVisible,
  TweetVoteAttachment,
  TweetVoteOption,
  UserArchiveMeta,
  UserArchiveRecord,
  UserArchiveResult,
  UserArchiveRunConfig,
  UserArchiveSlice,
  UserArchiveSliceState,
  UserArchiveStore,
  UserArchiveSummary,
  UserBrief,
  UserGroup,
  UserMentionsPageResult,
  VerificationType,
  VideoWaterfallPageResult,
  WeiboAuthMode,
  WeiboCapability,
  WeiboEvent,
  WeiboLogger,
  WeiboLogLevel,
  WeiboLogRecord,
  WeiboProxyInput,
  WeiboRetryKind,
  WeiboSDKErrorMeta,
  WeiboSDKHookBaseMeta,
  WeiboSDKHooks,
  WeiboSDKLifecycleEvent,
  WeiboSDKRawMeta,
  WeiboSDKRequestMeta,
  WeiboSDKSelfCheckMode,
  WeiboSessionContext,
  WeiboTransport,
} from '@chilfish/weibo-sdk'
import type { SdkScenario } from '../lib/types'
import {
  ARCHIVE_SCHEMA_ID,
  ARCHIVE_SCHEMA_URL,
  ConnectionTimeoutError,
  createConsoleLogger,
  createJsonlLogger,
  createLoggerPlugin,
  createMemoryUserArchiveStore,
  createMultiLogger,
  InvalidConfigError,
  MediaDownloadError,
  MediaInvalidResponseError,
  MediaStorageError,
  NetworkRequestError,
  RateLimitError,
  TWEET_CONTRACT_VERSION,
  UnexpectedAPIResponseError,
  USER_ARCHIVE_JOURNAL_SCHEMA,
  VERSION,
  WeiboAPINotOkError,
  WeiboSDKError,
  WeiboSessionExpiredError,
} from '@chilfish/weibo-sdk'

/**
 * 下游最常见的「落库行 / 展示行」映射。
 *
 * 这些函数不调用网络：它们在 `pnpm typecheck` 时验证 Stable 类型的字段形状，
 * 任何字段改名 / 删除 / 类型变化都会让 CI 失败。运行场景只打印覆盖清单。
 */
interface MirrorRow {
  mblogId: string
  author: string
  publishedAt: string
  text: string
  media: string[]
  attachments: string[]
  topics: string[]
  repostDepth: number
}

function formatTweetUser(user: TweetUser): string {
  return `${user.name}(${user.id})`
}

function toMirrorRow(tweet: ITweet): MirrorRow {
  const media: TweetMedia[] = tweet.media
  const attachments: TweetAttachment[] = tweet.attachments ?? []
  return {
    mblogId: tweet.mblogId,
    author: formatTweetUser(tweet.user),
    publishedAt: tweet.createdAt,
    text: tweet.text,
    media: media.map(item => `${item.type}:${item.id}`),
    attachments: attachments.map(item => `${item.kind}:${item.id}`),
    topics: tweet.topics ?? [],
    repostDepth: tweet.repostChain?.length ?? 0,
  }
}

function formatComment(comment: ITweetComment): string {
  return `${comment.user.name}: ${comment.text.slice(0, 60)} likes=${comment.likes} replies=${comment.replies?.length ?? 0}`
}

function formatContext(context: ITweetContext): string {
  const media = context.media.map(item => `${item.type}@${item.owner.relation}`).join(',')
  return `${context.post.author.name} ${context.post.kind} media=${media || 'none'} unknowns=${context.unknowns.length} via=${context.provenance.via}`
}

function formatArticle(attachment: TweetArticleAttachment): string {
  return `${attachment.title} author=${attachment.author ?? '?'} paid=${attachment.isPaid ?? false}`
}

function formatArchive(file: ArchiveFile): string {
  return `${file.schema} complete=${file.complete} tweets=${file.stats.tweets} comments=${file.stats.comments} issues=${file.errors.length}`
}

function formatArchived(entry: ArchivedTweet): string {
  return `${entry.mblogId} comments=${entry.comments.length} reposts=${entry.reposts?.length ?? 0}`
}

function formatIssue(issue: ArchiveIssue): string {
  return `${issue.stage}/${issue.code}: ${issue.message}`
}

function formatItem(item: ArchiveItem): string {
  return `${item.source} ${item.mblogId ?? item.tweet?.mblogId ?? '-'}`
}

function formatCheckpoint(checkpoint: ArchiveCheckpoint): string {
  return `${checkpoint.uid} ${checkpoint.phase}`
}

function formatUserArchive(result: UserArchiveResult): string {
  return `complete=${result.complete} tweets=${result.summary.tweets} coverage=${result.summary.coverage ?? 'n/a'}`
}

function isResumable(store: UserArchiveStore): boolean {
  return typeof store.loadMeta === 'function' && typeof store.saveCheckpoint === 'function'
}

function formatSession(session: WeiboSessionContext): string {
  return `${session.authMode} uid=${session.uid ?? '-'} checkedAt=${session.checkedAt}`
}

function formatCapability(capability: WeiboCapability): string {
  return `${capability.id} ${capability.status} auth=${capability.auth}`
}

function formatTrend(item: TrendItem): string {
  return `${item.word} heat=${item.heat ?? '-'}`
}

function formatTags(tags: FavoriteTagList): string {
  return `${tags.tags.length}/${tags.total ?? '?'}`
}

function formatGroup(group: UserGroup): string {
  return `${group.id} ${group.title}`
}

function formatMblogGroup(group: MblogGroup): string {
  return `${group.id} ${group.name}`
}

function formatUser(user: IUser | UserBrief): string {
  return `${user.id} ${user.name} followers=${user.stats.followers}`
}

function formatProfile(profile: ISelfProfile): string {
  return `${profile.uid ?? '?'} ${profile.gender}`
}

function formatAsset(asset: IUserMediaAsset): string {
  return `${asset.type} ${asset.id}${asset.duration === undefined ? '' : ` ${asset.duration}s`}`
}

function formatAlbum(album: IUserAlbum): string {
  return `${album.containerId} ${album.title}`
}

function formatGender(gender: Gender): string {
  return gender
}

function formatVerification(verification: VerificationType): string {
  return String(verification)
}

function formatLongText(longText: TweetLongText): string {
  return `${longText.text.length} chars markdown=${longText.isMarkdown ?? false}`
}

function formatDownload(item: MediaDownloadItem, totals: MediaDownloadTotals): string {
  return `${item.status} ${item.type} ${totals.downloaded}/${totals.total} bytes=${totals.bytes}`
}

function formatMediaResult(result: TweetMediaDownloadResult): string {
  return `${result.mblogId} dryRun=${result.dryRun} items=${result.items.length}`
}

/** 所有分页返回类型都带 `hasMore`，下游可写一个统一的分页循环。 */
function pageHasMore(page: { hasMore: boolean }): boolean {
  return page.hasMore
}

/** 一次性覆盖全部分页形状，避免某个 PageResult 字段改名后无人发现。 */
function pageSizes(pages: {
  tweets: TweetPageResult
  mentions: UserMentionsPageResult
  comments: TweetCommentsPageResult
  reposts: TweetRepostsPageResult
  likers: TweetLikersPageResult
  search: TweetSearchByDatePageResult
  following: FollowingPageResult
  favorites: FavoritePageResult
  likes: LikePageResult
  history: CommentHistoryPageResult
  commentNotifications: CommentNotificationPageResult
  likeNotifications: LikeNotificationPageResult
  topics: SuperTopicPageResult
  images: ImageWallPageResult
  videos: VideoWaterfallPageResult
  albumPhotos: AlbumPhotoPageResult
  albums: AlbumListResult
}): number[] {
  return [
    pages.tweets.tweets.length,
    pages.mentions.tweets.length,
    pages.comments.comments.length,
    pages.reposts.reposts.length,
    pages.likers.likers.length,
    pages.search.tweets.length,
    pages.following.users.length,
    pages.favorites.tweets.length,
    pages.likes.tweets.length,
    pages.history.comments.length,
    pages.commentNotifications.items.length,
    pages.likeNotifications.items.length,
    pages.topics.topics.length,
    pages.images.assets.length,
    pages.videos.assets.length,
    pages.albumPhotos.assets.length,
    pages.albums.albums.length,
  ]
}

/**
 * 下游适配层会接触到的扩展契约。
 *
 * 这是类型面清单：函数体不构造对象，但参数类型会强制 typecheck 每个 Stable 契约
 * 仍然存在且可导入。新增 / 改名导出时这里会先失败。
 */
interface ContractMap {
  authMode: WeiboAuthMode
  retryKind: WeiboRetryKind
  retryConfig: IWeiboRetryConfig
  guestConfig: IWeiboGuestConfig
  proxy: WeiboProxyInput
  proxyProvider: IProxyProvider
  proxyContext: IProxyRequestContext
  capabilityFilter: CapabilityFilter
  contractVersion: TweetContractVersion
  visible: TweetVisible
  beforeRetry: BeforeRetryResult
  errorContext: ErrorContext
  errorMeta: WeiboSDKErrorMeta
  requestContext: RequestContext
  responseContext: ResponseContext
  retryContext: RetryContext
  hooks: WeiboSDKHooks
  hookMeta: WeiboSDKHookBaseMeta
  rawMeta: WeiboSDKRawMeta
  requestMeta: WeiboSDKRequestMeta
  lifecycle: WeiboSDKLifecycleEvent
  selfCheckMode: WeiboSDKSelfCheckMode
  transport: WeiboTransport
  transportMethod: TransportMethod
  transportRequest: TransportRequest
  transportMeta: TransportRequestMeta
  logger: WeiboLogger
  logLevel: WeiboLogLevel
  logRecord: WeiboLogRecord
  jsonlLogger: JsonlLogger
  jsonlTelemetry: JsonlTelemetry
  telemetryInput: TelemetryJsonlInput
  telemetryEvent: TelemetryEvent
  telemetryBase: TelemetryEventBase
  telemetryPrimitive: TelemetryPrimitive
  weiboEvent: WeiboEvent
  archiveIssueStage: ArchiveIssueStage
  archiveUserItem: ArchiveUserItem
  archiveMeta: UserArchiveMeta
  archiveRecord: UserArchiveRecord
  archiveSlice: UserArchiveSlice
  archiveSliceState: UserArchiveSliceState
  archiveSummary: UserArchiveSummary
  archiveRunConfig: UserArchiveRunConfig
  mergeResult: MergeArchiveResult
  favoriteTag: FavoriteTag
  userLabel: IUserLabel
  userVerification: IUserVerification
  superTopic: SuperTopic
  superTopicCategory: SuperTopicCategory
  commentNotification: CommentNotification
  likeNotification: LikeNotification
  liker: TweetLiker
  enrichResult: TweetEnrichResult
  searchUsers: SearchUserPageResult
  searchTweets: SearchTweetPageResult
  contextAttachment: TweetContextAttachment
  contextAttachmentKind: TweetContextAttachmentKind
  contextAuthor: TweetContextAuthor
  contextComment: TweetContextComment
  contextFlags: TweetContextFlags
  contextKind: TweetContextKind
  contextLink: TweetContextLink
  contextMedia: TweetContextMedia
  contextMediaDownload: TweetContextMediaDownload
  contextMediaRelation: TweetContextMediaRelation
  contextPost: TweetContextPost
  contextProvenance: TweetContextProvenance
  contextRepost: TweetContextRepostEntry
  repostEntry: TweetRepostEntry
  contextStats: TweetContextStats
  contextVisibility: TweetContextVisibility
  geo: TweetGeo
  linkCard: TweetLinkCard
  pageCard: TweetPageCard
  atUser: TweetAtUser
  commentPic: TweetCommentPic
  audio: TweetAudio
  vote: TweetVoteAttachment
  voteOption: TweetVoteOption
  live: TweetLiveAttachment
  lottery: TweetLotteryAttachment
  downloadItemBase: MediaDownloadItemBase
  skipReason: MediaSkipReason
  variant: MediaVariant
  mediaItemError: MediaItemErrorContext
}

function contractKeys(map: ContractMap): string[] {
  return Object.keys(map).sort()
}

/** 下游通常按错误类 / code 分支，而不是匹配 message。 */
function describeErrorClass(error: unknown): string {
  if (error instanceof ConnectionTimeoutError)
    return 'NET_TIMEOUT'
  if (error instanceof NetworkRequestError)
    return 'NET_REQUEST_FAILED'
  if (error instanceof RateLimitError)
    return 'RATE_LIMITED'
  if (error instanceof WeiboAPINotOkError)
    return 'API_NOT_OK'
  if (error instanceof UnexpectedAPIResponseError)
    return 'API_BAD_RESPONSE'
  if (error instanceof WeiboSessionExpiredError)
    return 'AUTH_SESSION_EXPIRED'
  if (error instanceof MediaDownloadError)
    return 'MEDIA_DOWNLOAD_FAILED'
  if (error instanceof MediaInvalidResponseError)
    return 'MEDIA_BAD_RESPONSE'
  if (error instanceof MediaStorageError)
    return 'MEDIA_STORAGE_FAILED'
  if (error instanceof WeiboSDKError)
    return error.code
  return 'UNKNOWN'
}

/** 错误按 `code` 分支，而不是匹配 message；这是下游最常用的错误处理方式。 */
function describeTypedError(error: unknown): { code: string, retryable: boolean } {
  if (error instanceof WeiboSDKError)
    return { code: error.code, retryable: error.retryable }
  return { code: 'UNKNOWN', retryable: false }
}

const TYPE_HELPERS = [
  toMirrorRow,
  formatComment,
  formatContext,
  formatArticle,
  formatArchive,
  formatArchived,
  formatIssue,
  formatItem,
  formatCheckpoint,
  formatUserArchive,
  isResumable,
  formatSession,
  formatCapability,
  formatTrend,
  formatTags,
  formatGroup,
  formatMblogGroup,
  formatUser,
  formatProfile,
  formatAsset,
  formatAlbum,
  formatGender,
  formatVerification,
  formatLongText,
  formatDownload,
  formatMediaResult,
  pageHasMore,
  pageSizes,
  contractKeys,
  describeErrorClass,
]

/** 纯离线：Stable 类型的下游映射在 typecheck 时验证，运行时只展示覆盖清单与错误分类。 */
export const scenario: SdkScenario = {
  kind: 'sdk',
  id: 'typed-consumer',
  title: '下游类型映射（离线，typecheck 验证）',
  summary: 'ITweet / ITweetContext / ArchiveFile / PageResult / 错误类等 Stable 类型的下游用法',
  usage: 'pnpm play typed-consumer',
  requiresCookie: false,
  async run({ log }) {
    log.info('这个场景不请求微博：它的价值在 `pnpm typecheck`，字段改名会直接编译失败。')

    log.heading('覆盖的 Stable 类型映射')
    for (const helper of TYPE_HELPERS)
      log.info(`- ${helper.name}`)

    log.heading('错误分类')
    const invalid = new InvalidConfigError('playground: 演示 CONFIG_INVALID')
    log.kv('InvalidConfigError', describeTypedError(invalid))
    log.kv('byInstance', describeErrorClass(invalid))
    log.kv('普通 Error', describeTypedError(new Error('boom')))
    log.info('下游应按 code / retryable 分支：AUTH_SESSION_EXPIRED 重新登录，RATE_LIMITED 退避，其余按需重试。')

    log.heading('版本常量与工厂')
    log.kv('versions', {
      VERSION,
      TWEET_CONTRACT_VERSION,
      ARCHIVE_SCHEMA_ID,
      ARCHIVE_SCHEMA_URL,
      USER_ARCHIVE_JOURNAL_SCHEMA,
    })
    log.kv('factories', [
      createConsoleLogger,
      createJsonlLogger,
      createMultiLogger,
      createLoggerPlugin,
      createMemoryUserArchiveStore,
    ].map(factory => factory.name))

    log.heading('使用提示')
    log.info('归一化方法返回 camelCase 领域模型；只有 `fetchRaw*` 返回上游 snake_case 形状。')
    log.info('分页结果统一带 `hasMore`，但游标字段不同（page / cursor / maxId / nextCursor）。')
    log.info('归档契约用 `ArchiveFile` + `weibo-user-archive/vN` 独立版本化，不跟包版本绑定。')
  },
}
