# 行动计划：0.1.0 发布 + 0.2.0 用户数据丰富度

**状态**: 进行中（2026-10-19 建立）
**承接**: [todo-contract-freeze.md](./todo-contract-freeze.md)（P0/P1/P2 已收口）
**产品定位**: 单账号公开数据归档 SDK，见 [requirements-spec.md](../requirements/requirements-spec.md)
**发布身份**: npm 包 `@chilfish/weibo-sdk`；CLI 二进制 `weibo-cli`

> 本文件是 0.1.0 发布收口与 0.2.0 功能扩展的**唯一行动清单**。新任务先登记到这里，再按优先级承接；
> 完成后勾选并回填日期/提交号，阶段结束后整体移入 `docs/archive/`。
>
> 原则：**功能扩展必须同时满足**——真实 fixture 驱动、契约不破坏、离线可测、CLI 可观察、
> 端点开发体验可复用。新增/修改端点的标准流程见 [endpoint-authoring.md](../engineering/endpoint-authoring.md)。

---

## 0. 当前基线（0.1.0）

- [x] 6 个领域服务 + ArchiveService：`users` / `tweets` / `followings` / `favorites` / `trends` / `search` / `archive`
- [x] 归档：mymblog + 日期切片 + 转发内联 + 收藏 + 评论挂载 + checkpoint 续传 + 进度事件 + 单条失败策略
- [x] 契约冻结：`ITweet` v1、`ArchiveItem.schemaVersion`、形状锁定测试
- [x] 离线测试：189 passed / 18 skipped（2026-10-20 复跑）
- [x] 真实 E2E：18/18（2026-10-20 复跑，维护者环境）
- [x] 发布门禁：typecheck / lint / build / validate:fixtures 全绿
- [x] npm 发布、Git tag、GitHub Release（0.1.1，2026-10-20）

---

## 1. P0 · 0.1.0 发布收口（阻塞发布）

### R0-1 包名 / CLI 二进制迁移

- [x] `package.json#name` → `@chilfish/weibo-sdk`
- [x] `package.json#bin` → `{ "weibo-cli": "./dist/cli.mjs" }`
- [x] `package.json#publishConfig.access` → `public`
- [x] CLI `meta.name` → `weibo-cli`
- [x] 回归测试断言包名 / bin（`tests/unit/entry/exports.test.ts`）
- [x] 全仓活跃文档与示例的 import / 子路径 / CLI 示例统一为 `@chilfish/weibo-sdk` / `weibo-cli`（2026-10-19）
- [x] `npm pack --dry-run` 检查产物（只含 `dist/`、README、LICENSE、package.json；2026-10-19：9 files / 168.3 kB）
- [x] 在 npm registry 确认 `@chilfish/weibo-sdk` 可发布（2026-10-19：registry 404，未被占用）

**DoD**：`pnpm build && node dist/cli.mjs --version`、`npm pack --dry-run`、exports 测试全部通过；README 的安装/导入/CLI 示例可直接复制运行。

### R0-2 正式发布

- [x] `CHANGELOG.md` Unreleased 迁移到 `0.1.0`（2026-10-20）
- [x] 打 tag：`git tag v0.1.0 && git push --tags`（2026-10-20；0.1.1 另打 `v0.1.1`）
- [x] GitHub Release：`gh release create v0.1.0 --generate-notes`（2026-10-20）
- [x] `pnpm publish`（2026-10-20：0.1.0 误用 npm 发布后 unpublish，改以 0.1.1 重发；见 [postmortem 010](../postmortem/010-npm-publish-catalog-protocol.md)）
- [x] 发布后核验：`npm view @chilfish/weibo-sdk dist-tags` → `latest: 0.1.1`；解包 tarball 依赖无 `catalog:`；临时目录安装后 `dist/cli.mjs --version` = `0.1.1`（2026-10-20）
- [ ] 归档 `todo-contract-freeze.md`，更新 [docs/README.md](../README.md) 索引

### R0-3 CI / 发布门禁补强

