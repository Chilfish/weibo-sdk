---
name: weibo-sdk
description: Reads or archives a Weibo account's public data (home feed, timeline, tweets, comments, reposts, likes, favorites, comment history, media, mentions, notifications, groups) through @chilfish/weibo-sdk or weibo-cli, and adds new reverse-engineered Weibo endpoints with fixtures, schema, service, CLI, and tests. Use when the task mentions Weibo data, weibo-cli, weibo-sdk, archiving a Weibo account, or capturing/adding a Weibo API endpoint; trigger phrases include "拉微博", "微博归档", "首页最新微博", "weibo-cli", "weibo-sdk", "add Weibo endpoint".
license: MIT
metadata:
  author: Chilfish
  version: 1.1.0
---

# weibo-sdk：读取与归档微博数据

通过 `@chilfish/weibo-sdk` 或 `weibo-cli` 读取微博公开数据，或者按数据驱动的流程新增逆向端点。SDK 和 CLI 共用同一套服务，能力保持一致。

## 开始之前

- 只做只读操作。不要新增发帖、点赞、转发、评论、关注等写接口。
- Cookie 只从 `.env` 读取。默认路径是当前目录的 `.env`，可以用 `--env-file` 指定，`--cookie` / `-c` 可以临时覆盖。不要回退到 shell 环境变量。
- CLI 把结果写到 stdout，把错误 JSON 写到 stderr，失败时以非零状态退出。处理错误时优先判断 `code`，不要匹配文案。
- 默认测试不访问网络。真实网络用例只有在 `WEIBO_E2E=1` 且 `.env` 里有 `WEIBO_COOKIE` 时才运行。
- 不要提交真实 Cookie 或未脱敏的个人数据。fixture 需要先脱敏再入库。

## 工作流程

### 1. 检查登录和环境

```bash
weibo-cli whoami          # 校验 Cookie，输出当前用户
weibo-cli capabilities    # 查看能力、分页类型和状态
```

如果 `whoami` 失败，先确认浏览器里的 `weibo.com` 仍然登录，然后重新导出 Cookie 到 `.env`。Node 侧也接受 Netscape `cookies.txt` 路径或包含 Cookie header 的文本文件。

### 2. 用 CLI 取数

```bash
weibo-cli user timeline <uid>
weibo-cli tweet detail <mblogId>
weibo-cli tweet comments-stream <mblogId> --max-pages 3
weibo-cli tweet home                          # 首页第一页
weibo-cli tweet home --max-id <上一页 maxId>   # 往旧翻
weibo-cli tweet home --since-id <微博数字 id>  # 只取更新的微博
weibo-cli tweet home-stream --max-pages 3     # NDJSON
weibo-cli follow stream <uid> --max-pages 2
weibo-cli media albums <uid>
weibo-cli topic stream --keyword 游戏
weibo-cli archive <uid> --likes --comment-history --images --videos
weibo-cli archive --uid-file uids.txt --state .weibo-archive-state.json
```

流式命令输出 NDJSON，每行是一个 `progress`、`item` 或 `done` 事件，可以直接接 `jq`。

`tweet` 和 `media download` 的 id 参数接受 mblogId、数字 mid 或微博状态 URL，例如 `https://m.weibo.cn/status/5356120103455672`。点赞者接口只接受数字 mid，传其他格式时 SDK 会先自动解析。

### 3. 用 SDK 集成

```ts
import { WeiboSDK } from '@chilfish/weibo-sdk'

const sdk = new WeiboSDK({ cookie })

const page = await sdk.tweets.listByUserId(uid)
const tweet = await sdk.tweets.getByMblogId(mblogId)
const home = await sdk.tweets.listFriendTimeline() // 翻旧页用 home.maxId

for await (const t of sdk.tweets.streamFriendTimeline({ maxPages: 3 })) {
  // ...
}

for await (const c of sdk.tweets.streamComments(mblogId, { maxPages: 3 })) {
  // ...
}

for await (const item of sdk.archive.streamArchive(uid, {
  includeLikes: true,
  includeCommentHistory: true,
  includeImages: true,
  includeVideos: true,
  incremental: { since: '2026-01-01', stopAtMblogId: lastSeenId },
})) {
  await persist(item)
  await saveCheckpoint(item.checkpoint)
}
```

