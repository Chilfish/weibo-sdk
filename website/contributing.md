---
title: 贡献与开发
---

# 贡献与开发

文档站面向 SDK 使用者。仓库开发约定、架构决策、端点抓包流程与发布检查放在 GitHub 仓库：

- [AGENTS.md](https://github.com/Chilfish/weibo-sdk/blob/main/AGENTS.md)：仓库级开发约束、测试策略、数据驱动开发。
- [端点开发指南](https://github.com/Chilfish/weibo-sdk/blob/main/docs/engineering/endpoint-authoring.md)：新增 / 修改 endpoint 的流程。
- [技术规格](https://github.com/Chilfish/weibo-sdk/blob/main/docs/engineering/technical-spec.md)：分层、契约与内部实现。
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

## 文档写法

公开文档只写当前版本的行为和使用方式。

- 先写结论或实际行为，再补细节。
- 直接陈述结果，例如「CLI 读取 `.env`」。
- 同一事实只写一次，其他页面链接过去。
- 参数、返回值、错误码用表格；背景解释控制在一段以内。
- 只写当前版本的行为；历史版本和旧接口对比留在仓库内部文档。
- 所有已发布能力按同一套文档描述。
- 修改公开 API 时，同步更新 `api-surface.json`、`api-surface.snapshot.json` 与对应 `website/api/**` 页面，`pnpm check:api` 必须通过。
- `pnpm check:docs` 会检查公开文档中的内部路径和内部文档链接。
