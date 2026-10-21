# ITweet 存档契约 v1（冻结）

**项目**: weibo-sdk | **冻结日期**: 2026-09-04 | **状态**: v1 生效 | **来源**: [todo-contract-freeze P0-1](../archive/todo-contract-freeze.md) / [review K1/K3](../reviews/review-apple-design-2026-08-10.md)

> `ITweet` 是下游 Weibo-archiver（web-v3 / monkey / CLI）的 **UI 展示与磁盘存档终局契约**
> （ADR-007/008，存入 IndexedDB）。改一个字段 = 破坏下游已归档数据——本文件把「改契约」
> 变成一个受版本管理的显式流程，而不是一个静默的 diff。
>
> 本文件与 `src/types/domain/ITweet.ts`（类型实现）、`tests/unit/contract/itweet-v1.test.ts`
> （形状锁定）共同构成契约的三份事实源：**规则在此、形状在类型、锁在测试**。

## 1. 版本机制（信封层）

- **契约版本常量**：`TWEET_CONTRACT_VERSION`（`src/types/domain/ITweet.ts`，当前 `1`；类型 `TweetContractVersion`）
- **归档信封**：`ArchiveItem = { schemaVersion, source, mblogId?, tweet?, asset?, schemaDigest, checkpoint, comment? }`
  ——磁盘条目自描述；CLI `weibo-cli archive` 的 NDJSON 进度事件同样携带 `schemaVersion`。
  `source: 'image'` 时 `tweet` / `mblogId` 可选，媒体资产在 `asset`；`source: 'video'` 同时有 `tweet` 与 `asset`；其余微博类 source 的 `tweet` / `mblogId` 恒有。
- **下游最小存档记录**建议：`{ schemaVersion: TweetContractVersion, tweet: ITweet }`
  （`source` / `checkpoint` 等为 SDK 归档流的附加元数据，消费方可按需取舍）
- **契约版本 ≠ 包版本**（K2/P0-3 解耦，详见 [release-checklist.md](./release-checklist.md)）：
  上游协议漂移 → 内部 schema 修复 + patch/minor；**只有契约破坏性变更才升包 major**。

## 2. v1 变更规则（冻结边界）

| 变更类型 | v1 内允许？ | 包版本动作 |
|---|---|---|
| 新增 optional 字段 | ✅（老读取方忽略未知键，非破坏；须更新本文件冻结表 + 契约测试键集） | minor |
| 注释 / 文档完善 | ✅ | patch |
| 字段 rename / remove | ❌ → 升 v2 | major |
| 字段类型或语义变更 | ❌ → 升 v2 | major |
| 枚举纯新增值（`TweetVisible` / `MediaType`） | ⚠️ 视语义：仅追加新值 = minor；重定义既有值语义 = v2 | — |

> 判断口径：**「一年前落盘的 v1 记录，用今天的代码读，是否仍然正确？」**——答案为否的任何变更都必须升 v2。

## 3. v1 字段冻结表

### ITweet（`src/types/domain/ITweet.ts`）

