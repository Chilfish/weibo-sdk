# Test Index

本文档索引项目中所有测试用例，描述其覆盖范围、运行方式与数据来源。

---

## 测试分层

| 层 | 目录 | 网络IO | 运行条件 | 用途 |
|---|---|---|---|---|
| Unit | `tests/unit/` | 否 | `pnpm test` | 纯函数、模型映射、错误类 |
| Component | `tests/component/` | 否 | `pnpm test` | 注入 mock 覆盖 Fetcher/Auth/RateLimit 等边界 |
| E2E | `tests/e2e/` | 是 | `WEIBO_E2E=1 pnpm test` | 真实 Cookie + 真实网络验证 |

---

## 测试用例清单

### Unit — 模型

| 文件 | 覆盖内容 | 关键测试点 |
|---|---|---|
| `unit/models/User.test.ts` | `User` 构造器 | avatar fallback 链（avatar_hd > avatar_large > profile_image_url）、IP属地前缀裁剪、stats映射、扩展属性（company/creditLevel/externalLinks/school） |
| `unit/models/UserView.test.ts` | `renderUserMarkdown` / `renderGuestSessionMarkdown` | 真实 fixture 用户卡片（认证/简介/所在地/统计/会员/标签/信用/注册时间/主页）、可选字段缺省时整行省略、认证说明与多行简介、链接文本转义与含括号 URL；访客 token 元信息（不含明文）与 token 缺失 |
| `unit/models/TweetList.test.ts` | `renderTweetListMarkdown` / 评论 / 点赞者 / 通知 | 标题与分页说明、计数字段、永久链接、转发链取当前作者正文、无正文时回退原微博并标注归属、摘要截断、空列表占位、`partial` 提示；真实 fixture 的评论（含图片评论）、点赞者、评论/点赞通知 |
| `unit/models/UserList.test.ts` | `renderFollowingUserListMarkdown` | 真实关注列表 fixture（认证/粉丝/所在地/主页）、互相关注 / 已关注 / 关注了你 / 无关系标签、空列表占位 |
| `unit/models/Collections.test.ts` | 分组 / 超话 / 相册 / 热搜渲染器 | 真实 fixture 的关注分组、微博分组、超话分类与列表、相册列表、热搜榜（热度千分位与标签） |
| `unit/models/Tweet.test.ts` | `Tweet` 构造器（mymblog 来源） | 核心字段映射、media 提取（pic_infos）、regionName、visible、stats、geo 坐标兼容（lon/lat 顺序）、retweeted_status 递归构造 |
| `unit/models/Tweet.show.test.ts` | `Tweet` 构造器（statuses/show 来源） | 从真实 fixture `tests/fixtures/raw/tweet_QqsYymYOS.json` 读取数据，验证长微博、地理位置、媒体信息归一化正确性 |
| `unit/models/Media.test.ts` | `normalizeImageWallItem` / `normalizeWaterfallVideo` | 图片墙 pic/livephoto/gif/unknown（URL 由 pid 构造）、视频瀑布 `page_info.media_info` 提取、`normalizeTweet` 的 page_info 视频映射 |
| `unit/models/Tweet.variants.test.ts` | `normalizeTweet` 真实 fixture 变种 | 纯文本 / 转发 / 图文 / 长文 / 视频 / 广告、`page_info.media_info` 视频、新增 optional 字段（`topics` / `linkCards` / `readCount` / `editCount` / `title` / `permanentVideoUrl` / `isOriginal` / `sourceUrl`）、卡片元数据（`pageInfo.objectId` / `subtitle` / https 封面，`linkCards.longUrl` / `oriUrl` / `urlType`）、`isGetLongText=true` 重复 `url_struct` 的 `linkCards` 去重 |
| `unit/models/Tweet.commentPics.test.ts` | `normalizeComment` 图片评论 | 真实 `comments.json` / `comments_pic_multi.json` / `my_comments_p1.json`、`url_struct[].pic_infos` 提取、多图重复 `url_struct` 去重、尺寸优先 `woriginal`、`reply_comment` / 楼中楼递归、无图时省略 `pics` |
| `unit/models/TweetContext.test.ts` | `buildTweetContext` / `renderTweetContextMarkdown` | 时间格式归一化、原创图文、长图/纯图提示、广告/付费/长文截断标记、`maxChars`/`maxMedia`、转发链只取当前作者正文、mentions 不含链上作者、原微博媒体归属、`--no-quoted`/`--no-chain` 语义、媒体下载回填、评论抽样声明、Markdown 章节、重复链接卡片只渲染一次 |
| `unit/contract/itweet-v2.test.ts` | ITweet v2 契约冻结 | `TWEET_CONTRACT_VERSION = 2`、顶层键集类型/运行时锁定、`ITweetComment` 键集与 `pics` 形状、`migrateTweetV1toV2` 递归删除 `textHtml` |
| `unit/contract/archive-schema.test.ts` | 归档 JSON Schema v2 | `$id` 与 `$schema` 指向同一 raw URL、最小归档通过 Ajv 校验、缺 `$schema` 被拒、未知字段前向兼容、真实 `verified_type` 取值通过 |

