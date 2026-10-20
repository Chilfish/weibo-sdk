---
name: weibo-sdk
description: Reads or archives a Weibo account's public data (home feed, timeline, tweets, comments, reposts, likes, favorites, comment history, media, mentions, notifications, groups) through @chilfish/weibo-sdk or weibo-cli, and adds new reverse-engineered Weibo endpoints with fixtures, schema, service, CLI, and tests. Use when the task mentions Weibo data, weibo-cli, weibo-sdk, archiving a Weibo account, or capturing/adding a Weibo API endpoint; trigger phrases include "拉微博", "微博归档", "首页最新微博", "weibo-cli", "weibo-sdk", "add Weibo endpoint".
license: MIT
metadata:
  author: Chilfish
  version: 1.1.0
---

# weibo-sdk：微博数据读取与归档

通过 `@chilfish/weibo-sdk` 或 `weibo-cli` 只读地拉取微博公开数据，或按数据驱动流程新增逆向端点。

## 重要

- **只读**：不要新增发帖、点赞、转发、评论、关注等写操作。
- **Cookie 只从 `.env` 读取**（默认 `<pwd>/.env`，可用 `--env-file` 指定，`--cookie`/`-c` 显式覆盖）；不读取环境变量，避免过期值遮蔽。
- **CLI 输出 JSON 到 stdout，错误 JSON 到 stderr 并以非零退出码结束**；优先解析错误里的 `code`，不要匹配 message。
- **默认测试离线**：真实网络用例仅在 `WEIBO_E2E=1` 且 `.env` 含 `WEIBO_COOKIE` 时运行。
- **禁止提交真实 Cookie 或未脱敏的个人数据**；fixture 先脱敏再入库。

## 指令

### 步骤 1：确认登录与环境

```bash
weibo-cli whoami          # 校验 Cookie，输出当前用户
weibo-cli capabilities    # 查看能力、分页类型、状态（stable/degraded/unavailable）
```

如果 `whoami` 失败：让用户在浏览器打开 `weibo.com` 确认已登录，重新导出 Cookie 到 `.env` 的 `WEIBO_COOKIE`。Node 侧也接受 Netscape `cookies.txt` 路径或 header 串文本文件。

### 步骤 2：用 CLI 快速取数

```bash
weibo-cli user timeline <uid>
weibo-cli tweet detail <mblogId>
weibo-cli tweet comments-stream <mblogId> --max-pages 3
weibo-cli tweet home                          # 首页「最新微博」第一页
weibo-cli tweet home --max-id <上一页 maxId>   # 翻旧页
weibo-cli tweet home --since-id <微博数字 id>  # 只取更新的微博（增量）
weibo-cli tweet home-stream --max-pages 3     # NDJSON progress/item/done
weibo-cli follow stream <uid> --max-pages 2
weibo-cli media albums <uid>
weibo-cli topic stream --keyword 游戏
weibo-cli archive <uid> --likes --comment-history --images --videos
weibo-cli archive --uid-file uids.txt --state .weibo-archive-state.json
```

流式命令输出 NDJSON：每行是 `{ event: 'progress' | 'item' | 'done', ... }`，可直接管道给 `jq`。

> `tweet` / `media download` 的 id 参数接受 mblogId、数字 mid、微博状态 URL
> （如 `https://m.weibo.cn/status/5356120103455672`）；SDK/CLI 会自动归一化。
> `likers` 只收数字 mid，SDK 会自动解析。

### 步骤 3：用 SDK 集成

