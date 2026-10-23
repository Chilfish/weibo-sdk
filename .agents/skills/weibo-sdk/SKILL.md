---
name: weibo-sdk
description: 用 bun 直接跑本地 weibo-sdk 源码读取微博公开数据（用户资料、时间线、单条微博上下文、评论、转发、点赞者、收藏、媒体下载、热搜超话），或把一个账号归档到本地、给 SDK 新增逆向端点。当任务提到微博数据、weibo-cli、weibo-sdk、拉微博、微博归档、首页最新微博、这条微博在说什么、tweet context 时使用。
license: MIT
metadata:
  author: Chilfish
  version: 2.0.0
  requires: bun 1.1+，pnpm 装好的 node_modules
---

# weibo-sdk：读取与归档微博数据（源码直跑版）

本地 checkout 的 `weibo-sdk` 仓库，用 **bun 直接执行 TypeScript 源码**。不装 npm 包、不 `pnpm build`、不用 `dist/`。
CLI 与 SDK 共用同一套服务，能力保持一致。

## 重要（先读这三条）

1. **依赖只能用 pnpm 装。** `bun install` 能装完但会产出坏缓存：axios 的 lazy 模块被改名成 `.0002` 之类，node 侧 import 直接报 `ERR_UNKNOWN_FILE_EXTENSION`；bun 侧则报 `Export named 'sanitizeHeaderValue' not found`。正确姿势是 `pnpm install --frozen-lockfile`。
2. **不要 `cd` 进仓库再跑。** CLI 的 Cookie 默认取 `<pwd>/.env`，包装脚本刻意保留调用方的 cwd；bun 从 `src/cli.ts` 的文件位置向上解析 `node_modules`，两者互不影响。
3. **只做只读。** 不要新增发帖、点赞、转发、评论、关注等写接口；私信、仅粉丝可见、付费内容不在范围内。媒体 URL 是短期签名地址，要归档就得及时下载。

## 入口

统一入口是仓库自带的 `scripts/weibo.sh`（bash 3.2+，Linux / macOS / Windows Git Bash 通用）：

```bash
.agents/skills/weibo-sdk/scripts/weibo.sh --doctor     # 环境自检：repo / bun / node_modules / .env
.agents/skills/weibo-sdk/scripts/weibo.sh --where      # 打印实际使用的 repo 和 bun
.agents/skills/weibo-sdk/scripts/weibo.sh whoami --guest
.agents/skills/weibo-sdk/scripts/weibo.sh trends --guest
```

脚本自己推断仓库位置（`$WEIBO_SDK_HOME` → 脚本的上级目录 → `$PWD` → `~/projects/weibo-sdk`），所以在哪个目录调用都行。想短一点就加个别名或软链：

```bash
ln -s "$PWD/.agents/skills/weibo-sdk/scripts/weibo.sh" ~/.local/bin/weibo   # 之后直接 weibo <命令>
```

脚本行为：
- bun 查找顺序：`$WEIBO_BUN` → `PATH` → `~/.bun/bin/bun` → `/usr/local/bin`、`/opt/homebrew/bin`、WinGet Links。Git Bash 下按 `bun.exe` 找，并把控制台切到 UTF-8（`chcp 65001`），避免中文输出乱码。
- `$WEIBO_ENV_FILE` 会在没显式传 `--env-file` 时补上。
- 退出码透传 CLI：成功 0，业务/配置失败非 0，脚本自身环境错误 64（找不到 repo/bun）或 78（缺 node_modules）。
- 文件必须是 LF 换行；Windows 上 `core.autocrlf=true` 会把 bash 脚本改成 CRLF 直接跑不起来。

## 工作流程

### 1. 先确认身份

```bash
weibo whoami            # Cookie 有效时输出当前账号
weibo whoami --guest    # 不校验登录，只给 token 元信息，退出码 0
weibo capabilities      # 每个能力的 auth / 分页 / 是否账号级
```

没有 Cookie 也能干活：`auth: 'auto'` 会自动降级到访客，显式指定用 `--guest`。
`auto` 不会在 Cookie 过期后静默转访客——能读到的范围不同，静默降级等于给调用方不完整的数据。

Cookie 只从 `.env` 读（默认 `<pwd>/.env`，或 `--env-file`，或 `-c/--cookie` 临时覆盖），**不读 shell 环境变量**，避免旧值遮蔽新值。
`.env` 里 `WEIBO_COOKIE` 可以是 header 串、Netscape `cookies.txt` 路径、或 header 文本文件路径。

