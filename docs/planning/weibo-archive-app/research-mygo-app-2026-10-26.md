# 调研：消费端应用（MyGo + SDK）

> **日期**：2026-10-26
> **目的**：在动手前把三件事的真实事实固定下来——前身项目怎么工作、SDK 能提供什么、MyGo 允许什么——再据此判断应用形态与可行性。
> **方法**：只记录可核对的事实；推断与假设单独标注「待验证」。代码引用以本仓库 `main`（0.6.0）为准，外部项目以当日 GitHub / 官方文档为准。

---

## 1. 背景

老项目 `Weibo-archiver` 已经验证过需求：490 stars / 37 forks，核心场景是「号被夹之前把微博备份下来」。它的问题不是需求，而是结构与数据：

- 数据格式是面向旧版 UI 的扁平结构，和现在 SDK 的 `ITweet` v2 / `weibo-user-archive/v2` 不兼容。
- 前端是 Vue 3 + shadcn-vue 的一套历史实现，需要按现在的设计规范重做。
- 抓取依赖油猴脚本，普通用户要先装脚本管理器，再导出 JSON，再上传网页——三步都劝退。

本调研要回答：**用 MyGo 做桌面端，能不能既零命令行、又复用 SDK 的抓取与归档能力。**

---

## 2. 前身项目事实（Chilfish/Weibo-archiver）

### 2.1 仓库与运行方式

- 许可 Apache-2.0；monorepo（pnpm）。
- `apps/web-v2`：查看器 SPA，Vue 3.5 / vue-router 5 / Pinia / Tailwind 4 / shadcn-vue（reka-ui）/ @tanstack/vue-table / Storybook / fuse.js；Vite 8；VitePress 文档；部署在 Vercel（`weibo-archiver.chilfish.top`）。
- `apps/monkey`：油猴脚本，Vue 3 + daisyui；`vite-plugin-monkey`；依赖 `@weibo-archiver/core`；devDeps 含 `axios` / `dexie`（IndexedDB）/ `file-saver` / `fuse.js`。
- `apps/cli`：Node CLI，axios。
- `packages/core`：zod、axios、dexie、file-saver、fuse.js。
- `server/`：**Go 写的本地服务器**，用于下载图片和离线浏览。存在的直接原因是浏览器拿不到微博图片的 Referer / 落盘能力。

### 2.2 用户流程（官方文档的描述）

1. 安装油猴脚本（推荐给普通用户）→ 在微博页面里点选范围 → 抓取 → 导出 JSON。
2. 打开网页查看器 → 上传 JSON → 像刷微博一样浏览。
3. 可选：本地 Go 服务器，把图片下载到电脑并离线查看。
4. 可选：CLI，给有技术基础的人做定制备份。

文档还提供了「从旧版本迁移」：旧版导出的 JSON 直接重新导入新网页即可，自动迁移。

### 2.3 归档数据模型（`packages/core/src/types`）

```ts
interface ImportedData {
  weibo: Post[]
  user: UserInfo
  followings: Following[]
  favorites: Favorite[]
}
```

- `Post`：`id` / `mblogid` / `regionName` / `createdAt` / `source?` / `text` / `imgs: string[]` / `repostsCount` / `commentsCount` / `likesCount` / `userId` / `card?` / `comments: Comment[]` / `retweet?` / `isShowBulletIn: '0' | '2'`。
- `Comment`：`id` / `text` / `createdAt` / `regionName` / `likesCount` / `commentsCount` / `floor` / `user` / `img?`。
- `User`：`uid` / `name` / `avatar` / `remark?`。
- `UserInfo`：`User` + `bio` / `followers` / `followings` / `createdAt?` / `birthday?` / `postCount?` / `followingIds` / `exportedAt?`。
- `Following`：`User` + `followers` / `followings` / `bio` / `location` / `createdAt`。
- `Favorite`：`Post` + `favBy` / `user` / `retweet?` / `card?`。

**特征**：面向展示、字段扁平；图片只有 URL；评论只有一层（无楼中楼）；没有媒体类型、转发链、附件、话题、可见范围等结构。

