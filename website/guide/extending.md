---
title: 传输与插件
---

# 传输与插件

## 替换传输

默认使用 axios。Worker / Edge / Deno / Bun / 测试替身可以换成原生 fetch：

```ts
import { fetchTransport, WeiboSDK } from '@chilfish/weibo-sdk'

const sdk = new WeiboSDK({ transport: fetchTransport() })
```

需要同时替换访客 token 发放用的 fetch：

```ts
const sdk = new WeiboSDK({
  fetch: myFetch,
  transport: fetchTransport({ fetch: myFetch }),
})
```

`WeiboTransport` 只负责发送请求并返回 HTTP 结果；重试、限流、鉴权、错误映射仍由 SDK 处理。

## 插件

插件在 `new WeiboSDK()` 时组装，按 `pre → normal → post` 排序，同组按注册顺序：

```ts
const sdk = new WeiboSDK({
  plugins: [
    {
      name: 'metrics',
      apiVersion: 1,
      enforce: 'post',
      observe: event => metrics.push(event),
    },
    {
      name: 'headers',
      apiVersion: 1,
      hooks: {
        beforeRequest: (ctx) => {
          ctx.headers['x-client'] = 'my-app'
        },
      },
    },
  ],
})
```

约束：

- `name` 必须唯一，重复会抛 `CONFIG_INVALID`。
- `apiVersion` 必填，当前只接受 `1`。
- `observe` 是只读观察者：不 await，抛错被吞掉。
- transport 中间件可以短路、缓存或 mock。
- `retry` / `rate-limit` / `auth-refresh` 的顺序不开放给插件。

完整契约见 [传输与插件参考](/reference/plugins)。

## 凭证解析

`CredentialResolver` 是凭证解析端口，默认包装 Cookie / 访客逻辑。当前不提供多账号 token 池；`credentialId` 只暴露非敏感标识，用于遥测与排障。
