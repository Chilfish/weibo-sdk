# 微博 SDK 渐进式开发计划

> **版本**: 2.0.1
> **最后更新**: 2026-08-09
> **状态**: 基础设施与 9 个端点已完成，进入"数据驱动精确化 + 新端点扩展"阶段
>
> 后续所有开发必须以真实微博 API 返回数据为准（见 `CLAUDE.md` 中"数据驱动开发"章节）。

---

## 当前状态

### 已完成的基础设施

- FetcherService（HTTP 核心，支持 DI/ErrorMapping/Preflight）
- AuthService（Cookie/Token 管理）
- RateLimitService（令牌桶，支持 FakeClock）
- EndpointSpec + defineEndpoint（端点定义范式）
- Zod Schema 校验（统一在 request() 中做 safeParse）
- Wide Events 可观测性（request_start/success/error/rate_limit_wait/normalize_done + sdk_init/self_check_*）
- 结构化错误体系（TransportError / BusinessError / ProtocolError）
- 测试分层（unit / component / e2e）与 mock（fakeAxios / FakeClock / TelemetryCollector）

### 已实现的端点与服务

| 端点 | Service 方法 | 说明 |
|---|---|---|
| `ajax/profile/info` | `UserService.info()` / `getById()` | 用户信息 |
| `ajax/profile/detail` | `UserService.details()` / `myDetails()` / `getById()` | 用户详情（`myDetails` 无 uid，自检用） |
| `ajax/statuses/mymblog` | `TweetService.myMblog()` / `listByUserId()` / `streamByUserId()` | 用户微博列表（分页 + 广告过滤 + 流式） |
| `ajax/statuses/show` | `TweetService.show()` / `getByMblogId()` | 微博详情 |
| `ajax/statuses/longtext` | `TweetService.longText()` | 长微博全文 |
| `ajax/statuses/searchProfile` | `TweetService.searchByDate()` | 按日期范围搜索用户微博 |
| `ajax/statuses/buildComments` | `TweetService.comments()` | 微博评论列表 |
| `ajax/feed/friendstimeline` | `TweetService.friendTimeline()` / `listFriendTimeline()` | 首页 Feed（归一化） |
| `ajax/side/bandUnified` | `TrendsService.hotBand()` | 热搜榜单 |
| `ajax/friendships/friends` | `FollowingsService.getFollowings()` | 用户关注列表 |
| `ajax/profile/followContent` | `FollowingsService.getMyFollowings()` | 我的关注列表 |
| `ajax/favorites/all_fav` | `FavoriteService.getFavorites()` | 收藏夹 |
| `m.weibo.cn/api/container/getIndex` | `SearchService.searchUsers()` / `searchTweets()` | 搜索用户 / 微博 |

所有端点均含 argsSchema 校验；`User` / `Tweet` 归一化由 `models/data/*.ts` 纯函数完成。

---

## 历史：真实 API 数据发现的问题

2026-05-16 通过 `.env` 中真实 Cookie 调取微博 API，与当时代码对比发现以下偏差（均已修复）。

| # | 问题 | 真实值 | 修复 |
|---|---|---|---|
| B1 | `since_id` 类型错误 | `string`（空串 `""`） | ✅ `data.since_id: string` |
| B2 | `total` 为 `-1` | `-1`（非范围值） | ✅ `raw.data.total > 0` 前置条件 |
| B3 | `mymblog` 响应 `data` 包装层 | `{ok, data: {since_id, list, total}}` | ✅ Service 路径改为 `raw.data.*` |
| B4 | `retweeted_status` 嵌套可 null | `user` / 嵌套 retweet 均可 null | ✅ Schema 兼容 nullable |
| B5 | 搜索端点 host 错误 | `m.weibo.cn` 而非 `weibo.com` | ✅ URL 修正 + containerid 编码 |
| B6 | mymblog 分页契约漂移（2026-08-09） | `since_id` 失效（传任意值均回第一页）、`total` 恒 `-1`，改用 `page` | ✅ schema `since_id`/`total` optional + Service/Archive 改 page 游标 |

**核心教训**：Schema ≠ 真相。所有生产 Bug 均源于"合理推断"而非"数据验证"，必须抓包取真实 fixture。
**第二教训（2026-08-09）**：上游分页策略会漂移——mymblog 曾用 `since_id`（2026-05 实测），数月后弃用改 `page`。分页/字段类型需周期性用真实数据回归，不能一次验证终身有效。

**2026-10-19 真实回归**（Cookie 只读 `.env` 后跑通 18/18 E2E）：