---

## 3. 新 SDK 事实（`@chilfish/weibo-sdk` 0.6.0）

### 3.1 发布状态（2026-10-26 核对）

- npm `latest = 0.6.0`（2026-10-23 发布），GitHub Release 已建，文档站 `https://weibo-sdk.chilfish.top` 在线。
- 仓库 `main` 干净；CI、Publish、每周 `Upstream Drift`（2026-10-26 05:35 UTC）均通过。
- 本地门禁：`pnpm typecheck` 通过、`pnpm test --run` 通过。

### 3.2 入口与运行时

| 入口 | 用途 | 依赖 |
|---|---|---|
| `@chilfish/weibo-sdk` | Node / Bun / Deno / Worker | 外部 `axios` / `zod` |
| `@chilfish/weibo-sdk/browser` | 浏览器 / 用户脚本，自包含 ESM | axios / zod 已内联 |
| `@chilfish/weibo-sdk/cli` | CLI 命令树 | `citty` 已内联 |
| `@chilfish/weibo-sdk/schemas/*` | 归档 JSON Schema | 无 |

- Node >= 20.16，ESM-only。
- 默认传输是 axios；可换 `fetchTransport`。

### 3.3 传输端口（应用最关键的接缝）

`src/services/internal/transport/types.ts`：

```ts
export interface WeiboTransport {
  send: (request: TransportRequest) => Promise<TransportResponse>
}

export type FetchLike = (
  url: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    redirect?: 'follow' | 'error' | 'manual'
    signal?: AbortSignal
  },
) => Promise<FetchResponseLike>

export interface FetchResponseLike {
  status: number
  ok?: boolean
  url?: string
  headers: {
    get: (name: string) => string | null
    getSetCookie?: () => string[]
    forEach?: (callback: (value: string, key: string) => void) => void
  }
  text: () => Promise<string>
}
```

`fetchTransport({ fetch })` 的行为（`FetchTransport.ts`）：

- 所有 HTTP 状态码正常返回；只有网络失败 / 超时包装成 `TransportFailure('network' | 'timeout')`。
- 超时用 `AbortController` + `request.timeoutMs`；调用方的 `signal` 会转发。
- `redirect` 原样传给 fetch（`manual` 用于访客登录页 / 302 判定）。
- 响应体先 `text()` 再尝试 `JSON.parse`，非 JSON（风控页 / 登录页）按文本返回。
- 会读取 `headers.getSetCookie()` 或 `set-cookie`。

### 3.4 鉴权

- `IWeiboConfig.cookie` 是 Cookie header 字符串；`AuthService` 手工设置 `Cookie` 头，并从串里提取 `XSRF-TOKEN`。
- `auth` 模式：`auto` / `cookie` / `guest`；`auth: 'cookie'` 且没有 Cookie 时构造期抛 `CONFIG_INVALID`。
- 访客模式：`GuestTokenService` 通过注入的 fetch 发放 token，并解析响应里的 `set-cookie`（`SUB` / `SUBP`）。
- CLI 只从 `.env` 读 Cookie，不读 shell 环境变量；`--guest` 显式访客。

### 3.5 归档契约

`ITweet` v2（`src/types/domain/ITweet.ts`）：

- 身份：`id` / `mblogId` / `createdAt` / `text` / `source` / `regionName?`。
- 作者与计数：`user`（简版）/ `stats { likes, comments, reposts }` / `visible`。
- 结构：`retweetedStatus?` / `repostChain?` / `pageInfo?` / `attachments?`（article / vote / live / lottery）/ `media[]` / `geo?`。
- 扩展：`topics?` / `linkCards?` / `readCount?` / `editCount?` / `title?` / `permanentVideoUrl?` / `isOriginal?` / `sourceUrl?` / `atUsers?` / `playCount?` / `isTop?` / `audio?`。
- 版本规则：v2 内只增 optional 字段；rename / remove / 类型变更必须升 v3 并提供迁移。

`ArchiveFile`（`weibo-user-archive/v2`，`src/types/archive/IArchiveFile.ts`）：