### Unit — 服务基础设施

| 文件 | 覆盖内容 | 关键测试点 |
|---|---|---|
| `unit/services/AuthService.test.ts` | `AuthService` | Cookie 中提取 XSRF-TOKEN、无 Token 时的回退行为 |
| `unit/services/RateLimitService.test.ts` | `RateLimitService` | 令牌桶算法、限流效果、FakeClock 注入、并发获取令牌、432 后全局暂停（`pause` / `isPaused` / `getPausedRemainingMs`、`rate_limit_wait.reason`） |
| `unit/services/RetryPolicy.test.ts` | `RetryPolicy` | 默认/异常配置归一化、重试次数上限、失败类别分类（432/429/5xx/超时/无响应）、`Retry-After`（秒与 HTTP date）、指数退避 + jitter |
| `unit/capabilities.test.ts` | 能力注册表 | 稳定 id 唯一、每条能力声明合法 `auth`、guest 能力集合、`users.timeline` 的 `first_page`、归档保持 cookie-only、`media.download` 为 `none` |

### Unit — 访客与鉴权

| 文件 | 覆盖内容 | 关键测试点 |
|---|---|---|
| `unit/services/GuestTokenService.test.ts` | `GuestTokenService` 发放 / 缓存 / 刷新 | 移动端 `genvisitor → incarnate` 请求序列与 Cookie 组装、`parseJsonp` 与 `readSetCookie` 边界、`Set-Cookie` 优先并用 JSONP `data.sub` 兜底、缺 `SUB` 抛 `AUTH_SESSION_EXPIRED`、HTTP 432 抛 `RATE_LIMITED` 且不重试、并发 single-flight、刷新成功替换 / 失败保留旧 token、预置 token 不触发放、预置 token 缺 `SUB=` 抛 `CONFIG_INVALID` |
| `unit/auth/AuthMode.test.ts` | `resolveAuthMode` / `createAuthContext` / `isAuthFailureReason` | auto·cookie·guest 模式矩阵（含空白 Cookie 视为缺失）、`auth: 'cookie'` 无 Cookie 抛 `CONFIG_INVALID`、guest provider 注入含 `SUB`/`SUBP`/`WEIBOCN_FROM` 的 Cookie、`none` provider 不发放 token、六种 `authFailureReason` 的识别 |
| `unit/services/mobileEndpoints.test.ts` | m 站容器端点（guest 第一页） | `mobileContainerSpec` 声明 `auth: 'guest'` + `require_ok_1`、URL 与 `page` 参数、containerid 编码、passthrough 保留未知字段、`extractMobileMblogs` 由 `mid` 换算 `mblogid`（`5039815108333719 → OgHLUyXYP`）并递归 `card_group`、无法换算的卡片跳过、`extractMobileUsers` 按 id/idstr 去重、真实 `mobile_timeline_p1` / `mobile_likes_p1` / `mobile_followings_p1` / `mobile_fans_p1` fixture |

### Unit — 工具

| 文件 | 覆盖内容 | 关键测试点 |
|---|---|---|
| `unit/utils/tweetId.test.ts` | `parseTweetIdInput` / `normalizeTweetIdInput` | mblogid / 数字 mid / `m.weibo.cn` 与 `weibo.com` 状态 URL、分享文案、query/fragment/尾斜杠、拒绝用户主页/文章页/t.cn、`CONFIG_INVALID` context |
| `unit/utils/sessionUid.test.ts` | `parseSessionUid` | 真实 `verified_url`（双 `?`）、标准 query、缺失 uid 返回 undefined |

### Unit — 领域服务