| 字段 | 类型 | 语义 / 备注 |
|---|---|---|
| `id` | `string` | 数字 id（`idstr` 优先，`id` 兜底转 string） |
| `mblogId` | `string` | 字母形式 id（如 `QqsYymYOS`，详情页 URL 用） |
| `createdAt` | `string` | 上游原始时间字符串（未做时区/格式转换） |
| `text` | `string` | 纯文本正文（`text_raw`，缺省 `''`） |
| `textHtml` | `string` | HTML 正文（`text`，缺省 `''`） |
| `regionName?` | `string` | IP 属地（如「发布于 广东」；无则缺省） |
| `source` | `string` | 发布客户端（缺省 `''`） |
| `user` | `TweetUser` | 见下；**简版**，非完整 IUser |
| `stats` | `{ likes, comments, reposts }`（均 `number`） | 计数快照（缺省 0） |
| `visible` | `TweetVisible`（enum 0-4） | 可见性；未知值回退 `PUBLIC(0)` |
| `retweetedStatus?` | `ITweet` | 转发内容，**递归同构**；非转发缺省 |
| `repostChain?` | `TweetRepostEntry[]` | 转发链分层（`text` 的 `//@` 由近到远；`index` 0 = 当前微博）；每层聚合该层 reppic 配图，见下；非转发缺省 |
| `pageInfo?` | `TweetPageCard` | 链接/视频卡片 `{ pageId, pageTitle, pageUrl, pagePic, type, objectType, objectId?, subtitle? }`；见下 |
| `media` | `TweetMedia[]` | 见下；**恒为数组**（无媒体 = 空数组） |
| `geo?` | `TweetGeo` | 定位 `{ latitude, longitude, address }`；无则缺省 |
| `topics?` | `string[]` | 话题（`topic_struct[].topic_title`，缺省退回 `title`；去重保序） |
| `linkCards?` | `TweetLinkCard[]` | 链接 / 超话卡片（`url_struct[]`；见下） |
| `readCount?` | `number` | 阅读数（`reads_count`；仅部分端点 / 自己可见时下发） |
| `editCount?` | `number` | 编辑次数（`edit_count`；未编辑或未下发时缺省） |
| `title?` | `string` | 顶栏标题（`title.text`，如「公开」「仅自己可见」） |
| `permanentVideoUrl?` | `string` | 视频永久播放页（`media_info.h5_url`） |
| `isOriginal?` | `boolean` | 是否原创（无 `retweeted_status`） |
| `sourceUrl?` | `string` | 微博网页永久链接（`https://weibo.com/<uid>/<mblogid>`） |
| `comments?` | `ITweetComment[]` | 评论（P1-6，v1 新增 optional 字段）：普通 `normalizeTweet` 不填充；仅 `streamArchive({ includeComments: true })` 拉取并挂载。字段见 §3「ITweetComment」；`replies` 递归同构 |
| `atUsers?` | `TweetAtUser[]` | @ 用户（从 `text` HTML 的 `/n/`、`/u/` 锚点解析；上游无结构化字段） |
| `playCount?` | `number` | 视频播放量（仅 `online_users` 明确含「次观看」时；直播在线人数不映射） |
| `isTop?` | `boolean` | 是否置顶（`isTop === 1/true`；非置顶缺省） |
| `audio?` | `TweetAudio[]` | 音频 / 播客（`page_info` / `mix_media_info.items[].data`） |

### TweetUser（简版用户）

| 字段 | 类型 | 语义 |
|---|---|---|
| `id` | `string` | 用户 id（`idstr` 优先） |
| `name` | `string` | 昵称（`screen_name`） |
| `avatar` | `string` | 头像（`avatar_hd` → `avatar_large` → `profile_image_url` fallback 链） |
| `verified` | `boolean` | 是否认证 |
| `verifiedType` | `VerificationType` | 认证类型（缺省 0） |

### TweetMedia（媒体）

| 字段 | 类型 | 语义 |
|---|---|---|
| `id` | `string` | 媒体 id（pic_infos 键或 mix_media object_id） |
| `type` | `MediaType`（`pic` / `video` / `livephoto` / `gif` / `unknown`） | 媒体类型 |
| `imageUrl` | `string` | 最大尺寸图 / 视频封面 URL（**临时，见 §4**） |
| `videoUrl?` | `string` | mp4 / mov 地址（**临时，见 §4**；livephoto 恒有） |
| `duration?` | `number` | 视频时长（秒） |
| `width` / `height` | `number` | 像素尺寸（缺省 0） |

### TweetLinkCard（链接 / 超话卡片）

| 字段 | 类型 | 语义 |
|---|---|---|
| `title` | `string` | 卡片标题（`url_title`；缺省 `''`） |
| `url` | `string` | 跳转地址（`h5_target_url` → `long_url` → `ori_url`；缺省 `''`）。可能是中间页 / 短域，规范地址见 `longUrl` |
| `shortUrl?` | `string` | 展示短地址（`short_url`） |
| `pageId?` | `string` | 卡片 page id（`page_id`） |
| `objectType?` | `string` | 对象类型（`object_type`） |
| `typePic?` | `string` | 卡片图标（`url_type_pic`） |
| `longUrl?` | `string` | 规范网页地址（`long_url`，如 `bilibili.com/video/...`）；上游未下发缺省 |
| `oriUrl?` | `string` | 上游原始跳转（`ori_url`，可能是 `sinaweibo://` scheme）；原样保留，缺省 |
| `urlType?` | `number` | 卡片类型码（`url_type`，样本 `39`）；`0` 也保留，缺省表示未下发 |

> `url` 与 `longUrl` / `oriUrl` 是三个不同层级的地址：`url` 是客户端点击目标（优先 `h5_target_url`），
> `longUrl` 是规范网页地址，`oriUrl` 是上游原始 scheme（可能是 `sinaweibo://browser?...`）。
>
> `statuses/show?isGetLongText=true` 会重复下发同一条 `url_struct`；归一化按 `shortUrl`（`t.cn` 短链 code，
> 兼容 http/https）去重，无 `shortUrl` 时按解析后的 `url` 去重，只有标题的卡片不参与去重。

