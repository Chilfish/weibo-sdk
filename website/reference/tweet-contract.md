---
title: ITweet 存档契约
outline: deep
---

# ITweet 存档契约

`ITweet` 是 SDK 对单条微博的存档结构，归档流、`ArchiveFile` 和 `weibo-cli archive` 的输出都以它为准。字段改名或删除会让已经写出的 JSON 失效，因此改动按契约版本管理。实现位于 `src/types/domain/ITweet.ts`，键集锁定在 `tests/unit/contract/itweet-v2.test.ts`。

## 1. 版本机制

- 契约版本常量 `TWEET_CONTRACT_VERSION = 2`，定义在 `src/types/domain/ITweet.ts`，类型为 `TweetContractVersion`。
- 归档信封 `ArchiveItem = { schemaVersion, source, mblogId?, tweet?, asset?, schemaDigest, checkpoint, comment? }`。磁盘条目自描述，CLI `weibo-cli archive` 的 NDJSON 进度事件同样携带 `schemaVersion`。
  - `source: 'image'` 时 `tweet` / `mblogId` 可选，媒体资产在 `asset`；`source: 'video'` 同时有 `tweet` 与 `asset`；其余微博类 source 的 `tweet` / `mblogId` 恒有。
- 下游最小存档记录为 `{ schemaVersion: TweetContractVersion, tweet: ITweet }`。`source` / `checkpoint` 等是 SDK 归档流的附加元数据，消费方按需取舍。
- 契约版本与包版本解耦：上游协议漂移走内部 schema 修复，发 patch / minor；契约破坏性变更才升包 major。

## 2. 变更规则

| 变更类型 | 当前契约内 | 版本动作 |
|---|---|---|
| 新增 optional 字段 | 允许，老读取方忽略未知键 | minor，同时更新字段表与契约测试键集 |
| 注释 / 文档完善 | 允许 | patch |
| 字段 rename / remove | 需升契约版本 | major |
| 字段类型或语义变更 | 需升契约版本 | major |
| 枚举纯新增值（`TweetVisible` / `MediaType`） | 追加新值允许；重定义既有值语义需升契约版本 | minor / major |

判断口径：已落盘的记录用当前代码读取时字段与语义保持一致；改变这一结果的改动升契约版本。

## 3. 字段表

### ITweet（`src/types/domain/ITweet.ts`）

| 字段 | 类型 | 语义 / 备注 |
|---|---|---|
| `id` | `string` | 数字 id（`idstr` 优先，`id` 兜底转 string） |
| `mblogId` | `string` | 字母形式 id（如 `QqsYymYOS`，详情页 URL 用） |
| `createdAt` | `string` | 上游原始时间字符串，保持原样 |
| `text` | `string` | 纯文本正文（`text_raw`，缺省 `''`）。`statuses/show` 默认带 `isGetLongText=true`，长微博已是全文 |
| `regionName?` | `string` | IP 属地（如「发布于 广东」）；上游未下发时缺省 |
| `source` | `string` | 发布客户端（缺省 `''`） |
| `user` | `TweetUser` | 简版用户结构，见下 |
| `stats` | `{ likes, comments, reposts }`（均 `number`） | 计数快照（缺省 0） |
| `visible` | `TweetVisible`（enum 0-4） | 可见性；未知值回退 `PUBLIC(0)` |
| `retweetedStatus?` | `ITweet` | 转发内容，递归同构；非转发时缺省 |
| `repostChain?` | `TweetRepostEntry[]` | 转发链分层（`text` 的 `//@` 由近到远；`index` 0 = 当前微博）；每层聚合该层 reppic 配图，见下；非转发时缺省 |
| `pageInfo?` | `TweetPageCard` | 链接/视频卡片 `{ pageId, pageTitle, pageUrl, pagePic, type, objectType, objectId?, subtitle? }`；见下 |
| `attachments?` | `TweetAttachment[]` | 结构化附件（`article` / `vote` / `live` / `lottery`）；无则缺省；见下。`pageInfo` / `linkCards` 保持原样，允许与附件重复 |
| `media` | `TweetMedia[]` | 见下；恒为数组（无媒体为空数组） |
| `geo?` | `TweetGeo` | 定位 `{ latitude, longitude, address }`；无则缺省 |
| `topics?` | `string[]` | 话题（`topic_struct[].topic_title`，缺省退回 `title`；去重保序） |
| `linkCards?` | `TweetLinkCard[]` | 链接 / 超话卡片（`url_struct[]`；见下） |
| `readCount?` | `number` | 阅读数（`reads_count`；仅部分端点或自己可见时下发） |
| `editCount?` | `number` | 编辑次数（`edit_count`；未编辑或上游未下发时缺省） |
| `title?` | `string` | 顶栏标题（`title.text`，如「公开」「仅自己可见」） |
| `permanentVideoUrl?` | `string` | 视频永久播放页（`media_info.h5_url`） |
| `isOriginal?` | `boolean` | 是否原创（无 `retweeted_status`） |
| `sourceUrl?` | `string` | 微博网页永久链接（`https://weibo.com/<uid>/<mblogid>`） |
| `comments?` | `ITweetComment[]` | 评论；只有 `streamArchive({ includeComments: true })` 会拉取并挂载。字段见下「ITweetComment」，`replies` 递归同构 |
| `atUsers?` | `TweetAtUser[]` | @ 用户（从上游 `text` HTML 的 `/n/`、`/u/` 锚点解析，上游无结构化字段） |
| `playCount?` | `number` | 视频播放量（`online_users` 明确含「次观看」时解析；直播在线人数场景缺省） |
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
| `imageUrl` | `string` | 最大尺寸图 / 视频封面 URL（临时，见 §4） |
| `videoUrl?` | `string` | mp4 / mov 地址（临时，见 §4；livephoto 恒有） |
| `duration?` | `number` | 视频时长（秒） |
| `width` / `height` | `number` | 像素尺寸（缺省 0） |

