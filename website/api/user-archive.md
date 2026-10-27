---
title: userArchive
outline: deep
---

# userArchive

按时间范围归档一个用户：日期切片枚举 + 逐条重新拉取详情 / 长文 / 评论 / 楼中楼 / 转发，支持续跑。

| 方法 | 返回 |
|---|---|
| `run(uid, options?)` | `Promise<UserArchiveResult>` |
| `stream(uid, options?)` | `AsyncIterableIterator<UserArchiveEvent>` |

访客调用抛 `CONFIG_INVALID`，边界见 [范围与限制](/guide/limitations)。

## `run(uid, options?)`

```ts
const result = await sdk.userArchive.run('1111681197', {
  since: '2026-01-01',
  until: '2026-03-31',
  includeComments: true,
  includeReplies: true,
  maxCommentPages: 2,
  maxReplyPages: 2,
})

result.file        // ArchiveFile（weibo-user-archive/v3）
result.complete
result.summary     // { tweets, comments, replies, errors, complete, estimatedTotal?, coverage? }
result.user
```

## `stream(uid, options?)`

逐事件消费，适合边抓边落盘：

```ts
for await (const event of sdk.userArchive.stream(uid, { store })) {
  switch (event.type) {
    case 'meta':
      await saveMeta(event.meta)
      break
    case 'record':
      await persist(event.entry)
      break
    case 'issue':
      console.warn(event.issue)
      break
    case 'slice-done':
      console.log('slice done', event.slice)
      break
    case 'done':
      console.log(event.summary)
      break
  }
}
```

事件：

| `type` | 载荷 |
|---|---|
| `meta` | `{ meta: UserArchiveMeta }`（切片计划与运行配置） |
| `slice-start` | `{ slice, resumed }` |
| `record` | `{ entry: UserArchiveRecord }` |
| `issue` | `{ slice?, issue: ArchiveIssue }` |
| `slice-done` | `{ slice: string }` |
| `done` | `{ summary: UserArchiveSummary }` |

## 选项 `UserArchiveOptions`

| 选项 | 默认 | 说明 |
|---|---|---|
| `since` / `until` | 2009-08-14 / 现在 | unix 秒、`YYYY-MM-DD` 或 `YYYYMMDD` |
| `sliceDays` | 30 | 每 n 天一个枚举子任务；0 = 不拆分 |
| `includeComments` | true | 拉取并挂载一级评论 |
| `includeReplies` | true | 展开楼中楼 |
| `includeReposts` | false | 拉取转发列表 |
| `commentOrder` | `'time'` | `'time'` / `'hot'` |
| `maxComments` | 不限 | 总评论条数上限 |
| `maxCommentPages` | 2 | 每条微博最多评论页数；0 = 全部 |
| `maxReplies` | 不限 | 总楼中楼条数上限 |
| `maxReplyPages` | 2 | 每条一级评论最多楼中楼页数；0 = 全部 |
| `maxReposts` / `maxRepostPages` | 不限 | 转发上限 |
| `concurrency` | 6（上限 32） | 全局补全并发；实际 QPS 仍受令牌桶控制 |
| `resume` | `'strict'` | `'strict'` 要求配置与 journal 一致；`'merge'` 保留已有记录，按新范围重新枚举 |
| `store` | 内存 | `UserArchiveStore` 持久化端口 |
| `onProgress` | 无 | `UserArchiveProgress` 回调 |
| `onIssue` | 无 | issue 回调 |
| `onRecord` | 无 | 每条记录完成时回调 |
| `signal` | 无 | 中断信号 |

## `UserArchiveStore`

持久化由调用方实现，SDK 通过 `UserArchiveStore` 读写进度：

```ts
interface UserArchiveStore {
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

内置 `createMemoryUserArchiveStore()`，适合测试与小范围运行。

## 续跑语义

- journal 记录每个切片的完成状态与 checkpoint；重跑同一命令即可接着跑。
- 已加载的旧记录计入 `processed`，重跑时跳过。
- 带 issue 的目标保持未完成，下一轮重试。
- 默认 `resume: 'strict'`：本次配置必须与 journal 一致，否则抛 `RESUME_MISMATCH`（`context.mismatch` 指向冲突字段）。
- `resume: 'merge'`：保留已有记录（按 `mblogId`），按本次范围重建切片计划并重新枚举；已完整的记录不再补全。省略的内容选项仍沿用 journal，`since` / `until` 不继承。
- `--fresh` 清空进度重新开始。

## 与全量镜像的区别

| | `archive.streamArchive` | `userArchive.run` |
|---|---|---|
| 枚举方式 | mymblog + 可选日期切片 | 日期切片 |
| 详情 | 时间线简版，可选补详情 | 逐条重新拉详情与长文 |
| 评论 | 可选，挂到 `tweet.comments` | 默认补一级评论 + 楼中楼 |
| 输出 | `ArchiveItem` 流 | 单个 `ArchiveFile` |
| 用途 | 全量镜像 / 增量同步 | 指定时间段深度归档 |

## CLI

```bash
weibo-cli archive user 1111681197 --since 2026-01-01 --until 2026-03-31 -o ./weibo-archive.json
weibo-cli archive user 1111681197 --since 2026-04-01 --until 2026-06-30 -o ./weibo-archive.json --merge
weibo-cli archive user 1111681197 --all-comments --all-replies
weibo-cli archive user 1111681197 --fresh
```
