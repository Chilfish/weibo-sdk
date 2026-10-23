# Weibo SDK Playground

`playground/` 是 `@chilfish/weibo-sdk` 和 `weibo-cli` 的可运行示例集合。每个场景都按真实调用方的方式编写，输出以 JSON 或 NDJSON 为主，方便用 `jq`、脚本或 Agent 继续处理。

- SDK 场景直接 `import { WeiboSDK } from '@chilfish/weibo-sdk'`，演示模型、流式分页、归档、遥测和错误诊断。
- CLI 场景运行真实的 `weibo-cli`，演示命令组合、输出形态和 `.env` 注入。

## 快速开始

```bash
pnpm install

# 1. 准备 Cookie：根目录 .env 或 playground/.env 都可以
cp playground/.env.example playground/.env
# Windows PowerShell: Copy-Item playground/.env.example playground/.env
# 编辑 WEIBO_COOKIE，填入 Cookie header，或者 Netscape cookies.txt / header 文本的路径

# 2. 列出所有场景
pnpm play

# 3. 运行 SDK 场景
pnpm play whoami
pnpm play tweet-comments QqsYymYOS --max-pages 1
pnpm play tweet-attachments RnQe6zQ70      # 文章；不传 id 会依次跑文章/投票/直播/抽奖样本
pnpm play plugins                               # 离线：插件 / 自定义 transport

# 4. 运行 CLI 场景，第一次需要先构建 dist
pnpm build
pnpm play cli:home
pnpm play cli:attachments RnQe6zQ70
```

SDK 场景通过 `tsconfig.json` 的 `paths` 指向 `src/index.ts`，可以直接运行。CLI 场景运行 `dist/cli-bin.mjs`，先执行 `pnpm build`；也可以用 `WEIBO_CLI_BIN` 指向已安装的 `weibo-cli`。

## 访客模式

只看公开数据时，CLI 的每个命令都支持 `--guest`，直接在仓库根目录用 `pnpm tsx` 跑源码：

```bash
pnpm tsx src/cli.ts whoami --guest
pnpm tsx src/cli.ts tweet detail <id> --guest
pnpm tsx src/cli.ts tweet comments <id> --guest
pnpm tsx src/cli.ts trends --guest
pnpm tsx src/cli.ts user timeline <uid> --guest   # 只有第一页，结果带 partial: true
```

没有可用 Cookie 时，也会自动使用访客身份。收藏、通知、@ 我、历史评论、首页关注时间线和归档需要 Cookie，访客调用会返回 `AUTH_SESSION_EXPIRED`（`context.requiredAuth = 'cookie'`）或 `CONFIG_INVALID`。

`playground/` 里的 SDK / CLI 场景都按登录态编写，会读取 `.env`，因此需要先准备 Cookie。

## Cookie 规则

与 CLI 一致：只读 `.env` 文件，Cookie 只有一个来源。

优先级从低到高：

1. 仓库根目录 `.env`
2. `playground/.env`
3. `--env-file <path>`
4. `--cookie "<header 串 / cookies.txt 路径>"`

CLI 场景会把最终命中的 `.env` 作为 `--env-file` 注入。显式传入 `--cookie` 时，终端输出会脱敏。

```bash
pnpm play whoami --env-file ./playground/.env
pnpm play whoami --cookie "SUB=...; SUBP=...; XSRF-TOKEN=..."
```

## SDK 场景