### TweetLinkCard（链接 / 超话卡片）

| 字段 | 类型 | 语义 |
|---|---|---|
| `title` | `string` | 卡片标题（`url_title`；缺省 `''`） |
| `url` | `string` | 跳转地址（`h5_target_url` → `long_url` → `ori_url`；缺省 `''`），可能是中间页 / 短域，规范地址见 `longUrl` |
| `shortUrl?` | `string` | 展示短地址（`short_url`） |
| `pageId?` | `string` | 卡片 page id（`page_id`） |
| `objectType?` | `string` | 对象类型（`object_type`） |
| `typePic?` | `string` | 卡片图标（`url_type_pic`） |
| `longUrl?` | `string` | 规范网页地址（`long_url`，如 `bilibili.com/video/...`）；上游未下发时缺省 |
| `oriUrl?` | `string` | 上游原始跳转（`ori_url`，可能是 `sinaweibo://` scheme）；原样保留，缺省 |
| `urlType?` | `number` | 卡片类型码（`url_type`，样本 `39`）；`0` 也保留，缺省表示未下发 |

`url` 与 `longUrl` / `oriUrl` 是三个不同层级的地址：`url` 是客户端点击目标（优先 `h5_target_url`），`longUrl` 是规范网页地址，`oriUrl` 是上游原始 scheme（可能是 `sinaweibo://browser?...`）。

`statuses/show?isGetLongText=true` 会重复下发同一条 `url_struct`。归一化按 `shortUrl`（`t.cn` 短链 code，兼容 http/https）去重，无 `shortUrl` 时按解析后的 `url` 去重；只含标题的卡片按原样逐条保留。

### TweetPageCard（页面卡片）

| 字段 | 类型 | 语义 |
|---|---|---|
| `pageId` | `string` | 卡片 id（`page_id`；缺省 `''`） |
| `pageTitle` | `string` | 卡片标题（`page_title`；缺省 `''`） |
| `pageUrl` | `string` | 卡片跳转（`page_url`；可能是 `sinaweibo://` scheme） |
| `pagePic` | `string` | 封面图（`page_pic`；`http://` 统一升级为 `https://`） |
| `type` | `number` | 卡片类型码（`type`；缺省 `0`） |
| `objectType` | `string` | 对象类型（`object_type`；如 `webpage` / `video` / `podcast_audio` / `audio`） |
| `objectId?` | `string` | 卡片对象 id（`object_id`）；上游未下发时缺省 |
| `subtitle?` | `string` | 卡片副标题 / 统计文案（`content2`，如「812播放  74点赞  0弹幕」）；空则缺省 |

### TweetAttachment（结构化附件）

`ITweet.attachments` 是判别联合，`kind` 区分四种附件。上游位置：

- PC：`page_info.object_type` 为 `article` / `hudongvote` / `live`；
- m 站：`url_objects[].object.object.object_type`；
- 抽奖：`url_struct[]` 的链接卡（`url_type: 39` + `lottery.media.weibo.com`）。

