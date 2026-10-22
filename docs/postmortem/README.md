# 尸检报告索引（Postmortems）

> **开写任何代码前，先读本页。** 本仓库历史踩坑全部沉淀于此，对照「高频雷区」自查后再动工，避免重复返工。
>
> 原则：**blameless** —— 不追究"谁写错了"，只追"什么系统条件允许它发生"，然后修系统和流程。

## 索引表

| 编号 | 主题 | 根因归类 | 一句话教训 |
|---|---|---|---|
| [001](001-ai-driven-iteration-baseline.md) | AI 驱动迭代基线 | 流程缺失 / 文档漂移 | 文档与代码不一致是最大的认知税；离线测试优先 |
| [002](002-engineering-closure.md) | 工程收尾 | 设计建模 | 递归等待/复制粘贴工具会变成真实事故；结构化错误是 API 的一部分 |
| [003](003-e2e-selfcheck-and-expected-errors.md) | 自检与预期错误 | 缺少边界校验 | 跨网络返回必须在边界层断言 ok/关键字段；预期内失败要可诊断 |
| [004](004-data-driven-schema-sprint.md) | 数据驱动 Schema 精确化 | 手写假设 ≠ 真实行为 | 5 个 bug 全是"合理推断"——先抓包再写 schema；null ≠ undefined |
| [005](005-capture-driven-development.md) | 抓包驱动端点发现 | 猜测端点 URL | 永远不要猜 API URL——微博有多个 host、分页策略不统一 |
| [006](006-fixture-sanitization-and-build-migration.md) | 脱敏与构建迁移 | 工具/数据 | 全量替换破坏数据关联，≤40 字符保留；tsdown 迁移 |
| [007](007-cli-framework-and-implementation.md) | CLI 框架选型 | 技术选型 | citty 零依赖匹配项目风格；CLI Interface Mandate |
| [008](008-marathon-session-lessons.md) | 马拉松会话元教训 | 多 Agent 协作 | 并行 Agent 需互不重叠 + 对齐最新范式；脱敏破坏关联 |
| [009](009-cookie-env-shadowing.md) | Cookie 环境变量遮蔽 `.env` | 工具反馈 / 流程缺失 | 配置来源必须单一显式；`process.loadEnvFile()` 不覆盖已有变量 |
| [010](010-npm-publish-catalog-protocol.md) | npm publish 打包 `catalog:` 依赖 | 工具反馈 / 流程缺失 | 发布只能用 `pnpm publish`；门禁必须检查产物而非源码 |
| [011](011-release-gate-conditional-exports.md) | 发布门禁未同步条件 exports | 流程缺失 / 工具反馈 | 本地发版门禁必须与 CI 跑同一组检查；`exports` 断言要兼容条件对象 |
| [012](012-eslint-local-capture-data.md) | 本地发布门禁 lint 了被忽略的抓取数据 | 工具反馈 / 流程缺失 | `.gitignore` 不等于 ESLint ignore；本地门禁输入面必须与 CI 一致 |

## 高频雷区（写码前自查）

### 1. 数据驱动（本项目最大的坑源）

- **先抓包、后实现**：永远不要猜 API URL 或字段类型。微博有多个 host（`weibo.com` / `m.weibo.cn`），端点 URL 命名无规律。新端点必须先有真实 fixture 再有代码。
- **内联测试样本 ≠ 真实样本**：schema 字段形状必须以 `tests/fixtures/raw/` 真实样本为准，不要照抄内联测试里的手写 fixture（2026-09-04 教训：`followContent.specialAttention` 真实是分组对象/缺省，内联假设的 array 直接写进了 schema，E5 契约回归才抓出）。
- **真实类型 ≠ 直觉类型**：`since_id` 可能是 `number`，也可能是带后缀的 `string`（2026-10-20 复测）；`total` 可能为 `-1`（防爬）也可能是真实总数；`followers_count` 才是 `number`。以 fixture 为准，schema 用 union 而非强转。
- **上游分页会漂移，必须定期复测**：mymblog 曾用 `since_id` 游标（2026-05 实测），2026-08-09 实测已弃用改 `page`（`since_id` 恒 `""`、`total` 恒 `-1`）；2026-10-20 复测 `since_id` 又恢复可用且与 `page` 等价、`total` 恢复真实值。分页策略不是一次验证就完事，翻页能力需周期性用真实数据回归。
- **`null` ≠ `undefined`**：JSON 里两者不同。递归引用（`retweeted_status`）必须 `.nullable().optional()` 同时处理；内层 retweet 没有 `ok` 字段。
- **`.passthrough()` 是双向安全网也是陷阱**：它允许新字段进入、缺失字段不报错，但也会隐藏字段访问错误。Schema 声明字段用 `.optional()`，Model 负责 fallback（Schema 管类型校验，不管完整性）。
- **测试必须 fail loudly**：禁止用 `try/catch` 跳过失败的 E2E/未知端点——那是在掩盖根本问题。未知端点标 known-issue 而非绕过。