```ts
interface ArchiveFile {
  $schema: string
  schema: 'weibo-user-archive/v2'
  generatedAt: string
  complete: boolean
  query: { uid, range, includeComments, includeReplies, includeReposts, commentOrder }
  user: IUser
  stats: { tweets, comments, replies, errors }
  tweets: ArchivedTweet[]   // { mblogId, source: 'timeline', tweet: ITweet, comments, reposts? }
  errors: ArchiveIssue[]
}
```

- 归档 JSON Schema 随包发布，可离线校验。
- 旧的 SDK v1 → v2 迁移只删除 `textHtml`（`migrateTweetV1toV2`）；**与老 Weibo-archiver 的 `Post` 格式无关**。

### 3.6 范围归档与持久化端口

`sdk.userArchive.stream(uid, options)` / `run(uid, options)`：

- 日期切片（`sliceDays`，默认 30 天）；枚举复用 `streamArchive({ timelineSource: 'search', sliceWindow })`。
- 补全复用 `tweets.enrich` / `streamComments` / `streamReplies` / `streamReposts`。
- 选项：`includeComments` / `includeReplies` / `includeReposts` / `commentOrder` / `maxComments` / `maxCommentPages` / `maxReplies` / `maxReplyPages` / `maxReposts` / `maxRepostPages` / `concurrency` / `signal`。
- 事件：`meta` / `slice-start` / `record` / `issue` / `slice-done` / `done`；另有 `onProgress` / `onIssue` / `onRecord`。
- **`UserArchiveStore` 是持久化端口**：`loadMeta` / `saveMeta` / `loadSlices` / `loadRecords` / `appendRecord` / `saveCheckpoint` / `markSliceDone` / `appendIssue` / `loadIssues` / `clear`。SDK 默认用内存实现，CLI 用 per-slice JSONL。
- 归档合并：`mergeArchiveFiles(files)`，按 `mblogId` 去重、评论 / 楼中楼 / 转发取并集。
- 访客限制：guest 下 `userArchive` 抛 `CONFIG_INVALID`（完整时间线需要 Cookie）。

### 3.7 其他与桌面端相关的公开能力

- `sdk.media.downloadTweetMedia` / CLI `media download`：Node 侧下载媒体（带 `Referer`、可落盘）。
- `sdk.capabilities()`：能力清单，带 `auth` / `guestPagination` / `guestNote`。
- `sdk.tweets.context(mblogId)`：Agent 视角的单条上下文（正文 / 媒体归属 / unknowns）。
- 插件：`plugins: [{ name, apiVersion, enforce?, hooks?, observe? }]`，transport 中间件可短路 / 缓存；不默认启用。
- 限流：`delay`（毫秒，0 = 不限速）/ `burst`（令牌桶容量）；所有 Service 共享一个令牌桶；432 全局暂停。

---

## 4. MyGo 事实

