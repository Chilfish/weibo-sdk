# Release Checklist

**项目**: `@chilfish/weibo-sdk`（CLI 二进制 `weibo-cli`） | **最后更新**: 2026-10-22

> `@chilfish/weibo-sdk` 发布到 npm。目标：每个「里程碑发布」的产物在真实环境验证通过，不留已知回归。
> 本文档覆盖**里程碑发布**（`pnpm release` 打 tag → CI 发布 npm → 手写 GitHub Release）时的完整清单。

## 版本纪律

- **包版本单一来源**：`package.json` `version` 字段（SemVer 2.0.0）；`src/index.ts` 的 `VERSION` 与 CLI `--version` 从此读取
- **契约版本 ≠ 包版本**（K2 / P0-3）：`TWEET_CONTRACT_VERSION` 管 `ITweet` 存档形状；上游协议漂移走内部 schema 修复 + patch/minor，**只有契约破坏性变更才升包 major**。规则见 [contract-itweet-v2.md](./contract-itweet-v2.md)
- **0.x 声明**（P0-6）：0.x 期间实现可随上游漂移修复，但 `ITweet` 自 v1 起冻结、只增不改（新增 optional 字段 = minor；rename/remove/类型变更 = v3 + major；v1 → v2 已于 2026-10-21 完成）
- 仅在验证门禁全绿后打 tag：统一走 `pnpm release <type>`（脚本会先跑门禁，再 bump + tag + push）
- 每次发布 version 单调递增，禁止回退
- `CHANGELOG.md` 的 Unreleased 节在发布前迁移到版本节
- Breaking change 必须：`BREAKING CHANGE` footer + 迁移指南 + 至少一个主版本存续期（SKILL.md 第八条）

## 验证门禁（发布前必过）

- [x] `pnpm run typecheck` 通过（2026-10-20；2026-10-21 / 0.3.2、2026-10-22 / 0.4.0、0.5.0 CI 复跑通过）
- [x] `pnpm run lint` 通过（2026-10-20；2026-10-21 / 0.3.2、2026-10-22 / 0.4.0、0.5.0 CI 复跑通过；本地 `eslint .` 已排除 `data/**`，见 [postmortem 012](../postmortem/012-eslint-local-capture-data.md)）
- [x] `pnpm run build` 通过（tsdown，确认 `dist/index.mjs` + `.d.mts` + `dist/browser.mjs` 生成；2026-10-20；2026-10-21 / 0.3.2、2026-10-22 / 0.4.0、0.5.0 CI 复跑通过）
- [x] `node scripts/browser-smoke.mjs --no-browser` 通过（导出条件解析 + Node 构建导入；2026-10-21，0.3.1 因该检查未同步条件 `exports` 在 CI 失败后修复并纳入本地门禁；2026-10-22 / 0.4.0、0.5.0 本地与 CI 均通过）
- [x] `pnpm test` 全绿（默认离线；2026-10-21 / 0.3.2：772 passed / 23 skipped；2026-10-22 / 0.4.0：956 passed / 23 skipped；2026-10-22 / 0.5.0：958 passed / 23 skipped）
- [x] `pnpm run validate:fixtures` 通过（离线契约回归，E5 已落地：fixtures × schema safeParse；2026-10-21 / 0.3.2：106 fixtures，98 ok / 8 unmodeled / 0 fail；2026-10-22 / 0.4.0、0.5.0：113 fixtures，102 ok / 11 unmodeled / 0 fail）
- [x] simple-git-hooks pre-commit 钩子无跳过（2026-10-21，0.3.2 提交均正常触发 lint-staged；2026-10-22，0.4.0 / 0.5.0 提交均正常触发 lint-staged）

## 包身份核验

- [x] `package.json#name` = `@chilfish/weibo-sdk`（2026-10-20）
- [x] `package.json#bin` = `{ "weibo-cli": "./dist/cli-bin.mjs" }`（2026-10-21；CLI 拆分为命令树 + bin 入口）
- [x] `package.json#publishConfig.access` = `public`（scoped 包首发必需）
- [x] `pnpm pack` 产物只包含 `dist/`、`README.md`、`LICENSE.md`、`package.json`（2026-10-20；不要用 `npm pack` 检查依赖，它不会重写 `catalog:`）
- [x] 打包产物 `dependencies` 已由 pnpm 重写（`axios ^1.20.0` / `zod ^4.5.4`，无 `catalog:` / `workspace:`；2026-10-21，`citty` 已内联进 CLI 产物并从 dependencies 移除）
- [x] `@chilfish/weibo-sdk` 在 npm registry 上可发布（当前 `latest = 0.5.0`，2026-10-22）

## 公共导出面核验

- [x] `src/index.ts` 导出面与规格书 §3.7 一致（无内部实现泄漏；2026-10-20；2026-10-22 / 0.5.0 删除 4 个手写 raw 类型导出，替换为 schema 推导类型，迁移见 CHANGELOG）
- [x] `exports` 字段回归测试通过（`vitest-package-exports`，见 `tests/unit/entry/exports.test.ts`；2026-10-20；2026-10-22 / 0.5.0 复跑通过）
- [x] 新增响应类型已用 `z.infer` 推导并导出（2026-10-20；2026-10-22 / 0.5.0 `MyMblogResponse` / `StatusShowResponse` 不再退化为 `any`）
- [x] 下游产物完整性门禁（见 [package-integrity.md](./package-integrity.md) §5）：`publint` / `attw` / tarball 安装 / Vite / tree-shaking / Worker smoke（2026-10-21；2026-10-22 / 0.5.0 在 bump 后重建再跑 `lint:package` / `verify:package` / `test:bundle` 均通过）

