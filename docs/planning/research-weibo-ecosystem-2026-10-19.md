# 调研：微博逆向 / 归档生态（2026-10-19）

> **目的**：在进入 P1 归档硬化前，横向对比仍在活跃维护的同类项目，确认我们的产品边界、接口形态与可靠性设计没有明显盲区。
> **方法**：`gh api search/repositories`（按 `updated` 排序）+ 关键仓库 README 精读；只收录 2026-08 之后仍有推送、且与「微博数据采集 / 归档 / CLI」直接相关的项目。
> **结论**：我们的「SDK + 契约 + 离线可测」定位是差异化的，但在**万条级完整镜像、增量早停、单条失败恢复、媒体生命周期、Agent DX** 上仍可向同类项目借鉴。

---

## 1. 生态分层

| 层次 | 代表项目 | 与我们的关系 |
|---|---|---|
| API 逆向 / 端点集合 | `cv-cat/WeiboApis`、`upupming/weiboAPI` | 端点与签名的参考源 |
| 通用采集 / CLI | `cv-cat/catbus`、`dataabc/weibo-crawler`、`Praeviso/crawl4weibo`、`NanmiCoder/MediaCrawler` | 认证、风控、CLI/Agent 形态参考 |
| 归档产品 | `Troray/weibo-backup`、`shanhesss/weibo-archive`、`yuemian0103/weibo-backup-pro`、`Chilfish/Weibo-archiver` | 完整镜像、增量、媒体、产物格式参考 |
| 热搜存档 | `justjavac/weibo-trending-hot-search`、`xiadd/tg-wb-trending` | 非核心，仅趋势数据 |

---

## 2. 活跃项目对比

