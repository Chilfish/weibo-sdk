---
title: 遥测与日志
---

# 遥测与日志

## Wide Events

SDK 在请求、限流、重试、归一化和自检时发出结构化事件。事件是扁平键值对，至少包含 `event_name` / `timestamp` / `trace_id`：

```ts
const sdk = new WeiboSDK({
  telemetry: {
    emit: (event) => {
      // 自定义 sink：日志、指标、采样
    },
  },
})
```

`telemetry.emit()` 的异常会被吞掉，不影响业务。

## 原始响应

需要原始 JSON 时使用 `hooks.onRaw`：

```ts
const sdk = new WeiboSDK({
  hooks: {
    onRaw: async (raw, meta) => {
      await saveRaw(meta.endpoint, meta.args, raw)
    },
  },
})
```

单条微博也可以直接取 raw：

```ts
const { tweet, raw, longText } = await sdk.tweets.enrich('QqsYymYOS', {
  includeLongText: true,
})
```

`ArchiveItem` 只包含归一化数据；归档 raw 由调用方通过 `hooks.onRaw` 或 `streamArchive({ onRaw })` 保存。

## JSONL 遥测

```ts
import { createJsonlTelemetry } from '@chilfish/weibo-sdk'

const sdk = new WeiboSDK({
  telemetry: createJsonlTelemetry({
    write: line => process.stdout.write(`${line}\n`),
  }),
})
```

CLI 的 `archive` / `archive user` 使用同一套事件生成 `progress` / `done`。

## 分级日志

日志默认关闭。需要时显式接入：

```ts
import { appendFileSync } from 'node:fs'
import {
  createConsoleLogger,
  createJsonlLogger,
  createMultiLogger,
  WeiboSDK,
} from '@chilfish/weibo-sdk'

const sdk = new WeiboSDK({
  cookie,
  logger: createMultiLogger([
    createConsoleLogger({ level: 'warn' }),
    createJsonlLogger({
      level: 'debug',
      write: line => appendFileSync('weibo.log', line),
    }),
  ]),
})
```

- `createConsoleLogger`：默认 stderr，单行 JSON。
- `createJsonlLogger`：写入调用方提供的流。
- `createLoggerPlugin`：把插件事件接入同一套 logger。
- 内置 sink 会把 Cookie / token 等敏感字段替换为 `[redacted]`。

## stdout 与日志

CLI 的数据输出写 stdout（JSON / NDJSON），日志写 stderr，管道只拿到数据。SDK 只在配置了 logger 后产生日志输出。
