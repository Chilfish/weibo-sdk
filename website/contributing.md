---
title: 贡献与开发
---

# 贡献与开发

这份文档站面向 SDK 使用者。仓库开发约定、架构决策、端点抓包流程与发布检查不在本站维护，放在 GitHub 仓库里：

- [AGENTS.md](https://github.com/Chilfish/weibo-sdk/blob/main/AGENTS.md)：仓库级开发约束、测试策略、数据驱动开发。
- [端点开发指南](https://github.com/Chilfish/weibo-sdk/blob/main/docs/engineering/endpoint-authoring.md)：新增/修改 endpoint 的标准流程。
- [技术规格](https://github.com/Chilfish/weibo-sdk/blob/main/docs/engineering/technical-spec.md)：分层、契约与内部实现说明。
- [发布检查清单](https://github.com/Chilfish/weibo-sdk/blob/main/docs/engineering/release-checklist.md)：发布门禁与产物核验。

## 本地命令

```bash
pnpm install
pnpm run typecheck
pnpm exec eslint .
pnpm test --run
pnpm check:api
pnpm docs:build
```

## 文档约定

- `website/` 是公开文档（本站）；`docs/` 是内部开发文档，不对外发布。
- 公开文档不复制内部规划、postmortem 或本机路径；`pnpm check:docs` 会检查。
- 修改公开 API 时，同步更新 `api-surface.json`、`api-surface.snapshot.json` 与对应 `website/api/**` 页面，`pnpm check:api` 必须通过。