### TweetPageCard（页面卡片）

| 字段 | 类型 | 语义 |
|---|---|---|
| `pageId` | `string` | 卡片 id（`page_id`；缺省 `''`） |
| `pageTitle` | `string` | 卡片标题（`page_title`；缺省 `''`） |
| `pageUrl` | `string` | 卡片跳转（`page_url`；可能是 `sinaweibo://` scheme） |
| `pagePic` | `string` | 封面图（`page_pic`；`http://` 统一升级为 `https://`） |
| `type` | `number` | 卡片类型码（`type`；缺省 `0`） |
| `objectType` | `string` | 对象类型（`object_type`；如 `webpage` / `video` / `podcast_audio` / `audio`） |
| `objectId?` | `string` | 卡片对象 id（`object_id`）；未下发缺省 |
| `subtitle?` | `string` | 卡片副标题 / 统计文案（`content2`，如「812播放  74点赞  0弹幕」）；空则缺省 |

### TweetRepostEntry（转发链层）

> 来源：转发时附带的图片（reppic）不在 `pic_ids` / `pic_infos`，只在 `url_struct[]`（`url_type: 39`）；
> 多层转发链会把各层配图全部聚合到顶层 `url_struct[]` 且重复下发。`repostChain` 按正文
> `//@` 由近到远分层，并用 `short_url` 把图片挂回所属层，避免「只剩一堆无归属图片」。

| 字段 | 类型 | 语义 |
|---|---|---|
| `index` | `number` | 层级索引：`0` = 当前微博，`1..n` = `text` 中由近到远的 `//@` 层级 |
| `authorName?` | `string` | 该层作者昵称（0 层取 `user.name`；其余从 `//@name:` 解析；无法解析缺省） |
| `text` | `string` | 该层正文（去掉 `//@` 前缀与图片短链；可能为空串） |
| `media` | `TweetMedia[]` | 该层配图（`url_struct[]` 的 reppic 条目；按 `pic_id` 去重；无图为空数组） |

- 链末端的原微博仍是 `retweetedStatus`，不复制进 `repostChain`。
- 无法在正文中定位的图片（正文截断 / 脱敏）追加到末尾补充层（`text: ''`），保证不丢数据。
- 中间层的 uid / mblogId 上游未下发，不臆造。

### TweetAtUser（@ 用户）

| 字段 | 类型 | 语义 |
|---|---|---|
| `name` | `string` | 展示名（锚点文本去掉前导 `@`） |
| `username?` | `string` | 主页路径中的用户名（`/n/<username>` / `/u/<uid>`） |
| `url?` | `string` | 用户主页绝对 URL |

### TweetAudio（音频 / 播客）

| 字段 | 类型 | 语义 |
|---|---|---|
| `id` | `string` | 音频 id（`media_id` → `page_id` → `object_id`） |
| `title` | `string` | 标题（`page_title` / `name`） |
| `url` | `string` | 播放地址（`stream_url` → `h5_url`） |
| `duration?` | `number` | 时长（秒） |
| `pageUrl?` | `string` | 播放页（`h5_url`） |
| `authorName?` | `string` | 作者昵称（`author_info.screen_name`） |
| `authorId?` | `string` | 作者 id（`author_info.idstr` → `id`） |

### ITweetComment（评论）

| 字段 | 类型 | 语义 |
|---|---|---|
| `id` | `string` | 评论 id（`idstr` → `id`） |
| `createdAt` | `string` | 上游原始时间字符串 |
| `text` | `string` | 纯文本（`text_raw` → `text`） |
| `textHtml` | `string` | HTML 片段（`text` → `text_raw`） |
| `source` | `string` | 来源（如「来自 广东」） |
| `likes` | `number` | 点赞数（`like_counts` → `like_count`；缺省 0） |
| `user` | `TweetUser` | 评论作者（简版） |
| `replies?` | `ITweetComment[]` | 楼中楼预览（上游 `comments[]`，递归同构） |
| `pics?` | `TweetCommentPic[]` | 图片评论配图（上游 `url_struct[].pic_infos`；无图缺省） |
| `rootId?` | `string` | 根评论 id（`rootidstr` → `rootid`） |
| `replyTo?` | `ITweetComment` | 被回复的评论（`reply_comment`，递归；不展开 `comments`） |
| `floorNumber?` | `number` | 楼层号（可为 0） |
| `totalReplies?` | `number` | 楼中楼回复总数（`total_number`；不含不可见评论） |
| `liked?` | `boolean` | 当前登录用户是否点赞（上游未下发时缺省） |
| `parentMblogId?` | `string` | 被评论微博的字母 id（内嵌 `status.mblogid`） |

