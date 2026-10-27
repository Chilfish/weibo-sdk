---
title: 范围归档
outline: deep
---

# 用户范围归档（`sdk.userArchive` / `weibo-cli archive user`）

用户范围归档把一个账号在指定时间范围内发布的微博、评论、楼中楼和转发补全后写进一个 JSON 文件，中断后可以接着跑。

两种归档方式的分工：

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

`since` / `until` 接受 `YYYY-MM-DD`、`YYYYMMDD` 或 unix 秒，默认范围是 2009-08-14 到现在。

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

运行期失败转成 `issue` 事件后继续。`AUTH_SESSION_EXPIRED`、`CONFIG_INVALID`、`RATE_LIMITED` 会停止后续切片，已产出的记录和 `done` 事件仍然保留。配置错误在第一次迭代前抛 `CONFIG_INVALID`。

### 选项

| 选项 | 默认 | 说明 |
|---|---|---|
| `since` / `until` | 2009-08-14 / 现在 | 时间范围，含边界 |
| `sliceDays` | `30` | 每 n 天一个枚举子任务；`0` 表示不拆分 |
| `includeComments` | `true` | 拉取一级评论 |
| `includeReplies` | `true` | 展开楼中楼 |
| `includeReposts` | `false` | 拉取转发列表 |
| `commentOrder` | `'time'` | `time` 按数字 mid 翻页，完整遍历更稳 |
| `maxComments` / `maxCommentPages` | 不限 / `2` | 一级评论条数 / 页数上限；页数 `0` 表示全部 |
| `maxReplies` / `maxReplyPages` | 不限 / `2` | 每条一级评论的楼中楼条数 / 页数上限；页数 `0` 表示全部 |
| `maxReposts` / `maxRepostPages` | 不限 | 转发条数 / 页数上限 |
| `concurrency` | `6` | 全局补全并发，上限 32；CLI 默认 20 |
| `resume` | `'strict'` | `strict` 要求配置与 journal 一致；`merge` 保留已有记录，按新范围重新枚举 |
| `store` | 内存 | 持久化端口，见下 |
| `signal` | 无 | `AbortSignal`；中止后按未完成处理 |

实际 HTTP 速率由 SDK 的令牌桶控制（`new WeiboSDK({ delay, burst })`），`concurrency` 决定同时排队的补全数。CLI 的 `archive user` 默认用 `concurrency=20`、`delay=300`、`burst=8`，`--delay` / `--burst` 是吞吐的主要旋钮。

### 断点续跑与 store 端口

续跑状态由 `UserArchiveStore` 承载，SDK 把读写交给调用方：

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

默认实现是 `createMemoryUserArchiveStore()`，只在一次运行内有效。下游可以按自己的存储实现 IndexedDB、SQLite、对象存储，实现上述接口即可。journal 格式属于 CLI 文件实现的内部细节。

```ts
import { createMemoryUserArchiveStore } from '@chilfish/weibo-sdk' // 仅作示例；也可自行实现

const store = createMemoryUserArchiveStore()
await sdk.userArchive.run(uid, { ...options, store })
```

续跑有两种模式：

| `resume` | 语义 |
|---|---|
| `'strict'`（默认） | 本次配置必须与 journal 一致。省略的参数沿用 journal（含第一次解析出的 `until`、切片天数、内容开关和上限）；显式值不同则抛 `RESUME_MISMATCH`（`ResumeMismatchError`，`context.mismatch` 指向冲突字段） |
| `'merge'` | 保留 store 里已有的记录（按 `mblogId`），按本次范围重建切片计划并重新枚举。已经完整的记录不再发起补全；省略的内容选项 / 切片天数仍沿用 journal，但 `since` / `until` 不继承，缺省按正常默认值解析 |

`merge` 适合「相对范围每次重算」的调用方（例如「最近 30 天」按当天日期计算）：

```ts
// 第一次
await sdk.userArchive.run(uid, { since: '2026-09-01', store })
// 隔天，只补新范围；旧记录保留
await sdk.userArchive.run(uid, { since: '2026-09-02', resume: 'merge', store })
```

`merge` 依赖 `store.loadRecords()` 返回全部已有记录；自定义 store 不要按当前 `meta.slices` 过滤记录，否则重建切片计划后旧记录会读不到。范围外的旧数据会保留在最终归档里，`query.range` 仍是本次范围。

要完全重来就调用 `store.clear()`，CLI 对应 `--fresh`。如果 store 同时承载产品库（时间线、互动、媒体路径等），建议让 `clear()` 只清 journal（`meta` / 切片状态 / checkpoint），产品数据另存；或者直接用 `resume: 'merge'` 避免清理。

## CLI

