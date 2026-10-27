---
title: 归档与续跑类型
outline: deep
---

# 归档与续跑类型

## `ArchiveFile`（`weibo-user-archive/v3`）

范围归档 `userArchive.run()` 的输出，也是归档 JSON 的顶层信封。

| 字段 | 类型 | 说明 |
|---|---|---|
| `$schema` | `string` | JSON Schema 地址 |
| `schema` | `string` | 格式标识 `weibo-user-archive/v3` |
| `generatedAt` | `string` | 生成时间 |
| `complete` | `boolean` | 枚举未中止且无遗留 issue |
| `query` | `object` | `uid`、`range`（since / until 的 input / unix / iso）、内容开关、评论排序 |
| `user` | `IUser` | 目标用户 |
| `stats` | `{ tweets, comments, replies, errors }` | 统计 |
| `tweets` | `ArchivedTweet[]` | 微博记录 |
| `errors` | `ArchiveIssue[]` | 未解决错误 |

相关常量：`ARCHIVE_SCHEMA_ID`、`ARCHIVE_SCHEMA_URL`。

## `ArchivedTweet`

| 字段 | 类型 | 说明 |
|---|---|---|
| `mblogId` | `string` | 微博 id |
| `source` | `'timeline'` | 来源 |
| `tweet` | `ITweet` | 归一化微博（长文已展开） |
| `comments` | `ITweetComment[]` | 一级评论；楼中楼在 `comment.replies` |
| `reposts` | `ITweet[]?` | 开启 `includeReposts` 时的转发列表 |

## `ArchiveIssue`

| 字段 | 类型 | 说明 |
|---|---|---|
| `stage` | `ArchiveIssueStage` | `timeline` / `detail` / `comments` / `replies` / `reposts` |
| `mblogId` / `commentId` | `string?` | 关联对象 |
| `code` / `level` / `retryable` | — | 结构化错误信息 |
| `message` | `string` | 可读说明 |
| `context` | `object?` | 排障上下文 |

## 合并

`mergeArchiveFiles(files)` 返回 `MergeArchiveResult`：

| 字段 | 说明 |
|---|---|
| `file` | 合并后的 `ArchiveFile` |
| `merged` | 合并统计（新增 / 去重 / issue 解决） |

`MergeArchiveOptions` 控制输出与跳过策略。

## 续跑类型

`USER_ARCHIVE_JOURNAL_SCHEMA = 'weibo-user-archive-journal/v2'`。

| 类型 | 用途 |
|---|---|
| `UserArchiveMeta` | 运行配置 + 切片计划 + 用户 + 各切片总数 |
| `UserArchiveSlice` | `{ index, key, since, until }` |
| `UserArchiveSliceState` | 切片是否完成 + checkpoint |
| `UserArchiveRecord` | 一条补全记录：`slice` / `mblogId` / `record` / `issues` / `checkpoint?` |
| `UserArchiveRunConfig` | 续跑时校验参数一致性 |
| `UserArchiveContentOptions` | 内容开关快照 |
| `UserArchiveStore` | 持久化端口（load/save/append/markDone/clear） |
| `UserArchiveEvent` | `meta` / `slice-start` / `record` / `issue` / `slice-done` / `done` |
| `UserArchiveProgress` | 切片级进度 |
| `UserArchiveSummary` | 最终统计与覆盖率 |
| `UserArchiveResult` | `{ file, complete, summary, user }` |

字段细节见 [userArchive](/api/user-archive)。