| 文件 | 覆盖内容 | 关键测试点 |
|---|---|---|
| `unit/services/Favorites.test.ts` | `FavoriteService.getFavorites` | URL/params、`with_total=true`、可选 page、`page=0` / NaN 不透传、转发嵌套 |
| `unit/services/FavoriteStream.test.ts` | `listFavorites` / `streamFavorites` | 单页与跨页去重、整页重复停止、`total_page` / `total_number`、空收藏、`maxPages`、标签过滤、进度回调异常 |
| `unit/services/LikeService.test.ts` | `LikeService` | 真实 fixture safeParse、page 归一化（0/负数/NaN）、单页与跨页去重、空页/整页重复/`maxPages` 停止、进度回调异常、错误路径 |
| `unit/services/CommentHistory.test.ts` | `CommentHistoryService` + `normalizeComment` | 真实 fixture safeParse、`max_id` 游标翻页、`next_cursor === 0`/空页/游标不前进/整页重复停止、`ITweetComment` 新字段与 `reply_comment` 递归归一化 |
| `unit/services/Comments.test.ts` | `buildComments` schema + 请求契约 | 真实 `comments` / `comments_no_type_*` / `comments_firewall` / `comments_hot_empty` / `comments_pic_multi` fixture、`type=feed` 参数拒绝、20/18/2 分页与 `max_id=0`、防火墙部分可见、空页但 `max_id` 非 0、图片评论 `pic_num` / `mix_media_ids` / `url_struct.pic_infos` |
| `unit/models/Favorite.test.ts` | `matchesFavoriteTag` | 标签 id / 名称 / 原始字符串匹配，缺失与畸形 tags 返回 false |

### Unit — 入口/导出

| 文件 | 覆盖内容 | 关键测试点 |
|---|---|---|
| `unit/entry/index.test.ts` | SDK 入口无副作用 | 导入 `WeiboSDK` 时无 console.log 等副作用 |
| `unit/entry/exports.test.ts` | 导出完整性回归 | `package.json#exports` 中声明的子路径均可正确导入 |
| `unit/sdk/WeiboSDK.test.ts` | `WeiboSDK` 门面类 | 构造矩阵（`auth: 'auto'` 无 Cookie → guest；`auth: 'cookie'` 无 Cookie → `CONFIG_INVALID`）、构造器初始化 UserService/TweetService、`sdk_init` 生命周期事件、selfCheck 模式 |
| `unit/sdk/WeiboSDK.session.test.ts` | `WeiboSDK.getSession` | uid 解析、single-flight 缓存、与 lazy 自检共享一次 `myDetails`、`refresh` 重探、失败不缓存、`checkSession` 复用 |

### Unit — CLI

| 文件 | 覆盖内容 | 关键测试点 |
|---|---|---|
| `unit/cli/archiveFlags.test.ts` | `resolveArchiveIncludeFlags` | 单账号默认全开；批量模式默认关闭收藏（账号级数据）；citty `--no-reposts/--no-favorites/--no-date-slices` 映射为 `false`；单项关闭不影响其他阶段 |
| `unit/cli/parsePositiveInt.test.ts` | `parsePositiveInt` | 正整数字符串解析、小数取整；`0` / 负数 / 非数字 / 空串返回 undefined |
| `unit/cli/guestArgs.test.ts` | `createSDK` 的 `--guest` | `--guest` 解析为 guest 且完全不读 `.env`（spy 断言零调用）、`--guest` + `--cookie` 仍为 guest、有 Cookie 且无 `--guest` 为 cookie、无 Cookie 时 auto 回落 guest |
| `unit/cli/outputFormat.test.ts` | `parseOutputFormat` / `renderOutput` / `createPrinter` | 缺省与空串为 `json`、`markdown` / `md` 别名、大小写与空白、未知值抛 `CONFIG_INVALID`（发请求前）、JSON 两空格缩进、Markdown 委托给命令渲染器 |
| `unit/cli/tweetCommentsArgs.test.ts` | `tweet comments` 参数 | `--max-id` 已声明并作为 `max_id` 透传（缺省 undefined） |
| `unit/cli/streamRangeArgs.test.ts` | 流式范围 CLI 参数 | `--max-items/--since/--until` 解析；时间序命令声明日期边界、非时间序命令只声明条数上限 |
| `unit/utils/streamRange.test.ts` | `createStreamRange` | `maxItems` 上限、`since` 早停、`until` 跳过、日期窗口、不可解析时间保留、非法日期 `CONFIG_INVALID`、缺 `getTime` 报错 |
| `unit/utils/pagination.test.ts` | `paginate` | 空页/去重/游标不前进/`maxPages`、`maxItems` 跨页截断、`since`/`until` 边界、日期边界缺 `getTime` 报错 |

