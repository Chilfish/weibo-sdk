# Weibo SDK

一个面向开发者的**微博 API 逆向 TypeScript SDK**：通过分层架构与契约，将微博接口返回的易变 raw JSON 稳定转换为领域模型，并提供可维护、可测试（默认离线）的服务能力（用户/微博等）。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10.0+-orange.svg)](https://pnpm.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 特性

- **分层架构**：`WeiboSDK → Services → Fetcher/Auth/RateLimit → Raw/Domain Models`
- **类型安全**：完整的 TypeScript 类型，EndpointSpec + Zod 校验，领域模型契约清晰
- **离线可测**：默认 `pnpm test` 不依赖真实微博网络 IO（E2E 需显式开启）
- **错误结构化**：自定义错误层次（Transport/Protocol/Business），便于诊断与重试决策
- **Wide Events 可观测**：内置扁平化遥测事件（`request_start/success/error` 等），支持 trace_id 全链路追踪
- **会话自检**：`selfCheck()` 支持 lazy/eager/none 三种模式，Cookie 过期提前诊断
- **速率控制**：令牌桶算法，支持并发控制，避免触发风控
- **浏览器可用**：`dist/browser.mjs` 自包含 ESM（axios/zod 内联），web-v3 / userscript 可直接 `import '@chilfish/weibo-sdk/browser'`
- **流式分页**：评论 / 转发 / 关注 / 粉丝 / 点赞 / 收藏 / 历史评论 / 媒体等均提供 `stream*`（去重 + `maxPages` + `maxItems` + `onProgress`；时间倒序的流另支持 `since` / `until` 日期边界）
- **归档扩展**：点赞 / 历史评论 / 图片墙 / 视频瀑布 / 增量 / 多账号批量 / 仅原创 + 断点续传
- **可诊断**：结构化错误带 `code/level/retryable/hint/next`；`capabilities()` 能力清单；`schema diff` 漂移报告

## 版本与契约

- **包版本 0.x**：实现可随微博上游漂移修复（patch/minor），不承诺实现细节稳定。
- **`ITweet` 存档契约自 v1 冻结**：字段只增不改；rename / remove / 类型变更才升 v2 并随包 major 发布。
- 契约版本与包版本解耦，规则见 [`docs/engineering/contract-itweet-v1.md`](./docs/engineering/contract-itweet-v1.md)。

## 快速开始

### 安装

```bash
pnpm add @chilfish/weibo-sdk
# 或 npm install @chilfish/weibo-sdk
```

从源码开发：

```bash
pnpm install
pnpm run build
```

浏览器 / userscript 使用 `@chilfish/weibo-sdk/browser` 子路径（Node 入口为 `@chilfish/weibo-sdk`）；构建后可用 `pnpm run smoke:browser` 在真实 Chromium 做冒烟。

### Cookie 来源

`cookie` 既可以是 Cookie header 串，也可以是文件路径（仅 Node 环境）：

```typescript
// 1. header 串
new WeiboSDK({ cookie: 'SUB=xxx; SUBP=xxx; XSRF-TOKEN=xxx' })

// 2. Netscape Cookie 文件（浏览器扩展 / curl cookies.txt 导出）
new WeiboSDK({ cookie: 'C:/Users/me/cookies.txt' })

// 3. 内容为 header 串的文本文件（可带 Cookie: 前缀、可多行）
new WeiboSDK({ cookie: './cookies.header.txt' })
```

文件中只保留微博域名（`weibo.com` / `weibo.cn` / `sina.com.cn`）的 Cookie，过期条目会被跳过；路径不存在或文件内没有可用 Cookie 会抛 `InvalidConfigError`（`CONFIG_INVALID`）。浏览器入口没有 `node:fs`，文件路径会退化为普通字符串。

### 获取用户信息

```typescript
import { WeiboSDK } from '@chilfish/weibo-sdk'

const sdk = new WeiboSDK({
  cookie: process.env.WEIBO_COOKIE || '',
})

const user = await sdk.users.getById('1111681197')
console.log(user.id, user.name, user.stats.followers)
```

### 获取用户微博列表

```typescript
const page = await sdk.tweets.listByUserId('1111681197')
console.log(page.page, page.hasMore, page.tweets[0]?.id)
```

### 遍历用户媒体集合

```typescript
// 图片墙（sinceid 游标）：pic / livephoto / gif
for await (const asset of sdk.media.streamImages('1111681197', { maxPages: 2 })) {
  console.log(asset.type, asset.url, asset.createdAt)
}

// 视频瀑布（cursor 游标）：从 page_info.media_info 提取视频
for await (const video of sdk.media.streamVideos('1111681197', { maxPages: 2 })) {
  console.log(video.sourceMblogId, video.duration, video.permanentPageUrl)
}

// 相册（D4）：先取相册列表，再按 since_id 遍历照片
const { albums } = await sdk.media.listAlbums('1111681197')
for await (const photo of sdk.media.streamAlbumPhotos(albums[0].containerId, { maxPages: 2 })) {
  console.log(photo.id, photo.url)
}
```

CLI：

```bash
weibo-cli media albums 1111681197
weibo-cli media album '<containerId>' --max-pages 2
```

### 下载单条微博媒体

```typescript
const result = await sdk.media.downloadByMblogId('QqsYymYOS', {
  dir: './media',
  // include: [MediaType.PIC, MediaType.VIDEO, MediaType.LIVEPHOTO, MediaType.GIF],
  // overwrite: true,
})

console.log(result.totals) // { total, downloaded, skipped, failed, bytes }
console.log(result.items)  // 逐项 path / url / status / attempts
```

CLI：

```bash
weibo-cli media download QqsYymYOS --out ./media
weibo-cli media download QqsYymYOS --out ./media --dry-run
weibo-cli media download QqsYymYOS --out ./media --include pic,video --no-refresh
```

> 下载使用独立 CDN 客户端：只带 `Referer: https://weibo.com/`，不携带 Cookie；支持重试、URL 过期刷新、临时文件原子落盘与失败清单。规则见 [media-download.md](./docs/engineering/media-download.md)。
### 流式遍历收藏夹

```typescript
// 自动翻页 + 跨页去重；tag 为客户端过滤（收藏项自带 tags），可按标签 id 或名称匹配
for await (const tweet of sdk.favorites.streamFavorites('1111681197', { tag: '技术' })) {
  console.log(tweet.mblogId, tweet.text)
}
```

### 遍历点赞与我的历史评论

```typescript
// 我赞过的微博（page 游标；上游无 total，空页停止）
for await (const tweet of sdk.likes.streamByUserId('1111681197', { maxPages: 3 })) {
  console.log(tweet.mblogId, tweet.text)
}

// 当前登录用户的历史评论（max_id 游标；next_cursor === 0 停止）
for await (const comment of sdk.commentHistory.streamMine({ maxPages: 3 })) {
  console.log(comment.createdAt, comment.parentMblogId, comment.text)
}
```

### 点赞者 / @我 / 消息 / 分组

```typescript
// 微博点赞者（page 游标；入参必须是数字 mid，不是字母 mblogid）
for await (const liker of sdk.tweets.streamLikers('5355873276528697', { maxPages: 2 })) {
  console.log(liker.name, liker.likedAt)
}

// @我的微博（max_id 游标；next_cursor === 0 停止）
for await (const tweet of sdk.users.streamMentions({ maxPages: 2 })) {
  console.log(tweet.mblogId, tweet.text)
}

// 消息中心：评论通知 / 点赞通知（max_id 游标）
for await (const item of sdk.notifications.streamComments()) {
  console.log(item.tweet.mblogId, item.comment.text)
}
for await (const item of sdk.notifications.streamLikes()) {
  console.log(item.tweet.mblogId, item.user.name)
}

// 关注分组 / 微博分组（无分页）
const groups = await sdk.users.groups()
const mblogGroups = await sdk.users.mblogGroups()
```

> 点赞者使用 `m.weibo.cn/api/attitudes/show`：网页端 `ajax/statuses/likeShow` 目前仍返回正确
> `total_number` 但 `data` 恒为空（隐私/风控门控）。越界页返回 `data: null`，服务层按空页停止。

### 超话分类 / 列表 / 搜索

```typescript
// 分类（sort_id 来源）；列表 count 是总页数（30 条/页）
const cates = await sdk.topics.cates()
const page = await sdk.topics.list({ sortId: cates[0].id })

// 关键词搜索（sort_id=0）
for await (const topic of sdk.topics.stream({ keyword: '游戏', maxPages: 2 })) {
  console.log(topic.pageId, topic.title)
}
```

CLI：`weibo-cli topic cates|list|stream`。

### 首页增量

```typescript
// 首页「最新微博」：max_id 翻旧页；since_id 只返回更新条目（单页）
for await (const tweet of sdk.tweets.streamFriendTimeline({ maxPages: 3 })) {
  console.log(tweet.mblogId)
}
const incremental = await sdk.tweets.listFriendTimeline({ since_id: lastSeenId })
```

### 获取单条微博详情

```typescript
const tweet = await sdk.tweets.getByMblogId('QqsYymYOS')
console.log(tweet.text, tweet.media)

// 也接受数字 mid 和微博状态 URL（从浏览器复制来的链接可以直接传）
await sdk.tweets.getByMblogId('https://m.weibo.cn/status/5356120103455672')
await sdk.tweets.comments('https://weibo.com/7679065628/QqsYymYOS')
```

> 所有接受 `mblogId` 的方法都支持 mblogId / 数字 mid / 微博状态 URL，入口统一归一化；
> 点赞者等只收数字 mid 的端点会自动用 `statuses/show` 解析一次。纯函数
> `parseTweetIdInput` / `normalizeTweetIdInput` 也从包入口导出。

### 获取原始响应（raw）与 enrich

`ArchiveItem` 不携带 raw；需要原始 JSON 时，下游自行落盘：

```typescript
// 请求级：所有端点的原始响应（Zod 校验前触发）
const sdk = new WeiboSDK({
  cookie: '',
  hooks: {
    onRaw: async (raw, meta) => {
      await saveRaw(meta.endpoint, meta.args, raw)
    },
  },
})

// 归档级：逐条原始微博（归一化前触发；ArchiveItem 仍不含 raw）
for await (const item of sdk.archive.streamArchive('1111681197', {
  onRaw: async (raw, meta) => saveRaw(`tweet:${meta.mblogId}`, raw),
})) {
  await persist(item.tweet)
}

// 单条补拉：raw + 归一化模型（可选长微博全文）
const { tweet, raw, longText } = await sdk.tweets.enrich('QqsYymYOS', { includeLongText: true })
```

### 完整镜像大号（日期切片）

`streamArchive` 默认先翻 `mymblog`；page 游标翻到底后，如果 `total` 表明仍有剩余（或 total 不可用），会自动从最旧一条继续用 `searchProfile` 做日期切片，单片过密时对半缩小窗口。万条级账号也能完整镜像：

```typescript
for await (const item of sdk.archive.streamArchive('1111681197', {
  includeReposts: true,
  includeFavorites: true,
  includeLikes: true, // D1：我赞过的微博（source='like'）
  includeCommentHistory: true, // D2：历史评论（source='comment'，评论在 item.comment）
  includeComments: true, // P1-6：评论挂到 item.tweet.comments
  includeImages: true, // D4：图片墙（source='image'，资产在 item.asset）
  includeVideos: true, // D5：视频瀑布（source='video'，同时有 item.tweet + item.asset）
  originalOnly: false, // true = 跳过转发并关闭内联转发
  onProgress: p => console.log(p.phase, p.processed, p.total, p.remaining),
  // 增量同步：翻到上次位置 / 早于 since 即停止（置顶不参与时间边界）
  // incremental: { stopAtMblogId: lastSeenId, since: '2026-01-01', skipPinned: true },
  // 可选：直接按日期切片（跳过 mymblog）、限制下界（unix 秒）
  // timelineSource: 'search',
  // since: Math.floor(Date.UTC(2009, 7, 14) / 1000),
  // searchQuery: '关键词',
})) {
  if (item.tweet)
    await persist(item.tweet)
  if (item.asset)
    await persistMedia(item.asset)
  await saveCheckpoint(item.checkpoint) // 断点续传
}
```

### 增量同步与多账号

```typescript
// 增量：状态文件由 CLI/调用方维护；SDK 只接收 incremental
for await (const { uid, item } of sdk.archive.streamUsersArchive(['111', '222'], {
  includeLikes: true,
  getIncremental: uid => ({ stopAtMblogId: lastSeen[uid], skipPinned: true }),
})) {
  await persist(uid, item)
}

// 状态文件工具（Node 侧）
import { parseArchiveState, updateArchiveState, incrementalOptionsFromState } from '@chilfish/weibo-sdk'
```

CLI 等价的增量用法：

```bash
weibo-cli archive <uid> --state .weibo-archive-state.json
weibo-cli archive --uid-file uids.txt --state .weibo-archive-state.json
```

### 能力清单与错误诊断

```typescript
const caps = sdk.capabilities({ service: 'tweets' })
// [{ id, service, methods, auth, pagination, status, cli?, note? }, ...]
```

```bash
weibo-cli capabilities --status degraded
weibo-cli schema diff before-digest.json after-digest.json
```

CLI 错误统一输出 `{ event: 'error', code, level, retryable, message, hint?, next?, context? }`；
Cookie 失效会得到 `AUTH_SESSION_EXPIRED` 并附带重新导出 Cookie 的下一步。

### 代理

```typescript
const sdk = new WeiboSDK({
  cookie,
  proxy: 'http://127.0.0.1:7890', // 静态代理
  // proxy: false,                // 显式直连
  // proxy: { getProxy: ctx => pickProxy(ctx.attempt) }, // 动态代理（每次请求/重试）
})
```

### CLI

CLI 的 Cookie **只从 `.env` 读取**（默认 `<pwd>/.env`，可用 `--env-file` 指定），不读取环境变量；`--cookie`/`-c` 为显式覆盖。`WEIBO_COOKIE` / `--cookie` 的取值可以是 header 串，也可以是 Cookie 文件路径（Netscape 或 header 串内容）。

```bash
# 安装后（全局或 npx）
npx weibo-cli whoami

# 本地开发
pnpm build
node dist/cli.mjs whoami
```

## Playground（可运行示例）

`playground/` 把 SDK / CLI 当作真实下游，按场景提供可直接运行的示例：

```bash
pnpm play            # 列出场景
pnpm play whoami
pnpm play cli:home   # CLI 场景需要先 pnpm build
```

详见 [playground/README.md](./playground/README.md)。示例只读、默认有界（`maxPages: 1`、媒体下载默认 dry-run），Cookie 只从 `.env` 读取。

## 文档

文档中央索引见 `docs/README.md`。核心文档：

- 架构与契约规格：`docs/engineering/technical-spec.md`
- 开发计划与路线图：`docs/planning/roadmap.md`
- 术语表：`docs/requirements/glossary.md`
- 架构决策（ADR）：`docs/planning/architecture.md`
- CLI 命令参考：`docs/engineering/cli.md`
- 错误排障手册：`docs/engineering/error-diagnostics.md`
- 端点开发指南：`docs/engineering/endpoint-authoring.md`
- 上一阶段行动计划（0.1.0 + 0.2.0，已完成并归档）：`docs/archive/todo-post-0.1.0.md`

## 测试

- 离线测试（默认）：`pnpm test`
- E2E（真实 Cookie + 外网，默认跳过）：在项目根目录 `.env` 配置 `WEIBO_COOKIE` 后运行 `pnpm test:e2e`（不读取环境变量）

## 开发

```bash
# 安装依赖
pnpm install

# 构建
pnpm run build

# 开发模式（stub 模式，实时更新）
pnpm run dev

# 类型检查
pnpm run typecheck

# Lint
pnpm run lint
```

## 贡献

欢迎贡献代码！请遵循以下步骤：

1. Fork 项目
2. 创建功能分支（`git checkout -b feat/amazing-feature`）
3. 提交更改（建议 Conventional Commits）
4. 推送到分支并创建 Pull Request

开发规范详见 `AGENTS.md`。

## 免责声明

本 SDK 仅用于学习和研究目的。使用时请遵守：

- 微博平台的服务条款
- 相关法律法规
- 数据保护和隐私政策
- 合理的请求频率限制

## 许可证

[MIT License](./LICENSE.md)
