/**
 * SDK 能力清单（离线静态注册表）。
 *
 * 供 `sdk.capabilities()` / `weibo-cli capabilities` 与 Agent 使用：不发起网络请求，
 * 直接回答「有哪些能力、是否需要登录、分页类型、当前状态」。
 */

/** 能力状态。 */
export type CapabilityStatus
  /** 正常可用 */
  = | 'stable'
  /** 可用但上游行为不稳定 / 有已知限制 */
    | 'degraded'
  /** 上游已失效或产品暂缓 */
    | 'unavailable'
  /** 已规划、尚未实现 */
    | 'planned'

/** 分页类型。 */
export type CapabilityPagination
  = 'none' | 'page' | 'cursor' | 'max_id' | 'since_id' | 'mixed'

/** 登录要求。 */
export type CapabilityAuth
  /** 必须 Cookie（登录账号） */
  = | 'cookie'
  /** 可用访客身份（guest token / m 站免登录接口） */
    | 'guest'
  /** 完全无需登录 */
    | 'none'

/** guest 模式下的分页能力。 */
export type CapabilityGuestPagination
  /** guest 模式不支持分页 */
  = | 'none'
  /** guest 模式仅能取到第一页 */
    | 'first_page'
  /** guest 模式可完整分页 */
    | 'full'

/** 一条能力描述。 */
export interface WeiboCapability {
  /** 稳定 id（如 `tweets.comments`） */
  id: string
  /** 所属服务（门面属性名，如 `tweets`）：真正能调用的地方，不一定等于 `id` 前缀 */
  service: string
  /** 公开方法名 */
  methods: string[]
  /**
   * 可直接运行的调用路径（如 `sdk.tweets.listByUserId(uid)`）。
   *
   * 由 `service` + `methods[0]` 拼出来的路径不一定可调用（同名方法可能挂在别的服务上，
   * 或者方法名是 `fetchRaw*` 这种低层数据源），所以这里显式给出入口。
   */
  sdk: string
  /** 能力说明 */
  description: string
  /** 登录要求：是否需要 Cookie / 可用 guest / 无需登录 */
  auth: CapabilityAuth
  /** guest 模式下的分页能力（未设置时视为 guest 能力未覆盖分页语义） */
  guestPagination?: CapabilityGuestPagination
  /** guest 模式下的备注（可覆盖范围 / 限制） */
  guestNote?: string
  /**
   * 是否只返回登录账号自身的数据（账号级能力）。
   *
   * 为 `true` 时，调用方传其他 uid / 不带 uid 都只能拿到 Cookie 对应账号的内容；
   * 归档的 `includeFavorites` / `includeCommentHistory` 也属于这一类。
   */
  accountScoped?: boolean
  /** 分页类型 */
  pagination: CapabilityPagination
  /** 当前状态 */
  status: CapabilityStatus
  /** 对应 CLI 命令 */
  cli?: string
  /** 已知限制 / 备注 */
  note?: string
}

