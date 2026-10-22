---
编号: 012
主题: 本地发布门禁 lint 了被 .gitignore 忽略的抓取数据
日期: 2026-10-22
严重度: 低
状态: 已归档
根因归类: 工具反馈 / 流程缺失
---

# 012 — 本地发布门禁 lint 了被 .gitignore 忽略的抓取数据

## 摘要

`pnpm release minor` 在 `pnpm exec eslint .` 阶段失败，7198 条 `no-irregular-whitespace` 全部来自本地抓取目录 `data/data*.json`。`data/.gitignore` 已用 `*` 忽略该目录，因此 CI 从未看到这些文件、始终全绿；但 ESLint 只读取自身 `ignores`，不读取嵌套 `.gitignore`，本地 `eslint .` 会把它们纳入检查。把 `data/**` 加入 ESLint 忽略后，本地门禁与 CI 的输入面重新一致，发布继续。

## 影响

- 首次 `pnpm release minor` 在门禁阶段中止，未执行 bump / tag / push，没有产生坏版本。
- 多跑一轮 CI 与发布门禁，约 4 分钟。
- 若不修根因，任何本地存在抓取数据的机器都会稳定复现，发布只能靠 `--skip-checks` 绕过（违反仓库硬约束）。

## 时间线

| commit / 事件 | 说明 |
|---|---|
| `e5ec153` | 推送 34 个待发布 commit，CI 全绿 |
| `pnpm release minor`（第一次） | typecheck 通过；`eslint .` 因 `data/**` 失败，未 bump |
| `c30c61b` | `eslint.config.js` 忽略 `data/**`，本地 `eslint .` 通过 |
| CI `39763080938` | Node 24 / 26 全绿 |
| `pnpm release minor`（第二次） | 全部门禁通过，`v0.4.0` tag 推送 |
| publish run `39763391860` | npm 发布成功，registry 核验通过 |

## 根因分析（blameless）

- **忽略规则有两套真源**：`data/.gitignore` 只约束 Git；ESLint 的 `ignores` 独立维护。两者没有关联，新增本地数据目录时不会自动获得 lint 豁免。
- **CI 与本地输入面不同**：CI 是干净 checkout，本地有未跟踪的抓取产物。本地门禁跑 `eslint .` 时检查了 CI 永远不会检查的文件，失败信息与代码质量无关。
- **门禁失败缺少“输入面”提示**：7198 条错误看起来像大面积风格问题，实际只需排除一个目录；错误聚合方式容易把环境问题误判为代码问题。

## 做得对的地方

- 没有用 `--skip-checks` / `--no-verify` 绕过，而是先修根因再重跑。
- 失败发生在 bump / tag 之前，版本号与 registry 没有被污染。
- 修完后先本地验证 `eslint .`，再推送并等 CI 全绿，才重新发版。

## 行动项

### 缓解

- [x] `eslint.config.js` 的 `ignores` 增加 `data/**`，并注明它是本地抓取数据。
- [x] 本地重跑 `pnpm exec eslint .` 确认通过，再重新执行发布。

### 预防

- [ ] 新增本地生成 / 抓取目录时，同时登记到根 `.gitignore`（或子目录 `.gitignore`）与 `eslint.config.js` 的 `ignores`。
- [ ] 本地发布门禁失败时，先确认报错文件是否被 Git 跟踪：未跟踪文件的环境问题不应通过修改代码解决。

## 教训

`.gitignore` 不等于 ESLint ignore；本地门禁的输入面必须与 CI 一致，否则发布会在与代码无关的文件上失败。