| id | 文件 | 内容 |
|---|---|---|
| `whoami` | [`sdk/whoami.ts`](./sdk/whoami.ts) | `checkSession`、`getGuestTokenStatus`、`getSession`、`getById`、`capabilities` |
| `user-timeline` | [`sdk/user-timeline.ts`](./sdk/user-timeline.ts) | 用户资料、`listByUserId`、有界 `streamByUserId` |
| `agent-digest` | [`sdk/agent-digest.ts`](./sdk/agent-digest.ts) | Feed → `tweets.context` → 本地 Markdown 摘要（Agent 视角） |
| `home-feed` | [`sdk/home-feed.ts`](./sdk/home-feed.ts) | 首页 Feed 的 `max_id` 翻页和 `since_id` 增量 |
| `tweet-comments` | [`sdk/tweet-comments.ts`](./sdk/tweet-comments.ts) | 详情、评论流、图片评论和楼中楼 |
| `tweet-engagements` | [`sdk/tweet-engagements.ts`](./sdk/tweet-engagements.ts) | 单页评论 / 楼中楼 / 转发 / 点赞者 / 长文 / 日期检索 |
| `tweet-attachments` | [`sdk/tweet-attachments.ts`](./sdk/tweet-attachments.ts) | `tweet.attachments` / `context.post.attachments`：文章、投票、直播、抽奖（默认跑 4 条公开样本） |
| `media-gallery` | [`sdk/media-gallery.ts`](./sdk/media-gallery.ts) | 图片墙、视频瀑布、相册（单页 + 流式） |
| `download-media` | [`sdk/download-media.ts`](./sdk/download-media.ts) | `downloadByMblogId`、`downloadTweetMedia`、dry-run、逐项状态 |
| `favorites-likes` | [`sdk/favorites-likes.ts`](./sdk/favorites-likes.ts) | 收藏 / 点赞 / 历史评论的单页与流式口径 |
| `social-graph` | [`sdk/social-graph.ts`](./sdk/social-graph.ts) | 关注、粉丝、@ 我、分组、点赞者的 `get*` / `stream*` 对比 |
| `notifications` | [`sdk/notifications.ts`](./sdk/notifications.ts) | 评论通知和点赞通知（单页 + 流式） |
| `topics-trends` | [`sdk/topics-trends.ts`](./sdk/topics-trends.ts) | 热搜、超话分类 / 搜索 / 列表、`fetchRawBand` |
| `archive` | [`sdk/archive.ts`](./sdk/archive.ts) | `streamArchive`、checkpoint、增量、多数据源、`onRaw` |
| `archive-batch` | [`sdk/archive-batch.ts`](./sdk/archive-batch.ts) | `streamUsersArchive`、每用户 checkpoint、失败隔离 |
| `user-archive` | [`sdk/user-archive.ts`](./sdk/user-archive.ts) | `userArchive.run` / `stream`：范围归档、补全、单文件产出 |
| `archive-merge` | [`sdk/archive-merge.ts`](./sdk/archive-merge.ts) | `mergeArchiveFiles`：多份归档按 `mblogId` 合并、评论 / 楼中楼 / 转发取并集（离线） |
| `raw-snapshot` | [`sdk/raw-snapshot.ts`](./sdk/raw-snapshot.ts) | 全部 `fetchRaw*` 端点：信封形状 + 可选落盘 JSON 做 schema diff |
| `typed-consumer` | [`sdk/typed-consumer.ts`](./sdk/typed-consumer.ts) | Stable 类型的下游映射（离线，`typecheck` 验证字段形状） |
| `telemetry` | [`sdk/telemetry.ts`](./sdk/telemetry.ts) | `createJsonlTelemetry` 和进度摘要（离线） |
| `diagnose` | [`sdk/diagnose.ts`](./sdk/diagnose.ts) | 能力清单和结构化错误（离线，加 `--probe` 会请求真实接口） |
| `plugins` | [`sdk/plugins.ts`](./sdk/plugins.ts) | `fetchTransport`、transport 缓存中间件、生命周期 hooks、observer、`onError` 替换（离线） |
| `raw-enrich` | [`sdk/raw-enrich.ts`](./sdk/raw-enrich.ts) | `tweets.enrich`、长文、`hooks.onRaw` |

所有 tweet id 参数都接受 mblogId、数字 mid 或微博状态 URL，例如 `https://m.weibo.cn/status/5356120103455672`。涉及 `tweet-comments`、`download-media`，以及 CLI 的 `tweet` 和 `media download`。

常用参数：

```bash
pnpm play <id> [uid|mblogId] [--max-pages 1] [--max-items 50]
pnpm play archive 1111681197 --likes --images --max-pages 1
pnpm play archive 1111681197 --resume --max-pages 1
pnpm play user-archive 1111681197 --since 2025-01-01 --until 2025-01-31 --no-comments
pnpm play archive-merge playground/output/user-archive/1111681197.json
pnpm play archive-batch --uid-file playground/uids.example.txt
pnpm play download-media QqsYymYOS --include pic,video --write
pnpm play agent-digest --max-items 3 --comments 2
pnpm play user-archive 1111681197 --since 2025-01-01 --until 2025-01-31 --stream
pnpm play raw-snapshot 1111681197 QqsYymYOS --write
```

## 覆盖报告

`pnpm play:coverage` 扫描 playground 里对 `@chilfish/weibo-sdk` 的 import 和 `sdk.<service>.<method>()` 调用，
对照 `api-surface.json` 输出：

- Stable 导出的显式引用率与未引用清单；
- 每个 Service 的公开方法调用覆盖率与缺口；
- `WeiboSDK` 门面方法覆盖率。

```bash
pnpm play:coverage          # 人类可读报告
pnpm play:coverage --json   # 机器可读
pnpm play:coverage --strict # 有缺口时退出码 1（可接 CI）
```

运行时覆盖只统计显式调用；类型字段由 `typed-consumer` 在 `pnpm typecheck` 时验证。
两者的共同目标是：**新增导出/方法时，playground 能先于下游发现问题**。

## 扩展：自定义 transport 与插件

先跑离线示例：

```bash
pnpm play plugins
```

它演示了四件事：

