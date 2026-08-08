# Postmortem 004 — Data-Driven Schema Sprint

**Date**: 2026-05-16
**Branch**: `codex/data-driven-schema-tightening`

## Summary

基于真实微博 API 响应数据，对全部 4 个核心 endpoint 的 Zod schema 进行了精确化重构，并在真实 API 调用中发现了 5 个生产环境 bug。建立了 E2E 结构快照体系作为 Schema 漂移检测机制。

## Impact

- 4 个 Schema 覆盖率从 ~5% 提升到 ~40-100%（基于 Model 构造器实际访问字段）
- 5 个 bug 被修复（其中 2 个会导致生产环境静默失败）
- 66 个测试全部通过（54 离线 + 12 E2E）
- 6 个结构快照覆盖全部核心 endpoint

## Root Cause Analysis

### Bug 1: mymblog 响应 `data` 包装层未处理（严重）
真实 API 返回 `{ ok: 1, data: { since_id: "", list: [...] } }`，但代码直接访问 `raw.since_id`。由于 Zod schema 使用 `.loose()`，不存在的字段返回 `undefined`，代码通过 `Number(undefined ?? 0)` = `0` 静默退化，导致 `listByUserId()` 永远返回空列表。

### Bug 2: `since_id` 类型为 string 非 number
直觉假设游标是 `number`，实际是 `string`（空串 `""` 表示无更多页）。

### Bug 3: `retweeted_status.user` 可为 null
部分转发微博的 `retweeted_status.user` 为 `null`（原微博被删除或隐私保护），`normalizeTweet` 中 `raw.user.idstr` 触发 `TypeError`。

### Bug 4: 嵌套 `retweeted_status` 可为 null
Zod schema 的 `z.lazy(() => Schema.optional())` 接受 `undefined` 但不接受 `null`（JSON 中两者不同）。

### Bug 5: 嵌套 `retweeted_status` 不含 `ok` 字段
内层 retweet 不包含 `ok` 字段（只有顶层响应有），但 Schema 将 `ok` 声明为 `z.number()`（必填）。

### 根因模式
**手写类型假设 ≠ 真实 API 行为**。所有 5 个 bug 都源于"合理推断"而非"数据验证"。真实 JSON 中的 `null`、空串、类型差异、字段缺失在离线 mock 测试中不可见。

## Decision Log

1. **Schema 精确化策略：只声明 Model 构造器实际访问的字段**
   - 不为完整性而声明所有字段，只为"代码会用到"的字段添加校验
   - 未访问字段通过 `.passthrough()` 保留，不阻塞
   - 决策：`screen_name` 等字段使用 `.optional()` 而非必填，因为代码已有 `|| ''` 降级

2. **E2E 结构快照替代值快照**
   - 微博 API 返回的计数器、签名 URL、ID 每次请求都不同
   - 使用 `stripVolatileKeys()` 将所有可变值替换为类型占位符（`<ID>`、`<DATE>`、`<COUNT>`）
   - 快照只验证响应结构（key 路径 + 值类型），不验证具体值

3. **Zod `.nullable()` vs `.optional()` 策略**
   - JSON 中 `null` 和字段缺失是不同的：`.optional()` 处理缺失，`.nullable()` 处理 null
   - 所有 `retweeted_status` 递归引用必须同时使用两者

## Lessons Learned

- **离线 mock 测试无法替代真实数据验证**：离线测试 100% 通过不代表代码能在真实 API 下工作
- **Zod `.passthrough()` 是双向安全网**：既允许新字段进入，也允许缺失字段不报错。但同时也隐藏了字段访问错误（如 Bug 1）
- **快照测试适用于结构而非值**：对经常变化的 API 响应，值快照 = flaky test。结构快照 = Schema 漂移检测器
- **JS/TS 中的 `null` 与 `undefined`**：在 Zod 和 JSON 中不可互换。API 可能返回 `null`，代码必须同时处理 `null` 和 `undefined`

## Anti-pattern Indexing

1. **Schema 声明必填字段但代码能处理缺失**
   - 症状：Schema `z.string()` 必填，但代码有 `raw.field || ''` fallback
   - 根因：Schema 和 Model 的 fallback 策略不一致
   - 处置：Schema 字段统一 `.optional()`，Model 负责降级；Schema 的职责是类型校验而非完整性校验

2. **`z.lazy()` 递归未加 `.nullable()`**
   - 症状：嵌套 retweet 的 `retweeted_status: null` 导致 safeParse 失败
   - 根因：只考虑了"有值"和"undefined"两种情况，忽略了 JSON 的 null
   - 处置：所有递归引用统一使用 `.nullable().optional()`

3. **E2E 测试用 `try/catch` 跳过失败**
   - 症状：Search endpoint 404 被静默跳过，不知 endpoint URL 是否正确
   - 处置：测试必须 fail loudly；未知 endpoint URL 应标记为 known-issue 而非绕过

## Technical Debt & Risks

- **Search 端点 URL 不正确**：`/ajax/search/users` 和 `/ajax/search/tweets` 返回 404，需要找到正确的搜索 API URL
- **Schema 仍不是 100% 覆盖**：MyMBlogItemSchema 只有 ~25 个字段声明，实际有 ~60 个。剩余字段通过 `.passthrough()` 放行
- **E2E 快照依赖特定测试用户**：使用 `tests/utils.ts` 中的 `userId = '1111681197'`，如果该用户删号或隐藏时间线，快照会失败

## Follow-ups

- 修复 Search endpoint URL（需要在浏览器中抓取真实的微博搜索 API）
- Phase 4（字段类型合规化）：`pic_infos` 内层类型仍为 `z.record(z.unknown())`
- Phase 2（VCR 录制回放框架）：用 Polly.js 录制 HTTP fixture，替代手动 curl
- 增加多用户 fixture 扩展快照覆盖（不同用户类型：认证用户、企业用户、无头像用户）
