# ITweet v3：单一富契约（2026-10-27）

> **状态**：已实施，随 0.7.0 发布（2026-10-27）。
> **决策**：`ITweet` 继续作为唯一的微博存档与展示结构，直接变富并升 v3。老 Weibo-archiver 的 `Post` 格式只保留一次性导入，不再作为兼容目标。

## 1. 背景

`website/reference/tweet-contract.md` 的首段把 `ITweet` 描述成「下游 Weibo-archiver（web-v3 / monkey / CLI）的展示与磁盘存档结构，下游把记录写入 IndexedDB」。这句来自 2026-08-10 审查时的前提（[review-apple-design-2026-08-10.md](../reviews/review-apple-design-2026-08-10.md) 引用下游 ADR-007/008），写下时成立，现在不成立：

- 消费端改由桌面应用承接，老项目的数据格式与前端都要重做。[research-mygo-app-2026-10-26.md](weibo-archive-app/research-mygo-app-2026-10-26.md) §2.3：`Post` 面向旧 UI、字段扁平，图片只有 URL，评论只有一层，没有媒体类型 / 转发链 / 附件 / 话题 / 可见范围。
- 目标宿主是 Node、站点同源脚本、浏览器扩展、Worker；网页 + IndexedDB 不再是存储模型。
- [p2-readiness.md](p2-readiness.md) 里「只加被下游明确消费的 optional 字段」「`card` 不进契约」是按老下游 UI 拍的，随之作废。

结论：兼容性约束的对象从「旧 IndexedDB」换成「我们自己已经写出的 `ArchiveFile` 和用户导入的历史数据」；字段丰富度不再由旧 UI 决定。

## 2. 保留什么

- 契约版本机制：`TWEET_CONTRACT_VERSION`、精确键集测试、rename / remove / 语义变更才升 major。保护对象是磁盘上的 JSON，不是某个消费者的内存结构。
- `ArchiveFile` 是 SDK 自己的归档格式，与下游无关，继续按自己的 schema 版本演进。
- raw 不进契约：仍走 `config.hooks.onRaw` / `streamArchive({ onRaw })` / `tweets.enrich` 的 sidecar 路径。变富不等于把原始 JSON 塞回来。

## 3. 范围

### 3.1 字段审计结果

对 `tests/fixtures/raw/` 下 714 条真实微博 raw 做了键频统计（2026-10-27），基线是「客户端能渲染、当前没建模」的字段。下表是选入 v3 的部分，括号内为样本数：

| 上游字段 | 客户端表现 | v3 位置 |
|---|---|---|
| `is_paid` (706) | 付费内容标识 | `flags.paid` |
| `isAd` / `ad_marked` (592 / 121) | 推广标识 | `flags.ad` |
| `can_edit` (706) / `edit_config.edited` (122) / `edit_at` (15) | 编辑按钮与「已编辑」 | `flags.editable` / `flags.edited` / `editedAt` |
| `isTop` (122) | 置顶 | `flags.pinned` |
| `favorites_count` (121) | 收藏数 | `stats.favorites` |
| `tag_struct` (43) | 标签（热文指数、小店） | `tags[]` |
| `title_source` (14) | 超话来源 | `superTopic` |
| `ai_tag_info` (4) | 「该内容使用AI技术辅助创作」「内容为转载」 | `notices[]` |
| `pic_focus_point` (192) | 图片裁剪焦点 | `media[].focusPoint` |
| `page_info.content1` / `page_desc` (155) | 卡片摘要 | `pageInfo.summary` |

审计中明确**不建模**的：`cardid`（187，语义未确认）、`common_struct`（17，超话 / 抽奖公示卡片，语义待定）、`multi_attitude`（41，type 码含义未知）、`annotations`（672，内部埋点）、`number_display_strategy`（703，客户端自行缩写的展示文案）。

### 3.2 计数与标记位收敛（破坏性）

v2 里计数字段散在顶层（`readCount` / `playCount` / `editCount`），标记位也散在顶层（`isTop` / `isOriginal`）。v3 收敛：

- 计数统一进 `stats`：`likes` / `comments` / `reposts` / `favorites?` / `reads?` / `plays?` / `edits?`。
- 布尔标记统一进可选对象 `flags`：`original?` / `pinned?` / `ad?` / `paid?` / `edited?` / `editable?`，未下发即缺省，不伪造 `false`。

### 3.3 老数据导入

老 `ImportedData`（`Post[]` / `UserInfo` / `Followings` / `Favorites`）→ v3 的一次性转换。字段映射与损失项见 [research-mygo-app-2026-10-26.md §6](weibo-archive-app/research-mygo-app-2026-10-26.md)：楼中楼、关注、收藏细节会有损失，导入时显式报告，不回填。适配器放在应用侧还是 SDK 独立 import 模块，等 POC 确认调用方后再定。

### 3.4 迁移

v2 → v3 用纯函数 `migrateTweetV2toV3`。v2 记录保持可读；v3 新增字段对旧记录缺省，不从 raw 回填。

### 3.5 契约同步

- `src/types/domain/ITweet.ts`，`TWEET_CONTRACT_VERSION = 3`
- `tests/unit/contract/itweet-v3.test.ts` 键集
- `website/reference/tweet-contract.md` 字段表
- `schemas/` JSON Schema 重新生成
- `CHANGELOG.md` 按 major 记录

## 4. 非目标

- 不为任何下游 UI 的既有结构保留别名或兼容层。
- 不把 raw 放回契约。
- 不为浏览器 IndexedDB 设计存储布局。
- 不新增写操作。