/** 能力清单（新增公开能力时同步登记）。 */
export const WEIBO_CAPABILITIES: readonly WeiboCapability[] = [
  {
    id: 'users.me',
    service: 'users',
    methods: ['myDetails'],
    sdk: 'sdk.users.myDetails()',
    description: '当前登录用户详情（也用于会话自检）',
    auth: 'cookie',
    accountScoped: true,
    pagination: 'none',
    status: 'stable',
    cli: 'weibo-cli whoami',
  },
  {
    id: 'users.profile',
    service: 'users',
    methods: ['fetchRawInfo', 'fetchRawDetails', 'getById'],
    sdk: 'sdk.users.getById(uid)',
    description: '用户信息 / 详情',
    auth: 'guest',
    guestPagination: 'none',
    pagination: 'none',
    status: 'stable',
    cli: 'weibo-cli user info <uid>',
  },
  {
    id: 'users.timeline',
    service: 'tweets',
    methods: ['listByUserId', 'streamByUserId'],
    sdk: 'sdk.tweets.listByUserId(uid)',
    description: '用户微博列表（归一化）',
    auth: 'guest',
    guestPagination: 'first_page',
    guestNote: 'guest 模式仅返回 m 站第一页，标注 partial: true',
    pagination: 'page',
    status: 'stable',
    cli: 'weibo-cli user timeline <uid>',
  },
  {
    id: 'users.mentions',
    service: 'users',
    methods: ['listMentions', 'streamMentions'],
    sdk: 'sdk.users.listMentions()',
    description: '@我的微博',
    auth: 'cookie',
    accountScoped: true,
    pagination: 'max_id',
    status: 'stable',
    cli: 'weibo-cli user mentions|mentions-stream',
  },
  {
    id: 'users.groups',
    service: 'users',
    methods: ['groups', 'mblogGroups'],
    sdk: 'sdk.users.groups()',
    description: '关注分组 / 微博分组',
    auth: 'guest',
    guestPagination: 'none',
    guestNote: 'feed/allGroups 无需登录；mblog 分组仍需 Cookie',
    pagination: 'none',
    status: 'stable',
    cli: 'weibo-cli user groups|mblog-groups',
  },
  {
    id: 'tweets.detail',
    service: 'tweets',
    methods: ['getByMblogId'],
    sdk: 'sdk.tweets.getByMblogId(mblogId)',
    description: '单条微博详情（归一化）',
    auth: 'guest',
    guestPagination: 'none',
    pagination: 'none',
    status: 'stable',
    cli: 'weibo-cli tweet detail <mblogId>',
  },
  {
    id: 'tweets.context',
    service: 'tweets',
    methods: ['context'],
    sdk: 'sdk.tweets.context(mblogId)',
    description: 'Agent 视角的单条微博上下文（作者 / 时间 / 正文 / 媒体归属与下载 / 转发关系 / 评论抽样 / 未知项）',
    auth: 'guest',
    guestPagination: 'none',
    pagination: 'none',
    status: 'stable',
    cli: 'weibo-cli tweet context <mblogId>',
    note: '确定性投影，不调用 LLM；--download-media 复用媒体下载链路',
  },
  {
    id: 'tweets.enrich',
    service: 'tweets',
    methods: ['enrich'],
    sdk: 'sdk.tweets.enrich(mblogId)',
    description: '单条微博 raw + 归一化模型（可选长文）',
    auth: 'guest',
    guestPagination: 'none',
    pagination: 'none',
    status: 'stable',
    cli: 'weibo-cli tweet enrich <mblogId>',
  },
  {
    id: 'tweets.comments',
    service: 'tweets',
    methods: ['comments', 'streamComments'],
    sdk: 'sdk.tweets.comments(mblogId)',
    description: '微博评论（含楼中楼内联回复）',
    auth: 'guest',
    guestPagination: 'full',
    pagination: 'max_id',
    status: 'stable',
    cli: 'weibo-cli tweet comments|comments-stream <mblogId>',
  },
  {
    id: 'tweets.replies',
    service: 'tweets',
    methods: ['replies', 'streamReplies'],
    sdk: 'sdk.tweets.replies(mblogId, rootCommentId)',
    description: '一级评论下的二级评论（楼中楼）',
    auth: 'guest',
    guestPagination: 'full',
    pagination: 'max_id',
    status: 'stable',
    cli: 'weibo-cli tweet replies|replies-stream <mblogId> <rootCommentId>',
  },
  {
    id: 'tweets.longText',
    service: 'tweets',
    methods: ['longText'],
    sdk: 'sdk.tweets.longText(mblogId)',
    description: '长微博全文',
    auth: 'guest',
    guestPagination: 'none',
    pagination: 'none',
    status: 'stable',
  },
  {
    id: 'tweets.reposts',
    service: 'tweets',
    methods: ['getReposts', 'streamReposts'],
    sdk: 'sdk.tweets.getReposts(mblogId)',
    description: '微博转发列表',
    auth: 'guest',
    guestPagination: 'full',
    guestNote: '访客可能拿到空页 + empty_tip（「前方拥堵，请登录后使用」）：此时 emptyReason 为 gated，不代表没有转发',
    pagination: 'page',
    status: 'stable',
    cli: 'weibo-cli tweet reposts|reposts-stream <mblogId>',
  },
  {
    id: 'tweets.likers',
    service: 'tweets',
    methods: ['likers', 'streamLikers'],
    sdk: 'sdk.tweets.likers(mid)',
    description: '微博点赞者',
    auth: 'guest',
    guestPagination: 'full',
    pagination: 'page',
    status: 'degraded',
    cli: 'weibo-cli tweet likers|likers-stream <mid>',
    note: '网页端 likeShow 恒返回空数组，改用 m.weibo.cn/api/attitudes/show；入参必须是数字 mid',
  },
  {
    id: 'tweets.friendTimeline',
    service: 'tweets',
    methods: ['listFriendTimeline', 'streamFriendTimeline'],
    sdk: 'sdk.tweets.listFriendTimeline()',
    description: '首页「最新微博」关注时间线（max_id 翻旧页；since_id 仅增量）',
    auth: 'cookie',
    pagination: 'max_id',
    status: 'stable',
    cli: 'weibo-cli tweet home|home-stream',
  },
  {
    id: 'tweets.searchProfile',
    service: 'tweets',
    methods: ['searchByDate'],
    sdk: 'sdk.tweets.searchByDate(uid)',
    description: '个人主页内按日期搜索',
    auth: 'cookie',
    pagination: 'page',
    status: 'stable',
    cli: 'weibo-cli tweet search-profile <uid>',
  },
  {
    id: 'followings.following',
    service: 'followings',
    methods: ['getFollowings', 'streamFollowings'],
    sdk: 'sdk.followings.getFollowings(uid)',
    description: '用户关注列表',
    auth: 'guest',
    guestPagination: 'first_page',
    guestNote: 'guest 模式仅 m 站第一页，结果带 partial: true',
    pagination: 'page',
    status: 'stable',
    cli: 'weibo-cli follow list|stream <uid>',
  },
  {
    id: 'followings.fans',
    service: 'followings',
    methods: ['getFans', 'streamFans'],
    sdk: 'sdk.followings.getFans(uid)',
    description: '用户粉丝列表',
    auth: 'guest',
    guestPagination: 'first_page',
    guestNote: 'guest 模式仅 m 站第一页，结果带 partial: true',
    pagination: 'page',
    status: 'stable',
    cli: 'weibo-cli follow fans|fans-stream <uid>',
  },
  {
    id: 'followings.my',
    service: 'followings',
    methods: ['getMyFollowings', 'streamMyFollowings'],
    sdk: 'sdk.followings.getMyFollowings()',
    description: '当前用户关注列表',
    auth: 'cookie',
    accountScoped: true,
    pagination: 'page',
    status: 'stable',
    cli: 'weibo-cli follow my|my-stream',
  },
  {
    id: 'favorites.list',
    service: 'favorites',
    methods: ['listFavorites', 'streamFavorites'],
    sdk: 'sdk.favorites.listFavorites(uid)',
    description: '收藏夹（可客户端按标签过滤）',
    auth: 'cookie',
    guestNote: '账号级数据；guest 不可用',
    accountScoped: true,
    pagination: 'page',
    note: '上游 all_fav 忽略 uid，始终返回登录账号的收藏',
    status: 'stable',
    cli: 'weibo-cli favorite list|stream <uid>',
  },
  {
    id: 'favorites.tags',
    service: 'favorites',
    methods: ['getTags'],
    sdk: 'sdk.favorites.getTags()',
    description: '收藏标签',
    auth: 'cookie',
    guestNote: '账号级数据；guest 不可用',
    accountScoped: true,
    pagination: 'none',
    status: 'stable',
    cli: 'weibo-cli favorite tags',
  },
  {
    id: 'likes.list',
    service: 'likes',
    methods: ['listByUserId', 'streamByUserId'],
    sdk: 'sdk.likes.listByUserId(uid)',
    description: '我赞过的微博',
    auth: 'guest',
    guestPagination: 'first_page',
    guestNote: 'guest 模式仅 m 站第一页',
    pagination: 'page',
    status: 'stable',
    cli: 'weibo-cli like list|stream <uid>',
  },
  {
    id: 'commentHistory.mine',
    service: 'commentHistory',
    methods: ['listMine', 'streamMine'],
    sdk: 'sdk.commentHistory.listMine()',
    description: '当前登录用户历史评论',
    auth: 'cookie',
    guestNote: '账号级数据；guest 不可用',
    accountScoped: true,
    pagination: 'max_id',
    note: '上游 myCmt 不接受 uid，始终返回登录账号的评论',
    status: 'stable',
    cli: 'weibo-cli comment mine|stream',
  },
  {
    id: 'media.images',
    service: 'media',
    methods: ['listImages', 'streamImages'],
    sdk: 'sdk.media.listImages(uid)',
    description: '用户图片墙',
    auth: 'guest',
    guestPagination: 'full',
    pagination: 'since_id',
    status: 'stable',
    cli: 'weibo-cli media images <uid>',
  },
  {
    id: 'media.videos',
    service: 'media',
    methods: ['listVideos', 'streamVideos'],
    sdk: 'sdk.media.listVideos(uid)',
    description: '用户视频瀑布',
    auth: 'guest',
    guestPagination: 'full',
    pagination: 'cursor',
    status: 'stable',
    cli: 'weibo-cli media videos <uid>',
  },
  {
    id: 'media.albums',
    service: 'media',
    methods: ['listAlbums', 'listAlbumPhotos', 'streamAlbumPhotos'],
    sdk: 'sdk.media.listAlbums(uid)',
    description: '用户相册（相册列表 + since_id 分页照片）',
    auth: 'guest',
    guestPagination: 'full',
    pagination: 'since_id',
    status: 'stable',
    cli: 'weibo-cli media albums|album',
    note: 'containerId 来自 getImageWall?has_album=true（pc_profile_album）',
  },
  {
    id: 'media.download',
    service: 'media',
    methods: ['downloadTweetMedia', 'downloadByMblogId'],
    sdk: 'sdk.media.downloadByMblogId(mblogId, { dir })',
    description: '单条微博媒体下载',
    auth: 'none',
    guestPagination: 'none',
    pagination: 'none',
    status: 'stable',
    cli: 'weibo-cli media download <mblogId>',
  },
  {
    id: 'topics.list',
    service: 'topics',
    methods: ['cates', 'list', 'stream'],
    sdk: 'sdk.topics.list()',
    description: '超话分类 / 列表 / 关键词搜索',
    auth: 'guest',
    guestPagination: 'full',
    pagination: 'page',
    status: 'stable',
    cli: 'weibo-cli topic cates|list|stream',
  },
  {
    id: 'notifications.comments',
    service: 'notifications',
    methods: ['listComments', 'streamComments'],
    sdk: 'sdk.notifications.listComments()',
    description: '评论通知',
    auth: 'cookie',
    guestNote: '账号级数据；guest 不可用',
    accountScoped: true,
    pagination: 'max_id',
    status: 'stable',
    cli: 'weibo-cli notification comments|comments-stream',
  },
  {
    id: 'notifications.likes',
    service: 'notifications',
    methods: ['listLikes', 'streamLikes'],
    sdk: 'sdk.notifications.listLikes()',
    description: '点赞通知',
    auth: 'cookie',
    guestNote: '账号级数据；guest 不可用',
    accountScoped: true,
    pagination: 'max_id',
    status: 'stable',
    cli: 'weibo-cli notification likes|likes-stream',
  },
  {
    id: 'trends.hot',
    service: 'trends',
    methods: ['hotBand'],
    sdk: 'sdk.trends.hotBand()',
    description: '热搜 / 话题 / 文娱榜单',
    auth: 'guest',
    guestPagination: 'none',
    pagination: 'none',
    status: 'stable',
    cli: 'weibo-cli trends',
  },
  {
    id: 'search.users',
    service: 'search',
    methods: ['searchUsers'],
    sdk: 'sdk.search.searchUsers(query)',
    description: '公开关键词搜索用户',
    auth: 'cookie',
    pagination: 'page',
    status: 'unavailable',
    cli: 'weibo-cli search users',
    note: '上游接口失效，产品暂缓',
  },
  {
    id: 'search.tweets',
    service: 'search',
    methods: ['searchTweets'],
    sdk: 'sdk.search.searchTweets(query)',
    description: '公开关键词搜索微博',
    auth: 'cookie',
    pagination: 'page',
    status: 'unavailable',
    cli: 'weibo-cli search tweets',
    note: '上游接口失效，产品暂缓',
  },
  {
    id: 'archive.stream',
    service: 'archive',
    methods: ['streamArchive'],
    sdk: 'sdk.archive.streamArchive(uid, options)',
    description: '单账号归档流（可断点续传 / 增量 / 媒体）',
    auth: 'cookie',
    guestNote: 'guest 模式不支持完整归档',
    pagination: 'mixed',
    status: 'stable',
    cli: 'weibo-cli archive <uid>',
  },
  {
    id: 'archive.batch',
    service: 'archive',
    methods: ['streamUsersArchive'],
    sdk: 'sdk.archive.streamUsersArchive(uids, options)',
    description: '多账号批量归档',
    auth: 'cookie',
    guestNote: 'guest 模式不支持完整归档',
    pagination: 'mixed',
    status: 'stable',
    cli: 'weibo-cli archive --uid-file <path>',
  },
  {
    id: 'archive.user',
    service: 'userArchive',
    methods: ['stream', 'run'],
    sdk: 'sdk.userArchive.run(uid, options)',
    description: '按时间范围归档一个用户：切片枚举 + 单条详情/长文/评论/楼中楼/转发补全，可续跑',
    auth: 'cookie',
    guestNote: 'guest 模式不支持完整归档',
    pagination: 'mixed',
    status: 'stable',
    cli: 'weibo-cli archive user <uid>',
  },
  {
    id: 'sdk.session',
    service: 'sdk',
    methods: ['selfCheck', 'getSession', 'checkSession', 'getGuestTokenStatus', 'capabilities'],
    sdk: 'sdk.getSession()',
    description: '会话自检、鉴权模式与能力发现（不额外发请求）',
    auth: 'guest',
    guestPagination: 'none',
    pagination: 'none',
    status: 'stable',
    cli: 'weibo-cli whoami|capabilities',
  },
] as const

/** 能力过滤条件。 */
export interface CapabilityFilter {
  /** 按服务名过滤（如 `tweets`） */
  service?: string
  /** 按状态过滤 */
  status?: CapabilityStatus
}

/** 返回能力清单（可按服务 / 状态过滤）。 */
export function listCapabilities(
  filter: CapabilityFilter = {},
): WeiboCapability[] {
  return WEIBO_CAPABILITIES.filter((capability) => {
    if (filter.service !== undefined && capability.service !== filter.service)
      return false
    if (filter.status !== undefined && capability.status !== filter.status)
      return false
    return true
  })
}