- `mymblog`：`since_id` 已不可用，`page` 游标成立；`listByUserId()` 返回 `page`，不再返回 `sinceId`。
- `favorites`：`data = { status, total_number }` 对象，不是数组。
- `searchProfile`：无日期与带日期参数均可用；`starttime` / `endtime` 为 **unix 秒**（日期字符串会被静默忽略）；单页约 50 条，大范围 `total` 会失真且 page 越界会重置，归档需用自适应日期窗口；曾出现一次瞬时空列表，重跑恢复——测试需容忍瞬时空结果。
- `friendships`：raw 用户字段继续增加（`pay_date` / `brand_ability` 等），`passthrough` 承接。
- `statuses/show` + `mix_media_info`：稳定；LivePhoto 的 `gif_mp4` 作为 `videoUrl` 输出。

---

## 开发路线图

### Phase 1：基于真实数据的 Bug 修复（P0）— ✅ 已完成
- [x] `IMyMBlogResponse` 重构为 `{ ok, data: { since_id, list, total } }` 包装结构
- [x] `since_id` 类型改为 `string`
- [x] `listByUserId` 中 `hasMore` 计算增加 `raw.data.total > 0` 前置条件

### Phase 2：Schema 精确化（P1）— 基本完成
- [x] 声明 Model 构造器实际访问的字段，其余保留 `.passthrough()` 向后兼容
- [x] `UserInfoResponseSchema` 17 字段（User 构造器访问面）
- [x] `UserDetailsResponseSchema` 全部字段（`company`/`career`/`links` optional）
- [x] `StatusShowResponseSchema` ~25 核心字段 + `retweeted_status` 用 `z.lazy()` 递归
- [x] `MyMblogResponseSchema` 7 顶层 + list 元素 ~25 字段
- [x] `pic_infos` 内层结构精确化（`PicSizeSchema`/`PicInfoSchema`：`width/height` 为 `number|string`、`type` 可为 `null`/`''`/`'pic'`，基于真实 fixture 验证）
- [x] `annotations` 行为多变（异构数组含嵌套数组，约束为 `z.array(z.unknown())`，基于真实 fixture 验证）

> **2026-08-09 数据驱动校验发现的 schema 修复**（用真实 fixture 对全部 endpoint schema 做 safeParse 时发现并修复）：
> - `retweeted_status.geo` 真实可为**空字符串** → `geo` 接受 `record | string | null`
> - `searchProfile.data.total` 真实为 **string**（如 `"185"`）→ 接受 `number | string`
> - `favorites.data` 真实为**对象** `{status: [...]}` 而非数组 → schema 与 `Favorites.test.ts` 同步修正
> - `feed_groups.json` 为另一端点（feed groups）的 fixture，不适用 friendstimeline schema（已注明）

### Phase 3：微博变种场景测试（P2）— ✅ 已完成
- [x] 纯文本 / 转发递归 / 多图 / 长微博 / 链接卡片 / 话题 变种测试（`tests/unit/models/Tweet.variants.test.ts`）
- [x] 含视频（`mix_media_info`）
- [x] 含位置（`geo`）
- [x] 含 `continue_tag`（长图文）
- [x] 广告（`isAd: true`）

> 2026-10-19：P1-8 补齐后四类变种（共 13 条用例），文件 21/21 通过；真实 fixture 优先，形状边界用内联最小样本精确断言。

### Phase 4：自动化 Schema 校验（P2）— ✅ 已完成
- [x] 编写 `scripts/validate-fixtures.ts`：遍历 `tests/fixtures/raw/*.json` 用对应 schema 做 safeParse，输出校验报告（`pnpm run validate:fixtures`，已入 CI；2026-10-19 复核 38 fixtures / 33 mapped / 0 fail）

### Phase 5：新端点开发（P1）
已完成：`longtext` / `buildComments` / `friendstimeline` / `bandUnified` / `searchProfile` / `friendships/friends` / `followContent` / `favorites/all_fav` / `search*`

> 注：`searchUsers` / `searchTweets` 公开关键词搜索已**产品暂缓**（2026-10-19：官方搜索体验差、接口失效）；`searchProfile`（个人主页内按日期搜索）仍可用，属于归档主线，且已作为 P1-5 日期切片的数据源。
>
> 下游集成：P2-1 已新增 `weibo-sdk/browser` 自包含 ESM 入口（真实 Chromium 冒烟），P2-3 已提供 JSONL telemetry 消费端；决策见 [p2-readiness.md](./p2-readiness.md)。

已完成（归档 MVP）：
1. [x] 转发列表 `/ajax/statuses/repostTimeline`
2. [x] 粉丝列表（`ajax/friendships/friends` 对偶）
3. [x] 收藏夹标签 `/ajax/favorites/tags`（fixture 已有 `favorites_tags.json`）

后续扩展候选见 [backlog.md](./backlog.md)（评论回复树 / 搜索增强 / 搜索接口恢复）。

每个新端点流程：
1. curl 获取真实响应并存 fixture
2. 定义 args Schema
3. 定义 response Schema（先 `.loose()` 再精确化）
4. 实现 endpoint spec
5. Service 中提供 public 方法 + CLI 子命令
6. 写测试

---

## 测试策略