> 来源：[llms.txt](https://mygo.egoist.dev/llms.txt) 与各专题页（links 见文末）。以下只摘与桌面端方案相关的部分。

### 4.1 形态

- 「Build desktop apps in Go」：窗口可以显示**系统 WebView 里的前端**，也可以用 Go 写的原生 UI（`package ui`），两种窗口可共存。
- 纯 Go、无 cgo；应用体积「几 MB」。
- 平台：macOS（WKWebView）、Windows（WebView2）、Linux（WebKitGTK 2.42+）。
- 前端任意框架；新项目模板用 TypeScript + Vite；开发期加载 dev server，构建期打包静态文件。
- CLI：`mygo init` / `mygo dev` / `mygo build` / `mygo generate`；配置在 `mygo.config.ts`（`defineConfig`）。

### 4.2 Go ↔ 前端绑定

- `mygo.Bind(service)` 暴露导出的方法；`mygo generate` 生成 `src/mygo.ts` 类型化客户端（`Notes.add()` 形式）。
- 方法可以接受 `context.Context`、返回 `(value, error)`、通过 `*mygo.Channel[T]` 流式返回；每调用一个 goroutine。
- 事件：`mygo.NewEvent[T]("progress")` + `Emit(win, v)` / `Broadcast(v)`；前端 `events.progress.on(...)`。
- **只有应用自己的页面能调用 Go**（前端页面、自定义协议、`file:` / `about:`、开发期 localhost）；其他网站需要 `TrustedOrigins` 显式放行。

### 4.3 Cookie（登录态）

- `mygo.Cookies.List/Set/Delete/Clear`：读写应用页面的 Cookie，**包括 HttpOnly**；默认 Cookie store 所有窗口共享，并由系统 WebView 跨运行持久化。
- `CookieFilter{ URL?, Name?, Domain?, Path? }`；`Domain: 'example.com'` 同时匹配子域。
- Windows：WebView2 只通过 web view 提供 Cookie；没有窗口时 MyGo 会临时创建隐藏 web view，窗口首次导航会等待进行中的调用；变更通过轮询确认，2 秒内不生效则失败。
- Linux：需要 WebKitGTK 2.42+；Cookie 存在用户数据目录的 `cookies.sqlite`。
- `App.ClearBrowsingData()` 清理 Cookie / localStorage / IndexedDB / service worker / 缓存。

### 4.4 fetch 插件（网络出口）

`mygo.Use(fetch.Plugin)` + 前端 `import { fetch } from '@mygo-plugins/fetch'`：

- 请求从 **Go 侧**发出，因此**不受 CORS 限制**。
- 可以设置 WebView 禁止的头：`Origin` / `Cookie` / `Referer` / `User-Agent`。
- 响应体是 `ReadableStream`，Go 按页读取速度供流；`AbortSignal` 会取消 Go 侧请求。
- **不暴露 `Set-Cookie`**（`Response` 容纳不了）。
- `mode` / `credentials` / `cache` / `referrerPolicy` / `integrity` / `keepalive` / `priority` 被忽略。
- `redirect: 'manual'` 返回 3xx 本身；`'follow'` 默认最多 20 次；`'error'` 遇重定向报错。
- `fetch.New(fetch.Options{ Client, Allow })`：`http.Client` 的 `Transport`（代理 / TLS）、`Jar`（Cookie）、`Timeout`、`CheckRedirect` 生效；`Allow` 在请求发出前按 URL / 方法 / header 决定是否放行。
- 非 http(s) scheme（`mygo://localhost`、`data:`、`blob:`）交给 WebView 自己的 fetch。
- 只有应用自己的页面能调用。

### 4.5 SQLite 插件

- 预编译 SQLite，通过 purego 加载，**不需要 cgo / C 编译器**；支持 macOS / Linux / Windows，amd64 + arm64。
- 同时向页面和 Go 提供本地数据库；原生 UI 应用也可用。

### 4.6 分发与更新

- `mygo build`：macOS 产出 app bundle + dmg；Windows 产出 exe + 安装器；Linux 产出可执行文件 + desktop entry + 安装脚本 + deb。
- 签名 / 公证：`mygo build` 按平台签名；macOS 必须在 macOS runner 上签。
- GitHub Actions 模板：打 tag 时并行构建三端，签名后上传到 draft release。
- updater 插件：类 Sparkle 的检查 / 更新 / 重启；从 GitHub 或任意 HTTPS 源下载，校验内置公钥签名。
- 原生能力：菜单 / 托盘 / 全局快捷键 / 文件对话框 / 剪贴板 / 拖放 / 通知 / 单实例 / 深链接 / 文件关联 / 开机启动 / 最近文档。

### 4.7 原生 UI（可选）

- `package ui` 提供大量原生控件（虚拟化 List / Grid / Table / Outline、Markdown、代码编辑器、图表、WebView 嵌入等），自带无障碍与主题。
- 对本项目不是必需：主界面仍建议 Web 前端；原生 UI 只可能用于很小的进度窗口或对话框。

---

## 5. 交叉约束分析（结论）

### 5.1 为什么纯网页不能承担抓取

| 约束 | 事实 | 后果 |
|---|---|---|
| `Cookie` 是 forbidden header | 浏览器脚本不能手工设置 `Cookie` 头 | SDK 浏览器入口在第三方网页里拿不到登录态 |
| CORS | `weibo.com` 不向第三方源开放 `Access-Control-Allow-Origin` | 网页 SPA 直接调 `/ajax/*` 会被浏览器拦截 |
| Referer / 防盗链 | 微博图片按 Referer 校验 | 浏览器批量下载图片不可靠；老项目为此写了 Go 本地服务器 |
| 存储 | 万级微博 + 评论 + 媒体索引 | IndexedDB 可用但不利于搜索、增量、跨端迁移 |
| 长任务 | 页面卸载即中断 | 网页不适合跑几十分钟的归档 |

结论：**抓取必须发生在有 Cookie、有文件系统、无 CORS 的进程里**。网页只能做「导入后的查看器」。

### 5.2 SDK 与 MyGo 的接缝是否成立

| SDK 侧 | MyGo 侧 | 判断 |
|---|---|---|
| `fetchTransport({ fetch })` | `@mygo-plugins/fetch` 的 `fetch` 形状 = 标准 `fetch` | **成立**（需 POC 验证超时 / manual redirect / 文本响应） |
| `AuthService` 设 `Cookie` 头 | fetch 插件允许设置 `Cookie` / `Referer` / `UA` | **成立** |
| `GuestTokenService` 解析 `Set-Cookie` | fetch 插件**不暴露** `Set-Cookie` | **不成立** → 应用内禁用 guest |
| `UserArchiveStore` 端口 | Go 绑定 + SQLite | **成立**（需验证批量写入性能与续跑语义） |
| `media.downloadTweetMedia`（Node） | Go `http.Client` + 文件写入 | **需重写**（Go 侧十几行，非阻塞） |
| `config.cookie` 文件路径 / `proxy`（Node） | 应用不需要；代理可交给 `http.Client.Transport` | **不需要** |
| `wrap` 插件 / telemetry | 前端直接订阅；Go 事件转发进度 | **成立** |

### 5.3 长任务归属（唯一需要设计的地方）

- Electron 里归档循环在主进程，窗口关了也能继续；MyGo 里 SDK 在 WebView，页面关闭 / 刷新会中断。
- 缓解方式：**不裸跑**。用 `userArchive.stream({ store })`，每条记录 / checkpoint 写回 Go 的 SQLite；重开应用时同一 `store` 自动续跑（`slice-start resumed: true`）。
- 「最小化后继续跑」：最小化不销毁页面，任务继续；真正关闭窗口前确认。若后续要求「关窗继续」，再评估隐藏 worker 页面（第二个 WebView 只跑 SDK），或把归档循环移到 Go（需要 sidecar，暂不推荐）。

### 5.4 安全与隐私

- Cookie 只在 Go 内存与 SDK 实例内；不写 localStorage / IndexedDB / 日志。
- 不提供 Cookie 导出；退出登录用 `Cookies.Delete` + store 清理。
- fetch 插件用 `Allow` 限制只允许微博域名，防止页面被注入后打向其他服务器。
- 遥测默认关闭；崩溃日志本地可选，不上传。

---

## 6. 数据兼容：老归档 → 新契约

老 `ImportedData` 与新 `ArchiveFile` 不是同一层的东西：前者是「查看器的展示数据」，后者是「归档信封 + 归一化微博」。应用内做一次**有损导入**，不修改 SDK 契约。

| 老字段 | 新位置 | 处理 / 损失 |
|---|---|---|
| `Post.id` / `Post.mblogid` | `ITweet.id` / `mblogId` | 直接映射 |
| `Post.createdAt` / `text` / `regionName` / `source` | `ITweet` 同名字段 | 直接映射；`source` 缺省补空串 |
| `Post.userId` | `ITweet.user.uid` | 需要 `UserInfo` 或 `Followings` 补全昵称 / 头像；缺失时用占位 |
| `Post.imgs[]` | `ITweet.media[]`（image） | URL 可保留；宽高 / 尺寸 / LivePhoto 信息丢失 |
| `Post.repostsCount` / `commentsCount` / `likesCount` | `ITweet.stats` | 直接映射 |
| `Post.card` | `ITweet.pageInfo` / `linkCards` | 有损：老卡片只有 link / title / img / desc |
| `Post.retweet` | `ITweet.retweetedStatus` | 递归映射；老 retweet 没有评论 |
| `Post.comments[]` | `ArchivedTweet.comments[]` | 映射 `floor` / 点赞；**没有楼中楼** |
| `Post.isShowBulletIn` | 无对应 | 丢弃 |
| `Comment.img` | `ITweetComment.pics[]` | 构造 `{ id, imageUrl, width: 0, height: 0 }`；宽高丢失 |
| `UserInfo` | `IUser` | 部分可得（bio / followers / followings / postCount）；认证、等级等缺失 |
| `Followings` | 无对应 | `ArchiveFile` 不含关注列表 → 应用侧单独存表或丢弃 |
| `Favorites` | 无对应 | `ArchiveFile` 不含收藏 → 应用侧单独存表或丢弃 |

**结论**：老归档可以「看得到」，但评论区、关注、收藏会有信息损失。导入时要显式提示，不假装无损。

---

## 7. 待验证假设（POC 必须回答）

| # | 假设 | 验证方式 | 失败影响 |
|---|---|---|---|
| A1 | `@chilfish/weibo-sdk/browser`（内联 axios / zod）能在系统 WebView 里加载并运行 | M0：`mygo dev` 里 import + 调 `capabilities()` | 大：需要调整打包或改用 Node sidecar |
| A2 | MyGo fetch 与 `FetchTransport` 语义一致（状态码 / 超时 / abort / manual redirect / 非 JSON） | M1：真实请求 + 故障注入 | 大：需自定义 transport 适配层 |
| A3 | 登录后 `mygo.Cookies.List` 能拿到可用 Cookie（含 HttpOnly），Windows 与 macOS 都成立 | M2：两端各跑一次 | 大：登录流程需换方案 |
| A4 | `UserArchiveStore` 接 SQLite 后，杀进程可续跑且不重复 | M3：中途 kill → 重开 | 中：退化为保存 JSON journal |
| A5 | Go 侧带 Referer 下载媒体稳定，签名 URL 过期可恢复 | M4：下载 50 张 + 构造过期 URL | 中：媒体改为可选能力 |
| A6 | WebView 内长任务在最小化 / 空闲时不被节流 | M3：最小化 5 分钟对比进度 | 中：需要 worker 页 |
| A7 | `mygo build` 产物在干净 Windows 10/11 与 macOS 可运行，体积可接受 | M5：两端打包 | 中：需要引导安装 WebView2 运行时 |
| A8 | MyGo 版本与 API 稳定性 | M0 固定版本；观察 changelog | 大：框架风险，回退 Electron |

---

## 8. 事实来源

**本仓库代码**

- `src/services/internal/transport/{types,FetchTransport}.ts`
- `src/services/internal/AuthService.ts`、`GuestTokenService.ts`
- `src/types/domain/ITweet.ts`
- `src/types/archive/{IArchiveFile,IUserArchive}.ts`
- `src/models/data/migrateTweet.ts`
- `website/guide/{installation,environments}.md`
- `docs/planning/research-*.md`（归档、插件、访客、特殊格式）

**外部**

- 老项目：<https://github.com/Chilfish/Weibo-archiver>（`apps/web-v2/package.json`、`apps/monkey/package.json`、`packages/core/src/types/{post,user,index}.ts`）
- 老项目文档：<https://weibo-archiver.chilfish.top/docs/intro.html>
- MyGo 总览：<https://mygo.egoist.dev/docs.md>、<https://mygo.egoist.dev/llms.txt>
- MyGo 绑定：<https://mygo.egoist.dev/docs/bindings.md>
- MyGo fetch：<https://mygo.egoist.dev/docs/plugins/fetch.md>
- MyGo SQLite：<https://mygo.egoist.dev/docs/plugins/sqlite.md>
- MyGo 分发：<https://mygo.egoist.dev/docs/distribution.md>
- MyGo Cookie：<https://mygo.egoist.dev/docs/app.md>（Browsing data / Cookies 一节）