### TweetCommentPic（评论配图）

| 字段 | 类型 | 语义 |
|---|---|---|
| `id` | `string` | 图片 id（`pic_infos` 键 / `pic_id`） |
| `imageUrl` | `string` | 最大尺寸图片 URL（`largest` → `original` → `woriginal` → `mw2000` → `large` → `bmiddle` → `thumbnail`；**临时，见 §4**） |
| `width` / `height` | `number` | 像素尺寸（缺省 0） |

> 图片评论不在评论顶层 `pic`，而是藏在 `url_struct[].pic_infos`（「查看图片」短链卡片）。
> 多图评论可能返回多个 `url_struct` 项并重复同一 `pic_infos`；归一化按 `pic_id` 去重，顺序为上游首次出现顺序。

### 嵌套说明

- `retweetedStatus` 递归为同一 `ITweet` 形状（深度由上游数据决定）。
- `pageInfo.pagePic` 为封面图 URL 字符串（同样受 §4 临时性约束）。

## 4. 媒体 URL 契约（P0-2 裁定，2026-09-04）

**裁定**：「URL 临时、消费方自抓」。

- `media[].imageUrl` / `videoUrl`（及 `pageInfo.pagePic`、`comments[].pics[].imageUrl`）是上游**临时签名 URL**：
  有效期 = 请求时间 + 1 小时、一次性（服务端再次下发新 URL 后旧链接作废）。
- **归档流不下载/持久化媒体**；`ArchiveItem` 不含 `mediaFiles`（裁定同时定义了信封形状）。
- **SDK 提供显式可选的媒体下载辅助**（`sdk.media.downloadTweetMedia` / `weibo-cli media download`），默认不启用，不改变本契约；详见 §4.2。
- 存档消费方（archiver）必须在归档时及时下载媒体字节；仅存 URL 的展示属「临时可用」，不是长期存档。
- 过期后的恢复路径：经 SDK 重新拉取单条微博（`getByMblogId` / `show`）获取新 URL。
- 媒体下载辅助 API（可选增强，显式调用）= `sdk.media.downloadTweetMedia` / `weibo-cli media download`；不阻塞本契约，`ArchiveItem` 仍不含 `mediaFiles`。

## 4.1 原始数据（raw）与 enrich 边界（2026-10-19 裁定）

**裁定**：`ArchiveItem` **不携带 raw**；raw 由下游按需另行保存。

- **信封保持 v1 形状**：`{ schemaVersion, source, mblogId, tweet, schemaDigest, checkpoint }`，不新增 `raw` 字段（避免磁盘膨胀与契约耦合）。
- **raw 获取路径**（P1-9 定稿，2026-10-19）：
  1. **请求级**：`config.hooks.onRaw(raw, meta)` —— 在 Zod 校验前触发，拿到端点**原始响应**；即使 `ok !== 1` 或 schema 校验失败也会先收到 raw。`meta` 含 `endpoint` / `resourceType` / `request` / `args` / `trace_id` / `timestamp`。`onFetched` 已移除；成功路径统一用 `onRaw` + `config.telemetry`（Wide Events）。
  2. **归档级**：`streamArchive(uid, { onRaw(raw, meta) })` —— 每个原始微博项在归一化前触发；`meta` 含 `uid` / `source` / `mblogId` / `page?` / `parentMblogId?`（repost 阶段为被转发原微博）。`ArchiveItem` 仍不携带 raw。
  3. **单条补拉**：`tweets.enrich(mblogId, options?)` 返回 `{ tweet, raw, longText? }`，把 raw 响应与归一化模型一起交给调用方；归档层需要的 mymblog 原始页走 `tweets.fetchRawUserTimelinePage()`（不再保留 `show` / `myMblog` 等已弃用别名）。
