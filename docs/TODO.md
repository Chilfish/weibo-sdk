# TODO / Next Steps (TDD-first)

> 原则：每个功能都有对应测试用例；默认测试必须离线可跑（不依赖真实微博网络 IO）。

---

## 优先级说明

- 🔴 P0：阻塞当前可用性或涉及仓库一致性
- 🟡 P1：功能推进（直接扩展 SDK 能力）
- 🟢 P2：工程优化（DX / 可维护性 / 文档）

---

## P0：仓库一致性与文档

- [x] **README 去伪存真**（2026-05-16 完成）。
- [x] **docs/渐进式开发计划.md** 重写为 2.0 版（2026-05-16 完成）：含完成状态、Bug 跟踪、7 Phase 路线图、Fixture 清单。
- [x] 输出"错误排障手册"（`docs/error-diagnostics.md`，2026-05-16 完成）。

---

## P1：功能推进

### Tweet 服务完善
- [x] 分页 Bug 修复：`since_id` 类型 `number` → `string`、`total: -1` 处理、`hasMore` 逻辑修正（基于真实 API fixture，2026-05-16）。
- [x] 广告过滤：`filterTweets(rawList)` 过滤 `isAd === true`（2026-05-16）。
- [x] `Tweet` 归一化 v2：抽取 `normalizeTweet(raw)` 纯函数，Tweet 类简化为薄包装（2026-05-16）。
- [x] 函数重载：`listByUserId(uid, sinceId?)` | `listByUserId(uid, { sinceId?, count? })`，含 `count` 参数（2026-05-16）。
- [x] 新增 endpoint：评论列表 `GET /ajax/statuses/buildComments`（2026-05-16，`sdk.tweets.comments()`）
- [x] 新增 endpoint：首页 Feed `GET /ajax/feed/friendstimeline`（2026-05-16，`sdk.tweets.friendTimeline()`）
- [x] 新增 endpoint：热搜榜单 `GET /ajax/side/bandUnified?type=hot`（2026-05-16，`sdk.trends.hotBand()`）
- [x] 修复 Search endpoint URL → `m.weibo.cn/api/container/getIndex`（2026-05-16，`sdk.search.searchUsers()`）
- [x] 修正 `mymblog` 参数：args schema 已加 `page`+`feature`（2026-05-16）
- [x] 补充 `profile/info` 缺失参数：args schema 已加 `scene`（2026-05-16）

### 流式接口
- [x] `TweetService.streamByUserId()` AsyncIterator 自动翻页（2026-05-16）。

### 新增端点（参考 Weibo-archiver 已有能力）

- [ ] `GET /ajax/statuses/longtext?id={mblogid}` — 获取长微博全文
- [ ] `GET /ajax/friendships/friends?uid={uid}&page={n}` — 获取用户关注列表（分页 + cursor）
- [ ] `GET /ajax/profile/followContent?page={n}` — 获取自己关注列表
- [ ] `GET /ajax/favorites/all_fav?uid={uid}&page={n}&with_total=true` — 获取收藏夹（分页遍历）
- [ ] `GET /ajax/statuses/searchProfile?uid={uid}&starttime={ts}&endtime={ts}&page={n}` — 按日期范围搜索用户微博
  - 支持 `hasori/hasret/hastext/haspic/hasvideo/hasmuisc` 过滤参数

### 高级功能

- [ ] 长微博自动展开：拉取 `isLongText` 微博时自动调用 longtext API 补全全文
- [ ] 评论自动填充：批量微博扫描时选择性填充每条前 N 条评论
- [ ] 桌面端搜索 `/ajax/side/search`（与 m.weibo.cn 不同端点，需评估价值）

---

## P2：工程优化

### Zod / Schema 迁移
- [x] 用 `z.infer<typeof Schema>` 逐步替代手写 `types/raw/**`（2026-05-16 完成）。
- [x] 明确 schema strictness 策略：`.passthrough()` 开放端点，所有代码访问字段 `.optional()`（2026-05-16 确定）。
- [x] 为所有 endpoint 补充 args schema（`myDetailsSpec` 添加 `z.object({}).strict()`，2026-05-16）。

