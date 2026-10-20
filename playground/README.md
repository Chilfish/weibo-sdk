# Weibo SDK Playground

把 `@chilfish/weibo-sdk` / `weibo-cli` 当作**真实下游**来用的场景化示例。每个场景都可直接运行，输出以 JSON / NDJSON 为主，方便 `jq` 或 Agent 消费。

- **SDK 场景**：`import { WeiboSDK } from '@chilfish/weibo-sdk'`，演示归一化模型、流式分页、归档、telemetry、错误诊断。
- **CLI 场景**：运行真实的 `weibo-cli`，演示命令组合、输出形态与 `.env` 注入。

## 快速开始

```bash
pnpm install

# 1) 准备 Cookie（二选一：根目录 .env 或 playground/.env）
cp playground/.env.example playground/.env
# Windows PowerShell: Copy-Item playground/.env.example playground/.env
# 编辑 WEIBO_COOKIE：Cookie header 串，或 Netscape cookies.txt / header 文本路径

# 2) 列出所有场景
pnpm play

# 3) SDK 场景
pnpm play whoami
pnpm play tweet-comments QqsYymYOS --max-pages 1

# 4) CLI 场景（第一次需要先构建 dist）
pnpm build
pnpm play cli:home
```

> SDK 场景在仓库内通过 `tsconfig.json` 的 `paths` 把 `@chilfish/weibo-sdk` 映射到 `src/index.ts`，所以不用先 build；CLI 场景运行 `dist/cli.mjs`，需要 `pnpm build`（或用 `WEIBO_CLI_BIN` 指向已安装的 `weibo-cli`）。

## Cookie 规则

与 CLI 一致：**只读 `.env` 文件，不读 shell 环境变量**（避免旧 Cookie 静默遮蔽新值）。

优先级从低到高：

1. 仓库根目录 `.env`
2. `playground/.env`
3. `--env-file <path>`
4. `--cookie "<header 串 / cookies.txt 路径>"`

CLI 场景会自动把最终命中的 `.env` 作为 `--env-file` 注入；显式 `--cookie` 会以 `--cookie` 注入（终端显示会脱敏）。

```bash
pnpm play whoami --env-file ./playground/.env
pnpm play whoami --cookie "SUB=...; SUBP=...; XSRF-TOKEN=..."
```

## 场景清单

### SDK 场景

| id | 文件 | 展示的能力 |
|---|---|---|
| `whoami` | [`sdk/whoami.ts`](./sdk/whoami.ts) | `checkSession` / `myDetails` / `getById` / `capabilities` |
| `user-timeline` | [`sdk/user-timeline.ts`](./sdk/user-timeline.ts) | 用户资料、`listByUserId`、有界 `streamByUserId` |
| `home-feed` | [`sdk/home-feed.ts`](./sdk/home-feed.ts) | 首页 Feed `max_id` 翻旧页、`since_id` 增量 |
| `tweet-comments` | [`sdk/tweet-comments.ts`](./sdk/tweet-comments.ts) | 详情、评论流、图片评论 `pics`、楼中楼 |
| `media-gallery` | [`sdk/media-gallery.ts`](./sdk/media-gallery.ts) | 图片墙 `since_id`、视频瀑布 `cursor`、相册 |
| `download-media` | [`sdk/download-media.ts`](./sdk/download-media.ts) | `downloadByMblogId`、dry-run、逐项状态 |
| `favorites-likes` | [`sdk/favorites-likes.ts`](./sdk/favorites-likes.ts) | 收藏标签/流、我赞过的、历史评论 |
| `social-graph` | [`sdk/social-graph.ts`](./sdk/social-graph.ts) | 关注/粉丝/@我/分组/点赞者 |
| `notifications` | [`sdk/notifications.ts`](./sdk/notifications.ts) | 评论通知、点赞通知（`max_id`） |
| `topics-trends` | [`sdk/topics-trends.ts`](./sdk/topics-trends.ts) | 热搜、超话分类/关键词搜索 |
| `archive` | [`sdk/archive.ts`](./sdk/archive.ts) | `streamArchive`、checkpoint、增量、多数据源、`onRaw` |
| `archive-batch` | [`sdk/archive-batch.ts`](./sdk/archive-batch.ts) | `streamUsersArchive`、每 uid checkpoint、失败隔离 |
| `telemetry` | [`sdk/telemetry.ts`](./sdk/telemetry.ts) | `createJsonlTelemetry`、进度摘要（**离线**） |
| `diagnose` | [`sdk/diagnose.ts`](./sdk/diagnose.ts) | 能力清单 + 结构化错误（离线；`--probe` 真实探测） |
| `raw-enrich` | [`sdk/raw-enrich.ts`](./sdk/raw-enrich.ts) | `tweets.enrich`、长文、`hooks.onRaw` |

