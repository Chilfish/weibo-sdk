---
title: 下载媒体
---

# 下载媒体

## 先理解 URL 的生命周期

微博媒体 URL 是**短期签名地址**，通常约一小时后失效。归档时要及时下载，或者只保存 URL 与元数据。

下载器使用独立的 CDN 客户端：只带微博 Referer，**不带 Cookie**，并限制允许的主机后缀。

## 下载单条微博的媒体

```ts
const result = await sdk.media.downloadByMblogId('QqsYymYOS', {
  dir: './media',
  include: [MediaType.PIC, MediaType.VIDEO],
  concurrency: 3,
  dryRun: false,
})

console.log(result.totals)
// { total, downloaded, skipped, failed, planned, bytes }
```

也可以直接传已归一化的微博，避免再次请求：

```ts
const tweet = await sdk.tweets.getByMblogId('QqsYymYOS')
const result = await sdk.media.downloadTweetMedia(tweet, { dir: './media' })
```

## 选项

| 选项 | 默认 | 说明 |
|---|---|---|
| `dir` | 必填 | 输出目录，SDK 内解析为绝对路径 |
| `include` | 全部 | 参与的媒体类型（`MediaType`） |
| `concurrency` | 3 | 媒体并发，clamp 1–8 |
| `retries` | 2 | 单媒体最大重试次数，clamp 0–10 |
| `timeoutMs` | 30000 | 连接 / 首字节超时 |
| `idleTimeoutMs` | 20000 | 流式读取空闲超时 |
| `maxBytes` | 512 MiB | 单文件字节上限 |
| `overwrite` | false | 目标已存在且非空时覆盖；否则跳过 |
| `referer` | `https://weibo.com/` | CDN Referer |
| `allowedHosts` | `DEFAULT_MEDIA_ALLOWED_HOSTS` | 允许的媒体主机后缀 |
| `refreshExpired` | true | 403 / 404 / 410 时重新拉微博换新 URL（每条最多 1 次） |
| `dryRun` | false | 只规划，不联网、不落盘、不 stat |
| `signal` | — | 取消信号 |
| `failFast` | false | 首个失败即中止（含取消在途下载） |
| `onProgress` | — | 每完成一项回调；抛错不影响流程 |
| `onItemError` | — | 单项失败回调；抛错不掩盖原始错误 |

## 结果

```ts
interface TweetMediaDownloadResult {
  mblogId: string
  dir: string
  dryRun: boolean
  items: MediaDownloadItem[]        // 顺序与原始 media 一致
  failures: FailedItem[]
  totals: MediaDownloadTotals       // downloaded + skipped + failed + planned === total
  errorsFile?: string               // 有失败且非 dryRun 时的失败清单路径
  durationMs: number
}
```

`items` 的状态：

- `downloaded`：成功，带 `bytes` / `contentType` / `refreshed`
- `skipped`：`exists` / `filtered-out` / `no-url` / `duplicate-id` / `duplicate-url` / `aborted`
- `planned`：dry-run 或 `failFast` 中止
- `failed`：带 `code` / `message` / `retryable` / `httpStatus`

## CLI

```bash
weibo-cli media download QqsYymYOS --out ./media
weibo-cli media download QqsYymYOS --out ./media --dry-run
weibo-cli media download QqsYymYOS --out ./media --include pic,video
```

`media download` 输出 NDJSON，每行一个事件；stdout 可直接接 `jq`。