- [x] CI 增加 `pnpm run build`（当前 CI 只跑 typecheck/lint/test/validate:fixtures；2026-10-20）
- [x] CI 增加 `node scripts/browser-smoke.mjs --no-browser`（Node 侧导出/构建检查；2026-10-20）
- [x] Node 版本矩阵：至少 22 + 24；评估 Windows/macOS 矩阵（22 + 24 已接入；Windows/macOS 暂不纳入，2026-10-20）
- [ ] 定时真实 E2E / canary（GitHub Actions schedule + 受控 Cookie secret），在上游漂移时提前告警
- [ ] 发布工作流：tag 触发 `npm publish --provenance`（可选，但推荐）
- [ ] CI 覆盖率报告（先可视化，不强制门槛；后续再评估阈值）

---

## 2. P1 · 用户数据面扩展（0.2.0 主线）

> 目标：一个用户不只是「微博正文」，还包括点赞、收藏、历史评论、图片、视频、音频、超话、关系与提及。
> 所有端点先抓真实响应存 fixture，再写 schema；**未确认的端点不得直接进入实现**。

### 2.1 端点候选与验证状态

| ID | 能力 | 候选端点 | 验证状态 | 备注 |
|---|---|---|---|---|
| D1 | 用户点赞过的微博 | `GET https://weibo.com/ajax/statuses/likes?uid=<uid>&page=<n>` | ⚠️ 待抓包 | 与 D8「微博点赞者」语义不同；需用真实账号确认路径与游标 |
| D2 | 当前用户发布的历史评论 | `GET https://weibo.com/ajax/message/myCmt?cursor=<cursor>` | ✅ 开源实现已用 | 仅当前登录用户；cursor 分页 |
| D3 | 收藏夹 | `GET /ajax/favorites/all_fav?uid=&page=&with_total=true` + `/ajax/favorites/tags` | ✅ 已实现 | 增加全量流、标签过滤、归档集成 |
| D4 | 用户图片墙 / 相册 | `GET /ajax/profile/getImageWall?uid=&sinceid=`；`GET /ajax/profile/getAlbumDetail?...` | ✅ 路径已确认 | 需要确认 `sinceid` 语义与相册详情参数 |
| D5 | 用户视频瀑布 | `GET /ajax/profile/getWaterFallContent?uid=&cursor=` | ✅ 路径已确认 | 需要确认 cursor 与返回结构 |
| D6 | 用户音频 / 播放列表 | `GET /ajax/multimedia/user_playlists_get?...` | ⚠️ 待抓包 | 参数与返回结构待确认 |
| D7 | 超话 / 话题 | `GET /ajax/stopic/list?sort_id=0&keyword=&page=` | ⚠️ 待抓包 | 可能是发现页而非「我关注/我参与」；需确认 |
| D8 | 微博点赞者列表 | `GET /ajax/statuses/likeShow?id=<mid>&page=<n>` | ✅ 路径已确认 | 与 D1 区分；用于单条微博的点赞用户 |
| D9 | @我的微博 / @我的评论 | `GET /ajax/statuses/mentions`；`GET /ajax/comments/mentions` | ✅ 路径已确认 | 仅当前账号；可用于增量发现 |
| D10 | 消息计数 / 评论通知 / 点赞通知 | `GET /ajax/message/count`；`/ajax/message/cmt`；`/ajax/message/likeNotice` | ✅ 路径已确认 | 用于增量同步与「有新内容」判定 |
| D11 | 关注分组 / 微博分组 | `GET /ajax/feed/allGroups`；`GET /ajax/mblog/querygroup` | ✅ 路径已确认 | 归档分组元数据 |
| D12 | 个人主页关键词搜索 | `GET /ajax/statuses/searchProfile?uid=&q=&starttime=&endtime=&page=` | ✅ 真实网页端 | 现有 spec 增加 `q`，与日期切片组合 |
| D13 | 二级评论完整分页 | `buildComments` + `is_reply=1` / `fetch_level` | ⚠️ 待抓包 | 当前只拿上游内联 replies；需确认独立分页参数 |
| D14 | 文章 / 头条 | 候选 `/ajax/profile/getArticleList` 等 | ❌ 低置信 | 先抓包再决定是否进入范围 |
| D15 | 用户转发历史 | 候选 `/ajax/message/myRepost`（待确认） | ⚠️ 待抓包 | `mymblog` 已含转发；独立历史用于增量/只抓转发 |

> 验证方法：用 `capture/`（CDP）或浏览器 DevTools 抓真实请求 → 保存到 `tests/fixtures/raw/` →
> 在 `tests/fixtures/raw/INDEX.md` 登记 → 再写 `argsSchema` / response schema。