### Unit — 脚本

| 文件 | 覆盖内容 | 关键测试点 |
|---|---|---|
| `unit/scripts/archive-user/slices.test.ts` | `planSlices` | `sliceDays = 0` 不拆分、区间短于窗口、多切片的连续无重叠、整除边界、key 编号稳定性 |
| `unit/scripts/archive-user/cli.test.ts` | `parseCli` / `isHelpRequested` | uid 位置参数、布尔与字符串选项解析、`provided` 记录显式参数、未知选项报错、长短 help |
| `unit/scripts/archive-user/config.test.ts` | 归档脚本参数与续跑校验 | uid 归一化（数字 / 主页链接）、并发与限速参数 clamp、`buildConfig` 默认值与开关、`assertResumeConfig` 的 uid / 时间 / 开关不一致 |
| `unit/scripts/archive-user/journal.test.ts` | journal 读写与合并 | meta 兼容性校验、切片 journal 往返、截断行修复、`stripRaw`、同 `mblogId` 去重（issue 少 / 更晚写入优先） |
| `unit/scripts/archive-user/raw.test.ts` | raw sidecar | `--raw` 路径推导与冲突校验、已存在文件的 `--force` / 续跑语义、逐次响应写 JSONL |
| `unit/scripts/archive-user/concurrency.test.ts` | `createLimiter` / `runPool` | 并发峰值、FIFO、异常归还槽位、任务池停止条件与错误传播 |
| `unit/scripts/archive-user/output.test.ts` | `assembleArchive` | 按 `mblogId` 去重、时间倒序、评论 / 楼中楼统计、issue 去重、fatal error 标记不完整、剥除 legacy raw |

### Unit — 错误

| 文件 | 覆盖内容 | 关键测试点 |
|---|---|---|
| `unit/errors/WeiboSDKError.test.ts` | 所有错误类 | code/level/retryable 属性正确、实例化与继承链 |

### Component — FetcherService

| 文件 | 覆盖内容 | 关键测试点 |
|---|---|---|
| `component/internal/FetcherService.test.ts` | HTTP 核心 | Cookie/Token 注入、GET/POST params 处理、preflight 调用、网络错误映射（ConnectionTimeoutError / NetworkRequestError / 432·429 → RateLimitError） |
| `component/internal/FetcherRetry.test.ts` | 重试与限流协作 | 432 → 退避 → 成功、重试上限与 `attempt` 上下文、`Retry-After`（秒/HTTP date）、5xx/超时重试、不可重试错误不重试、`retries: 0` / `retryOn: []`、432 后令牌桶全局暂停 |
| `component/internal/Telemetry.test.ts` | Wide Events | `request()` 全路径事件序列（start/success/error）、rate_limit_wait + normalize_done 事件、parse error 路径 |
| `component/internal/FetcherGuestAuth.test.ts` | `FetcherService` 的访客鉴权 | guest 端点注入访客 Cookie、`auth: 'none'` 端点不注入、302 登录跳转触发一次刷新并重试、静默 `{}` 门控刷新后成功、`ok: -100` 刷新一次后仍失败即停、432 不刷新直接 `RATE_LIMITED`、cookie-only 端点在发请求前抛 `AUTH_SESSION_EXPIRED`（`requiredAuth: 'cookie'`）、事件带 `auth_mode` |

### Component — 领域服务

