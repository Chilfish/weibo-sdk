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

判断 `error.code`；`message` 会随上游文案变化。`context` 用于排障，包含端点、参数和截断后的响应片段。

## 常用错误码

| code | level | 可重试 | 含义 |
|---|---|---|---|
| `AUTH_SESSION_EXPIRED` | business | 否 | Cookie 缺失或过期；访客下表示该能力需要登录 |
| `RATE_LIMITED` | transport | 是 | HTTP 432 / 429 |
| `NET_TIMEOUT` | transport | 是 | 请求超时 |
| `NET_REQUEST_FAILED` | transport | 是 | DNS、连接失败或非 2xx |
| `API_NOT_OK` | business | 否 | 微博返回 `ok !== 1` |
| `API_BAD_RESPONSE` | protocol | 否 | 非 JSON（登录页 / 风控页）或 schema 不匹配 |
| `CONFIG_INVALID` | business | 否 | Cookie、代理或参数不合法 |
| `RESUME_MISMATCH` | business | 否 | 续跑配置与 journal 不一致；修正参数或改用 `resume: 'merge'` |
| `MEDIA_*` | transport / protocol / storage | 视情况 | 媒体下载失败 |

完整列表与排查步骤见 [故障排查](/reference/troubleshooting)。

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

- `retries` 默认 2，上限 10；`retryOn: []` 表示不重试。
- 4xx、`ok !== 1`、schema 校验失败直接返回错误。
- 432 / 429 会解析 `Retry-After`，并暂停全局令牌桶（含并发请求）。
- 媒体下载有独立重试参数，见 [下载媒体](/guide/media)。

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
      // 交给 SDK 退避
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

CLI 把错误写到 stderr，以非零退出码结束，stdout 只保留命令结果：

```json
{"code":"AUTH_SESSION_EXPIRED","level":"business","retryable":false,"message":"...","context":{}}
```