- **enrich 方法**：**不改变 `ITweet` v1**。`tweet` 与 `getByMblogId` 同构；`raw` 为 `statuses/show` 的 passthrough 原始响应；`longText` 仅在 `includeLongText: true` 时补拉 `longtext` 端点。enrich 结果由调用方决定是否落盘；uid 级扩展字段走 `users.fetchRawInfo` / `users.fetchRawDetails` 或请求级 `onRaw`。
- **回调失败语义**：`onRaw` 抛错会使该次请求 / 该条归档失败（不静默丢失 raw），与其它 hooks 一致。
- **下游职责**：需要 raw 的消费方（如 archiver）自行保存 raw 字节/JSON，并按 `mblogId` 与 `{ schemaVersion, tweet }` 关联。

## 4.2 媒体下载辅助（2026-10-20 补充裁定）

**裁定**：在「归档流不下载」的前提下，SDK 提供**显式调用**的单条微博媒体下载辅助；不是归档自动行为。

- 范围：单条微博（含转发兜底）；不做账号级图片墙/视频瀑布的自动下载。
- 落盘：扁平 `<mblogId>-<index>-<mediaId>.<ext>`；LivePhoto 动态帧加 `-motion`。
- 安全：CDN 请求只带 `Referer`（默认 `https://weibo.com/`），**不携带 Cookie/XSRF**；主机后缀白名单。
- 稳定性：403/404/410 重新拉取微博换新 URL（每条微博最多一次）；临时文件 + 原子 rename；字节上限、空闲超时、Content-Length 校验、重试退避。
- 失败：单项失败不中断其余项；`<mblogId>-media-errors.json` 汇总；CLI 有失败时非零退出。
- 详见 [media-download.md](./media-download.md)。
## 5. 迁移策略（v1 → v2）

1. v2 随包 **major** 版本发布，`TWEET_CONTRACT_VERSION` 升为 `2`，`ArchiveItem.schemaVersion` 类型随之收紧。
2. SDK 同步导出迁移函数（如 `migrateTweetV1toV2(record)`），纯函数、可离线测试。
3. **下游 dexie `version()` 联动设计**：
   - dexie schema version 与契约版本**各自独立演进**（dexie 管 store/索引，契约管记录形状）；
   - 升级路径 = `db.version(n + 1).upgrade(tx => 逐条读 record → 按 record.schemaVersion 分发到 SDK 迁移函数 → 写回)`；
   - **读到未知更高 `schemaVersion`**：拒绝覆盖写入并提示升级 SDK（防降级写坏已升级数据）；
   - `schemaVersion` 缺失（v1 冻结前的历史数据）按 `1` 处理。
4. CHANGELOG 以 `BREAKING CHANGE` footer 标注并给出迁移指南。

## 6. schemaDigest ≠ schemaVersion（K1 澄清）

| | `schemaDigest` | `schemaVersion` |
|---|---|---|
| 管什么 | **上游漂移**：raw 响应结构快照（`stripVolatileKeys`），同一端点字段变化时 digest 变 | **下游磁盘格式**：ITweet 契约版本，记录形状演进时升版 |
| 谁消费 | SDK 侧回归 / 排障（对比同期同端点 digest） | 下游存档读取方（按版本迁移） |
| 变更时机 | 随上游任意变化（不受控） | 仅契约破坏性变更（受控，本文件 §2） |

## 7. 契约锁定手段

- **类型层**：`tests/unit/contract/itweet-v1.test.ts` 断言 `keyof ITweet` 精确键集（rename/remove/新增都会编译期失败，强制走本文件流程）。
- **运行时层**：真实 fixture（`mymblog_page1.json`，含 `pic_infos` 样本）归一化键集快照（数据驱动，防实现悄悄改形状）。
- **修改契约的流程**：先改本文件（版本决策，§2）→ 改 `ITweet.ts` 类型 → 契约测试红 → 实现 → CHANGELOG 标注。

## 8. 待下游（Weibo-archiver）同步事项

> 本机不可读 `I:\dev\Weibo-archiver`，以下为 archiver 侧需要跟进的对齐点（2026-09-04 记录）：

1. 集成文档 §3.1「主版本跟随协议漂移」改为本文件 §1 的解耦规则（K2）。
2. M0 前完成：dexie 存档记录采用 `{ schemaVersion, tweet }` 信封；升级回调用按 §5 设计。
3. §9.6 版本锁定策略与 weibo-sdk 的 0.x 契约冻结声明对齐（见 [CHANGELOG](../../CHANGELOG.md) / README）。
4. 媒体持久化职责按 §4 落实；archiver 可在归档时调用 sdk.media.downloadTweetMedia，或继续自行抓取。
