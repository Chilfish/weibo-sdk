---
layout: home
hero:
  name: Weibo SDK
  text: 读取与归档微博公开数据
  tagline: TypeScript SDK + weibo-cli。契约稳定、离线可测、访客可用，媒体与归档一条链路。
  image:
    src: /logo.svg
    alt: Weibo SDK
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/quick-start
    - theme: alt
      text: API 参考
      link: /api/
    - theme: alt
      text: GitHub
      link: https://github.com/Chilfish/weibo-sdk
features:
  - title: 稳定子集
    details: 领域模型、服务方法、归档契约按 Stable / Experimental 分层；导出面有快照与文档覆盖率门禁。
  - title: 访客优先
    details: 没有 Cookie 也能读公开数据；auth 只由构造配置决定，Cookie 过期不会静默降级。
  - title: 归档可续跑
    details: streamArchive / userArchive 支持 checkpoint、增量、多账号与媒体；续跑语义明确为 at-least-once。
  - title: 离线可测
    details: 默认测试不访问网络；每个端点用真实 fixture 校验 Zod schema，上游漂移可定位。
---

## 30 秒上手

```bash
pnpm add @chilfish/weibo-sdk
```

```ts
import { WeiboSDK } from '@chilfish/weibo-sdk'

const sdk = new WeiboSDK({}) // 没有 Cookie → 自动使用访客身份

const tweet = await sdk.tweets.getByMblogId('QqsYymYOS')
const comments = await sdk.tweets.comments('QqsYymYOS', { count: 20 })
const context = await sdk.tweets.context('QqsYymYOS', { comments: 5 })

for await (const item of sdk.archive.streamArchive('1111681197', { includeLikes: true })) {
  console.log(item.source, item.mblogId)
}
```

## 接下来

- [安装与环境](/guide/installation)：Node 版本、ESM、浏览器子路径。
- [鉴权与访客模式](/guide/authentication)：Cookie 来源、`auth` 三态、能力边界。
- [分页与流式读取](/guide/pagination-streaming)：`list*` / `stream*`、游标、停止条件。
- [API 参考](/api/)：每个方法的签名、参数、返回、错误与访客可用性。
- [CLI 参考](/cli/)：`weibo-cli` 命令、JSON / NDJSON 输出与 `jq` 管道。
