---
title: users
outline: deep
---

# users

用户资料、@ 我的微博、关注分组与微博分组。

| 方法 | 返回 | 分页 | 访客 | 稳定性 |
|---|---|---|---|---|
| `fetchRawInfo(id)` | `UserInfoResponse` | — | 可用 | 实验性 |
| `fetchRawDetails(id)` | `UserDetailsResponse` | — | 可用 | 实验性 |
| `myDetails()` | `UserDetailsResponse` | — | 需 Cookie | 稳定 |
| `getById(id)` | `IUser` | — | 可用 | 稳定 |
| `listMentions(options?)` | `UserMentionsPageResult` | `maxId` / `page` | 需 Cookie | 稳定 |
| `streamMentions(options?)` | `ITweet` 流 | `maxId` | 需 Cookie | 稳定 |
| `groups()` | `UserGroup[]` | — | 可用 | 稳定 |
| `mblogGroups()` | `MblogGroup[]` | — | 需 Cookie | 稳定 |

## `fetchRawInfo(id)`

拉取 `ajax/profile/info` 原始响应。字段为 snake_case 上游形状，可能随上游漂移；日常读取请用 `getById`。

```ts
const raw = await sdk.users.fetchRawInfo('1111681197')
raw.data.user.screen_name
```

## `fetchRawDetails(id)`

拉取 `ajax/profile/detail` 原始响应（含简介、生日、公司、学校、标签等）。

## `myDetails()`

不带 uid，读取当前登录用户详情，常用于会话自检。内部 `skipPreflight` 发出，避免递归自检。

- 错误：`AUTH_SESSION_EXPIRED`、`API_NOT_OK`、`API_BAD_RESPONSE`、传输层错误。

## `getById(id)`

并行请求 `fetchRawInfo` 与 `fetchRawDetails`，归一化为 `IUser`：

```ts
const user = await sdk.users.getById('1111681197')
user.name
user.stats.followers
user.verification.type
```

缺失字段保持 `undefined`，不伪造默认值。任一请求失败即整体失败。

返回字段见 [领域模型](/api/types/domain#iuser)。

## `listMentions(options?)`

读取一页 `@我的微博`（`ajax/statuses/mentions`）。`maxId`（上游 `max_id`）优先于 `page`；`since_id` 被上游忽略。

| 选项 | 类型 | 说明 |
|---|---|---|
| `maxId` | `number \| string` | 上一页的 `cursor` |
| `page` | `number` | 页码，未给 `maxId` 时生效 |

返回 `{ cursor, hasMore, total?, tweets: ITweet[] }`，本页已按 `mblogId` 去重。

## `streamMentions(options?)`

```ts
for await (const tweet of sdk.users.streamMentions({ maxPages: 3, since: '2026-01-01' })) {
  console.log(tweet.mblogId, tweet.text)
}
```

选项：`maxId`、`page`、`maxPages`、`maxItems`、`since`、`until`、`onProgress`。

停止条件：`next_cursor === 0`、空页、游标不前进、整页重复、日期边界、`maxPages` / `maxItems`。

## `groups()`

读取关注分组（`ajax/feed/allGroups`），拍平后保留 `category`：

```ts
const groups = await sdk.users.groups()
// [{ id, name, category }, ...]
```

## `mblogGroups()`

读取微博分组（`ajax/mblog/querygroup` 的 `join_groups`），无参数即当前账号加入的分组。

## CLI

```bash
weibo-cli user info 1111681197
weibo-cli user timeline 1111681197
weibo-cli user mentions --max-pages 2
weibo-cli user mentions-stream --max-pages 2
weibo-cli user groups
weibo-cli user mblog-groups
```
