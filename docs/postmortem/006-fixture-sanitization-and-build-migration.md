# Postmortem 006 — Fixture Sanitization & Build Migration

**Date**: 2026-05-16

## Part A: 数据脱敏

### Context
仓库中有 21 个真实微博 API 响应 fixture（1.7MB），包含用户 ID、签名 URL、个人隐私文本。需要脱敏后才能安全提交到公开仓库。

### Decision: 类型感知的占位符替换

**方案**：保留值类型（typeof），只替换内容：
- `string` → 按格式分：`<URL>`、`<ID>`（纯数字 ≥10 位）、`<DATE>`、`<TEXT>`（长文本）
- `number` → 保留（小而不可逆）；超大整数 → `-1`
- `boolean` → 保留
- ≤40 字符的非 URL/数字/日期字符串 → **保留**（pic_ids 等 ID 需保持一致性以支持对象查找）

**Why**：完全替换 `<TEXT>` 会破坏数据关联（如 `pic_ids` 与 `pic_infos` 的键匹配），导致 2 个测试失败。

### Result
- 1,774KB → 694KB（61% 节省）
- 21 个描述性文件名（`timeline_u*`、`tweet_*`、`comments`、`feed_home` 等）
- 测试从精确值断言改为结构性断言（`typeof` 检查）
- 64 个离线测试全部通过

### Anti-pattern
- **全部字符串替换为 `<TEXT>`** → 破坏 `pic_ids`/`pic_infos` 键匹配，media 解析返回空数组
- 修复：≤40 字符的短字符串保留

---

## Part B: unbuild → tsdown 迁移

### Context
`unbuild` 基于 Rollup + jiti，构建配置简单但生态较小。`tsdown` 基于 Rolldown（Rust），是 tsup 的现代化替代品。

### Migration
| 项 | unbuild | tsdown |
|----|---------|--------|
| 配置 | `build.config.ts` | `tsdown.config.ts` |
| 构建命令 | `unbuild` | `tsdown` |
| 开发模式 | `unbuild --stub` | `tsdown --watch` |
| 产物 | `dist/index.mjs` | `dist/index.mjs`（46.7KB） |
| DTS | `declaration: 'node16'` | `dts: true`（自动检测） |
| package.json | 手动维护 `main`/`module` | 自动管理 `exports`，移除冗余字段 |

### Breaking
- tsdown 移除了 `main`/`module`（`exports` 已足够），需更新测试断言

### Result
- 构建时间：908ms
- 无需额外配置即生成 `.d.mts`
- `exports: true` 自动管理包导出
