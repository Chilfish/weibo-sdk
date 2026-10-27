# ITweet v3：单一富契约（2026-10-27）

> **状态**：方向已定，字段清单待真实数据审计后补全。
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

### 3.1 字段审计（先做）

基线是「官方客户端能正常渲染的东西」，不是当前 schema 恰好保留的字段。逐类对真实抓包比对缺口，每条结论附 fixture。已知候选：

- 复杂卡片：`pageInfo` 只覆盖 6 个字段，完整卡片结构未建模。
- 标记位：广告 / 付费 / 营销等语义未进契约。
- 其余以审计结果为准，不在本文预设。

### 3.2 老数据导入

老 `ImportedData`（`Post[]` / `UserInfo` / `Followings` / `Favorites`）→ v3 的一次性转换。字段映射与损失项见 [research-mygo-app-2026-10-26.md §6](weibo-archive-app/research-mygo-app-2026-10-26.md)：楼中楼、关注、收藏细节会有损失，导入时显式报告，不回填。适配器放在应用侧还是 SDK 独立 import 模块，等 POC 确认调用方后再定。

### 3.3 迁移

v2 → v3 用纯函数 `migrateTweetV2toV3`。v2 记录保持可读；v3 新增字段对旧记录缺省，不从 raw 回填。

### 3.4 契约同步

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
