---
title: 配置与扩展
outline: deep
---

# 配置与扩展

## 配置

| 类型 | 说明 |
|---|---|
| `IWeiboConfig` | 构造配置，字段见 [WeiboSDK 门面](/api/sdk#构造配置-iweiboconfig) |
| `WeiboAuthMode` | `'auto' \| 'cookie' \| 'guest'` |
| `IWeiboGuestConfig` | `token` / `issuer` / `autoRefresh` |
| `IWeiboRetryConfig` | `retries` / `baseDelayMs` / `maxDelayMs` / `retryOn` |
| `WeiboRetryKind` | `'rate_limit' \| 'server_error' \| 'timeout' \| 'network_error'` |
| `WeiboProxyInput` / `IProxyProvider` / `IProxyRequestContext` | 静态代理、动态 provider 与上下文 |

## Hooks

| 类型 | 说明 |
|---|---|
| `WeiboSDKHooks` | `onLifecycle` / `onRaw` / `onError` |
| `WeiboSDKSelfCheckMode` | `'none' \| 'lazy' \| 'eager'` |
| `WeiboSDKLifecycleEvent` | `sdk_init` / `self_check_*` |
| `WeiboSDKRequestMeta` / `WeiboSDKRawMeta` / `WeiboSDKErrorMeta` | 回调元数据 |
| `WeiboSDKHookBaseMeta` | 公共字段（endpoint / args / traceId 等） |

`onRaw(raw, meta)` 在 Zod 校验与 `okPolicy` 之前触发，适合落盘原始响应。

## 传输

| 类型 | 说明 |
|---|---|
| `WeiboTransport` | `send(request, meta)` 契约 |
| `TransportRequest` / `TransportResponse` / `TransportRequestMeta` | 请求 / 响应 / 元数据 |
| `TransportMethod` | HTTP 方法 |
| `TransportFailure` / `TransportFailureKind` | 传输异常（timeout / network） |
| `FetchLike` / `FetchResponseLike` | 注入 fetch 的最小接口 |
| `fetchTransport(options?)` | 原生 fetch 实现 |

## 插件

| 类型 | 说明 |
|---|---|
| `WeiboPlugin` | `{ name, apiVersion, enforce?, transport?, hooks?, observe? }` |
| `RequestContext` / `ResponseContext` / `RetryContext` / `ErrorContext` | 生命周期上下文 |
| `BeforeRetryResult` | `beforeRetry` 的延迟 / 中止决策 |
| `PluginRequestInfo` | 只读请求信息 |
| `WeiboEvent` | 事件类型 |

顺序：`pre → normal → post`；`apiVersion` 当前只接受 `1`；同名插件抛 `CONFIG_INVALID`。

## 凭证

| 类型 | 说明 |
|---|---|
| `Credential` | `id` / `mode` / `getHeaders()` / `refresh?()` |
| `CredentialResolveContext` | 解析上下文 |
| `CredentialResolver` | `resolve()` / `report?()` |

## 日志与遥测

| 类型 | 说明 |
|---|---|
| `WeiboLogger` / `WeiboLogRecord` / `WeiboLogLevel` | 日志端口与记录 |
| `ConsoleLoggerOptions` / `JsonlLoggerOptions` / `JsonlLogger` / `LogWriteStream` | 内置 sink |
| `TelemetryEvent` / `TelemetryEventBase` / `TelemetryPrimitive` | Wide Events |
| `WeiboSDKTelemetry` | `emit(event)` |
| `JsonlTelemetryOptions` / `JsonlTelemetry` / `TelemetryJsonlInput` | JSONL 遥测 |
| `ArchiveProgressEvent` / `ArchiveProgressSummary` | 归档进度事件与摘要 |

## 媒体下载

| 类型 | 说明 |
|---|---|
| `MediaDownloadOptions` | 下载选项（16 个字段），见 [下载媒体](/guide/media) |
| `MediaDownloadItem` / `MediaDownloadItemBase` | 单项结果 |
| `MediaDownloadProgress` / `MediaDownloadTotals` | 进度与汇总 |
| `TweetMediaDownloadResult` | 单条微博的下载结果 |
| `MediaSkipReason` / `MediaVariant` / `MediaItemErrorContext` | 跳过原因 / 变体 / 失败上下文 |

## 微博 id

| 类型 / 函数 | 说明 |
|---|---|
| `ParsedTweetId` / `TweetIdKind` | 解析结果（`mblogid` / `mid`） |
| `parseTweetIdInput(input)` | 解析 mblogId / 数字 mid / 状态 URL |
| `normalizeTweetIdInput(input)` | 归一化为可请求的 id |
| `midToMblogId(mid)` | 数字 mid → mblogId |

这些辅助函数属于实验性。
