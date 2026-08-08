# Weibo SDK CLI

基于 [citty](https://github.com/unjs/citty) 构建的命令行工具，类型安全、零依赖。

## 安装

```bash
pnpm build        # 构建 dist/
node dist/cli.mjs --help
# 或开发模式直接运行
npx tsx src/cli.ts --help
```

## 配置 Cookie

仅通过环境变量或 `.env` 文件（`src/cli.ts` 顶部自动 `process.loadEnvFile()`）：

```bash
# .env 文件（推荐）
WEIBO_COOKIE="SUB=xxx; XSRF-TOKEN=xxx; ..."

# 或直接导出
export WEIBO_COOKIE="SUB=xxx; XSRF-TOKEN=xxx; ..."
```

每个子命令都支持 `--cookie`/`-c` 可选覆盖（优先于环境变量）。

所有命令默认输出 **JSON 格式**（`JSON.stringify(data, null, 2)`），可用于管道处理：

```bash
weibo-sdk user info 1111681197 | jq '.name, .stats'
weibo-sdk tweet detail QqsYymYOS | jq '.media[0]'
weibo-sdk search users 新闻 | jq '.data.cards[0].card_group[:3]'
```

## 命令参考

### 用户操作（`user`）

```bash
# 获取用户信息（info + details 归一化为 User 模型）
weibo-sdk user info <uid>

# 获取用户微博时间线（归一化为 TweetPageResult）
weibo-sdk user timeline <uid> [--since_id/-s <n>] [--count <n>]
```

### 微博操作（`tweet`）

```bash
# 获取微博详情（归一化为 Tweet 模型）
weibo-sdk tweet detail <mblogId>

# 获取微博评论
weibo-sdk tweet comments <mblogId> [--count <n>] [--flow 0|1]

# 获取首页 Feed（关注时间线，归一化为 TweetPageResult）
weibo-sdk tweet home [--since_id/-s <n>] [--count <n>]

# 获取长微博全文
weibo-sdk tweet longtext <mblogId>

# 按日期范围搜索用户微博
weibo-sdk tweet search-profile <uid> [--page <n>] [--starttime <yyyyMMdd>] [--endtime <yyyyMMdd>] \
  [--hasori 0|1] [--hasret 0|1] [--hastext 0|1] [--haspic 0|1] [--hasvideo 0|1] [--hasmusic 0|1]
```

### 关注列表（`follow`）

```bash
# 获取指定用户关注列表（cursor 分页）
weibo-sdk follow list <uid> [--page <n>]

# 获取自己关注列表
weibo-sdk follow my [--page <n>]
```

### 收藏夹（`favorite`）

```bash
# 获取指定用户收藏夹（按页遍历）
weibo-sdk favorite list <uid> [--page <n>]
```

### 搜索（`search`）

```bash
# 搜索用户
weibo-sdk search users <query> [--page <n>]

# 搜索微博
weibo-sdk search tweets <query> [--page <n>]
```

### 其他

```bash
# 热搜榜单
weibo-sdk trends

# 验证 Cookie 有效性（myDetails → 从 verified_url 提取 UID → getById）
weibo-sdk whoami
```

## 输出形态速查

| 子命令 | 底层 Service 方法 | 输出 |
|---|---|---|
| `user info` | `users.getById()` | `User` 领域模型 |
| `user timeline` | `tweets.listByUserId()` | `TweetPageResult`（`sinceId`/`hasMore`/`tweets[]`） |
| `tweet detail` | `tweets.getByMblogId()` | `Tweet` 领域模型 |
| `tweet comments` | `tweets.comments()` | raw `BuildCommentsResponse` |
| `tweet home` | `tweets.listFriendTimeline()` | `TweetPageResult` |
| `tweet longtext` | `tweets.longText()` | raw `LongtextResponse` |
| `tweet search-profile` | `tweets.searchByDate()` | raw `SearchProfileResponse` |
| `follow list` | `followings.getFollowings()` | raw `FriendshipsResponse` |
| `follow my` | `followings.getMyFollowings()` | raw `FollowContentResponse` |
| `favorite list` | `favorites.getFavorites()` | raw `FavoritesResponse` |
| `search users` | `search.searchUsers()` | raw `SearchUsersResponse` |
| `search tweets` | `search.searchTweets()` | raw `SearchTweetsResponse` |
| `trends` | `trends.hotBand()` | raw `BandUnifiedResponse` |
| `whoami` | `users.myDetails()` + `users.getById()` | `User` 领域模型 |

> `trends` 命令未暴露 `hotBand(type)` 的 `type` 参数，始终使用默认 `'hot'`；需要 `topic`/`entertainment` 请走 SDK 调用。

## 架构

```
src/cli.ts              # 主入口，runMain()；顶层 trends / whoami；子命令注册
src/cli/
  shared.ts             # getCookie / createSDK / cookieArg（--cookie 共享参数）
  commands/
    user.ts             # user info / user timeline
    tweet.ts            # tweet detail / comments / home / longtext / search-profile
    follow.ts           # follow list / follow my
    favorite.ts         # favorite list
    search.ts           # search users / search tweets
```

基于 citty 的 `defineCommand` + `runMain` 模式：

- 每个子命令独立定义，支持嵌套（`user`/`tweet`/`follow`/`favorite`/`search` 为分组，`trends`/`whoami` 为顶层命令）
- 自动生成 `--help` 文档
- 零运行时依赖
- 错误输出到 stderr 并以非零退出码退出（如 `whoami` 在 Cookie 缺失/无效时 `process.exit(1)`）
