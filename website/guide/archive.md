---
title: 归档账号
---

# 归档账号

归档有三条路径，语义不同：

| 入口 | 用途 | 输出 |
|---|---|---|
| `sdk.archive.streamArchive(uid)` | 全量镜像流：时间线、转发、收藏、点赞、历史评论、图片墙、视频 | `ArchiveItem` 流，带 checkpoint |
| `sdk.userArchive.run/stream(uid)` | 指定时间段 + 深度补全（详情 / 长文 / 评论 / 楼中楼 / 转发） | `ArchiveFile` 或事件流 |
| `mergeArchiveFiles(files)` | 合并同一账号的多份归档 | 新的 `ArchiveFile` |

## 全量镜像流

```ts
for await (const item of sdk.archive.streamArchive('1111681197', {
  includeReposts: true,
  includeFavorites: true,
  includeLikes: true,
  includeCommentHistory: true,
  includeImages: true,
  includeVideos: true,
  concurrency: 3,
})) {
  if (item.tweet) await persist(item.tweet)
  if (item.asset) await saveMedia(item.asset)
  await saveCheckpoint(item.checkpoint)
}
```

`item.source` 可能是 `timeline`、`repost`、`favorite`、`like`、`comment`、`image`、`video`。图片项可能没有 `tweet`，只有 `asset`。

### 续跑语义

- **at-least-once**：`checkpoint` 记录最后一条已完整处理的项；中断后重跑可能重复边界 1 条。
- 图片墙 / 视频瀑布按整页写回游标，续跑会重放整页。
- 消费端按 `mblogId`（媒体按 `asset.id`）幂等去重。

```ts
let checkpoint = await loadCheckpoint() // 上次保存的值；首次为 undefined

for await (const item of sdk.archive.streamArchive(uid, { checkpoint })) {
  await persist(item)
  checkpoint = item.checkpoint
  await saveCheckpoint(checkpoint)
}
```

### 账号级数据

`includeFavorites` 与 `includeCommentHistory` 只读取 Cookie 对应的登录账号；归档其他 uid 会抛 `CONFIG_INVALID`。`includeLikes` 按目标 uid 读取。

### 首页并发

页内请求默认并发预取（评论链 / 转发首页，`concurrency: 3`，范围 1–8）。分页、产出顺序与 checkpoint 不变；`concurrency: 1` 回到完全串行。

## 范围归档

```ts
const result = await sdk.userArchive.run('1111681197', {
  since: '2026-01-01',
  until: '2026-03-31',
  sliceDays: 30,
  includeComments: true,   // 默认 true
  includeReplies: true,    // 默认 true
  includeReposts: false,
  commentOrder: 'time',
  maxCommentPages: 2,      // 每条微博最多 2 页；0 = 全部
  maxReplyPages: 2,
  concurrency: 20,
})

result.file       // ArchiveFile（weibo-user-archive/v2）
result.complete
result.summary    // tweets / comments / replies / errors / coverage
```

流式消费：

```ts
for await (const event of sdk.userArchive.stream(uid, { store })) {
  if (event.type === 'record') await persist(event.entry)
  if (event.type === 'issue') console.warn(event.issue)
  if (event.type === 'done') console.log(event.summary)
}
```

事件类型：`meta` / `slice-start` / `record` / `issue` / `slice-done` / `done`。

### Store 端口

SDK 不碰文件系统。要续跑就实现 `UserArchiveStore`（内存 / IndexedDB / SQLite / S3 均可）：

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

内置 `createMemoryUserArchiveStore()` 便于测试。

## 合并归档

```ts
import { mergeArchiveFiles } from '@chilfish/weibo-sdk'

const { file } = mergeArchiveFiles([older, newer])
```

规则：

- 同一 `mblogId` 保留信息更全的微博本体；
- 评论 / 楼中楼 / 转发按 id 取并集；
- `query.range` 合并为覆盖包络（中间可能有空洞）；
- `stats` / `complete` 重新计算；
- 已解决的 issue 不会永久残留。

## CLI

```bash
# 全量镜像（NDJSON，带状态文件续跑）
weibo-cli archive 1111681197 --state .weibo-archive-state.json

# 多账号
weibo-cli archive --uid-file uids.txt --state .weibo-archive-state.json

# 范围归档
weibo-cli archive user 1111681197 --since 2026-01-01 --until 2026-03-31 -o ./weibo-archive.json

# 增量并回同一份文件
weibo-cli archive user 1111681197 --since 2026-04-01 --until 2026-06-30 -o ./weibo-archive.json --merge

# 合并已有归档
weibo-cli archive merge a.json b.json -o ./merged.json
```