`ArchiveItem.source` 可能是 `timeline`、`repost`、`favorite`、`like`、`comment`、`image` 或 `video`。媒体资产在 `item.asset`，图片项可能没有 `item.tweet` 或 `item.mblogId`。

### 4. 新增或修正端点

1. 先验证真实行为。优先复用已登录的 Chrome（OpenCLI browser bridge，见 `docs/engineering/opencli-browser-bridge.md`）或项目的 `capture/`，在页面内用 `fetch(..., { credentials: 'include' })` 复放接口。
2. 至少抓两种变体，例如正常页、空页、边界值或不同账号。脱敏后放进 `tests/fixtures/raw/`。
3. 在 `scripts/validate-fixtures.ts` 的 `FIXTURE_RULES` 和 `tests/fixtures/raw/INDEX.md` 登记。
4. 在 `src/services/endpoints/<domain>.ts` 定义 `argsSchema`、`schema`、`buildResource` 和 `okPolicy`，用 `defineEndpoint()` 包装。
5. 在 Service 中调用 `this.request(spec, args)`。归一化逻辑放在 `src/models/data/`。
6. 同步添加 CLI 子命令，补 unit / component 测试。
7. 运行 `pnpm run typecheck && pnpm run lint && pnpm test && pnpm run validate:fixtures`。

## 示例

### 拉取首页最新微博并增量保存

用户说：「拉一下我首页最新微博，只取新的。」

1. 运行 `weibo-cli tweet home`，拿到第一页和 `maxId`。
2. 记下已知最新微博的数字 `id`。
3. 下次运行 `weibo-cli tweet home --since-id <id>`，只返回比该 id 更新的微博。
4. 需要往旧翻时，用 `weibo-cli tweet home --max-id <maxId>`。

增量只请求一页，首页固定返回 25 条。`since_id` 不是翻页游标。

### 归档一个账号

用户说：「把这个账号的微博和图片都存下来。」

```bash
weibo-cli archive <uid> --images --state .weibo-archive-state.json
```

命令会流式输出 `item.checkpoint`。把 checkpoint 落盘后，下次带 `--state` 运行会自动续传。

## 分页规则

| 游标 | 端点 |
|---|---|
| `page` | mymblog、likes、favorites、followings/fans、reposts、likers |
| `max_id` | comments、comment history、mentions、notifications、首页 Feed（`maxId`） |
| `since_id` | 图片墙 / 相册；首页 Feed 仅做增量过滤 |
| `cursor` | 视频瀑布 |

流式方法在空页、整页重复、游标不前进、达到 `total` 或 `maxPages` 时停止。首页 Feed 的 `total_number` 固定为 2000 左右的上限值，不代表剩余条数。

## 常见问题

### 返回登录页或 `AUTH_SESSION_EXPIRED`

Cookie 缺失或过期。在浏览器重新登录 `weibo.com`，重新导出 Cookie 到 `.env` 的 `WEIBO_COOKIE`，然后运行 `weibo-cli whoami` 确认。

### `RATE_LIMITED`（HTTP 432 / 429）

触发了微博风控。停止并发请求，等待退避。SDK 会自动暂停令牌桶，并按 `Retry-After` 重试。不要绕过限流。

### 首页 Feed 翻页重复，或者只返回一页

通常是把 `since_id` 当成了翻页游标，或者 `max_id` 没有前进。翻旧页用响应里的 `maxId` / `max_id`，增量才用 `sinceId`。跨页按 `mblogId` 去重。

### `API_BAD_RESPONSE` 或 schema 校验失败

可能是微博字段变了，也可能拿到的是登录页或风控页。抓一份新的真实响应，对照 schema 放宽 optional 或 union 字段，不要用 `.strict()` 锁死响应。

### `pnpm test` 访问了真实网络

`WEIBO_E2E` 被写进了 `.env`。从 `.env` 删掉它，这个变量只由 `vitest.e2e.config.ts` 设置。

## 范围与安全

- 只读。私信、仅粉丝可见和付费内容不在范围内。
- 尊重微博条款、限流和隐私，只使用自己的账号 Cookie。
- 媒体 URL 是短期签名地址，归档时需要及时下载。