### 2.2 Likes（用户点赞）

- [x] **D1** 抓包确认「用户点赞过的微博」端点、分页游标、`ok` 语义、返回是微博数组还是卡片（2026-10-20：真实端点为 `/ajax/statuses/likelist?uid=&page=`；候选 `/ajax/statuses/likes` 已下线，返回 200 + HTML 404 页）
- [x] endpoint spec：`like.ts`（args：`uid` / `page`；`with_total` 被上游忽略）
- [x] `LikeService` / `sdk.likes`：`listByUserId` + `streamByUserId`（page 型；空页 / 整页重复 / `maxPages` 停止）
- [x] 归一化复用 `Tweet`；上游不提供「点赞时间」，只有微博发布时间 `created_at`
- [x] CLI：`weibo-cli like list|stream <uid> [--page] [--max-pages]`
- [ ] 归档集成：`streamArchive({ includeLikes: true })`，`ArchiveItem.source = 'like'`
- [ ] checkpoint：独立 `likesPage` / `likesCursor`，中断续跑
- [x] tests：fixture safeParse、分页停止、重复页保护、归一化、错误路径（2026-10-20：`tests/unit/services/LikeService.test.ts` 21 例 + component 3 例）

### 2.3 Comment history（当前用户历史评论）

- [x] **D2** 抓包确认 `/ajax/message/myCmt` 参数（`cursor` / `page` / `uid`）与返回结构（2026-10-20：真实翻页参数是 `max_id=<上一页 data.next_cursor>`，`page` 等价；`cursor` 被上游忽略；`next_cursor === 0` 停止）
- [x] endpoint spec：`commentHistory.ts` / `myCommentsSpec`
- [x] `CommentHistoryService` / `sdk.commentHistory`：`listMine` + `streamMine`（游标不前进 / 整页重复 / 空页 / `maxPages` 保护）
- [x] 归一化：`ITweetComment` 扩展 optional `rootId` / `replyTo` / `floorNumber` / `totalReplies` / `liked` / `parentMblogId`
- [x] 评论若带原微博引用，保留 `parentMblogId`；不挂完整 `parentTweet`（单页内嵌 status ~460K，避免归一化结果翻倍）
- [x] CLI：`weibo-cli comment mine|stream [--max-id] [--page] [--max-pages]`
- [ ] 归档集成：`streamArchive({ includeCommentHistory: true })`，`ArchiveItem.source = 'comment'`
- [x] 隐私边界：**只允许当前登录用户读取自己的历史评论**，不做他人评论历史（端点不接受 uid，身份由 Cookie 决定）
- [x] tests：分页、空结果、删除评论/微博的容错、归一化（2026-10-20：`tests/unit/services/CommentHistory.test.ts` 31 例）

### 2.4 Favorites 增强

- [x] **D3** `streamFavorites(uid, options)` 自动翻页 + 跨页去重 + `maxPages` / `onProgress`；配套 `listFavorites` 返回 `{ page, hasMore, total?, totalPages?, tweets }`（2026-10-20）
- [x] 标签过滤：`listFavorites` / `streamFavorites` 的 `tag` 选项按收藏项自带 `tags` 做客户端精确匹配（id 或名称）（2026-10-20）
- [x] 收藏项保留收藏时间 / 来源：raw 仅提供微博发布时间 `created_at` 与 `tags`，没有收藏时间字段；不新增 `ITweet` 字段，保持契约不变（2026-10-20 复核）
- [x] CLI：`weibo-cli favorite stream <uid> [--page] [--tag] [--max-pages]`，NDJSON 输出 `progress` / `item` / `done`（2026-10-20）
- [x] tests：翻页、整页重复、`maxPages`、`total_page` / `total_number` 估算、空收藏、标签过滤、进度回调异常（2026-10-20）
- [x] 修复 `favorite list --page 0`（及非法页码）透传导致上游 HTTP 400（2026-10-20 线上复核：`page=0` 返回 400，`page` 从 1 开始）

> 2026-10-20 线上复核（已登录 Chrome）：`all_fav` 顶层存在 `count` / `total_page`，用 `total_page` 判 `hasMore` 比 `total_number` 更可靠（`total_number` 可能包含已删除项）；`tag_id` / `tag` 参数被上游忽略，标签只能客户端过滤。