### 可观测性与测试
- [x] 将 `normalize_done` 事件的 `trace_id` 统一为入口方法级格式（2026-05-16）。
- [x] 真实 API fixture 基线：6 个 JSON 文件（2026-05-16）。
- [x] `tests/testkit/` 扩展：添加通用 `FakeClock` + barrel 导出（2026-05-16）。
- [x] 扩大 telemetry 测试覆盖：新增 preflight error + parse error 事件断言（2026-05-16）。

### CI / 构建
- [x] 配置 CI（GitHub Actions）：`pnpm install` → `pnpm run typecheck` → `pnpm run lint` → `pnpm test`（2026-05-16）。
- [x] 配置 `size-limit`（2026-05-16，20kB 限制）。

### 开发者体验
- [ ] 补充公共 API 的 TSDoc 注释（当前仅部分方法有注释）。

---

## 已完成 ✓

<details>
<summary>展开查看已完成的条目</summary>

### 0. 仓库一致性与"文档即事实"
- [x] 对齐 README 与实际目录结构（移除错误的 monorepo 描述）。
- [x] 移除库入口副作用（`src/index.ts` 不再 `console.log`），并用测试防止回归。
- [x] 统一导出面：`src/index.ts` 与 `src/types/index.ts` 导出 domain/raw 等公共契约。

### 1. 测试基座与分层策略
- [x] 约定并落实测试分层：unit / component / e2e。
- [x] 迁移集成测试脚本到 `tests/e2e/*`，用 `WEIBO_E2E=1` 显式开启。
- [x] 为 `package.json#exports` 添加回归测试。

### 2. Contract First
- [x] 对齐文档与代码中的命名/字段（`realName` camelCase）。

### 3. Internal 基础设施可测性改造
- [x] FetcherService 解耦 axios：支持注入 `AxiosInstance/Auth/RateLimit`。
- [x] FetcherService 单测覆盖 request 注入/错误映射等核心路径。
- [x] 引入 SDK hooks（`onLifecycle/onFetched/onError`）与 preflight 自检（lazy/eager）。
- [x] 引入 `EndpointSpec + request(spec)`：统一处理 ok!=1 / schema 校验 / hooks emission。
- [x] 引入 Zod schema 验证：协议层集中产出可诊断的 `API_BAD_RESPONSE`（含 `zodIssues`）。
- [x] 定义并实现 telemetry（Wide Events）接口。
- [x] RateLimitService 注入 `now()` 与 `sleep(ms)`，支持 fake clock。
- [x] RateLimitService 去递归（while 循环替代递归等待）。
- [x] AuthService 单测覆盖。

### 4. UserService & User Model
- [x] UserService 组件测试（mock HTTP）：覆盖 endpoint/params/referer 与 hooks 调用。
- [x] User 归一化单测：avatar fallback、IP 属地前缀、stats/扩展字段映射。

### 5. TweetService
- [x] 扩展 `types/resources.ts` 资源映射与 raw schema 覆盖（含 `TWEET_MYMBLOG`）。
- [x] Tweet：实现 mymblog 列表 + show 详情。
- [x] Tweet 归一化 v1：media/pageInfo/geo/retweetedStatus。

### 6. Wide Events
- [x] 定义统一 `TelemetryEvent`（扁平 KV，含 `event_name/timestamp/trace_id`）。
- [x] 关键路径打点：request_start/success/error、rate_limit_wait、normalize_done。
- [x] 测试中可断言事件序列与字段完整性。

### 7. Zod / Spec 工程化
- [x] 将 schema/spec 从 Service 文件中抽离到 `src/services/endpoints/**`。
- [x] 将 `EndpointSpec` 的 args 类型改为"由 args schema 推导"，并提供 `defineEndpoint()` helper。

</details>
