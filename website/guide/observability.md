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

`telemetry.emit()` 抛错不会影响 SDK 业务。

## 原始响应

`ArchiveItem` 不携带 raw。需要原始 JSON 时用 hook：

```ts
const sdk = new WeiboSDK({
  hooks: {
    onRaw: async (raw, meta) => {
      await saveRaw(meta.endpoint, meta.args, raw)
    },
  },
})
```

单条微信也可以直接拿 raw：

```ts
const { tweet, raw, longText } = await sdk.tweets.enrich('QqsYymYOS', {
  includeLongText: true,
})
```

## JSONL 遥测

```ts
import { createJsonlTelemetry } from '@chilfish/weibo-sdk'

const sdk = new WeiboSDK({
  telemetry: createJsonlTelemetry({
    write: line => process.stdout.write(`${line}\n`),
  }),
})
```

CLI 的 `archive` / `archive user` 内部也用这套事件生成 `progress` / `done`。

## 分级日志

日志默认关闭，SDK 不产生 console / 文件 IO。需要时显式接入：

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
- 内置 sink 默认替换 Cookie / token 等敏感字段。

## 日志与 stdout 的边界

- SDK 不写 stdout / stderr（除非显式接入 logger）。
- CLI 的数据输出（JSON / NDJSON）不经过 logger，不会被日志污染。