| 项目 | 语言 | Stars | 最近推送 | 定位与关键能力 | 可借鉴 |
|---|---:|---:|---|---|---|
| [cv-cat/catbus](https://github.com/cv-cat/catbus) | TypeScript | 462 | 2026-10-18 | 11 平台统一 CLI，300+ 命令；stdout 只有 JSON；登录态按平台/端/账号隔离；请求与上游逐字节对拍 | CLI 契约、Agent DX、登录态隔离、对拍测试 |
| [cv-cat/WeiboApis](https://github.com/cv-cat/WeiboApis) | Python | 63 | 2026-08-18 | PC / 移动端 / 创作者端接口；Cookie + XSRF；图文/视频发布；FastAPI 服务 | 移动端与 PC 端 header 差异、创作者端签名 |
| [Troray/weibo-backup](https://github.com/Troray/weibo-backup) | TypeScript | 0（新仓） | 2026-10-16 | 轻量 Node（无 Playwright）；扫码登录；原画视频/LivePhoto `.mov`；Markdown/CSV/SQLite/JSON；时间游标增量；Telegram/通知/后置脚本 | 永久视频页链接、时间游标、低资源运行 |
| [shanhesss/weibo-archive](https://github.com/shanhesss/weibo-archive) | Python | 1 | 2026-10-19 | 全量历史 + 断点续爬 + 本地查询；保留每条微博原始 JSON；432 退避；AI 总结归档语雀 | 原始 JSON 留存、432 退避、失败后补 |
| [yuemian0103/weibo-backup-pro](https://github.com/yuemian0103/weibo-backup-pro) | JavaScript | 0 | 2026-10-14 | m.weibo.cn 油猴脚本；断点续扫；翻到已备份页提前停止；IndexedDB 媒体缓存；ZIP/离线 HTML；多标签互斥 | 增量早停、媒体缓存、`scan-errors.json`、运行锁 |
| [Praeviso/crawl4weibo](https://github.com/Praeviso/crawl4weibo) | Python | 43 | 2026-10-03 | 无 Cookie 访客会话；Playwright 取 Cookie；432 指数退避；代理池；长文展开；评论/回复；MCP/CLI | 432 处理、无 Cookie 兜底、MCP 接口 |
| [dataabc/weibo-crawler](https://github.com/dataabc/weibo-crawler) | Python | 4671 | 2026-07-22 | 多用户增量；CSV/JSON/MySQL/MongoDB/SQLite；图片/视频/LivePhoto；一级评论与转发 | 稳定产物字段、增量模式、可选存储后端 |
| [NanmiCoder/MediaCrawler](https://github.com/NanmiCoder/MediaCrawler) | Python | 大型多平台 | 持续活跃 | Playwright 登录态 + 浏览器上下文执行 JS 取签名；关键词/帖子/二级评论/创作者主页/代理池 | 浏览器上下文签名兜底、评论树、代理抽象 |
| [Chilfish/Weibo-archiver](https://github.com/Chilfish/Weibo-archiver) | TypeScript | 489 | 2026-10-03 | monorepo：core / web / monkey / CLI；`ITweet` 的下游消费方 | **契约目标**，不是功能参考 |
| [justjavac/weibo-trending-hot-search](https://github.com/justjavac/weibo-trending-hot-search) | TypeScript | 798 | 2026-10-19 | 每小时抓取热搜并按天归档 | 趋势归档的稳定性做法 |

> Stars / 推送时间为 2026-10-19 通过 GitHub API 读取；`MediaCrawler` 的精确 Stars 因 API TLS 超时未取，表中不写具体值。

---

## 3. 值得借鉴的设计

### 3.1 认证与风控

- **两条路线并存**：`crawl4weibo` 默认无 Cookie 访客会话，登录 Cookie 只用于更完整数据；`MediaCrawler` 用 Playwright 登录态直接在浏览器上下文执行签名 JS，避免逆向。
- **432 是独立信号**：多个项目对 HTTP 432 / 业务风控做指数退避，而不是当普通错误。我们目前有 `RateLimitService` 的令牌桶，但没有针对 432 的专门分类与退避策略。
- **登录态隔离**：`catbus` 按「平台 × 端 × 账号」隔离到 `~/.catbus/`，权限 0700/0600。我们只支持单 Cookie；对个人归档足够，但多账号不在范围内。

**对我们的结论**：保持 `.env` 单 Cookie；补 432 分类/退避与「Cookie 失效」诊断即可。无 Cookie 访客模式可作为公开数据的兜底候选，但不应影响契约主线。

### 3.2 完整历史与增量

- **时间游标**：`Troray/weibo-backup` 记录最后一条微博时间，下次只抓新内容；`yuemian0103` 翻到已备份页就提前停止。
- **页码断点的已知缺陷**：`shanhesss` 明确记录「按页码断点，暂停期间新发一整页可能漏几条，下次增量补回」——这印证了 P1-1/P1-2 的必要性。
- **万条级**：`shanhesss` 实测 1 万条约半小时；我们的 `mymblog` 只有 page 游标，必须靠 P1-5 的日期切片补齐。

**对我们的结论**：P1-5（searchProfile 时间片）不是增强项，而是「完整镜像」成立的必要条件；P1-1/P1-2 应优先于新增端点。

### 3.3 媒体生命周期

- **临时 URL 是共识**：`Troray/weibo-backup` 明确只保存 `video.weibo.com/show` / `weibo.com/tv/show` 永久页，避免 2 小时后 403；`crawl4weibo`、`weibo-scraper` 都提供媒体下载工具。
- **LivePhoto 要单独处理**：多个项目都把 `.mov` 视频源与静态封面分开下载；我们的 `extractMedia` 已识别 `livephoto` 并给出 `videoUrl`，但契约明确「SDK 不下载」。
- **媒体缓存/失败记录**：`yuemian0103` 用 IndexedDB 缓存媒体、单独输出 `scan-errors.json`，避免重复下载与静默丢失。

**对我们的结论**：P0-2 的「URL 临时、消费方自抓」裁定可以保留；但应补一个**可选媒体下载辅助**（P1-7）和**永久视频页链接**字段/文档，降低下游踩坑概率。

### 3.4 产物与原始数据

- 同类项目普遍提供 Markdown / CSV / SQLite / JSON 多产物；我们只提供 `ITweet` + NDJSON 归档流，把展示与存储交给下游 archiver。这是合理的边界。
- **原始 JSON 留存**：`shanhesss` 的关键设计是「每条微博保留接口原始 JSON，后续补字段无需重爬」。我们的 `ArchiveItem` 只有 `schemaDigest`，归一化后丢失未知字段（K5 的有损问题）。

**对我们的结论**：需要单独裁定——是否在归档信封中增加可选 `raw`（不进 `ITweet`），或由下游自行保存 raw。若不加，未来补字段必须重爬，规模越大代价越高。

### 3.5 可靠性

- 单条失败隔离：`yuemian0103` 输出 `scan-errors.json`；`Troray` 支持重试与退避。
- 运行锁：`yuemian0103` 用心跳锁避免多标签页同时扫描。
- 断点续传：几乎所有归档项目都有，且都强调「页码断点不完美」。

**对我们的结论**：P1-3（进度事件）与 P1-4（单条失败策略）是产品可信度的底线；错误应带 `retryable` 与下一步建议。

### 3.6 Agent / CLI DX

- `catbus`：stdout 只有 JSON、退出码稳定、错误里带下一步命令、`platforms` 输出能力清单、自带 `SKILL.md` 与 `llms.txt`。
- `crawl4weibo`：CLI 默认 JSON、`--detail compact|full`、MCP server、Agent skill。
- 我们的 CLI 已经满足「JSON 输出 + 非零退出码」，但还缺**能力清单 / llms.txt / SKILL.md / `--detail` 级别**。

**对我们的结论**：P2-3（telemetry 消费端）之外，补一个轻量 `llms.txt` + Agent skill 成本很低，能显著提升下游/Agent 可发现性。

---

## 4. 我们与生态的差距（映射到行动计划）

| 差距 | 生态做法 | 我们的行动 |
|---|---|---|
| 万条级完整镜像 | 时间游标 / 日期切片 | **P1-5** searchProfile 时间片 |
| 断点续传效率 | 时间游标、提前停止 | **P1-1/P1-2** 去掉 `visitedMblogIds` 全量数组与 reposts 重放 |
| 进度可观测 | 实时进度、失败记录 | **P1-3/P1-4** 进度事件 + 单条跳过/重试 |
| 评论完整镜像 | 评论树 / 二级评论 | **P1-6** 评论归档阶段 |
| 媒体长期可用 | 永久视频页 + 下载器 | **P1-7** 可选媒体下载辅助；文档补永久页链接 |
| 原始字段留存 | 保留 raw JSON | **已裁定（2026-10-19）**：raw 不进 `ArchiveItem`；通过 hooks/回调 + 独立 `enrich` 方法提供，下游自行落盘（P1-9） |
| 432 风控 | 指数退避 / 专门错误 | **新候选**：432 → `RateLimitError(retryable)` + backoff |
| 浏览器/下游 | Playwright / 浏览器构建 | **P2-1** browser target + web-v3/monkey 冒烟 |
| Agent 可发现性 | `llms.txt` / `SKILL.md` / MCP | **P2-3/P2-6** 及新增 `llms.txt`/skill |

---

## 5. 建议的后续顺序

1. **契约决策已定**：`raw` 不进入归档信封；P1-9 设计 raw 回调 / `enrich` 方法，下游自行保存 raw。
2. **P1-1/P1-2**：去掉 O(N²) 与 reposts 全量重放——这是规模化的地基。
3. **P1-5**：日期切片，让「完整镜像」对万条级账号成立。
4. **P1-3/P1-4**：进度与单条失败策略，长任务可观测、可恢复。
5. **P1-6/P1-7**：评论阶段与可选媒体下载（按 P0-2 裁定的边界）。
6. **P2-1**：browser 构建与下游冒烟，作为 1.0 前的发布阻塞。
7. **P2-3/P2-6 + `llms.txt`/skill**：Agent/DX 收尾。

> 不建议现在扩展「多平台 / 发布 / 私信 / 热搜 / 公开关键词搜索」——生态里已有成熟产品，我们的差异化是**可维护的 SDK 契约 + 离线可测 + 可恢复归档**。
>
> **公开搜索边界（2026-10-19 产品裁定）**：官方微博搜索页体验差、逆向收益低，公开关键词搜索（`searchUsers` / `searchTweets`）先放放；这与「个人主页内按日期搜索自己的微博」（`searchProfile`）不是一回事，后者仍可用且属于归档主线。

---

## 6. 参考

- GitHub API：`search/repositories?q=weibo&sort=updated`、`weibo scraper`、`weibo archive`、`weibo api`（2026-10-19）
- 各项目 README（链接见上表）
- 本地真实 E2E 结果与上游字段观察见 [2026-10-19 开发日志](../development-log/2026-10-19.md)
