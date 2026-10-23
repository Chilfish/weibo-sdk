---
title: 微博上下文
outline: deep
---

# 微博上下文（`ITweetContext`）

`sdk.tweets.context()` 的返回结构，schema 标识 `weibo.tweet-context/v1`。

`ITweet` 记录微博本体，作为存档模型；`ITweetContext` 是面向阅读和 Agent 的确定性投影，回答：谁说的、什么时候、作者本人说了什么、配了什么、和谁有关、别人怎么反应、哪些信息缺失。

上下文只包含抓取到的事实；OCR、视觉描述和视频转写由调用方补充。

## 顶层字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `schema` | `'weibo.tweet-context/v1'` | 结构版本 |
| `post` | `TweetContextPost` | 当前作者本人的发言与元信息 |
| `media` | `TweetContextMedia[]` | 当前微博自己的媒体；原微博媒体在 `quoted.media` |
| `quoted` | `ITweetContext?` | 转发的原微博（默认展开一层） |
| `repostChain` | `TweetContextRepostEntry[]?` | 转发链分层 |
| `discussion` | `TweetContextComment[]?` | 抽样评论 |
| `provenance` | `TweetContextProvenance` | 抓取时间、来源、抽样数、鉴权模式 |
| `unknowns` | `string[]` | 缺失项（图片未描述、视频未转写、正文可能截断、评论为抽样等） |
| `hints` | `string[]` | 确定性提示（长图、图集、广告、媒体归属等） |

## `post`

| 字段 | 说明 |
|---|---|
| `kind` | `'original'` / `'repost'` |
| `text` | 当前作者本人正文；转发链在 `repostChain` |
| `createdAt` / `publishedAt` / `publishedAtLocal` | 原始时间与 ISO |
| `url` | 微博永久链接 |
| `author` | `TweetContextAuthor`：id / name / 认证 / 简介 / 粉丝数 / 关注关系 |
| `stats` | 互动快照 |
| `visibility` | 可见性 |
| `flags` | 广告、付费、截断、编辑、置顶等标记 |
| `mentions` | 当前作者正文里的 @ |
| `topics` / `links` / `attachments` | 话题、链接卡片、文章 / 投票 / 直播 / 抽奖 |

## `media`

| 字段 | 说明 |
|---|---|
| `index` | 1-based，与原始媒体顺序一致 |
| `mediaId` | 媒体 id |
| `owner` | `{ mblogId, relation: 'self' \| 'quoted' }` |
| `type` | `pic` / `gif` / `livephoto` / `video` / `unknown` |
| `url` / `coverUrl` | 主资源与封面；短期签名 URL |
| `width` / `height` / `aspectRatio` / `duration` | 尺寸与时长 |
| `temporary` | 恒为 `true`，提示及时下载 |
| `hints` | 长图、图集、需要转写等 |
| `download` | `TweetContextMediaDownload?`：本地路径、状态、字节数 |

## 相关类型

`TweetContextKind`、`TweetContextVisibility`、`TweetContextAuthor`、`TweetContextStats`、`TweetContextFlags`、`TweetContextMediaRelation`、`TweetContextMediaDownload`、`TweetContextMedia`、`TweetContextLink`、`TweetContextRepostEntry`、`TweetContextComment`、`TweetContextAttachmentKind`、`TweetContextAttachment`、`TweetContextPost`、`TweetContextProvenance`。

## 使用示例

```ts
const context = await sdk.tweets.context(id, { comments: 5 })

// 读图：优先本地路径
const local = context.media.find(m => m.download?.status === 'downloaded')
if (local?.download) readFile(local.download.path)

// 边界：把缺失项显式交给下游
console.log(context.unknowns)
```

CLI 的 `weibo-cli tweet context` 输出 Markdown 卡片；`--download-media <dir>` 会回填 `download.path`。