## 功能冒烟（真实环境，`WEIBO_E2E=1`）

> 真实 Cookie **只从项目根目录 `.env` 读取**（`tests/e2e/setup-env.ts` 会覆盖环境变量），勾选并记录日期。E2E 用例默认跳过，发布前由维护者显式开启。

- [x] `pnpm test:e2e` 全绿（2026-10-20 / 0.3.0：18 passed / 5 skipped（guest E2E 未开启）；0.2.0 时首跑发现 `favorites/all_fav` 快照缺少顶层 `count` / `total_page`，已更新快照；2026-10-22 / 0.5.0：23 passed（含 guest），先刷新 `statuses/show` 的 `user.status_total_counter` 上游漂移快照）
- [x] CLI 关键命令冒烟：`whoami` / `archive` / `tweet detail` / `trends` / `capabilities` / `tweet home-stream`（2026-10-20；含从打包 tarball 安装后执行 `whoami`）
- [x] `sdk.selfCheck()` 在真实 Cookie 下返回 ok（2026-10-20，E2E lifecycle 用例）
- [x] 一次真实归档链路跑通：断点续传 + 进度事件（2026-10-20：`archive --max-pages 1` 产出 20 条，checkpoint 落盘正常）
- [x] 新端点 Zod schema 与真实响应 safeParse 通过（`pnpm run validate:fixtures`，E5；2026-10-20 / 0.3.0：98 ok / 8 unmodeled / 0 fail）
- [x] registry 安装冒烟：干净临时目录安装 `@chilfish/weibo-sdk@0.5.0` 后 CLI `--version` = `0.5.0`，`dependencies` 仅 `axios` / `zod`（2026-10-22；`npx` 会命中本地缓存并输出旧版本，核验版本应以临时目录安装为准）
- [x] provenance 签名链：`npm audit signatures` 显示 29 个包通过 registry 签名、3 个包通过 attestations；`0.4.0` / `0.5.0` 带 SLSA provenance v1（2026-10-22）

## 发布步骤

发布由 tag 触发的 GitHub Actions 完成，本地只负责版本收口与推送 tag。

### 发布前（本地）

1. 确认 `main` 已推送且 CI 全绿
2. 更新 `CHANGELOG.md` 的 `## Unreleased`（本版全部变化）
3. 更新 `docs/README.md` 索引（如涉及新增文档）
4. 需要时跑功能冒烟（`WEIBO_E2E=1`），勾选并记录日期
5. 执行 `pnpm release <patch|minor|major|x.y.z>`
   - 脚本会校验分支 / 工作区 / 远端同步 / tag 与 npm 版本，跑本地门禁
   - `bumpp` 更新 `package.json`、把 `Unreleased` 转成 `## <version> (<date>)`、提交、打 tag、推送
   - 不传版本类型时不会猜测：必须显式指定

### 发布（CI）

6. `.github/workflows/publish.yml` 由 tag 触发：
   - 校验 tag 与 `package.json` 版本一致、CHANGELOG 存在对应版本节
   - 复跑 `typecheck` / `eslint` / `test --run` / `validate:fixtures` / `build` / `browser-smoke --no-browser`
   - `pnpm publish --no-git-checks --access public --provenance`
   - 流水线不创建 GitHub Release
7. 发布成功后手写 GitHub Release：以 CHANGELOG 版本节为底稿人工润色，`gh release create v<version> --notes-file <file>`
8. **禁止 `npm publish`**：pnpm `catalog:` 不会被 npm 重写，产物会写成 `"catalog:"`（[postmortem 010](../postmortem/010-npm-publish-catalog-protocol.md)）。`prepublishOnly` 已加守卫，npm 调用会直接失败。
9. tag 已推送但发布失败：从 GitHub Actions 重跑失败的工作流，不要删除 tag 重打。若 `Publish to npm` 已成功、仅 `Verify registry` 超时，先手动核验 registry；GitHub 可能对 `startup_failure` 的 run 拒绝重跑（0.5.0 遇到），此时保留 tag、记录到开发日志并完成手工核验。

### 发布后（核验）

10. `npm view @chilfish/weibo-sdk dist-tags` 指向新版本
11. 解包 tarball 确认 `dependencies` 无 `catalog:`、`npm i --prefix <tmp> @chilfish/weibo-sdk && node <tmp>/node_modules/@chilfish/weibo-sdk/dist/cli.mjs --version`
12. npm 页面显示 provenance，GitHub Release 内容与 CHANGELOG 一致
13. 回填冒烟勾选日期与开发日志

> 本地核验注意：`pnpm release` 的门禁 build 在 bump 前执行，发布后 `dist` 仍嵌入旧 `VERSION`；跑 `verify:package` / tarball 核验前先 `pnpm build`。CI 从 tag 重建，发布产物不受影响（0.5.0 已确认）。

> 真实外网验证由维护者在发布前执行，勾选并记录日期。

## 发布凭据（Trusted Publisher / OIDC）

- npm 包设置里的 Trusted Publisher：GitHub 仓库 `Chilfish/weibo-sdk`、工作流文件名 `publish.yml`、权限 publish / stage publish / dist-tag
- workflow 需要 `permissions.id-token: write`（换取 npm OIDC token）；`contents` 保持只读，GitHub Release 由维护者手写
- 不使用 `NPM_TOKEN` / `NODE_AUTH_TOKEN`；`actions/setup-node` 不配置 `registry-url`，避免写入占位 token 的 `.npmrc`
- 首次配置后必须在 npm 要求的期限内成功发布一次，Trusted Publisher 才会从 `Pending validation` 变为生效