```bash
weibo-cli archive user 1234567890 --since 2025-01-01 --until 2025-12-31
weibo-cli archive user https://weibo.com/u/1234567890 --since 2025-01-01
weibo-cli archive user 1234567890 --since 2025-01-01 --no-comments --reposts

# 上次进度还在，但范围变了：保留已有记录，按新范围重新枚举
weibo-cli archive user 1234567890 --since 2025-01-02 --resume merge
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
| `--resume` | `strict`（默认）或 `merge`；`merge` 保留已有记录，按新范围重新枚举 |
| `--raw` / `--raw-out` | 把上游原始响应单独写进 JSONL，归档 JSON 只保留归一化字段 |
| `--no-comments` / `--no-replies` | 关闭评论 / 只拉一级评论 |
| `--comment-order` | `time`（默认）或 `hot` |
| `--max-comments` / `--max-comment-pages` | 一级评论条数 / 页数上限；页数默认 2，`0` 表示全部 |
| `--all-comments` | 拉取全部评论页，等价于 `--max-comment-pages 0` |
| `--max-replies` / `--max-reply-pages` | 楼中楼条数 / 页数上限；页数默认 2，`0` 表示全部 |
| `--all-replies` | 拉取全部楼中楼页，等价于 `--max-reply-pages 0` |
| `--reposts` / `--max-reposts` / `--max-repost-pages` | 转发列表与上限 |
| `--slice-days` | 每 n 天一个枚举子任务，默认 30；`0` 表示不拆分 |
| `--concurrency` | 补全并发；SDK 默认 6，CLI 默认 20，上限 32 |
| `--fast` | 激进预设：`concurrency 32`、`delay 100ms`、`burst 16`；显式参数优先 |
| `--delay` / `--burst` | 令牌桶补充间隔与容量；CLI 默认 300ms / 8，SDK 默认 1000ms / 3 |
| `--log-format` | `pretty` / `ndjson` / `silent`；TTY 默认 pretty，管道 / CI 默认 ndjson |
| `--no-progress` | pretty 下关闭动态状态行，只输出切片完成 / issue / 汇总 |
| `--quiet` | 不输出诊断，等价于 `--log-format silent` |
| `--env-file` / `--dotenv` / `--cookie` | Cookie 来源；默认 `<pwd>/.env` |

### 产出与退出码

运行在输出文件旁写一组进度文件：

```
weibo-archive-<uid>.json                          最终归档
weibo-archive-<uid>.json.slices/meta.json         切片计划 / 配置 / 用户信息
weibo-archive-<uid>.json.slices/<slice>.journal.jsonl   每个切片的记录 / checkpoint / error / slice-done
weibo-archive-<uid>.json.raw.ndjson               可选的 raw sidecar（--raw）
```

- 完整结束时 `.slices/` 会被删除；存在错误或枚举中止时保留，下次重跑同一命令即可续跑。
- 每个切片一个 journal；进程被杀造成的截断行在下次读取时丢弃并原子修复。
- stdout 输出一行 JSON 摘要 `{ event: 'done', out, tweets, comments, replies, errors, complete }`；进度、issue、raw 诊断走 stderr。
- stderr 的呈现按终端自动切换：TTY 下是一行原地刷新的状态加追加日志，管道 / CI 下是 NDJSON。`--log-format` 显式覆盖，`--no-progress` 关闭动态刷新，`--quiet` 静默。具体规则见 [CLI 的「终端呈现」](/cli/#终端呈现-archive-user)。
- 退出码：`0` 完整；`1` 枚举中止、存在未补全项或 raw 写入失败。

## 合并归档

增量归档的常见做法是先跑一次较大的范围，之后每次只抓新增的一段。每次运行都产出一份完整的 `ArchiveFile`，合并可以放在文件层：

```ts
import { mergeArchiveFiles } from '@chilfish/weibo-sdk'

const { file, deduped } = mergeArchiveFiles([older, newer])
await writeFile('weibo-archive.json', JSON.stringify(file, null, 2))
```

`archive user` 也能完成这件事：输出文件已存在时加 `--merge`，它把旧文件当作基线，跑完再合并写回。

```bash
# 第一次：指定范围，正常产出
weibo-cli archive user 1111681197 --since 2025-01-01 --until 2025-12-31 -o ./weibo-archive.json

