# CLI 架构（内部）

> 面向仓库维护者。命令、参数与输出契约见公开站点：`website/cli/index.md`。

## 入口与命令树

```
src/cli.ts              # 命令树（只导出，无顶层副作用）
src/cli-bin.ts          # 唯一的 bin 入口，调用 runMain()
src/cli/
  shared.ts             # getCookie / getEnvFilePath / createSDK / cookieArg（--cookie / --env-file / --guest）
  commands/
    archiveUser.ts      # archive user：参数映射、输出文件、退出码
    archiveMerge.ts     # archive merge：读取多份归档、合并、原子写入
    user.ts             # user info / timeline / mentions / groups
    tweet.ts            # tweet detail / context / comments / home / likers / longtext / reposts / search-profile
    follow.ts           # follow list / follow fans / follow my
    favorite.ts         # favorite list / favorite stream / favorite tags
    like.ts             # like list / like stream
    comment.ts          # comment mine / comment stream
    media.ts            # media images / media videos / albums / download
    notification.ts     # notification comments / comments-stream / likes / likes-stream
    topic.ts            # topic cates / list / stream
    search.ts           # search users / search tweets
src/utils/cookieInput.ts # Cookie header 串 / Netscape / header 文件的统一解析
```

## 约定

- 基于 citty 的 `defineCommand` + `runMain`；`src/cli.ts` 不执行顶层逻辑，`src/cli-bin.ts` 是唯一带副作用的入口。
- 每个子命令独立定义，支持嵌套；`trends` / `whoami` / `archive` / `capabilities` 为顶层命令。
- 查询命令默认 JSON，`--format markdown` 为可选阅读视图；流式命令固定 NDJSON。
- 错误输出到 stderr 并以非零退出码退出；stdout 只放数据。
- citty 在构建期内联进 CLI 产物，运行时依赖保持 `axios` / `zod`。

## 新增子命令

1. 在 `src/cli/commands/<domain>.ts` 定义 `defineCommand`，参数用 kebab-case。
2. 在 `src/cli.ts` 注册到对应分组或顶层。
3. 补 `tests/unit/cli/*` 覆盖参数映射（尤其是 snake_case 上游参数）。
4. 更新公开站点 `website/cli/index.md` 的命令表与输出形态速查。
5. 跑 `pnpm check:api` 与 `pnpm typecheck`。
