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
| `unit/models/Tweet.show.test.ts` | `Tweet` 构造器（statuses/show 来源） | 从真实 fixture `tests/fixtures/raw/show.json` 读取数据，验证长微博、地理位置、媒体信息归一化正确性 |

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
| `e2e/user.e2e.test.ts` | 真实网络下 UserService 端到端 | `WEIBO_E2E=1` + 有效 `WEIBO_COOKIE` |
| `e2e/tweet.e2e.test.ts` | 真实网络下 TweetService 端到端 | `WEIBO_E2E=1` + 有效 `WEIBO_COOKIE` |

---

## 测试数据来源

所有 component/unit 测试均使用 **mock HTTP**（`tests/testkit/fakeAxios.ts`），不依赖真实网络。

E2E 测试从 `.env` 中读取 `WEIBO_COOKIE` 并使用真实 API。

### 真实 API 响应 Fixtures

路径：`tests/fixtures/raw/`

| 文件 | 来源 | 用途 |
|---|---|---|
| `show.json` | 人工录制（Chilfish_ 用户的长微博） | `Tweet.show.test.ts` 中的归一化验证 |
| `profile_info_1740358225.json` | `curl https://weibo.com/ajax/profile/info?uid=1740358225` | 当前 Zod schema 准确性校验 |
| `profile_detail_1740358225.json` | `curl https://weibo.com/ajax/profile/detail?uid=1740358225` | 同上 |
| `mymblog_1740358225.json` | `curl https://weibo.com/ajax/statuses/mymblog?uid=1740358225&page=1&count=10` | 9 条微博（含转发、图文、链接卡片等变种） |
| `status_show_OgHLUyXYP.json` | `curl https://weibo.com/ajax/statuses/show?id=OgHLUyXYP` | 9 图微博详情 |
| `status_show_P6yhlzD3j.json` | `curl https://weibo.com/ajax/statuses/show?id=P6yhlzD3j` | 转发微博详情 |
| `status_show_PCN4v8k6W.json` | `curl https://weibo.com/ajax/statuses/show?id=PCN4v8k6W` | 纯文本微博详情 |

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