所有 tweet id 参数（`tweet-comments` / `download-media` / CLI 的 `tweet`、`media download`）都接受
mblogId、数字 mid 或微博状态 URL（如 `https://m.weibo.cn/status/5356120103455672`）。

常用参数：

```bash
pnpm play <id> [uid|mblogId] [--max-pages 1] [--max-items 50]
pnpm play archive 1111681197 --likes --images --max-pages 1
pnpm play archive 1111681197 --resume --max-pages 1
pnpm play archive-batch --uid-file playground/uids.example.txt
pnpm play download-media QqsYymYOS --include pic,video --write
```

### CLI 场景

完整命令食谱见 [`cli/README.md`](./cli/README.md)。

| id | 组合 |
|---|---|
| `cli:whoami` | `whoami` + `capabilities --status stable` |
| `cli:user` | `user info` + `user timeline` |
| `cli:home` | `tweet home` + `tweet home-stream` |
| `cli:comments` | `tweet detail` + `tweet comments-stream` |
| `cli:media` | `media images` / `videos` / `albums` |
| `cli:download` | `media download --dry-run` |
| `cli:favorites` | `favorite tags/stream` + `like stream` + `comment stream` |
| `cli:social` | `follow stream/fans-stream` + `user mentions-stream` + `notification comments-stream` |
| `cli:topics` | `trends` + `topic cates/stream` |
| `cli:archive` | `archive --no-favorites --max-pages 1` |
| `cli:archive-resume` | `archive --state <output>/cli-archive-state.json` |
| `cli:enrich` | `tweet enrich --longtext` |
| `cli:diagnose` | `capabilities --status degraded` / `--service archive`（离线） |

## 输出与安全边界

- 产物统一写到 `playground/output/`（已 gitignore）：归档 NDJSON、checkpoint、raw、媒体下载、telemetry JSONL。
- 所有示例默认**有界**：流式场景 `maxPages: 1`，归档默认 `--max-items 200`；不会无休止翻页。
- 媒体下载默认 **dry-run**，只有 `--write` 才真正下载。
- 只读：不提供发帖、点赞、转发、评论、关注等写操作。
- 媒体 URL 是短期签名 URL（约 1 小时、一次性），归档消费方需要及时下载。
- 请只使用自己的账号 Cookie，并遵守微博条款与合理请求频率。

## 新增一个 SDK 场景

1. 在 `playground/sdk/` 新建文件，导出 `scenario: SdkScenario`（`kind` / `id` / `title` / `summary` / `usage` / `run`）。
2. 从 `@chilfish/weibo-sdk` 导入（不要从 `src/` 相对路径导入），保持用户视角。
3. 在 `playground/run.ts` 的 `SDK_SCENARIOS` 注册。
4. 跑 `pnpm run typecheck` 和 `pnpm play <id>`。
5. 如果是纯离线场景，加 `requiresCookie: false`。

## 排障

| 症状 | 处理 |
|---|---|
| `未找到 WEIBO_COOKIE` | 复制 `.env.example`，或 `--cookie` 显式传入 |
| `AUTH_SESSION_EXPIRED` | Cookie 过期；重新登录浏览器并导出 |
| `RATE_LIMITED` | HTTP 432/429；降低并发/加长间隔，让 SDK 退避 |
| `API_BAD_RESPONSE` | 上游返回登录页/风控页或 schema 漂移；先 `pnpm play diagnose --probe` |
| `CONFIG_INVALID` | Cookie 文件路径/格式、日期参数等配置问题 |
| 公开搜索不可用 | `sdk.search.*` 上游失效；个人主页搜索用 `tweets.searchByDate` |
| CLI 找不到 | 先 `pnpm build`，或 `WEIBO_CLI_BIN=/path/to/weibo-cli` |