1. 用 `fetchTransport({ fetch })` 替换默认 axios（同一套代码可跑在 Worker / Edge / 测试替身里）。
2. `transport` 中间件做缓存：第二次请求直接命中缓存。
3. 生命周期钩子：`beforeRequest` 加请求头、`afterResponse` 看 raw、`beforeRetry` 改延迟（或返回 `{ retry: false }` 停止重试）。
4. `observe` 收到 `request_start` / `request_retry` / `request_success`，`onError` 把上游 500 替换成业务错误。

最小用法：

```ts
import { fetchTransport, WeiboSDK } from '@chilfish/weibo-sdk'

const sdk = new WeiboSDK({
  cookie,
  transport: fetchTransport({ fetch: myFetch }),
  plugins: [
    {
      name: 'headers',
      apiVersion: 1,
      enforce: 'pre',
      hooks: {
        beforeRequest(ctx) {
          ctx.headers['x-client'] = 'my-app'
        },
      },
    },
    {
      name: 'metrics',
      apiVersion: 1,
      enforce: 'post',
      observe(event) {
        metrics.push(event)
      },
    },
  ],
})
```

约束：插件只在 `new WeiboSDK()` 时组装，没有 `sdk.use()` 热插拔；同名插件或 `apiVersion !== 1` 会抛 `CONFIG_INVALID`；`observe` 是只读观察者，抛错会被吞掉。完整契约见 [插件与传输适配](../website/reference/plugins.md)。

## CLI 场景

完整的命令食谱见 [`cli/README.md`](./cli/README.md)。

| id | 组合 |
|---|---|
| `cli:whoami` | `whoami` + `capabilities --status stable` |
| `cli:user` | `user info` + `user timeline` |
| `cli:home` | `tweet home` + `tweet home-stream` |
| `cli:comments` | `tweet detail` + `tweet comments-stream` |
| `cli:attachments` | `tweet detail` + `tweet context --format json`（文章 / 投票 / 直播 / 抽奖） |
| `cli:media` | `media images` / `videos` / `albums` |
| `cli:download` | `media download --dry-run` |
| `cli:favorites` | `favorite tags/stream` + `like stream` + `comment stream` |
| `cli:social` | `follow stream/fans-stream` + `user mentions-stream` + `notification comments-stream` |
| `cli:topics` | `trends` + `topic cates/stream` |
| `cli:archive` | `archive --no-favorites --max-pages 1` |
| `cli:archive-resume` | `archive --state <output>/cli-archive-state.json` |
| `cli:archive-merge` | `archive merge <a.json> [b.json]`（本地，需要已有归档） |
| `cli:enrich` | `tweet enrich --longtext` |
| `cli:diagnose` | `capabilities --status degraded` / `--service archive`（离线） |

## 输出与安全

- 产物写到 `playground/output/`，该目录已加入 `.gitignore`。包括归档 NDJSON、checkpoint、raw、媒体文件和 telemetry JSONL。
- 所有示例默认有界：流式场景 `maxPages: 1`，归档默认 `--max-items 200`。
- 媒体下载默认 dry-run，加 `--write` 才下载。
- 项目只读；发帖、点赞、转发、评论、关注等写操作不在范围内。
- 媒体 URL 是短期签名地址，通常约一小时后失效，归档时需要及时下载。
- 请只使用自己的账号 Cookie，并遵守微博条款和合理的请求频率。

## 新增 SDK 场景

1. 在 `playground/sdk/` 新建文件，导出 `scenario: SdkScenario`，包含 `kind`、`id`、`title`、`summary`、`usage` 和 `run`。
2. 从 `@chilfish/weibo-sdk` 导入，保持用户视角。
3. 在 `playground/run.ts` 的 `SDK_SCENARIOS` 中注册。
4. 运行 `pnpm run typecheck` 和 `pnpm play <id>`。
5. 纯离线场景加上 `requiresCookie: false`。

## 排障

| 症状 | 处理 |
|---|---|
| `未找到 WEIBO_COOKIE` | 复制 `.env.example`，或用 `--cookie` 显式传入；只想读公开数据时用 `--guest` |
| `AUTH_SESSION_EXPIRED` | Cookie 过期，重新登录浏览器并导出；`context.requiredAuth === 'cookie'` 表示访客读不到这个能力 |
| `RATE_LIMITED` | HTTP 432 / 429，降低并发或拉长间隔，让 SDK 退避 |
| `API_BAD_RESPONSE` | 微博返回登录页、风控页或 schema 漂移，先运行 `pnpm play diagnose --probe` |
| `CONFIG_INVALID` | Cookie 路径、格式或日期参数有问题；`auth: 'cookie'` 却没有 Cookie、访客请求第 2 页、访客调用归档也会报这个错 |
| 公开搜索不可用 | `sdk.search.*` 的微博接口已失效，个人主页搜索用 `tweets.searchByDate` |
| CLI 找不到 | 先运行 `pnpm build`，或设置 `WEIBO_CLI_BIN=/path/to/weibo-cli` |
