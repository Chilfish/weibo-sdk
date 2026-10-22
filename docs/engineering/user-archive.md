# 用户范围归档（`sdk.userArchive` / `weibo-cli archive user`）

用户范围归档解决一个具体问题：把一个账号在**指定时间范围内**发布的微博、评论、楼中楼和转发，补全后写进**一个 JSON 文件**，中断后还能接着跑。

它和 `sdk.archive` / `weibo-cli archive` 的分工：

| 能力 | 入口 | 适合 |
|---|---|---|
| 全量镜像 | `sdk.archive.streamArchive()` / `weibo-cli archive <uid>` | 从头镜像账号，NDJSON 流式产出 |
| 范围归档 | `sdk.userArchive.run/stream()` / `weibo-cli archive user <uid>` | 指定时间段，深度补全，单文件交付，可续跑 |

## SDK

### 一次拿到完整归档

```ts
import { WeiboSDK } from '@chilfish/weibo-sdk'

const sdk = new WeiboSDK({ cookie })

const result = await sdk.userArchive.run(uid, {
  since: '2025-01-01',
  until: '2025-12-31',
  includeComments: true,
  includeReplies: true,
  includeReposts: false,
  concurrency: 6,
})

result.file      // ArchiveFile：user / query / stats / tweets / errors
result.complete  // 是否完整结束
result.summary   // { tweets, comments, replies, errors, complete }
```

`since` / `until` 接受 `YYYY-MM-DD`、`YYYYMMDD` 或 unix 秒；默认范围是 2009-08-14 到现在。

### 流式消费

```ts
for await (const event of sdk.userArchive.stream(uid, options)) {
  switch (event.type) {
    case 'meta':
      console.log(event.meta.slices)
      break
    case 'record':
      await persist(event.entry.record)   // 逐条落盘
      break
    case 'issue':
      console.warn(event.issue)
      break
    case 'done':
      console.log(event.summary)
      break
  }
}
```

事件顺序：`meta` → 每个切片 `slice-start` / `record*` / `issue*` / `slice-done` → `done`。

运行期失败会转成 `issue` 事件并继续；`AUTH_SESSION_EXPIRED`、`CONFIG_INVALID`、`RATE_LIMITED` 会停止后续切片，但已产出的记录和 `done` 事件仍会保留。配置错误和访客模式在第一次迭代前抛出 `CONFIG_INVALID`。

### 选项

| 选项 | 默认 | 说明 |
|---|---|---|
| `since` / `until` | 2009-08-14 / 现在 | 时间范围，含边界 |
| `sliceDays` | `30` | 每 n 天一个枚举子任务；`0` 不拆分 |
| `includeComments` | `true` | 拉取一级评论 |
| `includeReplies` | `true` | 展开楼中楼 |
| `includeReposts` | `false` | 拉取转发列表 |
| `commentOrder` | `'time'` | `time` 按数字 mid 翻页，完整遍历更稳 |
| `maxComments` / `maxCommentPages` | 不限 | 一级评论条数 / 页数上限 |
| `maxReplies` / `maxReplyPages` | 不限 | 每条一级评论的楼中楼条数 / 页数上限 |
| `maxReposts` / `maxRepostPages` | 不限 | 转发条数 / 页数上限 |
| `concurrency` | `6` | 全局补全并发，上限 16 |
| `store` | 内存 | 持久化端口，见下 |
| `signal` | — | `AbortSignal`；中止后按未完成处理 |

实际 HTTP 速率仍由 SDK 的令牌桶控制（`new WeiboSDK({ delay, maxConcurrent })`），`concurrency` 只决定同时排队的补全数。

### 断点续跑与 store 端口

SDK 核心不碰文件系统。续跑状态由 `UserArchiveStore` 承载：

```ts
export interface UserArchiveStore {
  loadMeta(): Promise<UserArchiveMeta | undefined>
  saveMeta(meta: UserArchiveMeta): Promise<void>
  loadSlices(): Promise<UserArchiveSliceState[]>
  loadRecords(slice?: string): Promise<UserArchiveRecord[]>
  appendRecord(entry: UserArchiveRecord): Promise<void>
  saveCheckpoint(slice: UserArchiveSlice, checkpoint: ArchiveCheckpoint): Promise<void>
  markSliceDone(slice: UserArchiveSlice): Promise<void>
  appendIssue(issue: ArchiveIssue, slice?: UserArchiveSlice): Promise<void>
  loadIssues(): Promise<ArchiveIssue[]>
  clear(): Promise<void>
}
```

默认是 `createMemoryUserArchiveStore()`（一次运行有效）。下游可以按自己的存储实现：IndexedDB、SQLite、对象存储都可以，不需要理解 journal 格式。CLI 用文件实现，见下。

```ts
import { createMemoryUserArchiveStore } from '@chilfish/weibo-sdk' // 仅作示例；也可自行实现

const store = createMemoryUserArchiveStore()
await sdk.userArchive.run(uid, { ...options, store })
```

