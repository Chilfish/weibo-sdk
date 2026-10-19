# Test Index

本文档索引项目中所有测试用例，描述其覆盖范围、运行方式与数据来源。

---

## 测试分层

| 层 | 目录 | 网络IO | 运行条件 | 用途 |
|---|---|---|---|---|
| Unit | `tests/unit/` | 否 | `pnpm test` | 纯函数、模型映射、错误类 |
| Component | `tests/component/` | 否 | `pnpm test` | 注入 mock 覆盖 Fetcher/Auth/RateLimit 等边界 |
| E2E | `tests/e2e/` | 是 | `WEIBO_E2E=1 pnpm test` | 真实 Cookie + 真实网络验证 |

---

## 测试用例清单

### Unit — 模型

| 文件 | 覆盖内容 | 关键测试点 |
|---|---|---|
| `unit/models/User.test.ts` | `User` 构造器 | avatar fallback 链（avatar_hd > avatar_large > profile_image_url）、IP属地前缀裁剪、stats映射、扩展属性（company/creditLevel/externalLinks/school） |
| `unit/models/Tweet.test.ts` | `Tweet` 构造器（mymblog 来源） | 核心字段映射、media 提取（pic_infos）、regionName、visible、stats、geo 坐标兼容（lon/lat 顺序）、retweeted_status 递归构造 |
| `unit/models/Tweet.show.test.ts` | `Tweet` 构造器（statuses/show 来源） | 从真实 fixture `tests/fixtures/raw/tweet_QqsYymYOS.json` 读取数据，验证长微博、地理位置、媒体信息归一化正确性 |

### Unit — 服务基础设施

| 文件 | 覆盖内容 | 关键测试点 |
|---|---|---|
| `unit/services/AuthService.test.ts` | `AuthService` | Cookie 中提取 XSRF-TOKEN、无 Token 时的回退行为 |
| `unit/services/RateLimitService.test.ts` | `RateLimitService` | 令牌桶算法、限流效果、FakeClock 注入、并发获取令牌 |

### Unit — 入口/导出

| 文件 | 覆盖内容 | 关键测试点 |
|---|---|---|
| `unit/entry/index.test.ts` | SDK 入口无副作用 | 导入 `WeiboSDK` 时无 console.log 等副作用 |
| `unit/entry/exports.test.ts` | 导出完整性回归 | `package.json#exports` 中声明的子路径均可正确导入 |
| `unit/sdk/WeiboSDK.test.ts` | `WeiboSDK` 门面类 | 构造器初始化 UserService/TweetService、selfCheck 模式 |

### Unit — 错误

| 文件 | 覆盖内容 | 关键测试点 |
|---|---|---|
| `unit/errors/WeiboSDKError.test.ts` | 所有错误类 | code/level/retryable 属性正确、实例化与继承链 |

### Component — FetcherService

| 文件 | 覆盖内容 | 关键测试点 |
|---|---|---|
| `component/internal/FetcherService.test.ts` | HTTP 核心 | Cookie/Token 注入、GET/POST params 处理、preflight 调用、网络错误映射（ConnectionTimeoutError / NetworkRequestError） |
| `component/internal/Telemetry.test.ts` | Wide Events | `request()` 全路径事件序列（start/success/error）、rate_limit_wait + normalize_done 事件、parse error 路径 |

### Component — 领域服务

| 文件 | 覆盖内容 | 关键测试点 |
|---|---|---|
| `component/public/UserService.test.ts` | `UserService` | info/details/myDetails 端点调用与 params、getById 归一化+正常化事件、session expired 错误、schema 校验失败 |
| `component/public/TweetService.test.ts` | `TweetService` | mymblog/show 端点调用与 params、listByUserId/getByMblogId 归一化+正常化事件、API not ok 错误、schema 校验失败 |

### E2E

| 文件 | 覆盖内容 | 前提条件 |
|---|---|---|
| `e2e/user.e2e.test.ts` | 真实网络下 UserService 端到端 | `WEIBO_E2E=1` + `.env` 中有效 `WEIBO_COOKIE` |
| `e2e/tweet.e2e.test.ts` | 真实网络下 TweetService 端到端 | `WEIBO_E2E=1` + `.env` 中有效 `WEIBO_COOKIE` |
| `e2e/new-endpoints.e2e.test.ts` | longtext / friendships / followContent / searchProfile / favorites 结构快照 | 同上 |
| `e2e/snapshot.e2e.test.ts` | profile / mymblog / show 结构快照 + 归一化形状 + SDK 生命周期 | 同上；2026-10-19 起 18/18 通过 |