### 2. 错误与可观测性

- **禁止抛裸 `Error`**：必须继承 `WeiboSDKError`，携带 `code/level/retryable/context`（`CONFIG_INVALID` / `API_NOT_OK` / `AUTH_SESSION_EXPIRED` / `API_BAD_RESPONSE` / `NET_TIMEOUT` / `NET_REQUEST_FAILED`）。
- **错误映射链**：axios → TransportError；ok≠1 → BusinessError；Zod fail → ProtocolError。
- **关键路径必须打 Wide Events**：Happy Path 与 Error Path 都要，测试可断言事件序列。
- **`telemetry.emit()` 失败绝不能影响 SDK**：外层 try/catch。

### 3. 工程卫生

- **递归等待 = 深层 Promise 链**：用 `while` 循环替代递归（`RateLimitService`）。
- **测试工具收敛到 `tests/testkit/`**：别复制粘贴 fake axios / fake clock。
- **文档/上下文漂移**：改代码必须同步改文档；完成阶段规划文档归档到 `docs/archive/`（历史记录，不主动读取）。
- **分页策略不统一**：`mymblog` 用 `page`（2026-08 起，曾用 since_id）、`buildComments` 用 `max_id`、搜索曾用 `page`（现接口已失效）。每个端点单独验证。
- **并行 Agent 协作**：文件分配互不重叠 + 对齐最新范式（旧 Zod 模式复用会制造风格不一致）；停止的背景 Agent 残留文件要清理。
- **结构快照只锁结构**：`stripVolatileKeys` 必须把值归一化为类型占位符（`<STR>/<NUM>/<BOOL>`），不要用 key 白名单；否则动态字段会持续误报（2026-10-19）。
- **脱敏保留关联**：短字符串（≤40 字符，如 `pic_ids`）必须保留，否则破坏 `pic_ids` ↔ `pic_infos` 键匹配。
- **配置来源单一显式**（2026-10-19 复发）：Cookie 只读 `.env`（默认 `<pwd>/.env`，`--env-file` 指定），不回退到环境变量；`process.loadEnvFile()` 不覆盖已存在的环境变量，旧值会静默遮蔽新值。
- **发布只用项目包管理器**（2026-10-20）：项目使用 pnpm catalog，`npm publish` 会把 `"catalog:"` 原样打进产物，消费者安装报 `EUNSUPPORTEDPROTOCOL`。发布必须 `pnpm publish`；发布后解包 tarball 检查 `dependencies` 与 `bin`，不要只看 `npm view`。
- **门禁与 CI 同源**（2026-10-21）：`scripts/release.mjs` 必须跑 CI 执行的同一组检查。改动 `exports` 形状后，所有读取 `package.json` 的脚本（`browser-smoke` / `verify-package` / 单测）都要一起更新；条件 `exports` 用 `default` 目标比较，不要和字符串比。
- **本地数据目录要同时登记 `.gitignore` 与 ESLint `ignores`**（2026-10-22）：ESLint 不读嵌套 `.gitignore`，本地抓取目录（如 `data/`）会让 `eslint .` 在发布门禁上大面积报错，而 CI 永远看不到这些文件。门禁失败先确认报错文件是否被 Git 跟踪。

### 4. 流程（非代码）

- 合并策略/流程类决策先调研再定（改一次就是全仓文档 + 习惯同步一次）。
- 流程级根因 → 同步更新 `AGENTS.md` 强制规范或 `docs/engineering/git-workflow.md`（如有）。

## 如何新增一条 postmortem

1. 遇到返工/事故 → 先跑 `git log` 定位 commit 与影响，查 `docs/development-log/README.md` 的当日记录。
2. 复制 [TEMPLATE.md](TEMPLATE.md)，编号顺延（`NNN-short-slug.md`），补摘要/影响/时间线/根因/行动项。
3. 在本索引表加一行；若属于既有根因归类，在「高频雷区」补规则。
4. 在 `docs/development-log/` 记录当天事件。
5. 根因是流程级 → 同步更新 `AGENTS.md` 强制规范。
