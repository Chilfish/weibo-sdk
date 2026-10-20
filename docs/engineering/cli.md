# Weibo CLI（`weibo-cli`）

基于 [citty](https://github.com/unjs/citty) 构建的命令行工具，类型安全、零依赖。

## 安装

```bash
# 作为依赖安装后使用
npx weibo-cli --help
# 或全局安装
npm i -g @chilfish/weibo-sdk && weibo-cli --help

# 本仓库开发
pnpm build        # 构建 dist/
node dist/cli.mjs --help
# 或开发模式直接运行
npx tsx src/cli.ts --help
```

## 配置 Cookie

**只从 `.env` 文件读取**（默认 `<pwd>/.env`，可用 `--env-file <path>` 指定）：

```bash
# .env（项目根目录）

# 1. Cookie header 串
WEIBO_COOKIE="SUB=xxx; XSRF-TOKEN=xxx; ..."

# 2. Netscape Cookie 文件（浏览器扩展 / curl cookies.txt 导出）
# WEIBO_COOKIE="C:/Users/me/cookies.txt"

# 3. 内容为 header 串的文本文件（可带 Cookie: 前缀、可多行）
# WEIBO_COOKIE="./cookies.header.txt"
```

相对路径按当前工作目录（pwd）解析。Netscape 格式按 7 列 TSV 解析（支持 `#HttpOnly_` 前缀与 `#` 注释），只保留 `weibo.com` / `weibo.cn` / `sina.com.cn` 域名的 Cookie，过期条目会被跳过；同名 Cookie 以文件中靠后的为准。文件路径不存在、读取失败或没有可用 Cookie 时，CLI 打印 `CONFIG_INVALID` 错误并以 1 退出。

刻意**不读取 `WEIBO_COOKIE` 环境变量**：本机残留的旧值会静默遮蔽 `.env` 中的新 Cookie（`process.loadEnvFile()` 不覆盖已存在的环境变量）。每个子命令都支持 `--cookie`/`-c` 显式覆盖（优先于 `.env`），取值规则与 `.env` 相同。

所有命令默认输出 **JSON 格式**（`JSON.stringify(data, null, 2)`），可用于管道处理：

```bash
weibo-cli user info 1111681197 | jq '.name, .stats'
weibo-cli tweet detail QqsYymYOS | jq '.media[0]'
weibo-cli search users 新闻 | jq '.data.cards[0].card_group[:3]'
```

## 命令参考

### 用户操作（`user`）

```bash
# 获取用户信息（info + details 归一化为 User 模型）
weibo-cli user info <uid>

# 获取用户微博时间线（归一化为 TweetPageResult）
weibo-cli user timeline <uid> [--page/-p <n>] [--count <n>]
```

### 微博操作（`tweet`）

```bash
# 获取微博详情（归一化为 Tweet 模型）
weibo-cli tweet detail <mblogId>

# 补拉原始响应 + 归一化模型（下游自行保存 raw；--longtext 额外补拉全文）
weibo-cli tweet enrich <mblogId> [--longtext] [--no-longtext]

# 获取微博评论
weibo-cli tweet comments <mblogId> [--count <n>] [--flow 0|1]

# 获取首页 Feed（关注时间线，归一化为 TweetPageResult）
weibo-cli tweet home [--since_id/-s <cursor>] [--count <n>]

# 获取长微博全文
weibo-cli tweet longtext <mblogId>

# 获取微博转发列表（分页用 --page；实测 next_cursor 参数无效）
weibo-cli tweet reposts <mblogId> [--page <n>]

# 按日期范围搜索用户微博
weibo-cli tweet search-profile <uid> [--page <n>] [--starttime <unix秒|YYYY-MM-DD>] [--endtime <unix秒|YYYY-MM-DD>] \
  [--hasori 0|1] [--hasret 0|1] [--hastext 0|1] [--haspic 0|1] [--hasvideo 0|1] [--hasmusic 0|1]
```

`--starttime` / `--endtime` 既可以是 unix 秒，也可以是 `YYYY-MM-DD` / `YYYYMMDD`：前者原样透传，后者在请求前换算（start 取当天 00:00:00、end 取当天 23:59:59，运行环境本地时区）。非法日期以非零退出码报错，不会静默返回未过滤结果。

### 关注/粉丝（`follow`）

```bash
# 获取指定用户关注列表（cursor 分页）
weibo-cli follow list <uid> [--page <n>]

# 获取指定用户粉丝列表（relate=fans）
weibo-cli follow fans <uid> [--page <n>]

# 获取自己关注列表
weibo-cli follow my [--page <n>]
```

### 收藏夹（`favorite`）

```bash
# 获取指定用户收藏夹（按页遍历；--page 从 1 开始，0/非法值按第一页处理）
weibo-cli favorite list <uid> [--page <n>]

# 流式遍历收藏夹（自动翻页 + 去重 + 客户端标签过滤）
# NDJSON：progress / item / done 事件
weibo-cli favorite stream <uid> [--page <n>] [--tag <标签 id 或名称>] [--max-pages <n>]

# 获取收藏夹标签
weibo-cli favorite tags
```

### 搜索（`search`）

```bash
# 搜索用户
weibo-cli search users <query> [--page <n>]

# 搜索微博
weibo-cli search tweets <query> [--page <n>]
```

### 其他

```bash
# 热搜榜单（--type 可选：hot/topic/entertainment，默认 hot）
weibo-cli trends [--type hot|topic|entertainment]

# 验证 Cookie 有效性（myDetails → 从 verified_url 提取 UID → getById）
weibo-cli whoami

# 镜像单个账号（timeline + 日期切片 + reposts + favorites，可断点续传）
# 输出 NDJSON 进度事件；checkpoint 落盘 .weibo-sdk-archive-<uid>.json，中断后重跑即续传
weibo-cli archive <uid> [--no-reposts] [--no-favorites] [--no-date-slices] \
  [--source mymblog|search] [--since <unix-seconds>] [--comments] [--comment-pages <n>] \
  [--max-retries <n>] [--repost-policy abort|skip|retry] [--comments-policy abort|skip|retry] \
  [--checkpoint <file>] [--max-pages <n>]
```

> `archive` 默认先翻 `mymblog`；翻到底后若 `total` 表明仍有剩余（或 total 不可用），
> 自动从最旧一条继续用 `searchProfile` 做日期切片。`--source search` 可跳过 mymblog
> 直接切片；`--no-date-slices` 关闭回填；`--since` 设置切片下界（unix 秒）。
>
> `--comments` 会把评论挂到 `tweet.comments`（favorite 项不拉取）；`--comment-pages` 限制每条微博评论页数。
> 转发/评论单页失败默认 `skip` 并继续；`--max-retries` 仅对 `retryable` 错误生效。
> 进度以 NDJSON `{ event: 'progress', phase, source, processed, total, remaining, page }` 输出，
> `item` / `done` 事件也携带 `count/total/remaining`。

> raw 落盘不在 CLI 默认输出中：SDK 使用方通过 `config.hooks.onRaw` / `streamArchive({ onRaw })` 接收原始项自行保存（P1-9，见 [contract-itweet-v1.md §4.1](../engineering/contract-itweet-v1.md)）。

## 输出形态速查

| 子命令 | 底层 Service 方法 | 输出 |
|---|---|---|
| `user info` | `users.getById()` | `User` 领域模型 |
| `user timeline` | `tweets.listByUserId()` | `TweetPageResult`（`page`/`hasMore`/`tweets[]`） |
| `tweet detail` | `tweets.getByMblogId()` | `Tweet` 领域模型 |
| `tweet enrich` | `tweets.enrich()` | `{ tweet, raw, longText? }`（raw 为 `statuses/show` 原始响应） |
| `tweet comments` | `tweets.comments()` | raw `BuildCommentsResponse` |
| `tweet home` | `tweets.listFriendTimeline()` | `TweetPageResult` |
| `tweet longtext` | `tweets.longText()` | raw `LongtextResponse` |
| `tweet reposts` | `tweets.getReposts()` | raw `RepostTimelineResponse` |
| `tweet search-profile` | `tweets.searchByDate()` | raw `SearchProfileResponse`（`starttime`/`endtime` 接受 unix 秒或 `YYYY-MM-DD` / `YYYYMMDD`，字符串在请求前换算为秒） |
| `follow list` | `followings.getFollowings()` | raw `FriendshipsResponse` |
| `follow fans` | `followings.getFans()` | raw `FriendshipsResponse` |
| `follow my` | `followings.getMyFollowings()` | raw `FollowContentResponse` |
| `favorite list` | `favorites.getFavorites()` | raw `FavoritesResponse` |
| `favorite stream` | `favorites.streamFavorites()` | NDJSON `{ event: 'progress', ... }` / `{ event: 'item', count, tweet }` / `{ event: 'done', uid, count }` |
| `favorite tags` | `favorites.getTags()` | raw `FavoritesTagsResponse` |
| `search users` | `search.searchUsers()` | raw `SearchUsersResponse` |
| `search tweets` | `search.searchTweets()` | raw `SearchTweetsResponse` |
| `trends` | `trends.hotBand(type?)` | raw `BandUnifiedResponse` |
| `whoami` | `users.myDetails()` + `users.getById()` | `User` 领域模型 |
| `archive` | `archive.streamArchive()` | NDJSON 进度事件 `{ event, schemaVersion, source, mblogId, tweetId, count, total, remaining, checkpoint }`；另有 `progress` / `item-error` 事件（数据本体走 SDK 流；`schemaVersion` 为 ITweet 存档契约版本；`checkpoint` 可能含 `sliceEnd/slicePage/sliceWindow` 日期切片游标） |

## 架构

```
src/cli.ts              # 主入口，runMain()；顶层 trends / whoami / archive；子命令注册
src/cli/
  shared.ts             # getCookie / getEnvFilePath / createSDK / cookieArg（--cookie / --env-file）
  commands/
    user.ts             # user info / user timeline
    tweet.ts            # tweet detail / comments / home / longtext / reposts / search-profile
    follow.ts           # follow list / follow fans / follow my
    favorite.ts         # favorite list / favorite stream / favorite tags
    search.ts           # search users / search tweets
src/utils/cookieInput.ts # Cookie header 串 / Netscape / header 文件的统一解析
```

基于 citty 的 `defineCommand` + `runMain` 模式：

- 每个子命令独立定义，支持嵌套（`user`/`tweet`/`follow`/`favorite`/`search` 为分组，`trends`/`whoami`/`archive` 为顶层命令）
- 自动生成 `--help` 文档
- 零运行时依赖
- 错误输出到 stderr 并以非零退出码退出（如 `whoami` 在 Cookie 缺失/无效时 `process.exit(1)`）
