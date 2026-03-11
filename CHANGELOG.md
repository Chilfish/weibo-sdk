# Changelog

本项目遵循语义化版本（SemVer）的约束思路，但在 `0.x` 阶段可能仍会发生 API 调整。任何破坏性变更必须在本文件中明确标注，并给出迁移说明。

## Unreleased

### Added

- Offline-first 测试分层：unit/component 默认离线；e2e 需 `WEIBO_E2E=1` 显式开启。
- `UserService` / `TweetService` 的离线组件测试与领域模型归一化测试。
- `Tweet` 归一化 v1：支持 media/pageInfo/geo/retweetedStatus（以 mymblog raw 为来源）。
- Postmortem 机制：`postmortem/NNN-*.md`。

### Changed

- SDK 入口不再产生 `console.*` 副作用。
- 配置校验错误结构化：缺失 cookie 抛 `InvalidConfigError`。

