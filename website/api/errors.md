---
title: 错误
description: 错误类的 code 与 level 对照、context 字段、判别方式与重试策略。
outline: deep
---

# 错误

所有库内错误继承 `WeiboSDKError`（同时从包根导出）：

| 类 | `code` | `level` | `retryable` |
|---|---|---|---|
| `WeiboSDKError`（抽象基类） | 无 | 无 | 无 |
| `WeiboSessionExpiredError` | `AUTH_SESSION_EXPIRED` | business | false |
| `WeiboAPINotOkError` | `API_NOT_OK` | business | false |
| `UnexpectedAPIResponseError` | `API_BAD_RESPONSE` | protocol | false |
| `InvalidConfigError` | `CONFIG_INVALID` | business | false |
| `ResumeMismatchError` | `RESUME_MISMATCH` | business | false |
| `RateLimitError` | `RATE_LIMITED` | transport | true |
| `UpstreamRejectedError` | `UPSTREAM_REJECTED` | transport | false |
| `ConnectionTimeoutError` | `NET_TIMEOUT` | transport | true |
| `NetworkRequestError` | `NET_REQUEST_FAILED` | transport | true |
| `MediaDownloadError` | `MEDIA_DOWNLOAD_FAILED` | transport | true |
| `MediaInvalidResponseError` | `MEDIA_BAD_RESPONSE` | protocol | false |
| `MediaStorageError` | `MEDIA_STORAGE_FAILED` | storage | false |

## 形状

```ts
interface WeiboSDKError {
  name: string
  message: string
  code: string
  level: 'transport' | 'protocol' | 'business' | 'storage'
  retryable: boolean
  context?: Record<string, unknown>
}
```

常见 `context`：

- `AUTH_SESSION_EXPIRED`：`requiredAuth`（访客下为 `'cookie'`）、`endpoint`、`args`
- `UPSTREAM_REJECTED`：`status`（HTTP 4xx）、`data`（响应体）、`endpoint`、`message`（上游文案）、`hint`、`next`
- `API_BAD_RESPONSE`：`endpoint`、`args`、`raw`（非 JSON 时截断）、`zodIssues`
- `RATE_LIMITED`：`status`（432 / 429）、`retryAfterMs`、`attempt`、`message`
- `CONFIG_INVALID`：`field`（出问题的配置项）
- `RESUME_MISMATCH`：`field: 'resume'`、`mismatch`（`uid` / `since` / `until` / `sliceDays` / `options` / `slices`）、`actual`、`expected`；`ResumeMismatchError` 继承 `InvalidConfigError`，`instanceof InvalidConfigError` 仍成立
- 媒体：`reason`、`status`、`mblogId`、`mediaId`

## 上游拒绝（`UPSTREAM_REJECTED`）

上游用 HTTP 4xx 明确拒绝请求时抛 `UpstreamRejectedError`。参数不合法、id 不存在、权限不足都归到这里：重发同一个请求结果相同，所以 `retryable: false`。按 `context.status` 定位方向（400 / 422 参数、401 / 403 登录态与权限、404 id），具体步骤见 [故障排查](/reference/troubleshooting)。

限流（432 / 429）抛 `RATE_LIMITED`；访客身份下的 403 是登录门控，抛 `AUTH_SESSION_EXPIRED`。`NET_REQUEST_FAILED` 覆盖 5xx 与没有 HTTP 响应的传输失败。

## 判断方式

```ts
import { WeiboSDKError } from '@chilfish/weibo-sdk'

catch (error) {
  if (!(error instanceof WeiboSDKError)) throw error
  if (error.code === 'AUTH_SESSION_EXPIRED') { /* 重新登录 */ }
  else if (error.retryable) { /* 退避重试 */ }
}
```

判断 `code`；`message` 会随上游变化。

## 重试

默认 `retries: 2`，只重试 `RATE_LIMITED` / `NET_TIMEOUT` / `NET_REQUEST_FAILED` / 5xx。`retryable: false` 的错误直接返回。

```ts
new WeiboSDK({
  retry: {
    retries: 3,
    baseDelayMs: 500,
    maxDelayMs: 8000,
    retryOn: ['rate_limit', 'server_error', 'timeout', 'network_error'],
  },
})
```

`retryOn: []` 关闭重试。432 会暂停全局令牌桶，等待 `Retry-After` 或退避时间。

重试与限流细节见 [错误、重试与限流](/guide/errors-retries)。
