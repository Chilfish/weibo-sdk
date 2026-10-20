---
编号: 010
主题: 用 npm publish 发布 pnpm catalog 项目，产物依赖为 "catalog:" 无法安装
日期: 2026-10-20
严重度: 高（首个 npm 版本不可安装，需 unpublish + 重发）
状态: 已归档
根因归类: 工具反馈 / 流程缺失
---

# 010 — 用 npm publish 发布 pnpm catalog 项目，产物依赖为 `catalog:` 无法安装

## 摘要

0.1.0 由维护者手动执行 `npm publish` 发布。npm 不识别 pnpm 的 `catalog:` 协议，把 `"axios": "catalog:"` 等依赖原样写进产物 `package.json`，消费者安装时报 `EUNSUPPORTEDPROTOCOL: Unsupported URL Type "catalog:"`。改用 `pnpm publish` 后，`catalog:` 被重写为 `^1.20.0` 等具体版本。最终 unpublish 0.1.0，以 0.1.1 重新发布，并在 `prepublishOnly` 增加发布工具守卫。

## 影响

- npm 上首个版本（0.1.0）无法安装，`npm i -g @chilfish/weibo-sdk@0.1.0` 直接失败。
- 需要 `npm unpublish` 回滚版本，再以 0.1.1 重发；GitHub tag / Release 的源码本身没有问题。
- 发布门禁只校验源码（typecheck / lint / test / build / fixtures），没有校验打包产物元数据。

## 时间线

| 时间（UTC） | 事件 |
|---|---|
| 02:25:40 | `0.0.0-stage` 被发布（无依赖、无 bin 的占位版本，用于测试发布权限） |
| 02:26:40 | 0.1.0 由维护者手动 `npm publish` 发布（终端需交互 OTP） |
| 02:27+ | `npm view` 先返回 404（registry 传播中）；随后可查，但 `npm i -g @chilfish/weibo-sdk@0.1.0` 报 `EUNSUPPORTEDPROTOCOL: catalog:` |
| 02:29+ | 解包线上 tarball：`dependencies` 为 `catalog:`；本地 `pnpm pack` 同一源码产物为 `^1.20.0` / `^0.2.2` / `^4.5.4` |
| 02:33 | 决策：unpublish 0.1.0，用 `pnpm publish` 重发 |
| 02:35:08 | 0.1.1 发布；产物依赖正常，`dist-tags.latest = 0.1.1` |

## 根因分析（blameless）

- **贡献因素 1：存在两条发布路径，但没有强制约束。** `package.json#release` 是 `bumpp && pnpm publish`，但手动发布时终端里用的是 `npm publish`；两者都能成功推送，且输出都是 `+ pkg@version`。
- **贡献因素 2：npm 对未知依赖协议静默放行。** npm publish 不校验 `catalog:` 是否为合法 spec，产物照样生成，问题只在消费者安装时才暴露。
- **贡献因素 3：门禁检查的是源码，不是产物。** CI 跑的是 typecheck / lint / test / build，`npm pack --dry-run` 只看了文件清单与体积，没有断言依赖是否已被重写。
- **非根因：** pnpm catalog 机制本身正常；源码、build 产物与 git tag 都没有问题。

## 做得对的地方

- 发布后按 release checklist 做安装验证，没有停在 `npm view` 成功这一步。
- 通过「线上 tarball 解包」与「本地 `pnpm pack` 产物」对比，快速定位到 `catalog:` 差异，而不是在上游依赖上猜测。
- 先用 `pnpm pack` 产物 + `npm i --prefix <tmp>` 验证 0.1.1 可安装、`dist/cli.mjs --version` 正常，再宣布发布成功。

## 行动项

### 缓解（针对已发生的具体缺口）

- [x] unpublish 0.1.0（72 小时内、零依赖方），以 0.1.1 重新发布
- [x] 新增 `scripts/verify-publish-tool.mjs`：`prepublishOnly` 检测 `npm_config_user_agent`，非 `pnpm` 直接失败并给出原因
- [x] `release-checklist.md` 明确「只能 `pnpm publish`」并在发布后核验解包产物依赖
- [x] 发布后核验：registry `dist-tags.latest`、tarball `dependencies`、`dist/cli.mjs --version`

### 预防（针对整类问题）

- [ ] CI 增加产物元数据校验（`pnpm pack` 后断言依赖无 `catalog:` / `workspace:`，`bin` 指向真实文件）
- [ ] 保持「发布只用项目包管理器」的原则：pnpm 项目不提供 npm 发布路径

## 教训

- **包管理器自有协议只在对应 CLI 打包时重写**（`catalog:` / `workspace:`）：发布必须用项目包管理器（pnpm），否则产物结构性损坏。
- **发布门禁必须检查产物，而不只是源码**：`npm pack` / tarball 解包是唯一能发现「源码正确、产物错误」的环节。
