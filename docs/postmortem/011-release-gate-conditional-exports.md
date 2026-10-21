---
编号: 011
主题: 发布门禁未同步条件 exports，0.3.1 tag 已推送但未发布
日期: 2026-10-21
严重度: 中
状态: 已归档
根因归类: 流程缺失 / 工具反馈
---

# 011 — 发布门禁未同步条件 exports，0.3.1 tag 已推送但未发布

## 摘要

0.3.1 的 tag 推送后，`publish.yml` 在 `Publish to npm` 之前失败：`browser-smoke --no-browser` 仍把 `package.json#exports["."]` 和 `exports["./cli"]` 当字符串比较，而这两个入口早已改成 `{ types, default }` 条件对象。tag 无法回退，最终以 0.3.2 发布同一批变更。

## 影响

- 0.3.1 未进入 npm，registry 上只有 0.3.0 → 0.3.2。
- 多发一个 tag 和一个版本号；CHANGELOG 需要保留 0.3.1 未发布的备注。
- 发布流水线多跑一轮，约 3 分钟。

## 时间线

| commit / 事件 | 说明 |
|---|---|
| `e3f7548` | `exports` 改为条件对象，但只更新了单测与产物门禁样式 |
| `2bbb765` | `chore(release): v0.3.1`，tag 推送 |
| run `39562319827` | CI 在 `browser-smoke --no-browser` 失败，未执行 publish |
| `f62ba81` | `browser-smoke` 改为比较 `default` 目标 |
| `3119e18` | 本地发版门禁追加 `browser-smoke --no-browser` |
| `f4d5c37` | `chore(release): v0.3.2`，CI 全绿并发布 |

## 根因分析（blameless）

- **检查有两份真源**：`exports` 的期望形状同时存在于 `tests/unit/entry/exports.test.ts` 和 `scripts/browser-smoke.mjs`。前者随 `e3f7548` 更新，后者被遗漏。
- **本地门禁与 CI 不一致**：`scripts/release.mjs` 跑 typecheck / eslint / test / fixtures / build，但 CI 额外跑 `browser-smoke`。本地全绿给了错误信心。
- **发布前只在 CI 命中**：该脚本属于“下游产物”类检查，平时不在默认 `pnpm test` 中，缺少改动 `exports` 时的强制触发条件。

## 做得对的地方

- 失败发生在 publish 之前，npm 没有产生不可撤回的坏版本。
- 按发布规范没有删除已推送 tag，而是顺延 patch 版本并记录原因。
- 修复时同时把检查加入本地发版门禁，而不是只改 CI 脚本。

## 行动项

### 缓解

- [x] `scripts/browser-smoke.mjs` 兼容字符串和条件对象两种 `exports` 形状。
- [x] `scripts/release.mjs` 在 build 后运行 `browser-smoke --no-browser`。
- [x] CHANGELOG / release-checklist / 开发日志记录 0.3.1 未发布的原因。

### 预防

- [ ] 新增或修改 `exports` / `bin` / `files` / `dependencies` 时，同步检查所有读取 `package.json` 的脚本，而不只是单测。
- [ ] 任何在 CI 中执行、但不在 `pnpm test` 中的发布门禁，都必须加入 `scripts/release.mjs`。

## 教训

发布门禁与 CI 必须跑同一组检查；任何按字段形状断言 `package.json` 的地方都要容忍条件 `exports` 的两种形态。
