---
title: users
outline: deep
---

# users

用户资料、@ 我的微博、关注分组与微博分组。

| 方法 | 返回 | 分页 | 访客 |
|---|---|---|---|
| `fetchRawInfo(id)` | `UserInfoResponse` | - | 可用 |
| `fetchRawDetails(id)` | `UserDetailsResponse` | - | 可用 |
| `fetchRawMyDetails()` | `UserDetailsResponse` | - | 需 Cookie |
| `myDetails()` | `ISelfProfile` | - | 需 Cookie |
| `getById(id)` | `IUser` | - | 可用 |
| `listMentions(options?)` | `UserMentionsPageResult` | `maxId` / `page` | 需 Cookie |
| `streamMentions(options?)` | `ITweet` 流 | `maxId` | 需 Cookie |
| `groups()` | `UserGroup[]` | - | 可用 |
| `mblogGroups()` | `MblogGroup[]` | - | 需 Cookie |

访客可读取用户资料；账号级方法需要 Cookie，边界见 [访客限制](/guide/limitations)。

## `fetchRawInfo(id)`

返回上游原始响应；需要归一化字段时用 `getById`。字段为 snake_case 上游形状。

```ts
const raw = await sdk.users.fetchRawInfo('1111681197')
raw.data.user.screen_name
```

## `fetchRawDetails(id)`

返回上游 `ajax/profile/detail` 原始响应；需要归一化字段时用 `getById`。响应含简介、生日、公司、学校、标签等。

## `myDetails()`

不带 uid，读取当前登录用户详情，会话自检也走它。内部以 `skipPreflight` 发出，避免递归自检。

返回归一化的 `ISelfProfile`：

```ts
const profile = await sdk.users.myDetails()
profile.uid          // 从 verified_url 解析
profile.ipLocation
profile.labelDesc
```

该端点只返回详情侧字段（IP 属地 / 教育 / 公司 / 标签等），不含昵称、头像与计数；完整资料用 `getById(profile.uid)`。需要上游原始响应时用 `fetchRawMyDetails()`。

- 错误：`AUTH_SESSION_EXPIRED`、`API_NOT_OK`、`API_BAD_RESPONSE`、传输层错误。

## `getById(id)`

并行请求 `fetchRawInfo` 与 `fetchRawDetails`，归一化为 `IUser`：

```ts
const user = await sdk.users.getById('1111681197')
user.name
user.stats.followers
user.verification.type
```

缺失字段保留 `undefined`。任一请求失败即整体失败。

返回字段见 [领域模型](/api/types/domain#iuser)。

## `listMentions(options?)`

读取一页 `@我的微博`（`ajax/statuses/mentions`）。`maxId`（上游 `max_id`）优先于 `page`；上游忽略 `since_id`。

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

读取微博分组（`ajax/mblog/querygroup` 的 `join_groups`），无参数时返回当前账号加入的分组。

## CLI

```bash
weibo-cli user info 1111681197
weibo-cli user timeline 1111681197
weibo-cli user mentions --max-pages 2
weibo-cli user mentions-stream --max-pages 2
weibo-cli user groups
weibo-cli user mblog-groups
```