### 2. 常用取数

```bash
weibo user info <uid> --guest
weibo user timeline <uid> --guest                      # 访客只有首屏，带 partial: true
weibo user timeline-stream <uid> --guest --max-items 10 # NDJSON，可截断
weibo tweet detail <mblogId> --guest
weibo tweet comments <mblogId> --guest --flow 1         # 0=热度 1=时间
weibo tweet comments-stream <mblogId> --max-pages 3
weibo tweet reposts <mblogId> --guest
weibo tweet likers <mblogId> --guest
weibo media images <uid> --guest --max-items 5          # NDJSON asset 流
weibo media download <mblogId> -o <dir>                  # 真下载，带重试/原子落盘/失败清单
weibo topic stream --keyword 游戏 --guest
weibo tweet home --since-id <数字id>                     # 首页增量，需要 Cookie
```

`<mblogId>` 参数接受 mblogId、数字 mid 或微博状态 URL（`https://weibo.com/<uid>/<mblogid>`、`https://m.weibo.cn/status/<mid>`），SDK 统一归一化。
普通命令输出格式化 JSON，`-stream` 命令输出 NDJSON（每行 `progress` / `item` / `done`），都能直接接 `jq`。
需要直接读给人看时，多数查询命令支持 `--format markdown`（`user info` / `user timeline` / `tweet detail` / `tweet comments` / `follow list|fans|my` / `like list` / `favorite list` / `notification` / `topic` / `trends` / `whoami` 等；默认仍是 JSON，管道行为不变）。流式命令仍输出 NDJSON。

### 3. 理解一条微博（给 Agent 用）

```bash
weibo tweet context <mblogId> --guest
weibo tweet context <mblogId> -f json --comments 5
weibo tweet context <mblogId> --download-media ./weibo-media   # 回填本地图片路径
```

这是本仓库最有价值的投影，务必优先用它而不是自己拼 `detail`：
- 明确区分「当前作者的正文」和「转发的原微博」——转发的 `text` 常常只是「转发微博」，信息全在原微博里。
- 每个媒体带归属（`self` / `quoted`）、临时签名 URL、封面、时长、尺寸，并给出该用哪条命令去下载（注意：原微博的媒体要用原微博的 mblogId 下，`--download-media` 会自动这么做）。
- `unknowns` 显式列出「图片没有描述 / 视频没有字幕」这类缺口；`hints` 给出 `quoted_post:author_is_not_the_poster` 之类的提醒。
- 不调用任何 LLM。OCR、视觉描述、视频转写由调用方自己补。

### 4. 归档一个账号（需要 Cookie）

```bash
weibo archive <uid> --images --state .weibo-archive-state.json
weibo archive --uid-file uids.txt --state .weibo-archive-state.json
weibo archive <uid> --incremental-since 2026-01-01 --stop-at <mblogId> --skip-pinned

# 指定范围 + 深度补全，输出单个 JSON（推荐给「归档某段时间」）
weibo archive user <uid> --since 2026-01-01 --until 2026-03-31 -o ./weibo-archive.json
```

- `item.source` ∈ `timeline` / `repost` / `favorite` / `like` / `comment` / `image` / `video`；媒体在 `item.asset`，图片项可能没有 `item.tweet`。
- 续跑是 **at-least-once**：checkpoint 记录最后一条完整处理的项，中断重跑可能重复边界 1 条；图片墙和视频瀑布按整页回写游标，会重放整页。按 `mblogId`（媒体按 `asset.id`）幂等去重。
- `includeFavorites` / `includeCommentHistory` 是**账号级**数据，只能读 Cookie 对应的登录账号；归档别人时传这些会 `CONFIG_INVALID`。
- 访客模式直接 `CONFIG_INVALID`：匿名只有首屏，无法保证完整。
- `archive user` 是范围归档：逐条重新拉详情/长文，默认补一级评论和楼中楼，`--reposts` 再拉转发；最终写一个 `ArchiveFile`。进度在 `<out>.slices/`，重跑同一命令续跑，`--fresh` 重来。SDK 对应 `sdk.userArchive.run()` / `.stream()`。

### 5. 写 SDK 脚本（同样 bun 直跑）

脚本放在仓库内或任意位置都可以。仓库内用包名（`tsconfig.json` 的 paths 指向 `src/index.ts`）：

