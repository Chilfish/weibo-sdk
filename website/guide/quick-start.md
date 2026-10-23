---
title: 快速开始
---

# 快速开始

## 访客身份

不传 Cookie 时，`new WeiboSDK({})` 使用访客身份读取公开数据：

```ts
import { WeiboSDK } from '@chilfish/weibo-sdk'

const sdk = new WeiboSDK({})

const user = await sdk.users.getById('1111681197')
console.log(user.name, user.stats.followers)

const tweet = await sdk.tweets.getByMblogId('QqsYymYOS')
console.log(tweet.text, tweet.media)

const page = await sdk.tweets.comments('QqsYymYOS', { count: 20 })
console.log(page.total, page.comments.length)
```

## 使用 Cookie

```ts
const sdk = new WeiboSDK({ cookie: 'SUB=...; SUBP=...; XSRF-TOKEN=...' })

// 也可以传文件路径：Netscape cookies.txt 或包含 Cookie header 的文本
new WeiboSDK({ cookie: './cookies.txt' })
```

CLI 从当前目录 `.env` 读取 `WEIBO_COOKIE`，可以用 `--cookie` 覆盖：

```bash
weibo-cli whoami
weibo-cli user timeline 1111681197
```

## 流式读取

```ts
for await (const tweet of sdk.tweets.streamByUserId('1111681197', {
  maxItems: 100,
  maxPages: 5,
  since: '2026-01-01',
})) {
  console.log(tweet.mblogId, tweet.createdAt)
}

for await (const comment of sdk.tweets.streamComments('QqsYymYOS', {
  maxPages: 3,
  onProgress: progress => console.log(progress.processed, '/', progress.total),
})) {
  console.log(comment.id, comment.text)
}
```

## 单条微博上下文

```ts
const context = await sdk.tweets.context('QqsYymYOS', {
  comments: 5,
  maxChars: 4000,
})

context.post.text          // 当前作者本人的发言；转发链在 repostChain
context.quoted             // 转发的原微博
context.media              // 有序媒体与归属
context.unknowns           // 图片未描述、视频未转写、评论为抽样等
```

## 归档

```ts
// 全量镜像流：断点续传、增量、多账号
for await (const item of sdk.archive.streamArchive('1111681197', {
  includeLikes: true,
  includeImages: true,
  includeVideos: true,
})) {
  if (item.tweet) await persist(item.tweet)
  if (item.asset) await saveMedia(item.asset)
  await saveCheckpoint(item.checkpoint)
}

// 指定时间段，补全详情 / 评论 / 楼中楼，一次返回 ArchiveFile
const result = await sdk.userArchive.run('1111681197', {
  since: '2026-01-01',
  until: '2026-03-31',
  includeComments: true,
  includeReplies: true,
})
```

## 错误处理

```ts
import { WeiboSDKError } from '@chilfish/weibo-sdk'

try {
  await sdk.tweets.getByMblogId('QqsYymYOS')
}
catch (error) {
  if (error instanceof WeiboSDKError) {
    console.error(error.code, error.retryable, error.context)
  }
}
```

判断 `error.code`；`message` 会随上游变化。完整清单见 [错误、重试与限流](/guide/errors-retries)。
