---
layout: home
hero:
  name: Weibo SDK
  text: 读取与归档微博公开数据
  tagline: TypeScript SDK 与 weibo-cli。访客身份可用，归档可以断点续跑，默认测试离线运行。
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
  - title: 访客可用
    details: 不传 Cookie 就以访客身份读取用户资料、单条微博、评论、媒体和热搜。
  - title: 归档可续跑
    details: streamArchive 按 checkpoint 续跑；userArchive 按时间段补全详情、评论、楼中楼和转发。
  - title: 结构化输出
    details: 读取方法返回归一化领域模型，归档文件有 JSON Schema，字段含义写在文档里。
  - title: 离线测试
    details: 默认测试不访问网络；每个端点用真实响应 fixture 校验 Zod schema。
---

## 30 秒上手

```bash
pnpm add @chilfish/weibo-sdk
```

```ts
import { WeiboSDK } from '@chilfish/weibo-sdk'

const sdk = new WeiboSDK({}) // 没有 Cookie，使用访客身份

const tweet = await sdk.tweets.getByMblogId('QqsYymYOS')
const comments = await sdk.tweets.comments('QqsYymYOS', { count: 20 })
const context = await sdk.tweets.context('QqsYymYOS', { comments: 5 })

for await (const item of sdk.archive.streamArchive('1111681197', { includeLikes: true })) {
  console.log(item.source, item.mblogId)
}
```

## 接下来

- [安装与环境](/guide/installation)：Node 版本、ESM、浏览器子路径。
- [鉴权与访客模式](/guide/authentication)：Cookie 来源、`auth` 三种取值、能力边界。
- [分页与流式读取](/guide/pagination-streaming)：`list*` / `stream*`、游标、停止条件。
- [API 参考](/api/)：每个方法的签名、参数、返回、错误与访客可用性。
- [CLI 参考](/cli/)：`weibo-cli` 命令、JSON / NDJSON 输出与 `jq` 管道。
