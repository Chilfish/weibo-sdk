---
title: 日志
outline: deep
---

# 日志（Logger）

## 1. 三层边界

```
Wide Events（事实）        TelemetryEvent：request_* / archive_* / media_* / guest_token_* / rate_limit_wait
      │                    事件在发生点发出一次
      ▼
Logger port（消费）        WeiboLogger：level / 格式化 / 落盘 / 上报
      │                    默认关闭；显式配置后由 bridge 把事件映射成日志记录
      ▼
CLI Output（协议）         stdout 数据 / NDJSON progress-item-done
                           由 CLI 直接输出；logger 只负责 stderr 诊断
```

日志由已有的 Wide Events 与生命周期事件消费，核心代码只发出事件，由 logger 负责投递。字段、`trace_id`、错误摘要因此只有一份事实源。

**telemetry 与 logger 的区别**：

| | telemetry | logger |
|---|---|---|
| 语义 | 领域事件（发生了什么） | 投递与呈现（谁要、什么级别、写到哪） |
| 默认 | 关闭 | 关闭 |
| 失败影响 | 吞掉 | 吞掉 |
| 分级 | 无 | `debug` / `info` / `warn` / `error` |
| 典型消费方 | 指标 / 归档追踪 / 远端上报 | console / 文件 / 日志平台 |

同一个事件可以同时进入 `config.telemetry` 和 `config.logger`；SDK 内部用 fanout 组合，两者互不影响。

## 2. 默认行为

logger 默认关闭。

| 配置 | 默认 | 说明 |
|---|---|---|
| `config.logger` | 未设置 | 库入口保持静默 |
| `config.telemetry` | 未设置 | 默认关闭 |
| `plugins` 中的 logger | 按需 | logger 是一等配置；已用插件的调用方可用 `createLoggerPlugin()` |

CLI 的日志开关由 CLI 自己控制。

## 3. 契约

```ts
export type WeiboLogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface WeiboLogRecord {
  level: WeiboLogLevel
  event_name: string
  timestamp?: number
  message?: string
  trace_id?: string
  /** 其余字段必须是 primitive（与 Wide Event 一致，便于索引） */
  [field: string]: TelemetryPrimitive | undefined
}

export interface WeiboLogger {
  /** 最低级别；未设置表示不过滤。SDK 在调用 `log()` 前按此过滤。 */
  readonly level?: WeiboLogLevel
  log: (record: WeiboLogRecord) => void | Promise<void>
}
```

约束：

1. `log()` 抛错或返回 rejected Promise 时由 bridge 的 try/catch 吞掉，请求结果不受影响。
2. 记录字段是 primitive；bridge 只搬运 primitive 字段，嵌套对象在映射时被丢弃。
3. logger 只接收脱敏后的字段；内置 sink 默认替换敏感键。
4. logger 在构造期组装，运行期保持不变。

## 4. 事件 → 日志级别

bridge 使用固定映射，同一条事件在所有项目里语义一致：

| 级别 | 事件 |
|---|---|
| `error` | `request_error` / `guest_token_error` / `media_download_item_error` / `archive_item_error` / `self_check_error` |
| `warn` | `request_retry` / `rate_limit_wait` |
| `debug` | `request_start` / `guest_token_issue` / `media_download_start` / `sdk_init` / `self_check_start` / `archive_progress` |
| `info` | 其余（`request_success` / `*_done` / `normalize_done` 等） |

`archive_progress` 归到 `debug`：它按页 / 按阶段高频产生；CLI 的进度仍走 stdout NDJSON。

生命周期事件（`sdk_init` / `self_check_*`）会同时进入 logger 与 `hooks.onLifecycle`；`observe` 接收请求 / 媒体 / 归档事件。

## 5. 内置 sink

### 5.1 console

```ts
import { createConsoleLogger } from '@chilfish/weibo-sdk'

const sdk = new WeiboSDK({
  cookie,
  logger: createConsoleLogger({ level: 'info' }), // 默认 stderr + 单行 JSON
})
```

| 选项 | 默认 | 说明 |
|---|---|---|
| `level` | `info` | 最低级别 |
| `format` | `json` | `json` 单行 / `pretty` 人类可读 |
| `stream` | `stderr` | `'stdout'` / `'stderr'` / `{ write(chunk) }` |
| `redact` | `true` | 敏感键替换为 `[redacted]` |
| `now` | `Date.now` | 缺时间戳时补齐 |

CLI 保持 `stderr`，stdout 留给机器可读数据。

### 5.2 JSONL / 文件

```ts
import { createJsonlLogger } from '@chilfish/weibo-sdk'

const logger = createJsonlLogger({
  write: line => appendFileSync('weibo.log', line),
  level: 'debug',
})
```

- 一行一条记录，字段扁平化、超长值截断（复用 `telemetryJsonl` 的序列化规则）。
- `write` 失败只计入 `dropped`，命令结果不受影响。
- 轮转、压缩、上传由调用方负责，SDK 只负责产出记录行。

### 5.3 多路

```ts
logger: createMultiLogger([
  createConsoleLogger({ level: 'warn' }),
  createJsonlLogger({ write, level: 'debug' }),
])
```

每个子 sink 自己按 `level` 过滤；单个 sink 抛错不影响其他 sink。

### 5.4 插件接入

已经使用 `plugins` 的调用方可以不改 `logger` 配置：

```ts
import { createLoggerPlugin } from '@chilfish/weibo-sdk'

new WeiboSDK({
  plugins: [createLoggerPlugin(createConsoleLogger())],
})
```

`createLoggerPlugin()` 与 `config.logger` 使用同一套映射。同时配置两者时同一事件输出两次，保留其中一个。

## 6. 脱敏与截断

内置 sink 默认把以下键（大小写、`-` / `_` 归一化后精确匹配）替换为 `[redacted]`：

```
cookie, set-cookie, authorization, xsrf-token, x-xsrf-token,
sub, subp, token, access_token, refresh_token, password, secret
```

`credential_id` 是 Cookie 指纹，保留用于排障。

`message` 与 `error_message` 可能来自上游或错误 context。调用方自己实现 logger 落盘时，确认上下文里没有额外敏感信息，并把写入路径限定在受控目录；CLI 的 `formatCliError` 会携带完整 `context`。