所有 `url` 都是 http/https 网页地址；`coverUrl` / `streamUrl` / `replayUrl` 可能是临时 URL。未知 `object_type` 不生成附件，`pageInfo` 仍保留。

| 字段 | 类型 | 语义 |
|---|---|---|
| `kind` | `'article' \| 'vote' \| 'live' \| 'lottery'` | 附件类型 |
| `id` | `string` | 上游 id（去掉 `1022:` 前缀，取不到用 page_id / mid） |
| `objectType` | `string` | 上游 object_type；lottery 为合成值 |
| `title` | `string` | 标题 / 投票问题 / 直播标题 |
| `url` | `string` | 可点击网页地址 |
| `coverUrl?` | `string` | 封面（临时 URL） |
| `source` | `'page_info' \| 'url_objects' \| 'url_struct'` | 数据来源 |

`article` 追加：`summary?` / `author?` / `isPaid?` / `content?` / `truncated?`。

`vote` 追加：`multiSelect` / `minChoices?` / `maxChoices?` / `expiresAt?`（unix 秒）/ `totalVotes?` / `state?` / `options: TweetVoteOption[]`。
`TweetVoteOption`：`id` / `text` / `votes?` / `ratio?`（0..1）/ `selected?` / `imageUrl?`。
m 站的 `vote_dynamic` 优先于 `vote_object` 的票数；票数是抓取时快照。

`live` 追加：`liveId` / `status?` / `startedAt?`（unix 秒）/ `viewerCount?` / `replayCount?` / `streamUrl?` / `replayUrl?` / `watchLimit?` / `durationSeconds?` / `authorName?`。
直播状态码语义未确认，原样保留；流地址是临时地址。

`lottery` 追加：`mid` / `detailUrl`。

### TweetRepostEntry（转发链层）

转发时附带的图片（reppic）位于 `url_struct[]`（`url_type: 39`）。多层转发链会把各层配图全部聚合到顶层 `url_struct[]` 且重复下发；`repostChain` 按正文 `//@` 由近到远分层，用 `short_url` 把图片挂回所属层。

| 字段 | 类型 | 语义 |
|---|---|---|
| `index` | `number` | 层级索引：`0` = 当前微博，`1..n` = `text` 中由近到远的 `//@` 层级 |
| `authorName?` | `string` | 该层作者昵称（0 层取 `user.name`；其余从 `//@name:` 解析；无法解析时缺省） |
| `text` | `string` | 该层正文（去掉 `//@` 前缀与图片短链；可为空串） |
| `media` | `TweetMedia[]` | 该层配图（`url_struct[]` 的 reppic 条目；按 `pic_id` 去重；无图为空数组） |

- 链末端的原微博存放在 `retweetedStatus`，`repostChain` 按 `//@` 层级记录。
- 无法在正文中定位的图片（正文截断 / 脱敏）追加到末尾补充层（`text: ''`），数据完整保留。
- 中间层的 uid / mblogId 上游未下发，保持缺省。

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
| `source` | `string` | 来源（如「来自 广东」） |
| `likes` | `number` | 点赞数（`like_counts` → `like_count`；缺省 0） |
| `user` | `TweetUser` | 评论作者（简版） |
| `replies?` | `ITweetComment[]` | 楼中楼预览（上游 `comments[]`，递归同构） |
| `pics?` | `TweetCommentPic[]` | 图片评论配图（上游 `url_struct[].pic_infos`；无图缺省） |
| `rootId?` | `string` | 根评论 id（`rootidstr` → `rootid`） |
| `replyTo?` | `ITweetComment` | 被回复的评论（`reply_comment`，递归；内层 `comments` 保持缺省） |
| `floorNumber?` | `number` | 楼层号（可为 0） |
| `totalReplies?` | `number` | 楼中楼回复总数（`total_number`；不含不可见评论） |
| `liked?` | `boolean` | 当前登录用户是否点赞（上游未下发时缺省） |
| `parentMblogId?` | `string` | 被评论微博的字母 id（内嵌 `status.mblogid`） |

### TweetCommentPic（评论配图）

| 字段 | 类型 | 语义 |
|---|---|---|
| `id` | `string` | 图片 id（`pic_infos` 键 / `pic_id`） |
| `imageUrl` | `string` | 最大尺寸图片 URL（`largest` → `original` → `woriginal` → `mw2000` → `large` → `bmiddle` → `thumbnail`；临时，见 §4） |
| `width` / `height` | `number` | 像素尺寸（缺省 0） |

