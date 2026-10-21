# 媒体下载（单条微博）

> 适用范围：Node 环境；`sdk.media.downloadTweetMedia` / `downloadByMblogId` 与 `weibo-cli media download <mblogId>`。
> 契约关系：不改变 `ITweet` / `ArchiveItem`；归档流仍不自动下载媒体（见 [contract-itweet-v2.md](./contract-itweet-v2.md) §7）。

## 1. 行为

- 输入：一条已归一化微博（或 `mblogId`，SDK 会先拉详情，`isGetLongText: false`）。
- 媒体来源：`tweet.media`；若为空且存在 `retweetedStatus.media`，使用被转发原微博的媒体（仍用外层 `mblogId` 命名）。
- 类型：`pic` / `gif` / `unknown` 取 `imageUrl`；`video` 取 `videoUrl`；`livephoto` 同时下载 `imageUrl`（静态帧）与 `videoUrl`（动态帧）。
- 不下载：视频封面、`pageInfo.pagePic`、`retweetedStatus` 中自有媒体之外的内容。

## 2. 落盘命名

扁平目录：

```text
<out>/<mblogId>-<index>-<mediaId>.<ext>
<out>/<mblogId>-<index>-<mediaId>-motion.<ext>   # LivePhoto 动态帧
<out>/<mblogId>-media-errors.json                # 仅在失败时
```

- `index` 为原始 `tweet.media` 的 1-based 位置（补零两位）；过滤后允许编号空档，保证同一媒体每次同名。
- 扩展名：`Content-Type` → URL 后缀 → 媒体类型默认值。
- 文件名片段替换 Windows 非法字符、规避 `CON`/`NUL` 等保留名，并截断到 60 字符。

## 3. 去重与跳过

顺序：

1. `include` 之外 → `filtered-out`。
2. URL 为空 → `no-url`。
3. 同 `mediaId + variant` 重复 → `duplicate-id`。
4. 同 URL 重复 → `duplicate-url`。
5. 目标文件已存在且 `size > 0` → `exists`（`overwrite: true` 时重下）。
6. 因 fatal 错误停止调度 → `aborted`。

## 4. 安全

- 媒体 CDN 请求只带 `Referer`（默认 `https://weibo.com/`）、`User-Agent`、`Accept`、`Accept-Encoding: identity`。
- **不携带 Cookie / X-XSRF-TOKEN**；不复用 API 的 axios 实例或令牌桶。
- 主机后缀白名单默认：`sinaimg.cn` / `sina.com.cn` / `weibo.com` / `weibo.cn` / `weibocdn.com` / `wbimg.cn` / `weiboimg.cn`。
- 重定向逐跳校验协议与主机；未知主机直接拒绝。
- 拒绝 `text/html` / `text/plain` / `application/json` / `application/xml` 响应。

## 5. 稳定性

- 流式写盘 + 背压；临时文件写入目标同目录，成功后原子 `rename`，失败/取消删除临时文件。
- 单文件 `maxBytes`（默认 512MiB）；`Content-Length` 超限直接失败。
- 空闲超时（默认 20s）：长时间无数据则中止并可重试。
- `Content-Length` 校验（截断）与 0 字节检查。
- 重试：408 / 429 / 5xx / 超时 / 连接错误 / 截断 / 空响应；指数退避 + jitter，复用 `RetryPolicy`。
- URL 过期：403/404/410 时重新拉取该微博换新 URL；记忆化 Promise 保证每条微博最多一次刷新，且不重置重试预算。
- 存储错误（`ENOSPC/EACCES/EPERM/EBUSY`）标记 fatal，停止调度后续媒体；已完成文件保留。
- 取消：`signal` / CLI `SIGINT` 中止在途下载、清理临时文件，不写失败清单。

## 6. 错误码

| code | level | retryable | 语义 |
|---|---|---|---|
| `MEDIA_DOWNLOAD_FAILED` | transport | ✅ | 5xx / 429 / 408 / 超时 / 连接错误 / 空闲超时 / 截断 / 0 字节 |
| `MEDIA_BAD_RESPONSE` | protocol | ❌ | HTML/JSON、类型族不符、超过上限、非法重定向、非 2xx 不可重试码 |
| `MEDIA_STORAGE_FAILED` | storage | ❌ | mkdir / write / rename / unlink 失败 |

## 7. 失败清单

> `totals` 恒满足 `downloaded + skipped + failed + planned === total`。`planned` 是仅规划、未执行的条目数：
> dry-run 下等于待下载项，`failFast` 中止后等于未尝试项。

`<out>/<mblogId>-media-errors.json`：

```json
{
  "schemaVersion": 1,
  "mblogId": "QqsYymYOS",
  "generatedAt": "2026-10-20T10:00:00.000Z",
  "dir": "D:/media",
  "totals": { "total": 9, "downloaded": 7, "skipped": 1, "failed": 1, "planned": 0, "bytes": 12345678 },
  "failures": [
    {
      "mediaId": "006...",
      "index": 4,
      "type": "video",
      "variant": "video",
      "url": "https://f.video.weibocdn.com/...",
      "path": "D:/media/QqsYymYOS-04-006....mp4",
      "attempts": 3,
      "code": "MEDIA_BAD_RESPONSE",
      "level": "protocol",
      "retryable": false,
      "httpStatus": 200,
      "message": "Media response is not a media file: text/html",
      "context": { "reason": "invalid-content-type", "contentType": "text/html" }
    }
  ]
}
```

无失败时删除同名旧清单；`dryRun` 不写清单。

## 8. 已知限制

- 不做断点续传；重跑依赖 `exists` 跳过。
- 不提供视频多清晰度选择：`ITweet` 只保留最优 `videoUrl`。
- 不自动清理历史文件（上游媒体顺序变化会导致旧文件名残留）。
- 媒体 URL 是临时签名 URL；请及时下载，过期后依赖刷新或重新运行。
