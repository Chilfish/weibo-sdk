---
title: 领域模型
outline: deep
---

# 领域模型

SDK 的公开读取方法返回这些模型。`ITweet` 与 `ITweetComment` 的字段由契约版本管理，完整字段与变更规则见 [ITweet 契约](/reference/tweet-contract)。

## `ITweet`

单条微博的存档模型（`TWEET_CONTRACT_VERSION = 2`）。

核心字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `string` | 数字 mid 字符串 |
| `mblogId` | `string` | 微博字母 id |
| `createdAt` | `string` | 上游原始时间串 |
| `text` | `string` | 正文（长文已展开，纯文本） |
| `user` | `TweetUser` | 简版作者 |
| `stats` | `{ likes, comments, reposts }` | 互动数 |
| `visible` | `TweetVisible` | 可见性枚举 |
| `media` | `TweetMedia[]` | 媒体，恒为数组 |
| `retweetedStatus` | `ITweet?` | 转发的原微博（递归） |
| `repostChain` | `TweetRepostEntry[]?` | 转发链分层 |
| `attachments` | `TweetAttachment[]?` | 文章 / 投票 / 直播 / 抽奖 |
| `pageInfo` / `linkCards` / `topics` / `atUsers` / `audio` / `geo` | — | 卡片、链接、话题、@、音频、位置 |
| `comments` | `ITweetComment[]?` | 归档时挂载的评论 |

`ITweetComment`：

| 字段 | 说明 |
|---|---|
| `id` / `createdAt` / `text` / `source` / `likes` / `user` | 基本信息 |
| `replies` | 楼中楼（递归） |
| `pics` | 图片评论 |
| `replyTo` | 被回复的评论 |
| `rootId` / `floorNumber` / `totalReplies` / `liked` / `parentMblogId` | 楼中楼与上下文 |

子类型：`TweetUser`、`TweetMedia`、`TweetCommentPic`、`TweetRepostEntry`、`TweetAtUser`、`TweetAudio`、`TweetLinkCard`、`TweetPageCard`、`TweetGeo`、`TweetAttachment`（`TweetArticleAttachment` / `TweetVoteAttachment` / `TweetLiveAttachment` / `TweetLotteryAttachment`）、`TweetVisible`、`MediaType`。

## `IUser`

用户资料。字段缺失表示上游未公开。

| 字段 | 说明 |
|---|---|
| `id` / `name` / `avatar` / `url` | 身份与主页 |
| `description` / `location` / `gender` / `birthday` / `realName` / `school` / `company` / `hometown` | 资料 |
| `verification` | `{ isVerified, type, reason }` |
| `stats` | `{ followers, friends, statuses }` |
| `cover` / `createdAt` / `creditLevel` / `externalLinks` / `svip` / `mbrank` / `labelDesc` | 扩展字段 |

相关：`Gender`、`VerificationType`、`IUserVerification`、`IUserLabel`。

## `UserBrief`

关注 / 粉丝列表与用户搜索结果里的用户简版。完整资料用 `users.getById()` 返回的 `IUser`。

| 字段 | 说明 |
|---|---|
| `id` / `name` / `avatar` / `url` | 身份与主页 |
| `description` / `location` / `gender` | 资料 |
| `stats` | `{ followers, friends, statuses }`，缺失按 0 |
| `verified` / `verifiedType` / `verifiedReason` | 认证 |
| `following` / `followedBy` | 与当前登录用户的关注关系 |

## `ISelfProfile`

当前登录账号的资料（`users.myDetails()`）。只包含 `ajax/profile/detail` 下发的详情侧字段：

| 字段 | 说明 |
|---|---|
| `uid` | 从上游 `verified_url` 解析 |
| `createdAt` / `description` / `ipLocation` / `gender` / `birthday` | 基本资料 |
| `school` / `company` / `hometown` / `creditLevel` / `realName` | 扩展资料 |
| `followers` | 粉丝数 |
| `labelDesc` / `links` | 标签与外部链接 |

## 媒体

- `IUserMediaAsset`：图片墙 / 视频 / 相册条目（`id`、`type`、`url`、尺寸、`mblogId` 等）。
- `IUserAlbum`：相册（`containerId`、`title`、`count`、`coverUrl`）。
- `MediaType`：`PIC` / `GIF` / `VIDEO` / `LIVEPHOTO` / `UNKNOWN`。

## 其他

| 类型 | 用途 |
|---|---|
| `TweetLiker` | 点赞者（用户字段 + `likedAt` / `source`） |
| `CommentNotification` / `LikeNotification` | 通知项 |
| `SuperTopic` / `SuperTopicCategory` | 超话 |
| `TrendItem` | 热搜 / 话题 / 文娱榜条目 |
| `FavoriteTag` | 收藏夹标签 |
| `UserGroup` / `MblogGroup` | 关注分组 / 微博分组 |
| `ITweetContext` | Agent 视角上下文，见 [微博上下文](/api/types/tweet-context) |
