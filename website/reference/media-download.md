---
title: 媒体下载
outline: deep
---

# 媒体下载（单条微博）

`sdk.media.downloadTweetMedia` / `downloadByMblogId` 与 `weibo-cli media download <mblogId>` 在 Node 环境中把一条微博的媒体文件下载到本地。范围限于单条微博，`ITweet` / `ArchiveItem` 的形状保持不变；归档流只记录媒体 URL，落盘由显式调用触发（见 [ITweet 存档契约](/reference/tweet-contract) §6）。

## 1. 行为

- 输入：一条已归一化微博，或一个 `mblogId`（SDK 先拉详情，`isGetLongText: false`）。
- 媒体来源：`tweet.media`；该数组为空且存在 `retweetedStatus.media` 时，使用被转发原微博的媒体，命名仍用外层 `mblogId`。
- 类型：`pic` / `gif` / `unknown` 取 `imageUrl`；`video` 取 `videoUrl`；`livephoto` 同时下载 `imageUrl`（静态帧）与 `videoUrl`（动态帧）。
- 落盘范围仅限上述媒体条目；视频封面与 `pageInfo.pagePic` 只保留 URL。

## 2. 落盘命名

扁平目录：

```text
<out>/<mblogId>-<index>-<mediaId>.<ext>
<out>/<mblogId>-<index>-<mediaId>-motion.<ext>   # LivePhoto 动态帧
<out>/<mblogId>-media-errors.json                # 仅在失败时
```

- `index` 为原始 `tweet.media` 的 1-based 位置（补零两位）；过滤后编号可以出现空档，保证同一媒体每次落盘同名。
- 扩展名按 `Content-Type` → URL 后缀 → 媒体类型默认值依次确定。
- 文件名片段替换 Windows 非法字符，规避 `CON` / `NUL` 等保留名，并截断到 60 字符。

## 3. 去重与跳过

判断顺序：

1. `include` 之外 → `filtered-out`。
2. URL 为空 → `no-url`。
3. 同 `mediaId + variant` 重复 → `duplicate-id`。
4. 同 URL 重复 → `duplicate-url`。
5. 目标文件已存在且 `size > 0` → `exists`（`overwrite: true` 时重下）。
6. 因 fatal 错误停止调度 → `aborted`。

## 4. 安全

- 媒体 CDN 请求头固定为 `Referer`（默认 `https://weibo.com/`）、`User-Agent`、`Accept`、`Accept-Encoding: identity`。Cookie 与 `X-XSRF-TOKEN` 只在 API 请求中使用。
- 下载器使用独立的 HTTP 客户端，与 API 的 axios 实例和令牌桶分开。
- 主机后缀白名单默认：`sinaimg.cn` / `sina.com.cn` / `weibo.com` / `weibo.cn` / `weibocdn.com` / `wbimg.cn` / `weiboimg.cn`。
- 重定向逐跳校验协议与主机，白名单外的主机直接拒绝。
- `text/html` / `text/plain` / `application/json` / `application/xml` 响应按错误处理。

## 5. 下载可靠性

- 流式写盘 + 背压；临时文件写入目标同目录，成功后原子 `rename`，失败或取消时删除临时文件。
- 单文件 `maxBytes`（默认 512MiB）；`Content-Length` 超限直接失败。
- 空闲超时（默认 20s）：长时间无数据则中止，并按可重试错误处理。
- 校验 `Content-Length`（截断）与 0 字节响应。
- 重试：408 / 429 / 5xx / 超时 / 连接错误 / 截断 / 空响应；指数退避 + jitter，复用 `RetryPolicy`。
- URL 过期：403/404/410 时重新拉取该微博换新 URL；记忆化 Promise 保证每条微博最多刷新一次，刷新沿用原重试预算。
- 存储错误（`ENOSPC` / `EACCES` / `EPERM` / `EBUSY`）标记 fatal，停止调度后续媒体，已完成文件保留。
- 取消：`signal` / CLI `SIGINT` 中止在途下载、清理临时文件，原有失败清单保留。

## 6. 错误码

| code | level | retryable | 语义 |
|---|---|---|---|
| `MEDIA_DOWNLOAD_FAILED` | transport | 是 | 5xx / 429 / 408 / 超时 / 连接错误 / 空闲超时 / 截断 / 0 字节 |
| `MEDIA_BAD_RESPONSE` | protocol | 否 | HTML/JSON、类型族不符、超过上限、非法重定向、非 2xx 不可重试码 |
| `MEDIA_STORAGE_FAILED` | storage | 否 | mkdir / write / rename / unlink 失败 |

## 7. 失败清单

`totals` 满足 `downloaded + skipped + failed + planned === total`。`planned` 是规划后未执行的条目数：dry-run 下等于待下载项，`failFast` 中止后等于未尝试项。

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

无失败时移除同名旧清单。`dryRun` 只输出规划结果，清单在真正执行时才写。

## 8. 已知限制

- 重跑时按 `exists` 跳过已存在的文件，未完成项重新下载。
- `ITweet` 只保留最优 `videoUrl`，视频按该地址对应的清晰度下载。
- 上游媒体顺序变化会产生新文件名，旧文件留在磁盘上，需要手工清理。
- 媒体 URL 是临时签名 URL，归档时同步下载；过期后由下载器重新拉取微博换新地址，或重新运行命令。
