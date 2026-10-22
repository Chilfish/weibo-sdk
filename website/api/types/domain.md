---
title: 领域模型
outline: deep
---

# 领域模型

SDK 的公开读取方法返回这些模型。`ITweet` 与 `ITweetComment` 受契约版本管理；其余模型跟随包 SemVer。

## `ITweet`

单条微博的存档契约（`TWEET_CONTRACT_VERSION = 2`）。完整字段与冻结规则见 [ITweet 契约 v2](/reference/tweet-contract-v2)。

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
| `repostChain` | `TweetRepostEntry[]?` | 拍平的转发链分层 |
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

用户资料。字段缺失表示上游未公开，不是空默认值。

| 字段 | 说明 |
|---|---|
| `id` / `name` / `avatar` / `url` | 身份与主页 |
| `description` / `location` / `gender` / `birthday` / `realName` / `school` / `company` / `hometown` | 资料 |
| `verification` | `{ isVerified, type, reason }` |
| `stats` | `{ followers, friends, statuses }` |
| `cover` / `createdAt` / `creditLevel` / `externalLinks` / `svip` / `mbrank` / `labelDesc` | 扩展字段 |

相关：`Gender`、`VerificationType`、`IUserVerification`、`IUserLabel`。

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
| `UserGroup` / `MblogGroup` | 关注分组 / 微博分组 |
| `ITweetContext` | Agent 视角上下文，见 [微博上下文](/api/types/tweet-context) |