```ts
import { WeiboSDK } from '@chilfish/weibo-sdk'

const sdk = new WeiboSDK({ cookie })

const page = await sdk.tweets.listByUserId(uid)
const tweet = await sdk.tweets.getByMblogId(mblogId)
const home = await sdk.tweets.listFriendTimeline() // 翻旧页用 home.maxId
for await (const t of sdk.tweets.streamFriendTimeline({ maxPages: 3 })) { /* ... */ }
for await (const c of sdk.tweets.streamComments(mblogId, { maxPages: 3 })) { /* ... */ }

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

`ArchiveItem.source` 为 `timeline | repost | favorite | like | comment | image | video`。媒体项在 `item.asset`；图片项可能没有 `item.tweet` / `item.mblogId`。

### 步骤 4：新增或修正端点（数据驱动）

1. 先用真实响应验证行为：优先复用已登录 Chrome（OpenCLI browser bridge，操作手册见 `docs/engineering/opencli-browser-bridge.md`；或 `capture/`），在页面内 `fetch(..., { credentials: 'include' })` 复放接口。
2. 抓至少两种变种（正常 / 空页 / 边界 / 不同账号），脱敏后放入 `tests/fixtures/raw/`。
3. 在 `scripts/validate-fixtures.ts` 的 `FIXTURE_RULES` 与 `tests/fixtures/raw/INDEX.md` 登记。
4. 在 `src/services/endpoints/<domain>.ts` 定义 `argsSchema` / `responseSchema` / `buildResource` / `okPolicy`，用 `defineEndpoint()` 包装。
5. 在 Service 中调用 `this.request(spec, args)`；归一化逻辑放 `src/models/data/`。
6. 新增 CLI 子命令（SDK 与 CLI 必须同步），补 unit/component 测试。
7. 跑门禁：`pnpm run typecheck && pnpm run lint && pnpm test && pnpm run validate:fixtures`。

## 示例

**示例 1：拉取首页最新微博并增量保存**

用户说：「拉一下我首页最新微博，只取新的」

操作：

1. 先跑 `weibo-cli tweet home` 拿到第一页与 `maxId`。
2. 记录已知最新微博的数字 `id`（`tweet.id`）。
3. 下次运行 `weibo-cli tweet home --since-id <id>`，只返回比该 id 更新的微博。
4. 需要继续往旧翻时，用 `weibo-cli tweet home --max-id <maxId>`。

结果：增量只请求一页（上游单页固定 25 条）；`since_id` 不是翻页游标。

**示例 2：归档一个账号**

用户说：「把这个账号的微博和图片都存下来」

操作：

```bash
weibo-cli archive <uid> --images --state .weibo-archive-state.json
```

结果：NDJSON 流式输出 `item.checkpoint`；把 checkpoint 落盘后，下次运行 `--state` 会自动续传。

## 分页约定

| 游标 | 端点 |
|---|---|
| `page` | mymblog、likes、favorites、followings/fans、reposts、likers |
| `max_id` | comments、comment history、mentions、notifications、首页 Feed（`maxId`） |
| `since_id` | 图片墙 / 相册；首页 Feed 仅做增量过滤（不是翻页游标） |
| `cursor` | 视频瀑布 |

流式方法在空页、整页重复、游标不前进、达到 `total` 或 `maxPages` 时停止。首页 Feed 的 `total_number` 实测恒为 2000 上限值，不能当作剩余条数。

## 故障排除

### `AUTH_SESSION_EXPIRED` / 返回 HTML 登录页

**原因**：Cookie 缺失或过期。
**解决方案**：在浏览器重新登录 `weibo.com`，重新导出 Cookie 到 `.env` 的 `WEIBO_COOKIE`，再跑 `weibo-cli whoami`。

### `RATE_LIMITED`（HTTP 432 / 429）

**原因**：触发微博风控。
**解决方案**：停止并发请求，等待退避；SDK 会自动暂停令牌桶并按 `Retry-After` 重试。不要绕过限流。

### 首页 Feed 翻页重复 / 只返回一页

**原因**：把 `since_id` 当成翻页游标，或 `max_id` 没有前进。
**解决方案**：翻旧页用响应里的 `maxId` / `max_id`；增量才用 `sinceId`。跨页按 `mblogId` 去重。

### `API_BAD_RESPONSE` / schema 校验失败

**原因**：上游字段漂移，或抓到的不是 JSON（登录页 / 风控页）。
**解决方案**：抓一份新的真实响应，对照 schema 放宽 optional / union 字段；不要用 `.strict()` 锁死响应。

### `pnpm test` 跑了真实网络

**原因**：`WEIBO_E2E` 被放进 `.env`。
**解决方案**：从 `.env` 移除 `WEIBO_E2E`；该变量只由 `vitest.e2e.config.ts` 显式设置。

## 边界

- 只读；私信、仅粉丝可见、付费内容不在范围内。
- 尊重微博条款、限流与隐私，只使用自己的账号 Cookie。
- 媒体 URL 是短期签名 URL，归档消费方需及时下载。
