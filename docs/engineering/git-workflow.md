# Git 开发流程

**项目**: weibo-sdk | **最后更新**: 2026-08-09

> 本文档对齐 Float / chill-s3 的 Git Workflow 规范，适配 weibo-sdk（TypeScript 库 + pnpm + Vitest）技术栈。根级硬约束见 [AGENTS.md](../../AGENTS.md)。

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
- **关联 issue**：修复类 commit 在 footer 写 `Closes #<n>`，仅引用不关闭时写 `Refs #<n>`；PR 正文用 `Closes #<n>` 关联，让 issue / commit / PR 双向可追溯

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
- **E2E 门控**：`tests/e2e/**` 仅在 `WEIBO_E2E=1` **且** `.env` 中存在 `WEIBO_COOKIE` 时运行；`WEIBO_E2E` 由 `vitest.e2e.config.ts` 显式设置，**不放入 `.env`**；Cookie 不读取环境变量
- **覆盖率门禁**：CI 额外运行 `pnpm test:coverage`（v8）。阈值在 `vitest.config.ts` 的 `coverage.thresholds`，是**棘轮**：新增测试拉高覆盖率后应上调，永远不要为了过 CI 而下调
- **定时漂移巡检**：`.github/workflows/drift.yml` 每周一 01:00 UTC 直连真实上游跑 `tests/e2e/guest.e2e.test.ts`（无需 Cookie）；仓库配置 `WEIBO_COOKIE` secret 时额外跑完整 E2E。失败会写 step summary，并尝试创建 / 复用标题为 `[drift] upstream API drift detected` 的 issue，避免上游悄悄变更却无人发现
- **文档字段门禁**：`pnpm check:docs` 除内部引用外，还校验 `website/**` 与 `README.md` 代码片段里的 `session.*` / `sdk.*` 是否是对应类型的公开成员；`pnpm check:api` 校验 Stable 分层与「实现细节不得默认 Stable」的保留模式

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
- [ ] 新增/修改 schema 前有真实 fixture（数据驱动，见 [AGENTS.md](../../AGENTS.md)）
- [ ] 新增公开 Service 方法时有对应 CLI 子命令（CLI Mandate）
- [ ] 关键路径有 Wide Events（Happy + Error Path）
- [ ] 相关文档已更新；新 Bug 模式写 postmortem

### 合并门禁（全部满足）

- [ ] `pnpm test` 通过（默认离线）
- [ ] `pnpm run typecheck` 通过
- [ ] 文档与代码一致（docs-as-truth）
- [ ] 新增功能有对应测试

> 涉及较大重构 / breaking change / 需真实外网验证（E2E）的 PR，必须先在 PR 中明确风险点并等待确认后再合并（AGENTS.md 自动化执行边界）。

## 发布流程

`@chilfish/weibo-sdk` 由 tag 触发的 GitHub Actions 发布到 npm，使用 npm Trusted Publisher（OIDC），**不保存长期 token**。

### 一键发布（默认路径）

1. 在 `main` 上把本版变化写进 `CHANGELOG.md` 的 `## Unreleased`（脚本会把它转成版本节）
2. 执行 `pnpm release <patch|minor|major|x.y.z>`
   - 校验当前分支为 `main`、工作区干净、`HEAD === origin/main`、tag 与 npm 版本尚未存在
   - 跑本地门禁：`typecheck` / `eslint .` / `test --run` / `validate:fixtures` / `build` / `browser-smoke --no-browser`
   - `bumpp` 更新 `package.json`，把 `Unreleased` 转成 `## <version> (<date>)`，提交 `chore(release): v<version>`，打 `v<version>` tag 并推送
3. tag 推送触发 `.github/workflows/publish.yml`：
   - 复核 tag 与 `package.json` 版本一致、CHANGELOG 有对应版本节
   - 复跑 CI 门禁，然后 `pnpm publish --provenance`
   - 只负责发布 npm，不自动创建 GitHub Release
4. 发布成功后手写 GitHub Release：以 CHANGELOG 版本节为底稿人工润色，正文首段引用对应 issue 并写 `Closes #<n>`，用 `gh release create v<version> --notes-file <file>` 提交
5. 发布后核验：`npm view @chilfish/weibo-sdk dist-tags`、GitHub Release、npm 页面的 provenance

### 发布凭据

- npm Trusted Publisher 绑定 `Chilfish/weibo-sdk` + `publish.yml` 工作流，权限为 publish / stage publish / dist-tag
- workflow 需要 `id-token: write`（换取 OIDC token）；`contents` 保持只读，GitHub Release 由维护者手动创建
- 不再使用 `NPM_TOKEN`；本地 `pnpm publish` 只用于排障，不作为正式发布路径

### 硬约束

- **禁止 `npm publish`**：项目依赖使用 pnpm `catalog:`，npm 不会重写，产物会写成 `"catalog:"`（[postmortem 010](../postmortem/010-npm-publish-catalog-protocol.md)）。`prepublishOnly` 已加守卫
- 版本号单一来源为 `package.json`（SemVer 2.0.0），tag 必须与它一致
- 只有 CI 门禁全绿才会发布；tag 已推送但发布失败时，从 GitHub Actions 页面重跑失败的工作流，不要删除 tag 重打

> 手动冒烟与产物核验清单见 [release-checklist.md](./release-checklist.md)。

## AI 协作开发

- 优先使用 `gh` CLI 进行 GitHub 全流程管理
- 新端点先抓包存 fixture，再写 schema/代码（ADR-002，见 [architecture.md](../planning/architecture.md)）
- 新库 API 行为先写 5 行 spike 验证（postmortem 007）
- 并行 Agent 协作：文件分配互不重叠 + 对齐最新范式；停止的背景 Agent 残留文件要清理（postmortem 008）
- 开写前读 [postmortem README](../postmortem/README.md)「高频雷区」自查
