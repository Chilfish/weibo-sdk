# Postmortem 008 — Marathon Session Meta-Lessons

**Date**: 2026-05-16
**Commits**: 35

## 多 Agent 并行协作

### 成功模式
- **互不重叠的文件分配**：Search Service（新文件）∥ Tweet 改进（models + services）∥ Zod 迁移（endpoints）— 三个 Agent 触碰文件零交集
- **Agent 超越预期**：Zod 迁移 Agent 自发调取真实 API、收集 fixture、发现 3 个 Bug — 比原始任务产出更多

### 踩坑
- Agent 间状态不同步：Search Agent 使用旧 Zod 模式（`as unknown as ZodType`），与 Zod 迁移 Agent 产生风格不一致
- 背景 Agent 被停止后残留文件未清理

## 数据驱动开发的核心教训

### "永远不要猜测 API"
- 搜索端点 404 的根因：host 是 `m.weibo.cn` 而非 `weibo.com`
- 凭直觉猜 URL 100% 失败 — 必须抓包验证

### Schema ≠ 真相
- 5 个生产 Bug 全部源于"合理推断"而非"数据验证"
- `since_id` 声明为 `number`，实际为 `string`
- `total` 可为 `-1`
- `retweeted_status.user` 可为 `null`
- Zod 校验不能替代真实验证

### 脱敏的陷阱
- 全部字符串替换为 `<TEXT>` 会破坏数据关联（`pic_ids` ↔ `pic_infos` 键匹配）
- 修复：≤40 字符保留、类型感知替换

## 工程决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 构建工具 | tsdown | unjs 生态、Rolldown、908ms |
| CLI 框架 | citty | unjs 生态、零依赖、函数式 |
| 认证方式 | env + --cookie | 多用户场景 |
| 测试策略 | 结构性断言 | 脱敏后数据无法做精确值比较 |

## 上下文管理

- 会话总结写入 `docs/development-log/2026-05-16.md`（原 `docs/sessions/`，2026-08-09 迁入）
- 项目记忆写入 `~/.claude/projects/I--tmp-weibo-sdk/memory/`
- 8 份 Postmortem 覆盖所有重要决策
