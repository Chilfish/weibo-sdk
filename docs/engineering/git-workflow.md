# Git 开发流程

**项目**: weibo-sdk | **最后更新**: 2026-08-09

> 本文档对齐 Float / chill-s3 的 Git Workflow 规范，适配 weibo-sdk（TypeScript 库 + pnpm + Vitest）技术栈。根级硬约束见 [CLAUDE.md](../../CLAUDE.md)。

## Commit 规范

遵循 [Conventional Commits 1.0.0](https://www.conventionalcommits.org/)。

### 格式

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Type

| Type | 说明 | 示例 |
|---|---|---|
| `feat` | 新功能 | `feat(archive): add resumable archive stream` |
| `fix` | Bug 修复 | `fix(tweet): align sinceId to string per real API` |
| `refactor` | 重构（不改变行为） | `refactor(tweet): extract normalize helpers` |
| `test` | 测试 | `test(archive): add resume-from-checkpoint coverage` |
| `docs` | 文档 | `docs: adopt Float documentation structure` |
| `style` | 格式化 | `style: apply eslint --fix` |
| `chore` | 构建/工具 | `chore(build): add validate-fixtures script` |
| `perf` | 性能优化 | `perf(rate-limit): replace recursion with while loop` |

### Scope

`scope` 使用模块名或功能名：

`user`、`tweet`、`followings`、`favorites`、`trends`、`search`、`archive`、`auth`、`build`、`cli`、`schema`、`docs`、`test`

### 规则

- **Description 用英文祈使句**（命令式）：`add`、`fix`、`remove`
- 首字母小写，不加句号，不超过 72 字符
- **Breaking change**：footer 标记 `BREAKING CHANGE: description`

### Commit 纪律

> **先想 commit message，再动工写代码。** 避免「上帝 commit」（一个超大 commit 包含所有变更）。

1. **写代码前**，先用 Conventional Commit 格式确定 commit message
2. **围绕这个 message 的范围编码**，超出范围的工作留给下一个 commit
3. **diff >10 文件或 >200 行时主动拆分**
4. 每个 commit 应能独立通过验证（`typecheck` + `lint` + 相关 `test`）
5. 模块创建、功能实现、配置修改、文档更新分开 commit

典型拆分示例：

```bash
# Commit 1: 测试基建（Red）
git commit -m "test(archive): add failing resume-checkpoint test"

# Commit 2: 功能实现（Green）
git commit -m "feat(archive): implement resumable archive stream"

# Commit 3: 重构
git commit -m "refactor(archive): extract checkpoint codec"

# Commit 4: 文档
git commit -m "docs: update archive plan status"
```

## 验证门禁

每个 commit / PR 合并前必须通过（离线，不依赖真实微博网络）：

```bash
pnpm run typecheck   # TypeScript strict 类型检查
pnpm run lint        # ESLint（@antfu/eslint-config）
pnpm run build       # tsdown 构建
pnpm test            # Vitest（默认离线，e2e 自动跳过）
pnpm run validate:fixtures  # 离线契约回归：fixtures × schema safeParse（E5）
```

- **fixture 契约回归（E5）**：`scripts/validate-fixtures.ts` 遍历 `tests/fixtures/raw/*.json` × 对应 endpoint schema；新增 fixture 必须在 `FIXTURE_RULES` 登记（mapped 或 unmodeled），未登记/失效登记会 fail loudly（CI 已接入）

- `simple-git-hooks` + `lint-staged` 在 `prepare` 自动安装，pre-commit 钩子已配置
- **禁止 `--no-verify` 跳过钩子**；钩子失败必须修复根因
- **E2E 门控**：`tests/e2e/**` 仅在 `WEIBO_E2E=1` **且** `WEIBO_COOKIE` 存在时运行；`WEIBO_E2E` 由 `vitest.e2e.config.ts` 显式设置，**不放入 `.env`**

## 代码审查

### PR 流程

1. 创建 PR → 跑通验证门禁
2. 至少 1 人 Approve；AI 辅助先进行自动化 Code Review
3. 所有检查通过后 Merge（**Squash Merge**，合并后删除分支）
4. PR 正文用 `gh pr create --body-file <file>`，禁止命令行字面量 `\n` 拼 body

### 审查清单

- [ ] 代码逻辑正确，覆盖边界情况（分页/空值/null vs undefined）
- [ ] 新功能/纯函数有测试；改动无回归
- [ ] 遵循 [code-style.md](./code-style.md)
- [ ] 无 `any`（边界层除外）、无 TODO 遗留
- [ ] 新增/修改 schema 前有真实 fixture（数据驱动，见 [CLAUDE.md](../../CLAUDE.md)）
- [ ] 新增公开 Service 方法时有对应 CLI 子命令（CLI Mandate）
- [ ] 关键路径有 Wide Events（Happy + Error Path）
- [ ] 相关文档已更新；新 Bug 模式写 postmortem

### 合并门禁（全部满足）

- [ ] `pnpm test` 通过（默认离线）
- [ ] `pnpm run typecheck` 通过
- [ ] 文档与代码一致（docs-as-truth）
- [ ] 新增功能有对应测试

> 涉及较大重构 / breaking change / 需真实外网验证（E2E）的 PR，必须先在 PR 中明确风险点并等待确认后再合并（CLAUDE.md 自动化执行边界）。

## 发布流程

weibo-sdk 发布到 npm（`pnpm publish`）：

### 里程碑发布（按需）

1. 从 `main` 创建 `release/x.y.z` 分支（或直接在 main）
2. 更新 `CHANGELOG.md`（Unreleased → 版本节）
3. 更新 `docs/README.md` 索引（如涉及新增文档）
4. 跑通全部验证门禁 + [release-checklist.md](./release-checklist.md) 冒烟
5. 打 Tag：`git tag v0.1.0 && git push --tags`
6. GitHub Release：`gh release create v0.1.0 --generate-notes`
7. `pnpm publish`

> 版本号单一来源为 `package.json`（SemVer 2.0.0），详见 [release-checklist.md](./release-checklist.md)。

## AI 协作开发

- 优先使用 `gh` CLI 进行 GitHub 全流程管理
- 新端点先抓包存 fixture，再写 schema/代码（ADR-002，见 [architecture.md](../planning/architecture.md)）
- 新库 API 行为先写 5 行 spike 验证（postmortem 007）
- 并行 Agent 协作：文件分配互不重叠 + 对齐最新范式；停止的背景 Agent 残留文件要清理（postmortem 008）
- 开写前读 [postmortem README](../postmortem/README.md)「高频雷区」自查
