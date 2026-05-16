# TODO / Next Steps (TDD-first)

> 原则：每个功能都有对应测试用例；默认测试必须离线可跑（不依赖真实微博网络 IO）。

---

## 优先级说明

- 🔴 P0：阻塞当前可用性或涉及仓库一致性
- 🟡 P1：功能推进（直接扩展 SDK 能力）
- 🟢 P2：工程优化（DX / 可维护性 / 文档）

---

### 新增端点（参考 Weibo-archiver 已有能力）

> 已验证浏览器抓包（`tests/fixtures/raw/captures/`），脱敏 fixture 已就绪。

- [ ] `GET /ajax/statuses/longtext?id={mblogid}` — 获取长微博全文
  - fixtures ✅ `longtext.json`：`{data: {longTextContent, topic_struct, url_struct, isMarkdown}}`
- [ ] **`GET /ajax/friendships/friends`** — 获取用户关注列表（cursor 分页）
  - fixtures ✅ 2 个 UID 各 1 页：`friendships_followings_u*.json`
  - 数据路径：`{users[], total_number, next_cursor, previous_cursor, ok}`
- [ ] **`GET /ajax/profile/followContent`** — 获取自己关注列表（cursor 分页）
  - fixtures ✅ 3 页：`followContent.json` / `_p2` / `_p3`
  - 数据路径：`{data: {follows: {users[], next_cursor, total_number}}, specialAttention, ok}`
- [ ] **`GET /ajax/favorites/all_fav`** — 获取收藏夹（按页遍历）
  - fixtures ✅ 1 页：`favorites_p1.json`（19 条微博）
  - 数据路径：`{data: {status: Post[]}, ok}` — 每条为完整 Status 对象（含 user/page_info/pic_infos）
- [ ] **`GET /ajax/statuses/searchProfile`** — 按日期范围搜索用户微博
  - fixtures ✅ 2 页：`searchProfile_p1.json` / `_p2`（各 50 条）
  - 参数：`uid, page, starttime, endtime, hasori, hasret, hastext, haspic, hasvideo, hasmusic`
  - 数据路径：`{data: {list: Post[], total, absstr}, ok}` — list 结构与 mymblog 相同

### 实现计划（按推荐顺序）

1. **`/statuses/longtext`** — 最简单，1 参数 1 字段
   - 新增 `src/services/endpoints/tweet.ts`：`longtextSpec`
   - 方法：`TweetService.longText(mblogId)` → `{ longTextContent, topicStruct, urlStruct }`
   - 高阶用法：`TweetService._expandLongText(tweetList)` 遍历 `isLongText` 微博自动补全全文

2. **`/friendships/friends` + `/followContent`** — 两个端点结构相似，可共享 FollowingsService
   - 新增 `src/services/endpoints/follow.ts`：`friendshipsSpec` + `followContentSpec`
   - 新增 `src/services/public/FollowingsService.ts`：
     - `getFollowings(uid, page?)` → 调用 friendships
     - `getMyFollowings(page?)` → 调用 followContent
     - 两者均返回 `{users: FollowingUser[], nextCursor, totalNumber}`
   - Model：`FollowingUser` 归一化（精简 User 子集，关注列表字段比 profile/info 少）
   - 分页：cursor 而非 since_id

3. **`/statuses/searchProfile`** — 可纳入 TweetService 或独立
   - 新增 `src/services/endpoints/tweet.ts`：`searchProfileSpec`
   - 方法：`TweetService.searchByDate(uid, {starttime, endtime, page?, hasori?, hasret?, ...})`
   - 返回格式与 `listByUserId` 相同（`Tweet[]`），可复用 `normalizeTweet`

4. **`/favorites/all_fav`** — 独立 FavoriteService
   - 新增 `src/services/endpoints/favorite.ts`：`favoritesSpec`
   - 新增 `src/services/public/FavoriteService.ts`：`getFavorites(uid, page?)`
   - 收藏内微博可复用 `normalizeTweet`

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


</details>