```ts
import { WeiboSDK } from '@chilfish/weibo-sdk'
```

仓库外用绝对路径 import `src/index.ts`：

```ts
import { WeiboSDK } from '/path/to/weibo-sdk/src/index.ts'

const sdk = new WeiboSDK({ auth: 'guest' })      // 或 { cookie }

for await (const t of sdk.tweets.streamByUserId('1111681197', { maxPages: 1 }))
  console.log(t.mblogId, t.text)

const ctx = await sdk.tweets.context('Rnzctqb28', { comments: 5 })
ctx.post.text      // 只含当前作者本人发言
ctx.quoted?.media  // 原微博的媒体
ctx.unknowns
```

```bash
bun /path/to/script.ts
```

#### 自定义 transport 与插件

需要换 HTTP 实现（Worker / Edge / 测试替身）或加缓存、日志、指标时，用构造配置，不要改核心：

```ts
import { fetchTransport, WeiboSDK } from '@chilfish/weibo-sdk'

const sdk = new WeiboSDK({
  cookie,
  transport: fetchTransport({ fetch: myFetch }),
  plugins: [
    { name: 'metrics', apiVersion: 1, enforce: 'post', observe: event => metrics.push(event) },
    { name: 'headers', apiVersion: 1, hooks: { beforeRequest: ctx => { ctx.headers['x-client'] = 'app' } } },
  ],
})
```

- 插件在构造期组装，按 `pre → normal → post` 排序；同名或 `apiVersion !== 1` 直接 `CONFIG_INVALID`。
- `transport` 中间件可缓存 / mock / 熔断 / 签名；`beforeRequest` / `afterResponse` / `beforeRetry` / `onError` 可改请求、重试延迟或终态错误；`observe` 只读且吞异常。
- 默认仍是 axios；`new WeiboSDK({})` 零配置行为不变。
- 完整契约：`website/reference/plugins.md`（公开站点）；离线示例：`pnpm play plugins`。

### 6. 新增或修正端点

1. 先验证真实行为。优先复用已登录的 Chrome（OpenCLI browser bridge，见 `docs/engineering/opencli-browser-bridge.md`）或项目的 `capture/`，在页面内用 `fetch(..., { credentials: 'include' })` 复放接口。
2. 至少抓两种变体，例如正常页、空页、边界值或不同账号。脱敏后放进 `tests/fixtures/raw/`。
3. 在 `scripts/validate-fixtures.ts` 的 `FIXTURE_RULES` 和 `tests/fixtures/raw/INDEX.md` 登记。
4. 在 `src/services/endpoints/<domain>.ts` 定义 `argsSchema`、`schema`、`buildResource`、`okPolicy` 和 `auth`，用 `defineEndpoint()` 包装。`auth` 默认 `cookie`；只有亲自用访客 token 验证过可读的端点才标 `guest`。
5. 在 Service 中调用 `this.request(spec, args)`。归一化逻辑放在 `src/models/data/`。
6. 同步添加 CLI 子命令，补 unit / component 测试。
7. 运行 `pnpm run typecheck && pnpm run lint && pnpm test && pnpm run validate:fixtures`。

## 分页规则

| 游标 | 端点 |
|---|---|
| `page` | mymblog、likes、favorites、followings/fans、reposts、likers |
| `max_id` | comments、comment history、mentions、notifications、首页 Feed（`maxId`） |
| `since_id` | 图片墙 / 相册；首页 Feed 仅做增量过滤 |
| `cursor` | 视频瀑布 |

`stream*` 统一支持 `--max-pages` / `--max-items`；时间倒序的流额外支持 `--since` / `--until`（`YYYY-MM-DD` / `YYYYMMDD` / unix 秒）。
首页 Feed 的 `total_number` 是约 2000 的上限值，不代表剩余条数；`since_id` 不是翻页游标。

## 错误处理

按 `code` 判断，不要匹配文案。错误以 JSON 写到 stderr，退出码非 0。