| 文件 | 覆盖内容 | 关键测试点 |
|---|---|---|
| `component/public/UserService.test.ts` | `UserService` | info/details/myDetails 端点调用与 params、getById 归一化+正常化事件、session expired 错误、schema 校验失败 |
| `component/public/TweetService.test.ts` | `TweetService` | mymblog/show 端点调用与 params、listByUserId/getByMblogId 归一化+正常化事件、API not ok 错误、schema 校验失败、`enrich` raw+归一化（含可选 longtext）、请求级 `onRaw` 在校验/ok 检查前触发、流式 `maxItems` / `since` 早停 |
| `component/public/TweetContext.test.ts` | `TweetService.context` | 默认 1 次请求 + 作者补拉、`author: false` 跳过、`isLongText` 才补长文、`longText: false` 保留截断标记、评论抽样（time 序直接用数字 mid 避免额外 show） |
| `component/public/MediaService.test.ts` | `MediaService` | 真实图片墙/视频瀑布 fixture、`sinceid` / `cursor` 翻页、跨页去重、空页停止、负游标归一化、`maxItems` 截断、`normalize_done` 事件 |
| `component/public/ArchiveService.test.ts` | `ArchiveService` | timeline（内联 reposts）→ favorites 编排、恒定大小 checkpoint + `lastTimelineMblogId` 续传、整页重复即停止、无 timeline 重放、schemaDigest、归档级 `onRaw` 逐项交付且信封不含 raw、onRaw 抛错向上传播 |
| `component/public/FavoriteService.test.ts` | `FavoriteService` | `getTags` 响应解析与 referer、`getFavorites` 透传 uid/page |
| `component/public/LikeService.test.ts` | `LikeService` | 真实 `likes_p1` 归一化、`normalize_done` 事件、p1+p2+end 流式去重与请求序列 |
| `component/public/MediaService.test.ts` | `MediaService` | 真实图片墙/视频瀑布 fixture、`sinceid` / `cursor` 翻页、跨页去重、空页停止、负游标归一化、`normalize_done` 事件 |
| `component/public/Likers.test.ts` | `TweetService.likers` / `streamLikers`（D8） | 真实 `likers_p1/p2/end` fixture、m 站 URL/referer、数字 mid 参数、越界 `data: null`、跨页去重、`page=0` 归一化、`normalize_done` |
| `component/public/TweetIdInput.test.ts` | Tweet id 输入归一化 | `getByMblogId` 状态 URL、`comments flow=1` 的 mid 解析、`getReposts` URL、`likers` mblogid→mid、`downloadByMblogId` URL |
| `component/public/UserSocial.test.ts` | `UserService` mentions / groups（D9/D11） | 真实 `mentions_*` fixture、`max_id` 翻页与 `next_cursor=0` 停止、`feed_groups` 分类拍平、`mblog_groups` join_groups、`normalize_done` |
| `component/public/NotificationService.test.ts` | `NotificationService`（D10） | 真实 `message_cmt_*` / `message_attitudes_*` fixture、`max_id` 翻页、`next_cursor=0` 停止、缺失 `status` 条目跳过、`normalize_done` |
| `component/public/TweetStreams.test.ts` | 评论 / 转发 / 楼中楼流式分页 | `max_id` 翻页与跨页去重、`total_number` 不提前停止、空页结束、`flow=1` 只解析一次数字 mid、楼中楼 `max_id=0` 停止 |
| `component/public/ArchiveService.extensions.test.ts` | `ArchiveService` D1/D2 归档集成 | `includeLikes` / `includeCommentHistory` 编排、source/`item.comment`、`likesPage` / `commentHistoryCursor` checkpoint、续跑、依赖缺失抛错、checkpoint 恒定大小 |
| `component/public/ArchiveService.scope.test.ts` | 账号级数据源守卫 | 目标 uid ≠ 登录 uid 时 `includeFavorites` / `includeCommentHistory` 抛 `CONFIG_INVALID`；登录 uid 放行；无法解析 session uid 时跳过守卫；批量在产出前失败；session uid 只解析一次 |
| `component/public/GuestReads.test.ts` | 访客第一页读取与归档守卫 | 真实 `mobile_*` fixture 下用户时间线 / 点赞归一化并标 `partial: true`、匿名第 2 页抛 `CONFIG_INVALID`、关注走 `followers` 容器 / 粉丝走 `follows` 容器（上游命名相反）、关注流只产出第一页、guest 归档在触达数据源前失败、guest 会话不请求 `myDetails` 且只暴露 token 元信息 |

### E2E