### 2.5 账号级媒体集合

- [ ] **D4** 图片墙：`getImageWall` 分页 + `getAlbumDetail`（相册）
- [ ] **D5** 视频瀑布：`getWaterFallContent` 分页
- [ ] **D6** 音频 / 播放列表：`user_playlists_get`
- [ ] 新领域模型 `IUserMediaAsset`：`id` / `type`（pic/video/audio/livephoto）/ `url` / `coverUrl` / `width` / `height` / `duration` / `createdAt` / `sourceTweetId?` / `permanentPageUrl?`
- [ ] CLI：`weibo-cli media images|videos|audio <uid>`
- [ ] 归档集成：`includeImages` / `includeVideos` / `includeAudio`
- [ ] 可选下载 helper（默认关闭）：`downloadMedia(asset, { dir })`，失败写 `media-errors.json`
- [ ] tests：分页、去重、URL 过期提示、下载失败不中断

### 2.6 关系 / 提及 / 分组 / 通知

- [ ] **D8** `tweets.likers(mblogId, { page })` + `streamLikers`
- [ ] **D9** `users.mentions({ sinceId })` / `comments.mentions({ sinceId })`
- [ ] **D10** `notifications.count()` / `notifications.comments()` / `notifications.likes()`
- [ ] **D11** `users.groups()` / `users.mblogGroups()`
- [ ] **D15** 转发历史：优先抓包确认独立端点；否则复用 `mymblog` + 「转发」过滤
- [ ] 增量同步可利用 D10 判断「是否有新内容」，避免全量扫描
- [ ] tests + CLI（`weibo-cli notification ...`，低频能力标 advanced）

### 2.7 搜索与评论完整性

- [ ] **D12** `searchProfile` 增加 `q`（个人主页内关键词搜索）；CLI `tweet search-profile --q`
- [ ] 日期切片 + 关键词组合：先按日期窗口，再按 `q` 过滤
- [ ] **D13** 二级评论：确认 `is_reply=1` / `fetch_level` 后实现递归分页
- [ ] `ITweetComment.replies` 支持完整树；限制深度/数量并暴露选项
- [ ] tests：楼中楼递归、分页、缺失父评论、循环引用保护

### 2.8 公共流式分页

> 目前自动翻页主要藏在 `ArchiveService` 内部；下游单独用某个 Service 时仍要自己写循环。
> 目标：所有可分页的公开能力都提供 `AsyncIterableIterator` + `maxPages` / `onProgress`。

- [ ] `tweets.streamComments(mblogId, { maxPages?, count?, flow? })`
- [ ] `tweets.streamReposts(mblogId, { maxPages?, count? })`
- [ ] `followings.streamFollowings(uid, { maxPages? })` / `streamFans(uid, ...)`
- [ ] `favorites.streamFavorites(uid, { maxPages? })`
- [ ] 点赞 / 历史评论 / 图片墙 / 视频瀑布的流式版本（随 D1/D2/D4/D5）
- [ ] 统一重复页保护、游标不前进保护、`hasMore` 语义
- [ ] CLI：分页命令支持 `--all` / `--max-pages`
- [ ] tests：空页、重复页、游标重置、提前 `break`

### 2.9 归档编排扩展

- [ ] `ArchiveItem.source` 扩展：`'timeline' | 'repost' | 'favorite' | 'like' | 'comment' | 'image' | 'video' | 'audio'`
- [ ] `ArchiveStreamOptions` 增加：`includeLikes` / `includeCommentHistory` / `includeImages` / `includeVideos` / `includeAudio`
- [ ] `ArchiveCheckpoint` 增加各数据源游标（保持恒定大小，禁止全量 id 数组）
- [ ] **增量模式**：`incremental: { since?: number, stopAtMblogId?: string }`
  - 时间游标：只抓上次之后的新内容
  - 早停：翻到已知 `mblogId` 即停止
  - 置顶微博跳过策略
- [ ] **多账号批量**：`streamUsersArchive(uids, options)` 或 `archiveMany`；CLI `archive --uid-file <path>`
- [ ] **仅原创**：`originalOnly` 过滤（对齐同类项目的 `only_crawl_original`）
- [ ] **增量与全量的状态文件**：`state.json`（每个 uid 的 last time / last mblogId）
- [ ] tests：10k 条规模、checkpoint 恒定大小、增量无重复/无漏、批量失败隔离

