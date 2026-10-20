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
| `unit/models/Tweet.test.ts` | `Tweet` 构造器（mymblog 来源） | 核心字段映射、media 提取（pic_infos）、regionName、visible、stats、geo 坐标兼容（lon/lat 顺序）、retweeted_status 递归构造 |
| `unit/models/Tweet.show.test.ts` | `Tweet` 构造器（statuses/show 来源） | 从真实 fixture `tests/fixtures/raw/tweet_QqsYymYOS.json` 读取数据，验证长微博、地理位置、媒体信息归一化正确性 |
| `unit/models/Media.test.ts` | `normalizeImageWallItem` / `normalizeWaterfallVideo` | 图片墙 pic/livephoto/gif/unknown（URL 由 pid 构造）、视频瀑布 `page_info.media_info` 提取、`normalizeTweet` 的 page_info 视频映射 |
| `unit/models/Tweet.variants.test.ts` | `normalizeTweet` 真实 fixture 变种 | 纯文本 / 转发 / 图文 / 长文 / 视频 / 广告、`page_info.media_info` 视频、新增 optional 字段（`topics` / `linkCards` / `readCount` / `editCount` / `title` / `permanentVideoUrl` / `isOriginal` / `sourceUrl`） |
| `unit/models/Tweet.commentPics.test.ts` | `normalizeComment` 图片评论 | 真实 `comments.json` / `comments_pic_multi.json` / `my_comments_p1.json`、`url_struct[].pic_infos` 提取、多图重复 `url_struct` 去重、尺寸优先 `woriginal`、`reply_comment` / 楼中楼递归、无图时省略 `pics` |
| `unit/contract/itweet-v1.test.ts` | ITweet v1 契约冻结 | `TWEET_CONTRACT_VERSION = 1`、顶层键集类型/运行时锁定（含 2026-10-20 新增 optional 字段）、`ITweetComment` 键集与 `pics` 形状 |

### Unit — 服务基础设施

| 文件 | 覆盖内容 | 关键测试点 |
|---|---|---|
| `unit/services/AuthService.test.ts` | `AuthService` | Cookie 中提取 XSRF-TOKEN、无 Token 时的回退行为 |
| `unit/services/RateLimitService.test.ts` | `RateLimitService` | 令牌桶算法、限流效果、FakeClock 注入、并发获取令牌、432 后全局暂停（`pause` / `isPaused` / `getPausedRemainingMs`、`rate_limit_wait.reason`） |
| `unit/services/RetryPolicy.test.ts` | `RetryPolicy` | 默认/异常配置归一化、重试次数上限、失败类别分类（432/429/5xx/超时/无响应）、`Retry-After`（秒与 HTTP date）、指数退避 + jitter |

### Unit — 工具

| 文件 | 覆盖内容 | 关键测试点 |
|---|---|---|
| `unit/utils/tweetId.test.ts` | `parseTweetIdInput` / `normalizeTweetIdInput` | mblogid / 数字 mid / `m.weibo.cn` 与 `weibo.com` 状态 URL、分享文案、query/fragment/尾斜杠、拒绝用户主页/文章页/t.cn、`CONFIG_INVALID` context |

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
| `unit/sdk/WeiboSDK.test.ts` | `WeiboSDK` 门面类 | 构造器初始化 UserService/TweetService、selfCheck 模式 |

### Unit — CLI

| 文件 | 覆盖内容 | 关键测试点 |
|---|---|---|
| `unit/cli/archiveFlags.test.ts` | `resolveArchiveIncludeFlags` | 默认全开；citty `--no-reposts/--no-favorites/--no-date-slices` 映射为 `false`；单项关闭不影响其他阶段 |
| `unit/cli/parsePositiveInt.test.ts` | `parsePositiveInt` | 正整数字符串解析、小数取整；`0` / 负数 / 非数字 / 空串返回 undefined |
| `unit/cli/tweetCommentsArgs.test.ts` | `tweet comments` 参数 | `--max-id` 已声明并作为 `max_id` 透传（缺省 undefined） |
| `unit/cli/streamRangeArgs.test.ts` | 流式范围 CLI 参数 | `--max-items/--since/--until` 解析；时间序命令声明日期边界、非时间序命令只声明条数上限 |
| `unit/utils/streamRange.test.ts` | `createStreamRange` | `maxItems` 上限、`since` 早停、`until` 跳过、日期窗口、不可解析时间保留、非法日期 `CONFIG_INVALID`、缺 `getTime` 报错 |
| `unit/utils/pagination.test.ts` | `paginate` | 空页/去重/游标不前进/`maxPages`、`maxItems` 跨页截断、`since`/`until` 边界、日期边界缺 `getTime` 报错 |

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

### Component — 领域服务

| 文件 | 覆盖内容 | 关键测试点 |
|---|---|---|
| `component/public/UserService.test.ts` | `UserService` | info/details/myDetails 端点调用与 params、getById 归一化+正常化事件、session expired 错误、schema 校验失败 |
| `component/public/TweetService.test.ts` | `TweetService` | mymblog/show 端点调用与 params、listByUserId/getByMblogId 归一化+正常化事件、API not ok 错误、schema 校验失败、`enrich` raw+归一化（含可选 longtext）、请求级 `onRaw` 在校验/ok 检查前触发、流式 `maxItems` / `since` 早停 |
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

### E2E

| 文件 | 覆盖内容 | 前提条件 |
|---|---|---|
| `e2e/user.e2e.test.ts` | 真实网络下 UserService 端到端 | `WEIBO_E2E=1` + `.env` 中有效 `WEIBO_COOKIE` |
| `e2e/tweet.e2e.test.ts` | 真实网络下 TweetService 端到端 | `WEIBO_E2E=1` + `.env` 中有效 `WEIBO_COOKIE` |
| `e2e/new-endpoints.e2e.test.ts` | longtext（固定 `RcbHecsos`）/ friendships / followContent / searchProfile / favorites 结构快照 | 同上；列表端点只快照响应信封，避免内容漂移 |
| `e2e/snapshot.e2e.test.ts` | profile / mymblog / show 结构快照 + 归一化形状 + SDK 生命周期 | 同上；show 用固定 mblogId（`QqsYymYOS` / `P6yhlzD3j`），2026-10-19 起 18/18 稳定通过 |

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
| `component/public/MediaServiceDownload.test.ts` | `MediaService` 下载编排 | 图片/视频/LivePhoto、exists 跳过、去重、HTML 失败继续、dryRun、无 fs、403 刷新、storage fatal |