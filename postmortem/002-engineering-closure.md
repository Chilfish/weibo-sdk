# Postmortem 002 — Engineering Closure (Non-recursive RateLimit, Testkit DRY, Structured Config Error)

## Context Summary

在 001 的基础上，仓库已经具备离线测试与基础服务闭环，但仍存在一些“长期会积累成熵”的问题：

- `RateLimitService.acquire()` 使用递归等待令牌：长时间等待会构建深层 Promise 链，属于隐性可靠性风险。
- 多个组件测试复制粘贴了 fake axios 实现：增加维护成本，容易导致未来行为不一致。
- `WeiboSDK.validateConfig` 仍抛 `Error`：与“结构化错误”规范不一致，且不利于下游区分配置错误与网络错误。
- 文档 TODO/概览未及时反映已完成项：造成上下文漂移（Context Drift）。
- 临时 PR 正文文件易被误提交：需要工程层面的忽略规则。

## Decision Log

1. **RateLimitService 去递归**
   - 将递归等待改为 `while (true)` 循环，避免深层 Promise 链与潜在内存增长。

2. **测试工具集收敛**
   - 引入 `tests/testkit/fakeAxios.ts`，将 fake axios 与常用的 `NoopRateLimitService` 收敛成单一事实来源。

3. **结构化配置错误**
   - 新增 `InvalidConfigError`（`CONFIG_INVALID`），并用于 `WeiboSDK` 的 cookie 校验。
   - 添加单测锁住行为，避免回退到抛 `Error`。

4. **文档闭环**
   - 更新 `docs/TODO.md` 的完成状态与下一步计划。
   - 更新 `docs/项目概览.md` 以反映 TweetService 已落地。
   - 新增 `CHANGELOG.md`，作为对外“发生了什么变化”的可检索入口。

5. **工程卫生**
   - `.gitignore` 忽略 `.pr*.md`，减少临时文件进入版本库的风险。

## Lessons Learned

- “能跑”不是完成：递归等待/复制粘贴测试工具这类问题，会在规模增长后变成真实事故。
- 结构化错误是 SDK 的 API 一部分：越早统一，越少未来的破坏性迁移。
- 文档与 TODO 必须跟随代码更新，否则 AI/人类都会被过期信息误导。

## Refactoring Opportunities

- 将 `tests/testkit` 扩展成更完整的测试基建（例如 fake clock、fake fetch/axios adapter），进一步减少重复。
- Wide Events/Telemetry 仍是系统性缺口：需要从 `onFetched` 过渡到可断言的事件流。