---

## 3. P1 · 契约与字段丰富度

> `ITweet` v1 只允许新增 optional 字段；rename/remove/类型变更必须升 v2 + major。
> 所有字段以真实 fixture 为准，不从直觉推导。

### 3.1 ITweet 可选字段

- [ ] `topics?: string[]`（话题）
- [ ] `atUsers?: TweetUser[]`（@ 用户）
- [ ] `readCount?: number`（阅读数，仅自己可见/部分账号）
- [ ] `playCount?: number`（视频播放数）
- [ ] `isOriginal?: boolean`（原创 / 转发）
- [ ] `isTop?: boolean`（置顶）
- [ ] `editHistory?`（编辑历史，若 raw 提供）
- [ ] `permanentVideoUrl?: string`（`video.weibo.com/show` / `weibo.com/tv/show` 永久页）
- [ ] `audio?: TweetAudio[]`（语音/音频）
- [ ] `sourceUrl?: string`（微博网页永久链接）

### 3.2 IUser / IComment 可选字段

- [ ] `IUser.ipLocation?` / `creditScore?` / `labels?` / `svip?`
- [ ] `IUserVerification` 增加 `verifiedType` 映射说明
- [ ] `ITweetComment.rootId?` / `replyTo?` / `floorNumber?` / `liked?` / `totalReplies?`
- [ ] `ITweetComment.parentMblogId?`（历史评论归属的原微博）

### 3.3 契约治理

- [ ] 更新 [contract-itweet-v1.md](../engineering/contract-itweet-v1.md) 冻结表与形状测试
- [ ] 每个 optional 字段补 2 种真实变种 fixture
- [ ] `schemaDigest` 漂移报告：新增字段 / 类型变化输出可读 diff
- [ ] v2 迁移函数预留（仅当出现破坏性变更）

---

## 4. P1 · 可靠性与风控

- [x] **432 独立错误**：`RateLimitError`（`retryable: true`），映射 HTTP 432 / 风控业务码（2026-10-20：`RATE_LIMITED`，level `transport`，同时覆盖 429；`context` = `status` / `retryAfterMs?` / `attempt`）
- [x] **指数退避 + jitter**：432 / 429 / 5xx / 超时；支持 `Retry-After`（2026-10-20：`src/services/internal/RetryPolicy.ts`，支持秒与 HTTP date，`maxDelayMs` 截断）
- [x] **请求级重试策略**：`IWeiboConfig.retry = { retries, baseDelayMs, maxDelayMs, retryOn }`（2026-10-20：全部可选，默认 `2 / 500 / 8000`，`retries` 上限 10，`0` = 关闭；不可重试错误不重试）
- [x] **限流与重试的协作**：432 后暂停全局令牌桶，避免多请求同时撞墙（2026-10-20：`RateLimitService.pause()` + `acquire()` `while` 循环先等暂停；`rate_limit_wait.reason = 'rate_limited'`）
- [ ] **代理抽象**：`ProxyProvider`（静态 / 动态 / 按请求），替代单一 `proxyUrl`
- [ ] **Cookie 失效诊断**：自检之外，遇到登录页 HTML / `ok:-100` 给出明确下一步
- [ ] **无 Cookie 访客模式（P3）**：公开数据兜底；不影响 Cookie 全量归档主线
- [ ] **定时漂移检测**：真实 E2E + `schemaDigest` 对比，输出上游变化报告
- [x] tests：432 → 退避 → 成功；重试上限；超时（2026-10-20：`tests/component/internal/FetcherRetry.test.ts`（432/429/5xx/超时/Retry-After/不可重试/令牌桶暂停）+ `tests/unit/services/RetryPolicy.test.ts` + `tests/unit/services/RateLimitService.test.ts` 暂停用例）
- [ ] tests：代理切换（随「代理抽象 `ProxyProvider`」任务落地）

---

## 5. P1/P2 · 端点开发体验（DX）

> 目标：新增一个端点的改动面可预测，避免「schema / service / CLI / fixture / 文档」各处漏改。

