# Release Checklist

**项目**: weibo-sdk | **最后更新**: 2026-08-09

> weibo-sdk 发布到 npm。目标：每个「里程碑发布」的产物在真实环境验证通过，不留已知回归。
> 本文档覆盖**里程碑发布**（打 tag + GitHub Release + `pnpm publish`）时的完整清单。

## 版本纪律

- **版本号单一来源**：`package.json` `version` 字段（SemVer 2.0.0）；`src/index.ts` 的 `VERSION` 与 CLI `--version` 从此读取
- 仅在**验证门禁全绿**后打 tag：`git tag v0.1.0 && git push --tags`
- 每次发布 version 单调递增，禁止回退
- `CHANGELOG.md` 的 Unreleased 节在发布前迁移到版本节
- Breaking change 必须：`BREAKING CHANGE` footer + 迁移指南 + 至少一个主版本存续期（SKILL.md 第八条）

## 验证门禁（发布前必过）

- [ ] `pnpm run typecheck` 通过
- [ ] `pnpm run lint` 通过
- [ ] `pnpm run build` 通过（tsdown，确认 `dist/index.mjs` + `.d.mts` 生成）
- [ ] `pnpm test` 全绿（默认离线）
- [ ] `pnpm run size` 通过（size-limit，50 kB 上限）
- [ ] simple-git-hooks pre-commit 钩子无跳过

## 公共导出面核验

- [ ] `src/index.ts` 导出面与规格书 §3.7 一致（无内部实现泄漏）
- [ ] `exports` 字段回归测试通过（`vitest-package-exports`，见 `tests/unit/entry/exports.test.ts`）
- [ ] 新增响应类型已用 `z.infer` 推导并导出

## 功能冒烟（真实环境，`WEIBO_E2E=1`）

> 真实 Cookie 验证在 `.env` 提供，勾选并记录日期。E2E 用例默认跳过，发布前由维护者显式开启。

- [ ] `pnpm test:e2e` 全绿（E2E 结构快照通过）
- [ ] CLI 关键命令冒烟：`whoami` / `archive`（如已实现）/ `tweet detail` / `trends`
- [ ] `sdk.selfCheck()` 在真实 Cookie 下返回 ok
- [ ] 一次真实归档链路（如已实现 A5-A8）跑通：断点续传 + 进度事件
- [ ] 新端点 Zod schema 与真实响应 safeParse 通过（离线契约回归脚本，如已实现 E5）

## 发布步骤

1. 从 `main` 创建 `release/x.y.z` 分支（或直接在 main）
2. 更新 `CHANGELOG.md`（Unreleased → 版本节）
3. 更新 `docs/README.md` 索引（如涉及新增文档）
4. 跑通验证门禁 + 功能冒烟
5. 打 Tag：`git tag v0.1.0 && git push --tags`
6. GitHub Release：`gh release create v0.1.0 --generate-notes`
7. `pnpm publish`（`prepublishOnly` 会自动 `nr build`）
8. 发布后回填冒烟勾选日期，归档本阶段计划文档

> 真实外网验证由维护者在发布前执行，勾选并记录日期。
