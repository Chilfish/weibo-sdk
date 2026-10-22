---
title: archive
outline: deep
---

# archive

全量镜像一个账号：时间线、转发、收藏、点赞、历史评论、图片墙、视频。产出 `ArchiveItem` 流，带 checkpoint。

| 方法 | 返回 | 访客 | 稳定性 |
|---|---|---|---|
| `streamArchive(uid, options?)` | `AsyncIterableIterator<ArchiveItem>` | 不可用（`CONFIG_INVALID`） | 稳定 |
| `streamUsersArchive(uids, options?)` | `AsyncIterableIterator<ArchiveUserItem>` | 不可用 | 稳定 |

## `streamArchive(uid, options?)`

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
  if (item.comment) await persistComment(item.comment)
  await saveCheckpoint(item.checkpoint)
}
```

### `ArchiveItem`

| 字段 | 类型 | 说明 |
|---|---|---|
| `schemaVersion` | `TweetContractVersion` | `ITweet` 契约版本（当前 `2`） |
| `source` | `'timeline' \| 'repost' \| 'favorite' \| 'like' \| 'comment' \| 'image' \| 'video'` | 条目来源 |
| `mblogId` | `string?` | 微博字母 id；图片项可能缺省 |
| `tweet` | `ITweet?` | 归一化微博；`source: 'image'` 时缺省 |
| `asset` | `IUserMediaAsset?` | 图片 / 视频项 |
| `comment` | `ITweetComment?` | `source: 'comment'` 时的历史评论 |
| `schemaDigest` | `unknown` | raw 结构快照，用于检测上游字段漂移 |
| `checkpoint` | `ArchiveCheckpoint` | 保存它即可续跑 |

### 续跑

- **at-least-once**：checkpoint 记录最后一条已完整处理的项，中断后可能重复边界 1 条。
- 图片墙 / 视频瀑布按整页写回游标，续跑会重放整页。
- 消费端按 `mblogId` / `asset.id` 幂等去重。

```ts
let checkpoint = await loadCheckpoint()

for await (const item of sdk.archive.streamArchive(uid, { checkpoint })) {
  await persist(item)
  checkpoint = item.checkpoint
  await saveCheckpoint(checkpoint)
}
```

### 选项

| 选项 | 默认 | 说明 |
|---|---|---|
| `includeReposts` | true | 归档每条微博的转发 |
| `includeFavorites` | true | 收藏（账号级） |
| `includeLikes` | false | 我赞过的微博（按目标 uid） |
| `includeCommentHistory` | false | 历史评论（账号级） |
| `includeImages` | false | 图片墙（`item.asset`，可能无 `tweet`） |
| `includeVideos` | false | 视频瀑布（同时有 `tweet` 与 `asset`） |
| `count` | 20 | timeline 每页条数 |
| `maxPagesPerPhase` | 不限 | 每阶段最多翻页数 |
| `concurrency` | 3 | 页内预取并发，clamp 1–8；`1` 完全串行 |
| `checkpoint` | — | 断点续传 |
| `onRaw` | — | 归一化前回调 raw（`ArchiveItem` 不含 raw） |
| `timelineSource` | `'mymblog'` | `'mymblog'` 翻到底 + 日期切片；`'search'` 直接日期切片 |
| `includeDateSlices` | true | mymblog 翻到底后用 searchProfile 补齐 |
| `since` / `until` | 微博上线日 / 现在 | 日期切片边界（unix 秒） |
| `searchQuery` | — | 日期切片内的关键词过滤 |
| `sliceWindow` | 30 天 | 自适应切片初始窗口（秒） |
| `maxSliceItems` | 800 | 单切片最多条数，超过则对半缩小窗口 |
| `includeComments` | false | 拉取并挂载评论到 `tweet.comments` |
| `maxCommentPagesPerTweet` | 不限 | 每条微博最多评论页数 |
| `commentCount` | 20 | 评论每页条数 |
| `onProgress` | — | `ArchiveProgress` 回调 |
| `onItemError` | — | 返回 `abort` / `skip` / `retry` |
| `repostErrorPolicy` | `skip` | 转发页失败策略 |
| `commentsErrorPolicy` | `skip` | 评论失败策略 |
| `likesErrorPolicy` | `abort` | 点赞页失败策略 |
| `commentHistoryErrorPolicy` | `abort` | 历史评论失败策略 |
| `imagesErrorPolicy` | `abort` | 图片墙失败策略 |
| `videosErrorPolicy` | `abort` | 视频瀑布失败策略 |
| `incremental` | — | 增量：`since` / `stopAtMblogId` / `skipPinned` |
| `originalOnly` | false | 只归档原创，跳过内联转发 |
| `maxRetries` | 1 | 可重试错误的最大重试次数 |
| `retryDelayMs` | 0 | 重试间隔 |

### `ArchiveCheckpoint`

| 字段 | 说明 |
|---|---|
| `uid` | 归档用户 |
| `phase` | `timeline` / `likes` / `comments` / `favorites` / `images` / `videos` / `done` |
| `page` | mymblog 当前页（恢复时重跑该页） |
| `lastTimelineMblogId` | 已完整处理的最后一条微博 |
| `favoritesPage` / `likesPage` | 收藏 / 点赞当前页 |
| `imagesCursor` / `videosCursor` | 媒体下一页游标 |
| `commentHistoryCursor` | 历史评论 `max_id` |
| `sliceEnd` / `slicePage` / `sliceWindow` | 日期切片游标（存在 `sliceEnd` 即处于切片阶段） |

## `streamUsersArchive(uids, options?)`

串行归档多个 uid，按用户注入 checkpoint / 增量：

```ts
for await (const { uid, item } of sdk.archive.streamUsersArchive(['111', '222'], {
  includeLikes: true,
  getCheckpoint: uid => state[uid],
  getIncremental: uid => ({ stopAtMblogId: lastSeen[uid], skipPinned: true }),
  onUserStart: uid => console.log('start', uid),
  onUserDone: (uid, count) => console.log('done', uid, count),
  onUserError: (uid, error) => 'skip',
})) {
  await persist(uid, item)
}
```

在单账号选项基础上增加：`getCheckpoint`、`getIncremental`、`onUserStart`、`onUserDone`、`onUserError`（默认 `abort`）。

## 行为与边界

- 访客调用抛 `CONFIG_INVALID`：匿名列表只有第一页，无法保证完整。
- `includeFavorites` / `includeCommentHistory` 只对登录账号有效；归档他人会抛 `CONFIG_INVALID`。
- `timelineSource: 'search'` 但未注入 `searchByDate` 时，首次迭代抛 `CONFIG_INVALID`。
- 日期切片串行枚举：`searchProfile` 的 `page > 1` 复用最近一次 `page=1` 的窗口，并发会互相覆盖。

## CLI

```bash
weibo-cli archive <uid> --state .weibo-archive-state.json
weibo-cli archive --uid-file uids.txt --state .weibo-archive-state.json
weibo-cli archive <uid> --likes --comment-history --images --videos
```
