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

访客 token 发放也使用同一个 fetch 时：

```ts
const sdk = new WeiboSDK({
  fetch: myFetch,
  transport: fetchTransport({ fetch: myFetch }),
})
```

`WeiboTransport` 负责发送请求并返回 HTTP 结果；重试、限流、鉴权、错误映射由 SDK 处理。

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
- `apiVersion` 必填，当前接受 `1`。
- `observe` 是只读观察者：不 await，异常会被吞掉。
- transport 中间件可以短路、缓存或 mock 请求。
- `retry` / `rate-limit` / `auth-refresh` 的执行顺序由 SDK 固定。

完整契约见 [传输与插件参考](/reference/plugins)。

## 凭证

`CredentialResolver` 是凭证解析端口，默认包装 Cookie / 访客逻辑。`credentialId` 只暴露非敏感标识，用于遥测与排障。