| `code` | 含义 | 处理 |
|---|---|---|
| `AUTH_SESSION_EXPIRED` | Cookie 缺失/过期，或该能力需要 Cookie | 看 `context.requiredAuth`；为 `cookie` 就换 Cookie 或改用访客可读的能力，重试无意义 |
| `CONFIG_INVALID` | 配置非法（Cookie 路径不存在、访客访问不可用能力、访客请求第 2 页） | 修参数，不要重试 |
| `RATE_LIMITED` | HTTP 432 / 429 风控 | 停并发、退避，SDK 已自动重试，不要绕过 |
| `API_NOT_OK` | 上游 `ok != 1`（微博不存在、权限不足等） | 看 `context.message` / `error_code` |
| `API_BAD_RESPONSE` | schema 校验失败（字段变了或拿到登录页） | 抓新响应放宽 schema，别用 `.strict()` 锁死 |
| `NET_TIMEOUT` / `NET_REQUEST_FAILED` | 网络层 | 可重试；沙箱里注意 DNS |

## 访客能力边界

- 完整可用：用户资料、单条微博、长文、评论（可翻页）、转发、点赞者、图片墙、视频、相册、超话、热搜、媒体下载。
- 只有第一页：用户时间线、点赞、关注、粉丝（`partial: true` / `next_cursor: 0`，请求第 2 页报 `CONFIG_INVALID`）。
- 不可用：首页关注时间线、日期搜索、收藏、通知、@我、历史评论、微博分组、公开搜索 → `AUTH_SESSION_EXPIRED`。
- 归档不可用 → `CONFIG_INVALID`。

## 示例

**「这条微博在说什么？图里是什么？」**

```bash
weibo tweet context Rnzctqb28 --comments 5 --download-media /tmp/wb-media
```

先读 Markdown 里的「谁发的 / 说了什么 / 转发的原微博 / 配了什么」，再看 `unknowns` 决定是否需要真的读图。需要读图时用回填的本地路径直接打开文件。

**「把这个账号的微博和图片存下来」**

```bash
weibo archive 1111681197 --images --state .weibo-state.json
```

流里的 `item.checkpoint` 落盘后，下次带同一个 `--state` 自动续传。

**「把这个账号某段时间的微博连评论一起存成一个文件」**

```bash
weibo archive user 1111681197 --since 2026-01-01 --until 2026-03-31 -o ./weibo-archive.json
```

默认补一级评论和楼中楼，但各只翻 2 页；`--all-comments` / `--all-replies`（或 `--max-*-pages 0`）才拉完。`--no-comments` / `--no-replies` 关闭，`--reposts` 额外拉转发。进度在 `./weibo-archive.json.slices/`，中断后重跑同一命令续跑；`--fresh` 丢弃进度。大账号用 `--fast` 提高吞吐，按日期分段跑最后 `archive merge`。

**拉首页最新微博并增量保存**

```bash
weibo tweet home                      # 拿第一页和 maxId
weibo tweet home --since-id <最新的数字 id>   # 下次只取更新的
weibo tweet home --max-id <maxId>            # 往旧翻
```

增量只请求一页（首页固定 25 条），`since_id` 不是翻页游标。

## 故障排除

### `weibo --doctor` 报 deps MISSING
仓库没有 `node_modules`。`pnpm install --frozen-lockfile`。不要用 `bun install`（见开头第 1 条）。

### Git Bash 下报 `$'\r': command not found`
脚本被换行符改成了 CRLF。`git config core.autocrlf input` 或对单个文件 `dos2unix`。仓库里建议加 `.gitattributes`：`*.sh text eol=lf`。

### 一切命令都报 `AUTH_SESSION_EXPIRED`，但明明有 `.env`
确认你在**有 `.env` 的目录**里执行（默认 `<pwd>/.env`），或者显式 `--env-file` / `WEIBO_ENV_FILE` / `-c`。`--guest` 会完全忽略 Cookie，别混用。

### 首页 Feed 翻页重复，或只给一页
把 `since_id` 当翻页游标了。翻旧页用响应里的 `maxId`，增量才用 `sinceId`，跨页按 `mblogId` 去重。

### `pnpm test` 打了真实网络
`.env` 里混进了 `WEIBO_E2E`。它只该由 `vitest.e2e.config.ts` 设置。

## 参考

- `references/cli.md` — 完整命令树、分组、常用 flag、输出形态。
- `references/sdk.md` — SDK 服务与方法、模型字段（`ITweet` / `IUser` / `ITweetContext`）、归档产物结构。
- 仓库文档：`website/cli/index.md`、`docs/engineering/cli-architecture.md`、`docs/engineering/technical-spec.md`、`website/reference/plugins.md`、`docs/engineering/endpoint-authoring.md`、`website/reference/troubleshooting.md`、`docs/postmortem/README.md`（写码前必读高频雷区）。