| 文件 | 覆盖内容 | 前提条件 |
|---|---|---|
| `e2e/user.e2e.test.ts` | 真实网络下 UserService 端到端 | `WEIBO_E2E=1` + `.env` 中有效 `WEIBO_COOKIE` |
| `e2e/tweet.e2e.test.ts` | 真实网络下 TweetService 端到端 | `WEIBO_E2E=1` + `.env` 中有效 `WEIBO_COOKIE` |
| `e2e/new-endpoints.e2e.test.ts` | longtext（固定 `RcbHecsos`）/ friendships / followContent / searchProfile / favorites 结构快照 | 同上；列表端点只快照响应信封，避免内容漂移 |
| `e2e/snapshot.e2e.test.ts` | profile / mymblog / show 结构快照 + 归一化形状 + SDK 生命周期 | 同上；show 用固定 mblogId（`QqsYymYOS` / `P6yhlzD3j`），2026-10-19 起 18/18 稳定通过 |
| `e2e/guest.e2e.test.ts` | 无 Cookie 的访客链路端到端 | `WEIBO_GUEST_E2E=1`（不需要 `WEIBO_COOKIE`）；单条微博、评论第一页、m 站第一页与 `mblogid` 换算；命中 432 / 429 时记 skip |

---

## 测试数据来源

所有 component/unit 测试均使用 **mock HTTP**（`tests/testkit/fakeAxios.ts`），不依赖真实网络。

E2E 测试只从 `.env` 中读取 `WEIBO_COOKIE`（`tests/e2e/setup-env.ts` 会覆盖环境变量）并使用真实 API。结构快照统一使用 `src/utils/structure.ts` 的 `stripVolatileKeys`（只保留 key 路径 + 值类型），快照失败 = 上游结构变更信号。

### 真实 API 响应 Fixtures

路径：`tests/fixtures/raw/`

| 文件 | 用途 |
|---|---|---|
| `tweet_QqsYymYOS.json` | 长微博详情（Tweet.show 归一化验证） |
| `tweet_OgHLUyXYP.json` | 9 图微博详情 |
| `tweet_P6yhlzD3j.json` | 转发微博详情 |
| `tweet_PCN4v8k6W.json` | 纯文本微博详情 |
| `tweet_QFekiwGId.json` | 微博详情变种 |
| `timeline_u1740358225.json` | 用户时间线（9 条，含转发、图文、链接卡片等变种） |
| `timeline_u2365795232.json` | 用户时间线（24 条） |
| `profile_info_u1740358225.json` | 用户信息（36 字段） |
| `profile_info_u2365795232.json` | 用户信息变种 |
| `profile_detail.json` | 用户详情 |
| `profile_detail_v2.json` | 用户详情变种 |
| `comments.json` | 评论列表（20 条，含图片评论 `url_struct[].pic_infos`） |
| `comments_pic_multi.json` | 图片评论样本（单图 + 多图；多图评论的多个 `url_struct` 项重复同一 `pic_infos`） |
| `comments_no_type_p1/p2/end.json` | `buildComments` 去掉 `type=feed` 后的真实三页（20 / 18 / 2，最后一页 `max_id=0`） |
| `comments_firewall.json` | 博主开启防火墙的部分可见样本（`data` < `total_number`，`trendsText` 提示） |
| `comments_hot_empty.json` | hot 排序空页停止态（`data: []`、`max_id` 仍非 0） |
| `feed_home.json` | 首页 Feed（25 条） |
| `feed_groups.json` | Feed 分组 |
| `search_users_p2.json` | 搜索用户（第 2 页） |
| `search_users_p3.json` | 搜索用户（第 3 页） |
| `hot_trends.json` | 热搜榜单（52 条） |
| `image_wall_p1.json` / `image_wall_p2.json` | 用户图片墙两页（pic + livephoto，含破损条目） |
| `waterfall_p1.json` / `waterfall_p2.json` | 用户视频瀑布两页（`page_info.media_info` 视频微博） |
| `mobile_timeline_p1.json` | m 站用户时间线第一页（`containerid=107603<uid>`，10 条，`card_type: 9`） |
| `mobile_likes_p1.json` | m 站点赞第一页（`containerid=230869<uid>`，月份分组头 + 9 条微博） |
| `mobile_followings_p1.json` / `mobile_fans_p1.json` | m 站关注 / 粉丝第一页（`231051_-_followers_-_` / `231051_-_follows_-_`，用户对象在 `card_group[].user`） |
| `mobile_photos_p1.json` / `mobile_album_tab.json` | m 站图片墙与相册 tab（`107803<uid>` / `107803<uid>_-_photoall`） |
| `mobile_videos_p1.json` / `mobile_search_users_p1.json` / `mobile_search_tweets_p1.json` | m 站视频瀑布与搜索容器样本 |
| `mobile_comments_p1.json` / `mobile_likers_p1.json` | m 站 `api/comments/show` 与 `api/attitudes/show` 样本 |

