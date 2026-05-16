# Postmortem 005 — Capture-Driven Endpoint Discovery

**Date**: 2026-05-16
**Branches**: `codex/comments-endpoint`, `codex/friendstimeline-endpoint`, `codex/hot-trends`, `codex/search-fix`

## Summary

通过浏览器 DevTools 抓包，获取了微博完整用户流程（首页→详情页→个人主页→搜索）的真实 API 请求/响应对。从 49 对数据中筛选出 14 个有价值的端点，实现了 3 个新端点 + 修复了搜索端点。

## Impact

- 3 个新端点上线：`buildComments`（评论）、`friendstimeline`（首页 Feed）、`bandUnified`（热搜）
- 1 个端点修复：Search API host 从 `weibo.com` 改为 `m.weibo.cn`
- 测试从 59 增至 62（均为离线 fixture 验证）
- 发现 3 个现有端点的参数差异（`mymblog` 缺 `page`/`feature`，`profile/info` 缺 `scene`）

## Root Cause Analysis

### 搜索端点 404 的根因
搜索 API 的 host 是 `m.weibo.cn`（移动端），而非 `weibo.com`（桌面端）。URL 格式也完全不同：
- 错误：`GET https://weibo.com/ajax/search/users?q=...`
- 正确：`GET https://m.weibo.cn/api/container/getIndex?containerid=100103type%3D3%26q%3D...%26t%3D&page_type=searchall`

如果不通过浏览器抓包，仅靠猜测 Web API 端点几乎不可能命中正确 URL。

### 为什么抓包是唯一可靠的数据源
1. 微博没有公开 API 文档
2. 桌面端和移动端使用不同的 API host
3. 端点 URL 命名无规律（`buildComments`、`friendstimeline`、`bandUnified`）
4. 参数格式多样（`containerid` 内嵌 URL 编码、`page` vs `since_id` 分页策略不同）

## Decision Log

1. **优先实现 fixture 覆盖而非 E2E 验证**
   - 先写 Schema + fixture 测试确保数据结构正确
   - E2E 验证留待后续（需要真实 Cookie 且数据会变化）
   - 决策理由：fixture 是稳定的，E2E 快照会因数据变化频繁漂移

2. **搜索端点重写而非修补**
   - 旧端点从 host 到 URL 到响应结构全错
   - 直接重写比维护兼容层更干净

3. **`TrendsService` 独立于 `TweetService`**
   - 热搜与微博是不同的领域概念
   - 独立 service 有利于未来扩展（话题榜、文娱榜等）

4. **`friendstimeline` 复用 `MyMBlogItemSchema`**
   - 首页 Feed 的每条微博结构与 `mymblog` 列表项完全相同
   - 复用 Schema 避免重复定义，也确认了两者的数据一致性

## Lessons Learned

- **永远不要猜测 API URL**：先抓包再实现，避免浪费在错误端点上
- **区分 host**：微博有多个 API host（`weibo.com`、`m.weibo.cn`、`rm.api.weibo.com`），功能不同
- **分页策略不统一**：`mymblog` 用 `since_id` 游标（光标式），`buildComments` 用 `max_id`，搜索用 `page`（偏移式）。每个端点必须单独验证
- **卡片模式**：`m.weibo.cn` 使用 `cards[{card_type, card_group[{...}]}]` 的卡片模式组织数据，不同于 `weibo.com` 的直接 JSON 结构

## Anti-pattern Indexing

1. **先实现后验证的搜索端点**
   - 症状：`/ajax/search/users` 返回 404，但代码和 Schema 都已写好
   - 根因：凭直觉猜测 API URL（`weibo.com/ajax/search/...`）
   - 处置：所有新端点必须先有 fixture 再有实现

2. **E2E 搜索测试用 try/catch 跳过 404**
   - 症状：搜索 E2E 静默通过但从未真正验证
   - 根因：不想让 404 阻断 CI，但掩盖了根本问题
   - 处置：修复端点 URL，移除 try/catch

## Follow-ups

- 补充 `mymblog` 的 `page`/`feature` 参数（抓包显示实际使用这些参数）
- 补充 `profile/info` 的 `scene` 参数
- 实现微博搜索（type=1，已有 fixture 结构可复用）
- 用搜索分页的真实数据补充分页测试
