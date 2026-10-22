---
title: 错误、重试与限流
---

# 错误、重试与限流

## 错误信封

所有库内错误继承 `WeiboSDKError`：

```ts
class WeiboSDKError extends Error {
  code: string
  level: 'transport' | 'protocol' | 'business' | 'storage'
  retryable: boolean
  context?: Record<string, unknown>
}
```

优先判断 `code`，不要匹配 `message`。`context` 用于排障，不包含 Cookie 明文。

## 错误码

| code | 类 | level | retryable | 含义与处理 |
|---|---|---|---|---|
| `AUTH_SESSION_EXPIRED` | `WeiboSessionExpiredError` | business | false | Cookie 缺失 / 过期；访客下表示该能力需要登录（`context.requiredAuth === 'cookie'`） |
| `RATE_LIMITED` | `RateLimitError` | transport | true | HTTP 432 / 429；SDK 自动退避并暂停令牌桶 |
| `NET_TIMEOUT` | `ConnectionTimeoutError` | transport | true | 请求超时 |
| `NET_REQUEST_FAILED` | `NetworkRequestError` | transport | true | DNS / 连接失败 / 非 2xx |
| `API_NOT_OK` | `WeiboAPINotOkError` | business | false | 微博返回 `ok !== 1` |
| `API_BAD_RESPONSE` | `UnexpectedAPIResponseError` | protocol | false | 非 JSON（登录页 / 风控页）或 schema 不匹配 |
| `CONFIG_INVALID` | `InvalidConfigError` | business | false | Cookie、代理或参数不合法 |
| `MEDIA_DOWNLOAD_FAILED` | `MediaDownloadError` | transport | true | CDN 5xx / 429 / 超时 / 截断 |
| `MEDIA_BAD_RESPONSE` | `MediaInvalidResponseError` | protocol | false | HTML 错误页、类型不符、超字节上限 |
| `MEDIA_STORAGE_FAILED` | `MediaStorageError` | storage | false | 本地落盘失败（ENOSPC / EACCES 等） |

## 重试策略

默认只重试可重试的结构化错误：

```ts
new WeiboSDK({
  retry: {
    retries: 2,
    baseDelayMs: 500,
    maxDelayMs: 8000,
    retryOn: ['rate_limit', 'server_error', 'timeout', 'network_error'],
  },
})
```

- `retries` 默认 2，上限 10；`retryOn: []` 等价于不重试。
- 4xx、`ok !== 1`、schema 失败不会重试。
- 432 / 429 会解析 `Retry-After`，并暂停全局令牌桶（含并发请求）。
- 媒体下载有独立重试：`retries` / `timeoutMs` / `idleTimeoutMs`，见 [下载媒体](/guide/media)。

## 分类处理示例

```ts
try {
  await sdk.tweets.getByMblogId(id)
}
catch (error) {
  if (!(error instanceof WeiboSDKError)) throw error

  switch (error.code) {
    case 'AUTH_SESSION_EXPIRED':
      // 重新导出 Cookie；访客模式下检查 context.requiredAuth
      break
    case 'RATE_LIMITED':
      // 让 SDK 退避；不要绕开限流
      break
    case 'NET_TIMEOUT':
    case 'NET_REQUEST_FAILED':
      // 可以重试
      break
    case 'API_BAD_RESPONSE':
      // 上游结构漂移：记录 context.endpoint / context.zodIssues
      break
    default:
      break
  }
}
```

## CLI 错误输出

CLI 把错误写到 stderr 并以非零退出码结束，stdout 不会混入错误：

```json
{"code":"AUTH_SESSION_EXPIRED","level":"business","retryable":false,"message":"...","context":{}}
```