| 类型 | 网络 | 数据 | 运行条件 |
|---|---|---|---|
| Unit | 无 | 硬编码 mock | `pnpm test` |
| Component | 无 | fakeAxios | `pnpm test` |
| Fixture-based | 无 | 真实脱敏 fixture | `pnpm test` |
| E2E | 真实 | 真实 Cookie | `WEIBO_E2E=1`（由 `vitest.e2e.config.ts` 显式设置） |

> **E2E 门控**：`tests/e2e/**` 用例仅在 `WEIBO_E2E === '1'` **且** `.env` 中存在 `WEIBO_COOKIE` 时运行，否则整组 `describe.skip`。`WEIBO_E2E` 不放入 `.env`（Vitest 默认加载 `.env`，会污染默认 `pnpm test`）；真实 Cookie 仅存于 `.env`（`tests/e2e/setup-env.ts` 只读该文件，不继承环境变量）。

---

## 真实数据获取操作手册

> **自动化抓取**：可复现的浏览器自动化（CDP）批量抓取见 [engineering/browser-capture.md](../engineering/browser-capture.md)。

### 前置条件

```bash
# .env 需包含：
WEIBO_COOKIE="SUB=xxx; XSRF-TOKEN=xxx; ..."

# 运行 E2E（WEIBO_E2E 由 vitest.e2e.config.ts 显式设置，无需写入 .env）
pnpm test:e2e
```

### 常用 API 调用

```bash
source .env
TOKEN=$(echo $WEIBO_COOKIE | sed -n 's/.*XSRF-TOKEN=\([^;]*\).*/\1/p')
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

# 用户信息
curl -s -H "Cookie: $WEIBO_COOKIE" -H "X-XSRF-TOKEN: $TOKEN" -H "User-Agent: $UA" \
  "https://weibo.com/ajax/profile/info?uid={uid}"

# 微博详情
curl -s -H "Cookie: $WEIBO_COOKIE" -H "X-XSRF-TOKEN: $TOKEN" -H "User-Agent: $UA" \
  -H "Referer: https://weibo.com/detail/{mblogid}" \
  "https://weibo.com/ajax/statuses/show?id={mblogid}&isGetLongText=true"

# 保存 fixture
curl -s ... > tests/fixtures/raw/{name}.json
```

> 新抓取的数据需按 `tests/fixtures/raw/INDEX.md` 的脱敏规则处理（URL → `<URL>`、长 ID → `<ID>`、日期 → `<DATE>`、≤40 字符短字符串保留），并同步更新 INDEX.md。

### 筛选特定变种

```python
import json
with open('mymblog.json', encoding='utf-8') as f:
    data = json.load(f)
for p in data['data']['list']:
    print(p['mblogid'], f"pics={p.get('pic_num',0)}",
          f"retweet={'retweeted_status' in p}",
          f"long={p.get('isLongText', False)}")
```

---

## 现有 Fixture 清单

完整清单与脱敏规则见 `tests/fixtures/raw/INDEX.md`（**唯一事实源**）。当前 38 个 JSON fixture（33 个已映射 schema + 5 个显式 unmodeled），按端点分组：

| 端点 | fixture | 说明 |
|---|---|---|
| `profile/info` | `profile_info_u1740358225.json` / `profile_info_u2365795232.json` | 2 个用户 |
| `profile/detail` | `profile_detail.json` / `profile_detail_v2.json` / `profile_sidedetail.json` | 用户详情 |
| `statuses/mymblog` | `timeline_u1740358225.json` / `timeline_u2365795232.json` | 9 / 24 条时间线 |
| `statuses/show` | `tweet_{QqsYymYOS,OgHLUyXYP,P6yhlzD3j,PCN4v8k6W,QFekiwGId}.json` | 5 个变种详情 |
| `statuses/buildComments` | `comments.json` | 20 条评论 |
| `feed/friendstimeline` | `feed_home.json` / `feed_groups.json` | 25 条 Feed |
| `statuses/longtext` | `longtext.json` | 长微博全文 |
| `statuses/searchProfile` | `searchProfile_p1.json` / `searchProfile_p2.json` | 各 50 条 |
| `statuses/repostTimeline` | `repost_timeline.json` / `repost_timeline_p2.json` | 24 / 2 条转发 |
| `side/bandUnified` | `hot_trends.json` / `side_cards.json` | 热搜 52 条 |
| `friendships/friends` | `friendships_followings_u{7679065628,2142312651}.json` | 19 / 20 个关注 |
| `friendships/friends?relate=fans` | `friendships_fans_u2365795232.json` / `_p2` | 2 / 2 个粉丝 |
| `profile/followContent` | `followContent.json` / `_p2` / `_p3` | 48 / 48 / 50 个关注 |
| `favorites/all_fav` | `favorites_p1.json`（19 条）/ `favorites_tags.json` | 收藏夹 |
| `search/*` | `search_users_p2.json` / `search_users_p3.json` | 搜索 |
| 其他 | `check_reward.json` / `statuses_config.json` | 辅助 |
