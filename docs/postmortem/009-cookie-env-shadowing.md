---
编号: 009
主题: Cookie 环境变量静默遮蔽 .env，导致真实 E2E 假失败
日期: 2026-10-19
严重度: 中（复发一次；阻断真实 E2E 与发布冒烟）
状态: 已归档
根因归类: 工具反馈 / 流程缺失
---

# 009 — Cookie 环境变量静默遮蔽 .env，导致真实 E2E 假失败

## 摘要

`.env` 已更新为新 Cookie，但 CLI 与 E2E 一直读取本机残留的旧 `WEIBO_COOKIE` 环境变量，`profile/detail` 返回 `ok:-100`，表现为「Cookie 已更新但仍会话过期」。根因是 `process.loadEnvFile()` **不覆盖已存在的环境变量**，且代码把环境变量作为隐式来源。修复：Cookie 只从显式指定的 `.env` 读取，不再回退到环境变量。

## 影响

- 真实 E2E 首轮 10 个失败中，有 2 个直接由旧 Cookie 引发（其余为快照/断言漂移）。
- 维护者需要额外确认 Cookie 是否真的更新，排障时间被拉长。
- 同类问题在 2026-08-09 的 spike 中已经出现过一次（当时改用 `dotenv config({ override: true })`），本次在 CLI 中复发。

## 时间线

| 事件 | 说明 |
|---|---|
| 2026-08-09 | spike 诊断发现 Node `loadEnvFile` 不覆盖环境变量；spike 改用 dotenv override |
| 2026-09-04 | CLI 使用 `process.loadEnvFile()`；E2E 使用 `dotenv/config`（不 override） |
| 2026-10-19 | 维护者更新 `.env`；`whoami` 仍报会话过期 |
| 2026-10-19 | 对比两个来源：环境变量 514 字符（`ok:-100`），`.env` 517 字符（`ok:1`） |
| 2026-10-19 | 决策并落地「只读 `.env`」；`whoami` 恢复正常，E2E 18/18 |

## 根因分析（blameless）

- **贡献因素 1：隐式优先级链**。代码接受「环境变量或 `.env`」两个来源，但没有明确谁优先；Node 的内置加载器选择「不覆盖已存在值」，于是系统级旧值静默获胜。
- **贡献因素 2：错误信息不指向真实来源**。CLI 只说「Cookie 无效」，没有打印实际读取的文件/来源，排障者无法一眼区分「Cookie 过期」与「读错来源」。
- **贡献因素 3：历史修复未固化到全局规范**。2026-08-09 已经踩过，但只修了 spike 脚本，没有把「Cookie 来源单一化」写进 CLI/E2E 规范。
- **非根因**：Cookie 本身有效（直接请求 `profile/detail` 返回 `ok:1`），上游没有变更。

## 做得对的地方

- 先用原始 HTTP 请求分别验证两个 Cookie，而不是继续在 SDK 层猜测。
- 把根因、两个来源的长度/状态与修复一起记录进开发日志。
- 修复后补了「陈旧环境变量不影响 `.env`」的单测，避免回归。

## 行动项

### 缓解（针对已发生的具体缺口）

- [x] CLI / capture / E2E 统一只读 `.env`（默认 `<pwd>/.env`，`--env-file` 可指定）
- [x] `--cookie` 保留为显式覆盖；不再读取 `process.env.WEIBO_COOKIE`
- [x] `whoami` 报错时打印实际读取路径
- [x] 新增 `tests/unit/utils/envFile.test.ts`（含陈旧环境变量场景）
- [x] 文档同步：`CLAUDE.md`、`docs/engineering/cli.md`、`release-checklist.md`、`error-diagnostics.md`、`capture/README.md`

### 预防（针对整类问题）

- [x] 把「Cookie 只读 `.env`」写入 `CLAUDE.md` 的 CLI Mandate
- [x] E2E `setup-env.ts` 用 `.env` 覆盖 `process.env`，避免测试环境继承旧值
- [ ] 后续新增任何「配置来源」时，默认单一来源 + 显式覆盖，不引入隐式环境变量回退

## 教训

- **配置来源必须单一且显式**：隐式回退链会让「旧值」静默获胜；本机环境变量比 `.env` 更容易过期。
- **内置加载器的语义要验证**：`process.loadEnvFile()` 不覆盖已存在变量；需要覆盖时应自己解析或显式 override。