# 之后：只抓新的一段，结果合并进同一个文件
weibo-cli archive user 1111681197 --since 2026-01-01 --until 2026-03-31 -o ./weibo-archive.json --merge
```

两份归档各自独立时用 `archive merge`：

```bash
weibo-cli archive merge ./weibo-archive-2025.json ./weibo-archive-2026.json -o ./weibo-archive.json
weibo-cli archive merge a.json b.json -o a.json --force   # 原地合并
weibo-cli archive merge ./archives -o ./weibo-archive.json          # 合并目录下所有合法归档
weibo-cli archive merge ./archives ./extra.json -o ./merged.json     # 目录与显式文件混用
```

输入可以是目录：只扫描目录顶层的 `*.json`，逐份校验后把可合并的 `weibo-user-archive/v3` 文件（旧 `weibo-user-archive/v2` 文件并入前迁移到 v3）纳入合并，其余文件跳过并在 stderr 打印原因。`--out` 指向目录内的文件时会被排除；目录与显式路径重复时按绝对路径去重。显式文件按严格语义处理，不存在或格式不合法时命令直接失败。单份合法但 uid 不同仍然抛 `CONFIG_INVALID`。目录展开后不足两份有效归档时报错。

合并规则：

| 部分 | 规则 |
|---|---|
| 微博本体 | 同一个 `mblogId` 保留 issue 更少的一份；issue 相同时取媒体更多、正文更长、`generatedAt` 更新的一份 |
| `comments` / `replies` | 按 id 并集；重复项保留楼中楼更多的一份，顺序沿用基准归档 |
| `reposts` | 按 `mblogId` 并集 |
| `query.range` | 取覆盖包络：最早的 `since`、最晚的 `until` |
| `query.include*` | 取交集：所有输入都开启时才为 `true` |
| `query.estimatedTotal` | 合并结果省略该字段；不同区间的总数相加会因重叠翻倍，取最大值也不成立 |
| `errors` | 去重后保留；某个 `mblogId` 已在另一份归档里完整拿到时，视为已解决 |
| `stats` / `complete` | 按合并结果重新计算 |

合并只接受同一 uid 的 `weibo-user-archive/v3` 文件（旧 `weibo-user-archive/v2` 输入先把记录迁移到 v3，输出恒为 v3），其他情况抛 `CONFIG_INVALID`。`query.range` 是覆盖包络，区间可能不连续：两次归档之间跳过的一段在合并结果中缺失。合并幂等，同一份归档重复合并结果不变（`generatedAt` 除外）。

## 总数、进度与并发

`searchProfile` 返回的 `total` 是当前日期窗口的条数。每个切片第一次拿到 `total` 时写入 `meta.totals`，并通过 `UserArchiveProgress.overallTotal` 暴露为已发现切片的总数之和。多切片时这个数字逐步逼近最终值；单切片（`sliceDays: 0`）就是该范围的完整总数。

`sdk.userArchive.run()` 的 `summary.estimatedTotal` / `summary.coverage` 是实际归档条数与上游总数的对照，CLI 的 `done` 摘要也带这两个字段。`complete` 为 `true` 表示枚举完整结束、没有主动中止且没有遗留 issue。上游 `total` 可能包含已删除、不可见或受权限限制的内容，差异属于正常情况。归档 JSON 把总数留在 `<out>.slices/meta.json` 和运行结果里。

并发模型：

- 每个切片内最多 `concurrency` 条微博同时补全；一页 20 条时可以全部进入窗口。
- 单条微博内部，`enrich`、评论、转发同时发出；楼中楼在评论拿到后按小并发展开。
- 分页严格串行，评论、转发、`searchProfile` 的游标按顺序推进。
- 实际 HTTP 并发受 `--burst` 限制，QPS 受 `--delay` 限制；命中 432 会全局暂停并重试。

`tweet.stats.comments === 0` 时 SDK 跳过评论请求，`tweet.stats.reposts === 0` 时跳过转发请求。

高互动微博会拖慢整个任务，评论与楼中楼因此默认各翻 2 页。需要完整评论区时加 `--all-comments` / `--all-replies`（或 `--max-comment-pages 0` / `--max-reply-pages 0`）。条数上限 `--max-comments` / `--max-replies` 同时生效，两个条件先到先停。

## 吞吐建议

CLI 默认 `concurrency=20`、`delay=300`、`burst=8`，稳态约 3 req/s；`--fast` 提高到 `32 / 100 / 16`，稳态约 10 req/s。

一条微博至少一次 `statuses/show`，再加上评论、转发、`searchProfile` 分页。

大账号（几万条）的处理建议：

- 按 1 到 3 个月拆成多个范围，每次输出独立文件；`--fast` 跑完后再用 `archive merge` 或在后一次加 `--merge` 合并。
- 同一个 Cookie 并发归档会互相覆盖 `searchProfile` 的窗口，按时间段串行拆分更稳。
- 命中 432 时 SDK 全局暂停并重试；`--fast` 更容易触发，日志频繁出现 `rate limited` 时退回默认档或调大 `--delay`。

详情请求始终执行。真实对比 `searchProfile` 列表项与 `statuses/show`，即使 `isLongText=false`，也可能差 `stats.reads`、`title`、`user`、`retweetedStatus` 等字段。评论和转发可以在 `stats` 为 0 时跳过。

## 相关文档

- 归档 JSON 结构：[归档格式](/reference/archive-format)
- `ITweet` 契约：[ITweet 契约](/reference/tweet-contract)
- 全量镜像与增量同步：[CLI 参考](/cli/)
- SDK 错误码：[故障排查](/reference/troubleshooting)
