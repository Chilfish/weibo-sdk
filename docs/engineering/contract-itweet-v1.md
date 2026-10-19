# ITweet 存档契约 v1（冻结）

**项目**: weibo-sdk | **冻结日期**: 2026-09-04 | **状态**: v1 生效 | **来源**: [todo-contract-freeze P0-1](../planning/todo-contract-freeze.md) / [review K1/K3](../reviews/review-apple-design-2026-08-10.md)

> `ITweet` 是下游 Weibo-archiver（web-v3 / monkey / CLI）的 **UI 展示与磁盘存档终局契约**
> （ADR-007/008，存入 IndexedDB）。改一个字段 = 破坏下游已归档数据——本文件把「改契约」
> 变成一个受版本管理的显式流程，而不是一个静默的 diff。
>
> 本文件与 `src/types/domain/ITweet.ts`（类型实现）、`tests/unit/contract/itweet-v1.test.ts`
> （形状锁定）共同构成契约的三份事实源：**规则在此、形状在类型、锁在测试**。

## 1. 版本机制（信封层）

- **契约版本常量**：`TWEET_CONTRACT_VERSION`（`src/types/domain/ITweet.ts`，当前 `1`；类型 `TweetContractVersion`）
- **归档信封**：`ArchiveItem = { schemaVersion, source, mblogId, tweet, schemaDigest, checkpoint }`
  ——磁盘条目自描述；CLI `weibo-cli archive` 的 NDJSON 进度事件同样携带 `schemaVersion`
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
| `pageInfo?` | `TweetPageCard` | 链接/视频卡片 `{ pageId, pageTitle, pageUrl, pagePic, type, objectType }` |
| `media` | `TweetMedia[]` | 见下；**恒为数组**（无媒体 = 空数组） |
| `geo?` | `TweetGeo` | 定位 `{ latitude, longitude, address }`；无则缺省 |
| `comments?` | `ITweetComment[]` | 评论（P1-6，v1 新增 optional 字段）：普通 `normalizeTweet` 不填充；仅 `streamArchive({ includeComments: true })` 拉取并挂载。`ITweetComment = { id, createdAt, text, textHtml, source, likes, user, replies? }`，`replies` 递归同构 |

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

### 嵌套说明

- `retweetedStatus` 递归为同一 `ITweet` 形状（深度由上游数据决定）。
- `pageInfo.pagePic` 为封面图 URL 字符串（同样受 §4 临时性约束）。

## 4. 媒体 URL 契约（P0-2 裁定，2026-09-04）

**裁定**：「URL 临时、消费方自抓」。

- `media[].imageUrl` / `videoUrl`（及 `pageInfo.pagePic`）是上游**临时签名 URL**：
  有效期 = 请求时间 + 1 小时、一次性（服务端再次下发新 URL 后旧链接作废）。
- **SDK 不负责下载/持久化媒体**；`ArchiveItem` 不含 `mediaFiles`（裁定同时定义了信封形状）。
- 存档消费方（archiver）必须在归档时及时下载媒体字节；仅存 URL 的展示属「临时可用」，不是长期存档。
- 过期后的恢复路径：经 SDK 重新拉取单条微博（`getByMblogId` / `show`）获取新 URL。
- 媒体下载辅助 API（可选增强，默认关闭）= [backlog](../planning/backlog.md)「媒体下载辅助」，不阻塞本契约；P1-7 复核结论为 SDK 不负责下载。

## 4.1 原始数据（raw）与 enrich 边界（2026-10-19 裁定）

**裁定**：`ArchiveItem` **不携带 raw**；raw 由下游按需另行保存。

- **信封保持 v1 形状**：`{ schemaVersion, source, mblogId, tweet, schemaDigest, checkpoint }`，不新增 `raw` 字段（避免磁盘膨胀与契约耦合）。
- **raw 获取路径**（P1-9 定稿，2026-10-19）：
  1. **请求级**：`config.hooks.onRaw(raw, meta)` —— 在 Zod 校验前触发，拿到端点**原始响应**；即使 `ok !== 1` 或 schema 校验失败也会先收到 raw。`meta` 含 `endpoint` / `resourceType` / `request` / `args` / `trace_id` / `timestamp`。`onFetched` 保留但标记 `@deprecated`。
  2. **归档级**：`streamArchive(uid, { onRaw(raw, meta) })` —— 每个原始微博项在归一化前触发；`meta` 含 `uid` / `source` / `mblogId` / `page?` / `parentMblogId?`（repost 阶段为被转发原微博）。`ArchiveItem` 仍不携带 raw。
  3. **单条补拉**：`tweets.enrich(mblogId, options?)` 返回 `{ tweet, raw, longText? }`，把 raw 响应与归一化模型一起交给调用方；raw 方法（`myMblog` / `show` 等）保留为底层数据源（部分标 `@deprecated`，不删除）。
- **enrich 方法**：**不改变 `ITweet` v1**。`tweet` 与 `getByMblogId` 同构；`raw` 为 `statuses/show` 的 passthrough 原始响应；`longText` 仅在 `includeLongText: true` 时补拉 `longtext` 端点。enrich 结果由调用方决定是否落盘；uid 级扩展字段走 `users.info` / `users.details` 或请求级 `onRaw`。
- **回调失败语义**：`onRaw` 抛错会使该次请求 / 该条归档失败（不静默丢失 raw），与其它 hooks 一致。
- **下游职责**：需要 raw 的消费方（如 archiver）自行保存 raw 字节/JSON，并按 `mblogId` 与 `{ schemaVersion, tweet }` 关联。

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
4. 媒体持久化职责按 §4 落实到 archiver 需求规格（P0-2 裁定）。
