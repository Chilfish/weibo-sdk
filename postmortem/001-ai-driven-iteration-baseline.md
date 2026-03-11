# Postmortem 001 — AI-driven Iteration Baseline

> 目的：知识固化与上下文注入；记录决策动机、踩坑与反模式，避免同类问题复发。
> 本文不追责，聚焦 Root Cause Analysis (RCA) 与可执行的改进项。

## Context Summary（初始状态）

- 仓库文档与实际代码严重不一致：README 讲“插件化爬虫 + monorepo packages/*”，但仓库实际是单包 SDK（`WeiboSDK -> Services -> Internal`），且 `packages/ examples/ playground/` 不存在。
- 测试形态不符合目标：“integration 测试”是顶层 await 脚本 + 真外网请求 + 写入 `.cache`，导致默认测试无法离线稳定运行。
- 可测性不足：`FetcherService` 强耦合 axios 与真实时间/睡眠；`RateLimitService` 依赖 `Date.now/setTimeout`；无法可靠单测并发与限速逻辑。
- 类型与运行时行为出现偏差：自定义错误类原型链设置不正确，导致 `instanceof` 在测试中失败。
- 工程流程不稳定：PR 正文出现字面量 `\\n`；pre-commit lint-staged 会因 ESLint 规则（如 `no-throw-literal`、pnpm catalog unused）阻断提交。

## Decision Log（关键决策与动机）

1. **Offline-first 测试分层**
   - 决策：默认 `pnpm test` 必须离线；真实外网用例迁移到 E2E，并用 `WEIBO_E2E=1` 显式开启。
   - 动机：符合规格书“可测试性：无需外部网络 IO”；提高 CI/本地反馈速度，避免 flaky。

2. **依赖注入提升可测性**
   - 决策：`FetcherService` 支持注入 `AxiosInstance/AuthService/RateLimitService`；`RateLimitService` 注入 `clock(now/sleep)`。
   - 动机：隔离 IO 与时间，允许 fake clock + fake http，稳定覆盖边界行为。

3. **修复错误类原型链**
   - 决策：`WeiboSDKError` 使用 `Object.setPrototypeOf(this, new.target.prototype)`。
   - 动机：确保派生类 `instanceof` 正常，避免错误类型判断失效。

4. **对齐仓库事实（Docs-as-truth）**
   - 决策：更新 README、清理 `pnpm-workspace.yaml` 指向与未使用 catalog，补齐 `src/types` 公共导出面。
   - 动机：减少认知摩擦；让新贡献者/Agent 不被过期文档误导。

5. **现代化 PR/分支流程固化到 AGENTS**
   - 决策：短分支 + squash merge；PR 正文用 `--body-file`；允许在门禁通过时自动合并。
   - 动机：控制迭代熵（Entropy），保持 `main` 历史干净、可回滚、可审阅。

6. **Tweet normalization v1（按主题推进）**
   - 决策：在一个主题 PR 内补齐 `Tweet.media/pageInfo/geo/retweetedStatus` 的归一化，并用离线单测锁住规则。
   - 动机：把“易变 raw”压缩成稳定 domain；用测试抵抗上游字段变化。

## Anti-pattern Indexing（本次踩坑/反模式索引）

1. **“integration test” 直接打外网**
   - 症状：默认测试不稳定、需要 Cookie、会写本地状态。
   - 根因：测试边界未定义；缺少 E2E 开关与 mock strategy。
   - 处置：迁移到 `tests/e2e/*` 并用 `WEIBO_E2E=1` gating。

2. **路径别名只在 TSConfig 配置，但 Vitest 不认识**
   - 症状：测试 `import '~/...'` 报 “Cannot find module”。
   - 根因：Vitest resolve 未设置 alias。
   - 处置：在 `vitest.config.ts` 添加 `resolve.alias`。

3. **错误类原型链设置错误**
   - 症状：抛出的 `ConnectionTimeoutError`/`NetworkRequestError` 不是其自身 `instanceof`。
   - 根因：基类把原型链强行设为 `WeiboSDKError.prototype`，破坏派生类原型。
   - 处置：改为 `new.target.prototype`，并加回归断言。

4. **在测试里 `throw { ... }` 被 ESLint 阻断**
   - 症状：提交阶段 lint-staged 失败（`no-throw-literal`）。
   - 根因：测试写法违反规范，且 pre-commit 强制 eslint --fix。
   - 处置：改为 `const err = new Error(...) as any; err.isAxiosError = true; throw err`。

5. **pnpm catalog 未使用项触发 ESLint 规则**
   - 症状：提交被 `pnpm/yaml-no-unused-catalog-item` 阻断。
   - 根因：`pnpm-workspace.yaml` 中残留 `tsup/winston` catalog，但当前 `package.json` 未引用。
   - 处置：移除未使用 catalog 项，或在未来需要时再引入。

6. **PR 正文写成字面量 `\\n`**
   - 症状：正文显示为 `\\n`，md 堆在一起难读。
   - 根因：命令行里用转义拼接 body。
   - 处置：统一 `--body-file`；已写入 `AGENTS.md` 作为硬约束。

## Technical Debt & Risks（技术债与风险）

- **Tweet 归一化仍是最小可用**：媒体字段来源复杂（mix_media_info/pic_infos/page_info），当前规则覆盖主路径，但仍可能遇到长文、广告、置顶、特殊卡片等分支。
- **Raw schema 演进风险**：微博字段变化频繁；缺少真实响应的 fixture 仓库，未来需要积累样本与回归测试。
- **Telemetry/Wide Events 未完全落地**：目前主要靠 `onFetched`；缺少统一 trace_id/timestamp 的宽事件体系与测试约束。

## Lessons Learned（可执行经验）

- 默认测试必须离线：任何需要 Cookie/外网的用例必须进 E2E 且默认跳过。
- TypeScript path alias ≠ test runner alias：Vitest/Jest/Vite 必须单独配置 resolve.alias。
- 自定义 Error 的 `instanceof` 是可靠性基础：基类不要“硬设” prototype；用 `new.target.prototype`。
- 先定主题与提交意图再写代码：避免“回头看历史看不懂”，也便于拆分/回滚。
- pre-commit 是“事实门禁”：如果 lint-staged 会阻断提交，测试代码也要符合工程规范（不能拿“只是测试”当借口）。

## Refactoring Opportunities（后续可重构点）

- **Tweet normalization 抽取纯函数**：当前 `Tweet` 构造器内逻辑较多，可拆成 `normalizeTweet(raw)` 纯函数 + 类包装，降低复杂度并便于复用。
- **统一 media 选择策略**：明确“最大图/封面/视频 url”优先级表，减少 scattered fallback。
- **Wide Events 体系化**：定义 `TelemetryEvent`、贯穿 trace_id，并在测试中断言事件序列。

## Session 终结协议（建议每轮迭代收尾执行）

1. 全量扫描：README/配置/exports 与当前结构是否一致。
2. 逻辑对齐：Design/Spec 与实现是否背离（尤其测试边界与错误语义）。
3. 增量更新：将本轮遇到的最大摩擦点补进下一条 Postmortem。