续跑时**省略的参数沿用 journal**（包括第一次运行时解析出的 `until`、切片天数、内容开关和上限）；显式传入的值必须与第一次一致，否则抛 `InvalidConfigError`。要重来就调用 `store.clear()`（CLI 对应 `--fresh`）。

## CLI

```bash
weibo-cli archive user 1234567890 --since 2025-01-01 --until 2025-12-31
weibo-cli archive user https://weibo.com/u/1234567890 --since 2025-01-01
weibo-cli archive user 1234567890 --since 2025-01-01 --no-comments --reposts
```

`pnpm archive:user ...` 是同一个命令的仓库内快捷方式。

### 参数

| 参数 | 说明 |
|---|---|
| `<uid>` | 数字 uid 或 `https://weibo.com/u/<uid>` 主页链接 |
| `--since` / `--until` | 时间范围，默认 2009-08-14 到现在 |
| `-o, --out` | 输出文件，默认 `./weibo-archive-<uid>.json` |
| `--force` | 覆盖已有的输出 / raw 文件 |
| `--fresh` | 丢弃已有切片进度，从头开始 |
| `--raw` / `--raw-out` | 把上游原始响应单独写进 JSONL，不进入归档 JSON |
| `--no-comments` / `--no-replies` | 不拉评论 / 只拉一级评论 |
| `--comment-order` | `time`（默认）或 `hot` |
| `--max-comments` / `--max-comment-pages` | 一级评论条数 / 页数上限 |
| `--max-replies` / `--max-reply-pages` | 楼中楼条数 / 页数上限 |
| `--reposts` / `--max-reposts` / `--max-repost-pages` | 转发列表与上限 |
| `--slice-days` | 每 n 天一个枚举子任务，默认 30；`0` 不拆分 |
| `--concurrency` | 补全并发，默认 6，上限 16 |
| `--delay` / `--burst` | 令牌桶补充间隔与容量，默认 1000ms / 3 |
| `--log-format` | `pretty` / `ndjson` / `silent`；TTY 默认 pretty，管道 / CI 默认 ndjson |
| `--no-progress` | pretty 下关闭动态状态块，只输出切片完成 / issue / 汇总 |
| `--quiet` | 不输出诊断，等价于 `--log-format silent` |
| `--env-file` / `--dotenv` / `--cookie` | Cookie 来源；默认 `<pwd>/.env` |

### 产出与退出码

运行会在输出文件旁写一组进度文件：

```
weibo-archive-<uid>.json                          最终归档
weibo-archive-<uid>.json.slices/meta.json         切片计划 / 配置 / 用户信息
weibo-archive-<uid>.json.slices/<slice>.journal.jsonl   每个切片的记录 / checkpoint / error / slice-done
weibo-archive-<uid>.json.raw.ndjson               可选的 raw sidecar（--raw）
```

- 完整结束时 `.slices/` 会被删除；存在错误或枚举中止时保留，下次重跑同一命令即可续跑。
- 每个切片独立 journal；进程被杀导致的截断行会在下次读取时丢弃并原子修复。
- stdout 输出一行 JSON 摘要 `{ event: 'done', out, tweets, comments, replies, errors, complete }`；进度、issue、raw 诊断走 stderr。
- stderr 的呈现按终端自动切换：TTY 下是一行原地刷新的状态 + 追加日志，管道 / CI 下是 NDJSON。`--log-format` 显式覆盖，`--no-progress` 关闭动态刷新，`--quiet` 静默。具体规则见 [cli.md 的「终端呈现」](./cli.md#终端呈现archive-user)。
- 退出码：`0` 完整；`1` 枚举中止、存在未补全项或 raw 写入失败。

## 行为细节

- **切片枚举串行**。`searchProfile` 的 `page > 1` 复用会话里最近一次 `page = 1` 的窗口，并发切片会互相覆盖，表现为每个切片只拿到第一页。
- **补全并发**。`statuses/show`、评论、楼中楼、转发是独立请求，按 `concurrency` 走全局窗口；journal 仍按枚举顺序落盘，checkpoint 推进顺序与串行一致。
- **最终合并去重**。同一个 `mblogId` 出现多次时，优先保留 issue 更少的一条；issue 相同保留更晚写入的。归档按发布时间倒序。
- **`complete` 语义**。无致命错误、无主动中止且没有遗留 issue 时为 `true`。
- **raw 不在契约内**。归档 JSON 不含 raw；需要时用 CLI 的 `--raw` / `--raw-out`，或 SDK 的 `config.hooks.onRaw`。
- **访客模式不支持**。访客只有匿名首屏数据，无法承诺完整归档，会报 `CONFIG_INVALID`。

## 相关文档

- 归档 JSON 结构：[archive-schema.md](./archive-schema.md)
- `ITweet` 契约：[contract-itweet-v2.md](./contract-itweet-v2.md)
- 全量镜像与增量同步：[cli.md](./cli.md)
- SDK 错误码：[error-diagnostics.md](./error-diagnostics.md)