- [x] 编写 [endpoint-authoring.md](../engineering/endpoint-authoring.md)（标准流程 + 检查清单 + 雷区）
- [ ] **脚手架**：`pnpm new:endpoint <domain>/<name>` 生成 args schema、response schema、spec、service 方法、CLI 命令、测试骨架
- [ ] **抓包助手**：`pnpm capture:endpoint <url>` 自动脱敏、写 fixture、更新 `INDEX.md` / `FIXTURE_RULES`
- [ ] **端点清单**：`sdk.capabilities()` + `weibo-cli capabilities`，输出能力 / 登录要求 / 分页类型 / 状态
- [ ] **分页抽象**：`paginate()` / `CursorPager`，统一 page / cursor / since_id / max_id 语义
- [ ] **错误信封与下一步**：CLI 错误带 `code` / `hint` / `next`（保持现有 JSON 输出兼容）
- [ ] **输出级别**：`--detail compact|full`（尤其是 timeline / comments / archive）
- [ ] **评价指标**：新增端点必须满足「1 个 fixture + 1 个 component test + 1 个 CLI 命令 + 1 段文档」
- [ ] **端点变更 checklist 自动化**：CI 检查新增 endpoint 是否登记 fixture / CLI / 导出面
- [ ] **TSDoc**：所有新增 public 方法参数、异常、分页语义、Wide Event 触发点

---

## 6. P2 · 分发与 Agent/产品化

- [ ] `llms.txt`（能力清单 + 命令示例 + 边界）
- [ ] Agent skill / `SKILL.md`（安装、登录、常用命令、错误处理、安全边界）
- [ ] MCP server（只读工具：user / timeline / tweet / comments / archive status）
- [ ] 导出适配器示例：Markdown / CSV / SQLite（作为 `examples/` 或独立包，不进入 SDK 核心）
- [ ] 多账号登录态隔离（`~/.weibo-cli/accounts/`，权限 0600）
- [ ] 终端二维码登录（`/sso/v2/qrcode/*`）
- [ ] Docker / 定时任务示例（增量同步）
- [ ] 媒体下载示例（原图 / 视频多清晰度 / LivePhoto `.mov` / 音频）

---

## 7. 明确不做 / 暂缓

| 能力 | 决策 | 原因 |
|---|---|---|
| 全局关键词搜索（`searchUsers` / `searchTweets`） | ⏸️ 产品暂缓 | 官方搜索体验差、上游接口失效；`searchProfile` 仍保留 |
| 写操作（发布 / 点赞 / 转发 / 评论 / 关注） | ❌ 不做 | 归档是只读任务；涉及风控与责任 |
| 私信 / 仅粉丝可见 / 付费内容 | ❌ 不做 | 超出公开数据归档范围，涉及他人隐私 |
| 多平台支持 | ❌ 不做 | 聚焦微博；多平台已有成熟项目 |

---

## 8. 建议执行顺序

1. **R0 发布收口**：包名/bin/文档/CI + 0.1.0 tag/Release/npm
2. **D2 历史评论 + D3 收藏增强 + D1 点赞**：用户数据面最小闭环
3. **D4/D5/D6 媒体集合**：图片墙 / 视频 / 音频
4. **归档编排扩展**：新数据源进 `streamArchive` + 增量 + 多账号 + 仅原创
5. **D12 `q` 搜索 + D13 二级评论 + D8/D9/D10/D11**
6. **可靠性**：432 / 重试 / 代理 / 漂移检测
7. **DX**：脚手架 / 抓包助手 / capabilities / 分页抽象
8. **Agent / 导出 / 登录增强**

---

## 9. 完成定义（DoD）

每个功能任务必须满足：

- [ ] 真实 fixture（脱敏）已入库并登记 `INDEX.md` / `FIXTURE_RULES`
- [ ] `argsSchema` + response schema（`.passthrough()` / optional 字段）通过 `validate:fixtures`
- [ ] Service 方法有归一化（如适用）与结构化错误
- [ ] CLI 子命令（CLI Mandate）
- [ ] unit / component 测试；错误路径覆盖
- [ ] TSDoc + 相关文档（technical-spec / cli / README）
- [ ] `pnpm run typecheck` / `lint` / `test` / `build` 全绿

---

## 10. 参考

- [端点开发指南](../engineering/endpoint-authoring.md)
- [技术规格](../engineering/technical-spec.md)
- [CLI 参考](../engineering/cli.md)
- [发布清单](../engineering/release-checklist.md)
- [同类项目调研](./research-weibo-ecosystem-2026-10-19.md)