图片评论的配图位于 `url_struct[].pic_infos`（「查看图片」短链卡片）。多图评论可能返回多个 `url_struct` 项并重复同一 `pic_infos`；归一化按 `pic_id` 去重，顺序为上游首次出现顺序。

### 嵌套说明

- `retweetedStatus` 递归为同一 `ITweet` 形状，深度由上游数据决定。
- `pageInfo.pagePic` 是封面图 URL 字符串，同样受 §4 临时性约束。

## 4. 媒体 URL 临时性

`media[].imageUrl` / `videoUrl`（含 `pageInfo.pagePic`、`comments[].pics[].imageUrl`）是上游临时签名 URL：有效期为请求时间加 1 小时，一次性，服务端再次下发新 URL 后旧链接作废。

归档流把媒体记录为 URL，`ArchiveItem` 的媒体字段止于 URL 层。存档消费方在归档时同步下载媒体字节并落盘；只存 URL 的记录在有效期内可展示。

URL 过期后经 SDK 重新拉取单条微博（`getByMblogId`）获取新 URL。

## 5. 原始数据与 enrich 边界

`ArchiveItem` 只携带归一化后的 `tweet`，raw 响应由下游按需另行保存。信封形状固定为 `{ schemaVersion, source, mblogId, tweet, schemaDigest, checkpoint }`。

raw 获取路径：

1. 请求级：`config.hooks.onRaw(raw, meta)` 在 Zod 校验前触发，拿到端点原始响应；`ok !== 1` 或 schema 校验失败时同样先收到 raw。`meta` 含 `endpoint` / `resourceType` / `request` / `args` / `trace_id` / `timestamp`。成功路径统一用 `onRaw` + `config.telemetry`（Wide Events）。
2. 归档级：`streamArchive(uid, { onRaw(raw, meta) })` 在每个原始微博项归一化前触发；`meta` 含 `uid` / `source` / `mblogId` / `page?` / `parentMblogId?`（repost 阶段为被转发原微博）。
3. 单条补拉：`tweets.enrich(mblogId, options?)` 返回 `{ tweet, raw, longText? }`，把 raw 响应与归一化模型一起交给调用方。归档层需要的 mymblog 原始页走 `tweets.fetchRawUserTimelinePage()`。

`enrich` 返回的 `tweet` 与 `getByMblogId` 同构；`raw` 是 `statuses/show` 的 passthrough 原始响应；`longText` 仅在 `includeLongText: true` 时补拉 `longtext` 端点。`statuses/show` 默认带 `isGetLongText=true`，该选项用于关闭长文后按需补拉。

`onRaw` 抛错会使该次请求或该条归档失败，与其他 hooks 一致。

下游职责：需要 raw 的消费方自行保存 raw 字节 / JSON，并按 `mblogId` 与 `{ schemaVersion, tweet }` 关联。

## 6. 媒体下载辅助

SDK 另提供显式调用的单条微博媒体下载能力，调用方式见 [媒体下载](./media-download)。

- 范围：单条微博（含转发兜底）。
- 落盘：扁平 `<mblogId>-<index>-<mediaId>.<ext>`，LivePhoto 动态帧加 `-motion`。
- 安全：CDN 请求只带 `Referer`（默认 `https://weibo.com/`），按主机后缀白名单放行。
- 可靠性：403/404/410 重新拉取微博换新 URL（每条微博最多一次）；临时文件加原子 `rename`；字节上限、空闲超时、`Content-Length` 校验、重试退避。
- 失败：单项失败后继续其余项，`<mblogId>-media-errors.json` 汇总，CLI 有失败时非零退出。

## 7. schemaDigest 与 schemaVersion

| | `schemaDigest` | `schemaVersion` |
|---|---|---|
| 管什么 | 上游漂移：raw 响应结构快照（`stripVolatileKeys`），同一端点字段变化时 digest 变 | 下游磁盘格式：ITweet 契约版本，记录形状演进时升版 |
| 谁消费 | SDK 侧回归与排障（对比同期同端点 digest） | 下游存档读取方（按 `schemaVersion` 分派读取逻辑） |
| 变更时机 | 随上游任意变化 | 仅契约破坏性变更（见 §2） |

## 8. 契约测试

- 类型层：`tests/unit/contract/itweet-v2.test.ts` 断言 `keyof ITweet` 精确键集，rename / remove / 新增都会在编译期失败。
- 运行时层：真实 fixture（`mymblog_page1.json`，含 `pic_infos` 样本）归一化键集快照，防止实现悄悄改形状。
