# Weibo SDK

用 TypeScript 读取微博公开数据的 SDK，附带命令行工具 `weibo-cli`。它把微博接口返回的原始 JSON 转成稳定的数据模型，支持时间线、微博、评论、转发、点赞、收藏、媒体和通知，也能把一个账号归档到本地。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10.0+-orange.svg)](https://pnpm.io/)
[![npm](https://img.shields.io/npm/v/@chilfish/weibo-sdk.svg)](https://www.npmjs.com/package/@chilfish/weibo-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 功能

- 读取用户资料、时间线、微博详情、评论（含楼中楼和图片评论）、转发、@ 提及和通知
- 读取关注与粉丝、收藏、点赞、历史评论、图片墙、相册、视频瀑布、超话和热搜
- 流式分页，支持 `maxPages`、`maxItems`；时间倒序的接口还支持 `since` / `until` 日期边界
- 归档流带 checkpoint，可以在中断后继续；支持增量、多账号、仅原创和媒体
- SDK 与 CLI 共用同一套能力；CLI 默认输出 JSON 或 NDJSON，方便 `jq` 和脚本消费
- 结构化错误、令牌桶限流和自动重试；默认测试离线运行，不依赖微博网络

## 安装

```bash
pnpm add @chilfish/weibo-sdk
# 或
npm install @chilfish/weibo-sdk
```

安装后可以用 `npx weibo-cli` 调用命令行工具，也可以全局安装：`npm i -g @chilfish/weibo-sdk`。

浏览器和用户脚本可以使用 `@chilfish/weibo-sdk/browser`。这个入口会把 axios 和 zod 一起打包，不需要额外的模块解析。

## 登录 Cookie（可选）

要读自己的关注时间线、收藏、通知，或者归档整个账号，需要一份已登录微博的 Cookie。可以直接传字符串，也可以传文件路径：

```ts
import { WeiboSDK } from '@chilfish/weibo-sdk'

const sdk = new WeiboSDK({
  cookie: 'SUB=...; SUBP=...; XSRF-TOKEN=...',
})

new WeiboSDK({ cookie: './cookies.txt' })        // Netscape cookies.txt
new WeiboSDK({ cookie: './cookies.header.txt' }) // 文件内容是 Cookie header
```

读取文件时只会保留 `weibo.com`、`weibo.cn`、`sina.com.cn` 的 Cookie，过期条目会被跳过。路径不存在或文件里没有可用 Cookie 时会抛出 `InvalidConfigError`。

CLI 不读取 shell 环境变量，只从 `.env` 文件读取。默认读取当前目录的 `.env`，也可以用 `--env-file` 指定：

```env
WEIBO_COOKIE="SUB=...; SUBP=...; XSRF-TOKEN=..."
```

`--cookie` / `-c` 可以临时覆盖。开始之前建议先运行 `weibo-cli whoami` 确认登录状态。

## 没有 Cookie？访客模式

不提供 Cookie 也能读公开数据，SDK 会自动使用访客身份：

```ts
import { WeiboSDK } from '@chilfish/weibo-sdk'

const sdk = new WeiboSDK({})                 // 等价于 auth: 'auto'，没有 Cookie 就走访客
const tweet = await sdk.tweets.getByMblogId('QqsYymYOS')
const comments = await sdk.tweets.comments('QqsYymYOS')

// 也可以显式指定
new WeiboSDK({ auth: 'guest' })
new WeiboSDK({ auth: 'guest', guest: { issuer: 'mobile', autoRefresh: true } })
```

CLI 的每个命令都支持 `--guest`，它不会读取 `.env`：

```bash
weibo-cli whoami --guest
weibo-cli tweet detail QqsYymYOS --guest
weibo-cli tweet comments QqsYymYOS --guest
weibo-cli trends --guest
weibo-cli user timeline 1111681197 --guest   # 只有第一页，结果带 partial: true
```

访客能读用户资料、单条微博、长文、评论、转发、点赞者、图片墙、视频、相册、超话和热搜。用户时间线、点赞、关注和粉丝只能拿到第一页；收藏、通知、@ 我、历史评论、首页关注时间线、日期搜索和归档仍然需要 Cookie，访客模式调用它们会返回 `AUTH_SESSION_EXPIRED`（`context.requiredAuth = 'cookie'`）或 `CONFIG_INVALID`。

`auth: 'auto'` 只在构造时判断：没有 Cookie 就用访客，Cookie 过期不会静默切换成访客，会照常报错。访客 token 会自动刷新一次，遇到限流（432 / 429）只退避重试。

## 快速开始

### 用户和微博

```ts
import { WeiboSDK } from '@chilfish/weibo-sdk'

const sdk = new WeiboSDK({ cookie })

const user = await sdk.users.getById('1111681197')
console.log(user.name, user.stats.followers)

const page = await sdk.tweets.listByUserId('1111681197')
for (const tweet of page.tweets)
  console.log(tweet.mblogId, tweet.text)

const tweet = await sdk.tweets.getByMblogId('QqsYymYOS')
console.log(tweet.media)
```

### 流式读取

```ts
for await (const tweet of sdk.tweets.streamByUserId('1111681197', {
  maxItems: 100,
  maxPages: 5,
})) {
  console.log(tweet.mblogId)
}

for await (const comment of sdk.tweets.streamComments('QqsYymYOS', {
  maxPages: 3,
})) {
  console.log(comment.text)
}
```

所有 `stream*` 方法都支持 `maxItems` 和 `maxPages`。用户时间线、首页、转发、@ 我、历史评论和通知这些时间倒序的流还支持 `since` / `until`，可以传 `YYYY-MM-DD` 或 unix 秒。评论热度序、点赞和收藏不提供日期边界，因为条目顺序和操作时间并不一致。

### 当前会话

```ts
const session = await sdk.getSession()
session.authMode   // 'cookie' 或 'guest'
session.uid        // 登录账号 uid（从 profile/detail 的 verified_url 解析；访客为 undefined）
session.details    // profile/detail 原始响应（访客缺省）
```

`getSession()` 复用启动自检已经发出的请求，按实例缓存，不会额外探测；需要重新确认登录态时传 `{ refresh: true }`。访客模式下它只确认访客 token 可用，并返回 `guestTokenIssuedAt`。

### 归档账号

```ts
for await (const item of sdk.archive.streamArchive('1111681197', {
  includeReposts: true,
  includeFavorites: true,
  includeLikes: true,
  includeCommentHistory: true,
  includeImages: true,
  includeVideos: true,
})) {
  if (item.tweet)
    await saveTweet(item.tweet)
  if (item.asset)
    await saveMedia(item.asset)
  await saveCheckpoint(item.checkpoint)
}
```

`ArchiveItem.source` 可能是 `timeline`、`repost`、`favorite`、`like`、`comment`、`image` 或 `video`。图片项可能没有 `tweet`，只有 `asset`。

归档需要登录 Cookie：访客身份调用 `streamArchive` 会抛 `CONFIG_INVALID`，因为匿名列表只有第一页，无法保证完整。

续跑是 **at-least-once**：`checkpoint` 记录最后一条已完整处理的项，中断后重跑可能重复边界 1 条；图片墙和视频瀑布的游标按整页写回，续跑会重放整页。请按 `mblogId`（媒体按 `asset.id`）幂等去重。

`includeFavorites` 和 `includeCommentHistory` 是**账号级**数据，只能读取 Cookie 对应的登录账号；归档其他 uid 时会抛 `CONFIG_INVALID`。`includeLikes` 按目标 uid 读取。

归档也支持增量、多账号和状态文件：

```ts
for await (const { uid, item } of sdk.archive.streamUsersArchive(['111', '222'], {
  includeLikes: true,
  getIncremental: uid => ({
    stopAtMblogId: lastSeen[uid],
    skipPinned: true,
  }),
})) {
  await persist(uid, item)
}
```

CLI 会把 checkpoint 和增量状态写到本地：

```bash
weibo-cli archive <uid> --state .weibo-archive-state.json
weibo-cli archive --uid-file uids.txt --state .weibo-archive-state.json
```

### 下载媒体

```ts
const result = await sdk.media.downloadByMblogId('QqsYymYOS', {
  dir: './media',
})

console.log(result.totals)
```

```bash
weibo-cli media download QqsYymYOS --out ./media
weibo-cli media download QqsYymYOS --out ./media --dry-run
weibo-cli media download QqsYymYOS --out ./media --include pic,video
```

下载器使用独立的 CDN 客户端，只带微博 Referer，不带 Cookie。支持重试、URL 过期刷新、临时文件原子落盘和失败清单。

### 命令行

```bash
weibo-cli whoami
weibo-cli user timeline <uid>
weibo-cli tweet detail <mblogId>
weibo-cli tweet comments-stream <mblogId> --max-pages 3
weibo-cli tweet home --max-id <上一页 maxId>
weibo-cli tweet home --since-id <微博数字 id>
weibo-cli follow stream <uid> --max-pages 2
weibo-cli media images <uid> --max-pages 1
weibo-cli notification comments-stream --max-pages 1
```

普通命令输出 JSON；`*-stream`、`archive` 和 `media download` 输出 NDJSON，每行一个事件：

```json
{"event":"progress","page":1,"processed":25}
{"event":"item","count":1,"tweet":{...}}
{"event":"done","count":25}
```

可以直接接 `jq`：

```bash
weibo-cli tweet home-stream --max-pages 2 \
  | jq -c 'select(.event=="item") | .tweet.mblogId'
```

## 微博 id

接受 `mblogId` 的方法也接受数字 mid 和微博状态 URL：

```ts
await sdk.tweets.getByMblogId('QqsYymYOS')
await sdk.tweets.getByMblogId('5356120103455672')
await sdk.tweets.getByMblogId('https://m.weibo.cn/status/5356120103455672')
```

点赞者接口只接受数字 mid。传 mblogId 或 URL 时，SDK 会先用 `statuses/show` 解析。

## 能力概览

| 领域 | SDK | CLI |
|---|---|---|
| 用户与关系 | `sdk.users` | `weibo-cli user` |
| 微博、评论、转发 | `sdk.tweets` | `weibo-cli tweet` |
| 关注与粉丝 | `sdk.followings` | `weibo-cli follow` |
| 收藏与点赞 | `sdk.favorites` / `sdk.likes` | `weibo-cli favorite` / `like` |
| 历史评论 | `sdk.commentHistory` | `weibo-cli comment` |
| 媒体集合与下载 | `sdk.media` | `weibo-cli media` |
| 通知 | `sdk.notifications` | `weibo-cli notification` |
| 超话与热搜 | `sdk.topics` / `sdk.trends` | `weibo-cli topic` / `trends` |
| 账号归档 | `sdk.archive` | `weibo-cli archive` |

完整命令和参数见 [CLI 参考](./docs/engineering/cli.md)。SDK 的方法签名、分页游标和返回类型以包内类型声明为准。

## 诊断

`capabilities()` 可以查看当前支持的能力、登录要求和分页方式。每条记录带 `auth`（`cookie` / `guest` / `none`）、`guestPagination` 和 `guestNote`，能直接看出访客身份下能不能用、能不能翻页：

```ts
const caps = sdk.capabilities({ service: 'tweets' })
```

```bash
weibo-cli capabilities --status degraded
weibo-cli schema diff before-digest.json after-digest.json
```

错误对象带有 `code`、`level`、`retryable`、`context`，部分错误还有 `hint` 和 `next`。建议先判断 `code`，不要匹配错误文案：

- `AUTH_SESSION_EXPIRED`：Cookie 无效或过期；访客模式下表示该能力需要登录（`context.requiredAuth === 'cookie'`）
- `RATE_LIMITED`：HTTP 432 / 429，SDK 会自动退避
- `NET_TIMEOUT` / `NET_REQUEST_FAILED`：网络问题，可重试
- `API_NOT_OK`：微博接口返回 `ok !== 1`
- `API_BAD_RESPONSE`：返回的不是 JSON，或字段结构与预期不符
- `CONFIG_INVALID`：Cookie、代理或参数配置有误（例如 `auth: 'cookie'` 却没有 Cookie、访客请求第 2 页、访客调用归档）

完整的错误码和处理方式见 [错误排障手册](./docs/engineering/error-diagnostics.md)。

## 原始响应与遥测

`ArchiveItem` 只包含归一化后的数据，不携带 raw。需要原始 JSON 时，可以通过 hook 或 `enrich` 单独获取：

```ts
const sdk = new WeiboSDK({
  cookie,
  hooks: {
    onRaw: async (raw, meta) => {
      await saveRaw(meta.endpoint, meta.args, raw)
    },
  },
})

const { tweet, raw, longText } = await sdk.tweets.enrich('QqsYymYOS', {
  includeLongText: true,
})
```

请求、限流、重试和归一化过程会产生结构化遥测事件。可以接入自己的 `telemetry.emit()`，也可以使用 `createJsonlTelemetry()` 直接写到 JSONL 文件。

## 开发

```bash
pnpm install
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm test
```

真实网络测试默认跳过。需要时在项目根目录 `.env` 里配置 `WEIBO_COOKIE`，再运行：

```bash
pnpm test:e2e
```

访客链路的冒烟用例不需要 Cookie，用独立开关开启：

```bash
WEIBO_GUEST_E2E=1 pnpm test:e2e
```

`playground/` 里有可直接运行的 SDK 和 CLI 示例：

```bash
pnpm play
pnpm play whoami
pnpm play cli:home
```

更多开发约定见 [AGENTS.md](./AGENTS.md)，端点开发流程见 [endpoint-authoring.md](./docs/engineering/endpoint-authoring.md)。

## 文档

文档入口是 [docs/README.md](./docs/README.md)。常用的几篇：

- [项目概览](./docs/requirements/overview.md)
- [CLI 参考](./docs/engineering/cli.md)
- [错误排障](./docs/engineering/error-diagnostics.md)
- [端点开发](./docs/engineering/endpoint-authoring.md)
- [数据模型说明](./docs/engineering/contract-itweet-v1.md)

## 边界

这个项目只做只读数据读取和归档，不提供发帖、点赞、转发、评论、关注等写操作。私信、仅粉丝可见和付费内容不在范围内。

媒体 URL 是微博的短期签名地址，通常约一小时后失效。归档时需要及时下载，或者只保存 URL 和元数据。

请只使用自己的账号 Cookie（或访客身份读取公开数据），并遵守微博的服务条款、限流规则和隐私政策。

## 许可证

[MIT](./LICENSE.md)
