---
title: 日志
outline: deep
---

# 日志（Logger）

> **目标**：给 SDK 一个显式、结构化、失败不影响业务的日志出口；默认静默，调用方在 `new WeiboSDK()` 或 `plugins` 中显式接入。
> **实现**：`src/types/logging.ts`、`src/utils/logger.ts`、`src/WeiboSDK.ts`。
> **相关**：[传输与插件](./plugins)、[遥测与日志](/guide/observability)。

---

## 1. 三层边界

```
Wide Events（事实）        TelemetryEvent：request_* / archive_* / media_* / guest_token_* / rate_limit_wait
      │                    SDK 内部只在事件发生点 emit 一次
      ▼
Logger port（消费）        WeiboLogger：level / 格式化 / 落盘 / 上报
      │                    默认 no-op；显式配置后由 bridge 把事件映射成日志记录
      ▼
CLI Output（协议）         stdout 数据 / NDJSON progress-item-done
                           不经过 logger，避免日志级别与格式化破坏管道契约
```

**不要双写**：核心代码不新增 `logger.info()` 调用。日志来自已有的 Wide Events 与生命周期事件，logger 只负责消费。这样字段、trace_id、错误摘要只有一份事实源。

**telemetry 与 logger 的区别**：

| | telemetry | logger |
|---|---|---|
| 语义 | 领域事件（发生了什么） | 投递与呈现（谁要、什么级别、写到哪） |
| 默认 | 关闭 | 关闭 |
| 失败影响 | 吞掉 | 吞掉 |
| 分级 | 无 | `debug` / `info` / `warn` / `error` |
| 典型消费方 | 指标 / 归档追踪 / 远端上报 | console / 文件 / 日志平台 |

同一个事件可以同时进入 `config.telemetry` 和 `config.logger`；SDK 内部用 fanout 组合，两者互不影响。

---

## 2. 默认行为

| 配置 | 默认 | 说明 |
|---|---|---|
| `config.logger` | 未设置 | 不创建 sink、不写 console / 文件，保持库入口零副作用 |
| `config.telemetry` | 未设置 | 行为不变 |
| `plugins` 中的 logger | 不需要 | logger 是一等配置；已用插件的调用方可用 `createLoggerPlugin()` |

**SDK 默认永远静默**。CLI 是否默认打开日志由 CLI 自己决定，不由库决定。

---

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

1. `log()` 抛错、返回 rejected Promise 都不能影响业务；bridge 外层 try/catch 并忽略 rejection。
2. 记录不允许嵌套对象；bridge 只搬运 primitive 字段。
3. 不把 Cookie / token 明文交给 logger；内置 sink 默认对敏感键做 redaction。
4. logger 在构造期组装，不支持运行时替换。

---

## 4. 事件 → 日志级别

bridge 使用固定映射，不开放配置（避免同一条事件在不同项目里语义漂移）：

| 级别 | 事件 |
|---|---|
| `error` | `request_error` / `guest_token_error` / `media_download_item_error` / `archive_item_error` / `self_check_error` |
| `warn` | `request_retry` / `rate_limit_wait` |
| `debug` | `request_start` / `guest_token_issue` / `media_download_start` / `sdk_init` / `self_check_start` / `archive_progress` |
| `info` | 其余（`request_success` / `*_done` / `normalize_done` 等） |

`archive_progress` 归到 `debug`：它按页 / 按阶段高频产生；CLI 的进度仍走 stdout NDJSON。

生命周期事件（`sdk_init` / `self_check_*`）会同时进入 logger 与 `hooks.onLifecycle`；`observe` 只接收请求 / 媒体 / 归档事件。

---

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

写 stdout 会污染机器可读输出，CLI 请保持 `stderr`。

### 5.2 JSONL / 文件

```ts
import { createJsonlLogger } from '@chilfish/weibo-sdk'

const logger = createJsonlLogger({
  write: line => appendFileSync('weibo.log', line),
  level: 'debug',
})
```

- 一行一条记录，字段扁平化、超长值截断（复用 `telemetryJsonl` 的序列化规则）。
- `write` 失败只计入 `dropped`，不影响命令。
- 轮转、压缩、上传由调用方负责；SDK 不内置文件管理。

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

`createLoggerPlugin()` 与 `config.logger` 使用同一套映射。**两者同时配置会重复输出**，选一个即可。

---

## 6. 脱敏与截断

内置 sink 默认把以下键（大小写、`-` / `_` 归一化后精确匹配）替换为 `[redacted]`：

```
cookie, set-cookie, authorization, xsrf-token, x-xsrf-token,
sub, subp, token, access_token, refresh_token, password, secret
```

`credential_id` 是 Cookie 指纹，不是明文，保留用于排障。

`message` 与 `error_message` 可能来自上游或错误 context；如果调用方自己的 logger 要落盘，仍需自行确认上下文里没有额外敏感信息。CLI 的 `formatCliError` 会携带完整 `context`，消费方应只写入受控路径。

---

## 7. 非目标

- **不把 CLI 数据输出纳入 logger**：stdout JSON / NDJSON 是命令契约。
- **不默认启用任何 sink**：零配置不产生额外分配与 IO。
- **不在核心新增文本日志调用**：需要新事实时先扩展 `TelemetryEvent`。
- **不做日志轮转 / 采样 / 远端上传**：用 `createJsonlLogger({ write })` 自行组合。

---

## 8. 测试

- 默认未配置 logger 时无 console 输出（库入口无副作用）。
- 事件级别映射、`level` 过滤、生命周期事件投递。
- 脱敏、截断、`timestamp` 补齐。
- `log()` 同步抛错 / 异步 reject 不影响请求。
- `createLoggerPlugin()` 与 `config.logger` 行为一致。
