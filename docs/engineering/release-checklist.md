# Release Checklist

**项目**: `@chilfish/weibo-sdk`（CLI 二进制 `weibo-cli`） | **最后更新**: 2026-10-20

> `@chilfish/weibo-sdk` 发布到 npm。目标：每个「里程碑发布」的产物在真实环境验证通过，不留已知回归。
> 本文档覆盖**里程碑发布**（打 tag + GitHub Release + `pnpm publish`）时的完整清单。

## 版本纪律

- **包版本单一来源**：`package.json` `version` 字段（SemVer 2.0.0）；`src/index.ts` 的 `VERSION` 与 CLI `--version` 从此读取
- **契约版本 ≠ 包版本**（K2 / P0-3）：`TWEET_CONTRACT_VERSION` 管 `ITweet` 存档形状；上游协议漂移走内部 schema 修复 + patch/minor，**只有契约破坏性变更才升包 major**。规则见 [contract-itweet-v1.md](./contract-itweet-v1.md)
- **0.x 声明**（P0-6）：0.x 期间实现可随上游漂移修复，但 `ITweet` 自 v1 起冻结、只增不改（新增 optional 字段 = minor；rename/remove/类型变更 = v2 + major）
- 仅在验证门禁全绿后打 tag：`git tag v<version> && git push --tags`
- 每次发布 version 单调递增，禁止回退
- `CHANGELOG.md` 的 Unreleased 节在发布前迁移到版本节
- Breaking change 必须：`BREAKING CHANGE` footer + 迁移指南 + 至少一个主版本存续期（SKILL.md 第八条）

## 验证门禁（发布前必过）

- [x] `pnpm run typecheck` 通过（2026-10-20）
- [x] `pnpm run lint` 通过（2026-10-20）
- [x] `pnpm run build` 通过（tsdown，确认 `dist/index.mjs` + `.d.mts` + `dist/browser.mjs` 生成；2026-10-20）
- [x] `pnpm test` 全绿（默认离线；2026-10-20：552 passed / 18 skipped）
- [x] `pnpm run validate:fixtures` 通过（离线契约回归，E5 已落地：fixtures × schema safeParse；2026-10-20：84 ok / 7 unmodeled / 0 fail）
- [ ] simple-git-hooks pre-commit 钩子无跳过

## 包身份核验

- [x] `package.json#name` = `@chilfish/weibo-sdk`（2026-10-20）
- [x] `package.json#bin` = `{ "weibo-cli": "./dist/cli.mjs" }`（2026-10-20）
- [x] `package.json#publishConfig.access` = `public`（scoped 包首发必需）
- [x] `pnpm pack` 产物只包含 `dist/`、`README.md`、`LICENSE.md`、`package.json`（2026-10-20；不要用 `npm pack` 检查依赖，它不会重写 `catalog:`）
- [x] 打包产物 `dependencies` 已由 pnpm 重写（`axios ^1.20.0` / `citty ^0.2.2` / `zod ^4.5.4`，无 `catalog:` / `workspace:`；2026-10-20）
- [x] `@chilfish/weibo-sdk` 在 npm registry 上可发布（当前 `latest = 0.1.1`，2026-10-20）

## 公共导出面核验

- [x] `src/index.ts` 导出面与规格书 §3.7 一致（无内部实现泄漏；2026-10-20）
- [x] `exports` 字段回归测试通过（`vitest-package-exports`，见 `tests/unit/entry/exports.test.ts`；2026-10-20）
- [x] 新增响应类型已用 `z.infer` 推导并导出（2026-10-20）

## 功能冒烟（真实环境，`WEIBO_E2E=1`）

> 真实 Cookie **只从项目根目录 `.env` 读取**（`tests/e2e/setup-env.ts` 会覆盖环境变量），勾选并记录日期。E2E 用例默认跳过，发布前由维护者显式开启。

- [x] `pnpm test:e2e` 全绿（2026-10-20：18/18；首跑发现 `favorites/all_fav` 快照缺少顶层 `count` / `total_page`，已更新快照后复跑通过）
- [x] CLI 关键命令冒烟：`whoami` / `archive` / `tweet detail` / `trends` / `capabilities` / `tweet home-stream`（2026-10-20；含从打包 tarball 安装后执行 `whoami`）
- [x] `sdk.selfCheck()` 在真实 Cookie 下返回 ok（2026-10-20，E2E lifecycle 用例）
- [x] 一次真实归档链路跑通：断点续传 + 进度事件（2026-10-20：`archive --max-pages 1` 产出 20 条，checkpoint 落盘正常）
- [x] 新端点 Zod schema 与真实响应 safeParse 通过（`pnpm run validate:fixtures`，E5；2026-10-20：84 ok / 7 unmodeled / 0 fail）
- [x] 打包产物安装冒烟：`npm i --prefix <tmp> <tarball>` 后 CLI `--version` = `0.2.0`、`whoami` 成功、SDK 入口可导入（2026-10-20）

## 发布步骤

1. 从 `main` 创建 `release/x.y.z` 分支（或直接在 main）
2. 更新 `CHANGELOG.md`（Unreleased → 版本节）
3. 更新 `docs/README.md` 索引（如涉及新增文档）
4. 跑通验证门禁 + 功能冒烟
5. 打 Tag：`git tag v<version> && git push --tags`
6. GitHub Release：`gh release create v<version> --generate-notes`
7. `pnpm publish`（`prepublishOnly` 会自动 `nr build`；`publishConfig.access=public` 已固定 scoped 包权限）
   - **禁止 `npm publish`**：项目依赖使用 pnpm `catalog:`，npm 不会重写，产物会写成 `"catalog:"` 导致消费者安装失败（[postmortem 010](../postmortem/010-npm-publish-catalog-protocol.md)）。`prepublishOnly` 已加守卫，npm 调用会直接失败。
8. 发布后核验：`npm view @chilfish/weibo-sdk dist-tags`、解包 tarball 确认 `dependencies` 无 `catalog:`、`npm i --prefix <tmp> @chilfish/weibo-sdk && node <tmp>/node_modules/@chilfish/weibo-sdk/dist/cli.mjs --version`
9. 发布后回填冒烟勾选日期，归档本阶段计划文档

> 真实外网验证由维护者在发布前执行，勾选并记录日期。