m 站样本共 11 份，均为 2026-10-20 用访客身份抓取的第一页真实响应。脱敏时使用 `node scripts/sanitize-raw.mjs <in> <out> --keep-ids`：m 站微博没有 `mblogid`，必须保留 `mid` / `idstr` / `uid` / 数字 id 才能验证 `midToMblogId` 换算与关联完整性。

完整索引见 `tests/fixtures/raw/INDEX.md`。

### 如何获取更多真实数据

```bash
# 前置条件：.env 中包含有效 WEIBO_COOKIE
source .env

# 1. 获取用户信息
curl -s -H "Cookie: $WEIBO_COOKIE" \
  -H "X-XSRF-TOKEN: <从 Cookie 中提取>" \
  -H "User-Agent: Mozilla/5.0 ..." \
  -H "Referer: https://weibo.com/" \
  "https://weibo.com/ajax/profile/info?uid=<用户UID>"

# 2. 获取用户详情
curl -s -H "Cookie: $WEIBO_COOKIE" \
  -H "X-XSRF-TOKEN: <token>" \
  -H "Referer: https://weibo.com/u/<uid>" \
  "https://weibo.com/ajax/profile/detail?uid=<uid>"

# 3. 获取用户微博列表
curl -s -H "Cookie: $WEIBO_COOKIE" \
  -H "X-XSRF-TOKEN: <token>" \
  -H "Referer: https://weibo.com/u/<uid>" \
  "https://weibo.com/ajax/statuses/mymblog?uid=<uid>&page=1&count=10"

# 4. 获取单条微博详情
curl -s -H "Cookie: $WEIBO_COOKIE" \
  -H "X-XSRF-TOKEN: <token>" \
  -H "Referer: https://weibo.com/detail/<mblogid>" \
  "https://weibo.com/ajax/statuses/show?id=<mblogid>&isGetLongText=true"

# 5. 从用户时间线中提取所有 mblogid（Python）
# import json
# with open('mymblog.json') as f:
#     data = json.load(f)
# for p in data['data']['list']:
#     print(p['mblogid'], p.get('pic_num', 0), p.get('text_raw', '')[:60])
```

### 微博变种覆盖策略

在获取新的 fixture 时，应优先覆盖以下变种：

- **纯文本**：无 `pic_ids`、无 `retweeted_status`
- **图文**：`pic_num > 0`，验证 `pic_infos` + `pic_focus_point`
- **转发**：有 `retweeted_status`，验证递归构造
- **含链接卡片**：有 `page_info`，验证卡片解析
- **含话题**：有 `topic_struct`
- **含位置**：有 `geo`，验证坐标解析
- **长微博**：`isLongText === true`
- **含视频**：有 `mix_media_info`，验证视频媒体提取
- **广告**：`isAd === true`，验证过滤逻辑
- **付费可见**：`is_paid === true`

### Unit / Component — 媒体下载

| 文件 | 覆盖内容 | 关键测试点 |
|---|---|---|
| `unit/services/media/MediaNaming.test.ts` | 文件名与扩展名 | Content-Type 映射、URL 兜底、类型默认、HTML/类型族拒绝、Windows sanitize、保留名、`-motion` 后缀、host 后缀匹配 |
| `unit/services/media/MediaSemaphore.test.ts` | 媒体并发 | 峰值限制、FIFO、异常归还、limit clamp |
| `unit/services/media/MediaRetry.test.ts` | 媒体重试分类 | 429/5xx/408/超时/连接错误、expired、storage、退避确定性 |
| `unit/services/media/MediaStreamWriter.test.ts` | 流式落盘 | 背压写入、原子 rename、maxBytes、截断/空响应、overwrite、rename 失败、abort 清理 |
| `unit/services/media/MediaHttpClient.test.ts` | 独立 CDN 客户端 | 无 Cookie、Referer/UA/identity、重定向与 host 白名单、403/429/4xx 映射 |
| `unit/cli/mediaDownload.test.ts` | `media download` 参数与事件 | include 解析、数字/`--no-refresh`、默认 out、item/item-error/done 键集 |
| `component/public/MediaServiceDownload.test.ts` | `MediaService` 下载编排 | 图片/视频/LivePhoto、exists 跳过、去重、HTML 失败继续、dryRun（`totals.planned`）、无 fs、403 刷新、storage fatal |