---

## 测试数据来源

所有 component/unit 测试均使用 **mock HTTP**（`tests/testkit/fakeAxios.ts`），不依赖真实网络。

E2E 测试只从 `.env` 中读取 `WEIBO_COOKIE`（`tests/e2e/setup-env.ts` 会覆盖环境变量）并使用真实 API。结构快照统一使用 `src/utils/structure.ts` 的 `stripVolatileKeys`（只保留 key 路径 + 值类型），快照失败 = 上游结构变更信号。

### 真实 API 响应 Fixtures

路径：`tests/fixtures/raw/`

| 文件 | 用途 |
|---|---|---|
| `tweet_QqsYymYOS.json` | 长微博详情（Tweet.show 归一化验证） |
| `tweet_OgHLUyXYP.json` | 9 图微博详情 |
| `tweet_P6yhlzD3j.json` | 转发微博详情 |
| `tweet_PCN4v8k6W.json` | 纯文本微博详情 |
| `tweet_QFekiwGId.json` | 微博详情变种 |
| `timeline_u1740358225.json` | 用户时间线（9 条，含转发、图文、链接卡片等变种） |
| `timeline_u2365795232.json` | 用户时间线（24 条） |
| `profile_info_u1740358225.json` | 用户信息（36 字段） |
| `profile_info_u2365795232.json` | 用户信息变种 |
| `profile_detail.json` | 用户详情 |
| `profile_detail_v2.json` | 用户详情变种 |
| `comments.json` | 评论列表（20 条） |
| `feed_home.json` | 首页 Feed（25 条） |
| `feed_groups.json` | Feed 分组 |
| `search_users_p2.json` | 搜索用户（第 2 页） |
| `search_users_p3.json` | 搜索用户（第 3 页） |
| `hot_trends.json` | 热搜榜单（52 条） |

完整索引见 `tests/fixtures/raw/INDEX.md`。

### 如何获取更多真实数据

```bash
# 前置条件：.env 中包含有效 WEIBO_COOKIE
source .env

# 1. 获取用户信息
curl -s -H "Cookie: $WEIBO_COOKIE" \
  -H "X-XSRF-TOKEN: <从 Cookie 中提取>" \
  -H "User-Agent: Mozilla/5.0 ..." \
  -H "Referer: https://weibo.com/" \
  "https://weibo.com/ajax/profile/info?uid=<用户UID>"

# 2. 获取用户详情
curl -s -H "Cookie: $WEIBO_COOKIE" \
  -H "X-XSRF-TOKEN: <token>" \
  -H "Referer: https://weibo.com/u/<uid>" \
  "https://weibo.com/ajax/profile/detail?uid=<uid>"

# 3. 获取用户微博列表
curl -s -H "Cookie: $WEIBO_COOKIE" \
  -H "X-XSRF-TOKEN: <token>" \
  -H "Referer: https://weibo.com/u/<uid>" \
  "https://weibo.com/ajax/statuses/mymblog?uid=<uid>&page=1&count=10"

# 4. 获取单条微博详情
curl -s -H "Cookie: $WEIBO_COOKIE" \
  -H "X-XSRF-TOKEN: <token>" \
  -H "Referer: https://weibo.com/detail/<mblogid>" \
  "https://weibo.com/ajax/statuses/show?id=<mblogid>&isGetLongText=true"

# 5. 从用户时间线中提取所有 mblogid（Python）
# import json
# with open('mymblog.json') as f:
#     data = json.load(f)
# for p in data['data']['list']:
#     print(p['mblogid'], p.get('pic_num', 0), p.get('text_raw', '')[:60])
```

### 微博变种覆盖策略

在获取新的 fixture 时，应优先覆盖以下变种：

- **纯文本**：无 `pic_ids`、无 `retweeted_status`
- **图文**：`pic_num > 0`，验证 `pic_infos` + `pic_focus_point`
- **转发**：有 `retweeted_status`，验证递归构造
- **含链接卡片**：有 `page_info`，验证卡片解析
- **含话题**：有 `topic_struct`
- **含位置**：有 `geo`，验证坐标解析
- **长微博**：`isLongText === true`
- **含视频**：有 `mix_media_info`，验证视频媒体提取
- **广告**：`isAd === true`，验证过滤逻辑
- **付费可见**：`is_paid === true`
