---
title: Agent 接入
description: llms.txt、单页 Markdown 与归档 schema 的取用方式。
---

# Agent 接入

这个站点的每一页都有 Markdown 版本，抓取时省掉 HTML 的导航和脚本。

## 索引

- [`/llms.txt`](https://weibo-sdk.chilfish.top/llms.txt)：全部页面的链接和一句话说明，按指南 / API 参考 / CLI / 契约分组。
- [`/llms-full.txt`](https://weibo-sdk.chilfish.top/llms-full.txt)：整站文档合成一份，79K tokens 左右。

先拿索引定位，再按需要拉单页。

## 单页

页面 URL 后面接 `.md` 就是 Markdown 版本：

```text
https://weibo-sdk.chilfish.top/guide/quick-start      HTML
https://weibo-sdk.chilfish.top/guide/quick-start.md   Markdown
```

页面顶部有「复制本页」和下载按钮，也能一键交给 ChatGPT 或 Claude 继续问。

## 归档格式

归档文件的 JSON Schema 在 [`/schemas/weibo-user-archive/v3.json`](https://weibo-sdk.chilfish.top/schemas/weibo-user-archive/v3.json)，拿它校验产物或生成下游类型。

## 边界

- 只读，没有发帖、点赞、评论这类写操作。
- 访客身份可以读公开数据；用户时间线、点赞、关注只有第一页，首页与通知需要 Cookie。
- 错误先看 `code` 字段，不要匹配文案。

## 仓库里的技能

仓库带一份 Agent Skill：`.agents/skills/weibo-sdk/SKILL.md`，写的是用本地源码跑 CLI、验证端点、新增逆向端点的流程。改这个项目的时候读它。
