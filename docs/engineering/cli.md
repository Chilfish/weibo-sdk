# Weibo CLI（`weibo-cli`）

`weibo-cli` 是 SDK 附带的命令行工具，基于 [citty](https://github.com/unjs/citty) 构建。它和 SDK 使用同一套服务与参数校验：查询命令输出 JSON，流式命令输出 NDJSON，方便直接交给脚本、`jq` 或 Agent 处理。

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

CLI 只从 `.env` 文件读取 Cookie，不读取 shell 环境变量。默认读取当前目录的 `.env`，可以用 `--env-file <path>` 指定其他文件：

```bash
# .env（项目根目录）

# 1. Cookie header 串
WEIBO_COOKIE="SUB=xxx; XSRF-TOKEN=xxx; ..."

# 2. Netscape Cookie 文件（浏览器扩展 / curl cookies.txt 导出）
# WEIBO_COOKIE="C:/Users/me/cookies.txt"

# 3. 内容为 header 串的文本文件（可带 Cookie: 前缀、可多行）
# WEIBO_COOKIE="./cookies.header.txt"
```

相对路径按当前工作目录解析。Netscape 格式按 7 列 TSV 解析，支持 `#HttpOnly_` 前缀和 `#` 注释；只保留 `weibo.com`、`weibo.cn`、`sina.com.cn` 域名的 Cookie，过期条目会被跳过，同名 Cookie 以文件中靠后的为准。路径不存在、读取失败或没有可用 Cookie 时，CLI 会输出 `CONFIG_INVALID` 错误并以非零状态退出。

之所以不读取 `WEIBO_COOKIE` 环境变量，是因为本机残留的旧值会静默遮蔽 `.env` 中的新 Cookie。每个子命令都支持 `--cookie` / `-c` 临时覆盖，优先级高于 `.env`，取值规则与 `.env` 相同。

普通命令输出格式化后的 JSON，可以接管道处理：

```bash
weibo-cli user info 1111681197 | jq '.name, .stats'
weibo-cli tweet detail QqsYymYOS | jq '.media[0]'
weibo-cli search users 新闻 | jq '.data.cards[0].card_group[:3]'
```

## 命令参考

> 所有 `<mblogId>` / `<mid>` 参数都接受 mblogId、数字 mid 或微博状态 URL
> （`https://m.weibo.cn/status/<mid>`、`https://weibo.com/<uid>/<mblogid>`）。SDK 在请求前统一归一化；
> `tweet likers` 会自动用 `statuses/show` 解析数字 mid。

### 用户操作（`user`）

```bash
# 获取用户信息（info + details 归一化为 User 模型）
weibo-cli user info <uid>

# 获取用户微博时间线（归一化为 TweetPageResult）
weibo-cli user timeline <uid> [--page/-p <n>] [--count <n>]

# 流式遍历用户时间线（NDJSON progress/item/done；时间倒序）
weibo-cli user timeline-stream <uid> [--page <n>] [--count <n>] [--max-pages <n>] [--max-items <n>] [--since <date>] [--until <date>]

# @我的微博（max_id 游标；--max-id 为上一页返回的 cursor）
weibo-cli user mentions [--max-id <cursor>] [--page <n>]
weibo-cli user mentions-stream [--max-id <cursor>] [--page <n>] [--max-pages <n>] [--max-items <n>] [--since <date>] [--until <date>]

# 关注分组 / 微博分组（无分页）
weibo-cli user groups
weibo-cli user mblog-groups
```

> `user mentions` 只读取当前登录用户的 @ 提及（身份由 Cookie 决定）；`mentions-stream` 输出 NDJSON `progress` / `item` / `done`。
> `user groups` 拍平 `/ajax/feed/allGroups` 的分类结构，`user mblog-groups` 读取 `/ajax/mblog/querygroup` 的 `join_groups`。

### 微博操作（`tweet`）

```bash
# 获取微博详情（归一化为 Tweet 模型）
weibo-cli tweet detail <mblogId>

# 补拉原始响应 + 归一化模型（raw 由调用方自行保存；--longtext 额外补拉全文）
weibo-cli tweet enrich <mblogId> [--longtext] [--no-longtext]

# 获取微博评论（首屏约 20 条；count 目前被微博忽略；flow=1 时 SDK 自动把 mblogId 解析为数字 mid）
# --max-id 为上一页响应顶层的 max_id（原始响应格式，含图片评论 url_struct 等字段）
weibo-cli tweet comments <mblogId> [--max-id <cursor>] [--count <n>] [--flow 0|1]

# 流式遍历评论（max_id 游标 + 自动去重；NDJSON progress/item/done）
# 结束条件：max_id=0 或空页；total_number 含楼中楼，不能当作剩余条数
weibo-cli tweet comments-stream <mblogId> [--max-id <cursor>] [--count <n>] [--flow 0|1] [--max-pages <n>] [--max-items <n>]

# 一级评论下的二级评论（is_reply=1 + fetch_level=1；请求 id=<rootCommentId>，不是 mblogId）
weibo-cli tweet replies <mblogId> <rootCommentId> [--max-id <cursor>] [--count <n>] [--flow 0|1]
weibo-cli tweet replies-stream <mblogId> <rootCommentId> [--max-id <cursor>] [--max-pages <n>] [--max-items <n>]

# 首页「最新微博」关注时间线（max_id 翻旧页；since_id 只做增量过滤）
weibo-cli tweet home [--max-id <id>] [--since-id <id>] [--list-id <id>] [--fid <id>] [--refresh <n>] [--count <n>]
weibo-cli tweet home-stream [--max-id <id>] [--since-id <id>] [--max-pages <n>] [--max-items <n>] [--since <date>] [--until <date>]

# 获取长微博全文
weibo-cli tweet longtext <mblogId>

# 获取微博转发列表（分页用 --page；next_cursor 参数目前无效）
weibo-cli tweet reposts <mblogId> [--page <n>]

# 流式遍历转发（page 游标 + 自动去重；NDJSON progress/item/done）
weibo-cli tweet reposts-stream <mblogId> [--page <n>] [--count <n>] [--max-pages <n>] [--max-items <n>] [--since <date>] [--until <date>]

# 按日期 / 关键词搜索用户微博（--q 为个人主页内关键词搜索）
weibo-cli tweet search-profile <uid> [--page <n>] [--q <keyword>] [--starttime <unix秒|YYYY-MM-DD>] [--endtime <unix秒|YYYY-MM-DD>] \
  [--hasori 0|1] [--hasret 0|1] [--hastext 0|1] [--haspic 0|1] [--hasvideo 0|1] [--hasmusic 0|1]

# 微博点赞者（按页；入参必须是数字 mid，不是字母 mblogid）
weibo-cli tweet likers <mid> [--page <n>]
weibo-cli tweet likers-stream <mid> [--page <n>] [--max-pages <n>] [--max-items <n>]
```

所有 `*-stream` 命令都支持 `--max-items <n>`，用于限制跨页去重后的产出条数；达到上限后不再请求下一页。时间倒序的流还支持 `--since <date>` / `--until <date>`，日期可以写 `YYYY-MM-DD`、`YYYYMMDD` 或 unix 秒：遇到更早的条目停止翻页，更晚的条目直接跳过。`--since-id` 是微博 id 或媒体游标，不是日期。起始页码和游标仍用 `--page` / `--max-id`，适合断点续传和增量拉取。

> `likers` 使用 `m.weibo.cn/api/attitudes/show`：网页端 `ajax/statuses/likeShow` 仍返回正确
> `total_number` 但 `data` 恒为空（隐私/风控门控）。越界页返回 `data: null`，按空页停止。

`--starttime` / `--endtime` 既可以是 unix 秒，也可以是 `YYYY-MM-DD` / `YYYYMMDD`：前者原样透传，后者在请求前换算（start 取当天 00:00:00、end 取当天 23:59:59，运行环境本地时区）。非法日期以非零退出码报错，不会静默返回未过滤结果。

### 关注/粉丝（`follow`）

```bash
# 获取指定用户关注列表（cursor 分页）
weibo-cli follow list <uid> [--page <n>]

# 获取指定用户粉丝列表（relate=fans）
weibo-cli follow fans <uid> [--page <n>]

# 获取自己关注列表
weibo-cli follow my [--page <n>]

# 流式遍历关注 / 粉丝 / 我的关注（page 游标 + 自动去重；NDJSON progress/item/done）
weibo-cli follow stream <uid> [--page <n>] [--max-pages <n>] [--max-items <n>]
weibo-cli follow fans-stream <uid> [--page <n>] [--max-pages <n>] [--max-items <n>]
weibo-cli follow my-stream [--page <n>] [--max-pages <n>] [--max-items <n>]
```

### 收藏夹（`favorite`）

```bash
# 获取指定用户收藏夹（按页遍历；--page 从 1 开始，0/非法值按第一页处理）
weibo-cli favorite list <uid> [--page <n>]

# 流式遍历收藏夹（自动翻页 + 去重 + 客户端标签过滤）
# NDJSON：progress / item / done 事件
weibo-cli favorite stream <uid> [--page <n>] [--tag <标签 id 或名称>] [--max-pages <n>] [--max-items <n>]

# 获取收藏夹标签
weibo-cli favorite tags
```

### 点赞（`like`）

```bash
# 获取我赞过的微博（按页遍历；--page 从 1 开始）
weibo-cli like list <uid> [--page <n>]

# 流式遍历我赞过的微博（自动翻页 + 跨页去重）
# NDJSON：progress / item / done 事件
weibo-cli like stream <uid> [--page <n>] [--max-pages <n>] [--max-items <n>]
```

### 历史评论（`comment`）

```bash
# 获取当前登录用户的历史评论（按页；--max-id 为上一页返回的 cursor）
weibo-cli comment mine [--max-id <cursor>] [--page <n>]

# 流式遍历历史评论（游标自动翻页 + 跨页去重）
# NDJSON：progress / item / done 事件
weibo-cli comment stream [--max-id <cursor>] [--page <n>] [--max-pages <n>] [--max-items <n>] [--since <date>] [--until <date>]
```

> `comment` 只读取**当前登录用户自己**发表过的评论（身份由 Cookie 决定，端点不接受 uid）；
> `myCmt` 的翻页参数是 `max_id=<上一页 next_cursor>`，`--page` 与其等价。

### 媒体集合（`media`）

```bash
# 流式遍历用户图片墙（pic / livephoto / gif；自动翻页 + 跨页去重）
# NDJSON：progress / item / done 事件
weibo-cli media images <uid> [--since-id <cursor>] [--max-pages <n>] [--max-items <n>]

# 流式遍历用户视频瀑布（从 page_info.media_info 提取视频）
# NDJSON：progress / item / done 事件
weibo-cli media videos <uid> [--cursor <cursor>] [--max-pages <n>] [--max-items <n>]

# 相册列表（getImageWall?has_album=true 的 album_list）
weibo-cli media albums <uid>

# 流式遍历相册照片（since_id 游标 + 跨页去重）
weibo-cli media album <containerId> [--since-id <cursor>] [--max-pages <n>] [--max-items <n>]
```

`images` 的游标是 `sinceid`：首屏不传或传 `0`，下一页传上一页的 `sinceId`。`videos` 的游标是 `cursor`：首屏传 `0`，下一页传上一页的 `cursor`；不要传 `-1`，微博会返回 400。

两者都输出 `IUserMediaAsset`：`id`、`type`、`url`、`coverUrl?`、`videoUrl?`、`duration?`、`createdAt?`、`sourceMblogId?`、`permanentPageUrl?`。

### 消息通知（`notification`）

```bash
# 评论通知（别人评论我 / 回复我；--max-id 为上一页返回的 cursor）
weibo-cli notification comments [--max-id <cursor>] [--page <n>]
weibo-cli notification comments-stream [--max-id <cursor>] [--page <n>] [--max-pages <n>] [--max-items <n>] [--since <date>] [--until <date>]

# 点赞通知（别人赞我）
weibo-cli notification likes [--max-id <cursor>] [--page <n>]
weibo-cli notification likes-stream [--max-id <cursor>] [--page <n>] [--max-pages <n>] [--max-items <n>] [--since <date>] [--until <date>]
```

> 两个消息端点都使用 `max_id=<上一页 data.next_cursor>` 翻页（`--page` 等价），`next_cursor === 0` 到底。
> 评论通知输出 `{ comment, tweet }`（评论本体 + 被评论微博）；点赞通知输出 `{ id, createdAt, attitude, source, user, tweet }`。
> 被点赞或被评论的微博已删除时，对应条目会被跳过，因为微博不再返回 `status`。

### 媒体下载（`media download`）

```bash
weibo-cli media download <mblogId> \
  [--out/-o <dir>] [--include pic,video,livephoto,gif,unknown] \
  [--concurrency <n>] [--retries <n>] [--timeout <ms>] [--idle-timeout <ms>] [--max-bytes <n>] \
  [--overwrite] [--fail-fast] [--dry-run] [--referer <url>] [--no-refresh]
```

- 输出扁平 `<out>/<mblogId>-<index>-<mediaId>.<ext>`；LivePhoto 动态帧加 `-motion`。
- `--out` 默认 `<pwd>/weibo-media`；`--include` 缺省全部类型。
- URL 过期（403/404/410）默认重新拉取微博换新 URL；`--no-refresh` 关闭。
- NDJSON：`progress` / `item` / `item-error`（stderr）/ `done`；任一失败退出码 1，Ctrl+C 退出码 130。
- 失败清单：`<out>/<mblogId>-media-errors.json`。

### 超话（`topic`）

```bash
# 超话分类
weibo-cli topic cates

# 超话列表（--sort-id 来自 cates；--keyword 搜索；--page 从 1 开始）
weibo-cli topic list [--sort-id <id>] [--keyword <kw>] [--page <n>]

# 流式遍历超话列表 / 搜索结果（page 游标 + 自动去重）
weibo-cli topic stream [--sort-id <id>] [--keyword <kw>] [--page <n>] [--max-pages <n>] [--max-items <n>]
```

> `stopic/list` 的 `count` 是**总页数**（30 条/页）；`sort_id=0` + `keyword` 为搜索。

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

# 验证 Cookie 有效性（getSession 复用自检 → uid → getById）
weibo-cli whoami

# 镜像单个账号（timeline + 日期切片 + reposts + favorites + 媒体，可断点续传 / 增量 / 批量）
# 输出 NDJSON 进度事件；checkpoint 落盘 .weibo-sdk-archive-<uid>.json，中断后重跑即续传
weibo-cli archive <uid> [--no-reposts] [--no-favorites] [--likes] [--comment-history] \
  [--images] [--videos] [--original-only] [--no-date-slices] \
  [--source mymblog|search] [--since <unix-seconds>] [--comments] [--comment-pages <n>] \
  [--max-retries <n>] [--repost-policy abort|skip|retry] [--comments-policy abort|skip|retry] \
  [--checkpoint <file>] [--max-pages <n>]

# 增量同步（状态文件记录每个 uid 的 lastMblogId / lastCreatedAt）
weibo-cli archive <uid> --state .weibo-archive-state.json [--incremental-since <date|unix>] [--stop-at <mblogId>] [--skip-pinned]

# 批量归档（每行一个 uid，# 开头为注释；单用户失败默认跳过）
# 批量默认不含收藏（收藏是账号级数据）；归档他人时 --favorites / --comment-history 会报 CONFIG_INVALID
weibo-cli archive --uid-file uids.txt [--state .weibo-archive-state.json]

# 能力清单（离线；可按服务 / 状态过滤）
weibo-cli capabilities [--service <name>] [--status stable|degraded|unavailable|planned]

# 对比两份 schemaDigest / 结构快照
weibo-cli schema diff before.json after.json
```

> `archive` 默认先翻 `mymblog`；翻到底后若 `total` 表明仍有剩余（或 total 不可用），
> 自动从最旧一条继续用 `searchProfile` 做日期切片。`--source search` 可跳过 mymblog
> 直接切片；`--no-date-slices` 关闭回填；`--since` 设置切片下界（unix 秒）。
>
> `--comments` 会把评论挂到 `tweet.comments`（favorite 项不拉取）；`--comment-pages` 限制每条微博评论页数。
> `--likes` / `--comment-history` 把「我赞过的微博」与「当前用户历史评论」接入归档：
> `source='like'`（微博本体为 `item.tweet`）与 `source='comment'`（评论在 `item.comment`，`item.tweet` 为被评论微博）。
> `--images` / `--videos` 把图片墙 / 视频瀑布接入归档：`source='image'`（资产在 `item.asset`，可能没有 `item.tweet`）与
> `source='video'`（同时有 `item.tweet` 与 `item.asset`）。
> `--favorites`（`all_fav`）与 `--comment-history`（`myCmt`）是**账号级**数据，只能读取登录账号自身；
> 目标 uid 与登录账号不一致时会报 `CONFIG_INVALID`。`--likes`（`likelist?uid=`）按目标 uid 读取。
> 阶段顺序为 timeline → likes → comments → favorites → images → videos。
> **续跑会重复**：checkpoint 记录最后一条已完整处理项，续跑可能重复边界 1 条（图片墙 / 视频瀑布会重放整页）。
> 消费 NDJSON 时请按 `mblogId`（媒体按 `asset.id`）幂等去重。
> `--original-only` 跳过转发微博并关闭内联转发；`incremental` 只作用于 timeline（点赞/收藏/媒体仍完整遍历）。
> 批量模式（`--uid-file`）为每个 uid 独立 checkpoint / state；单用户失败默认 `skip` 并继续。
> 转发/评论单页失败默认 `skip` 并继续；`--max-retries` 仅对 `retryable` 错误生效。
> 进度以 NDJSON `{ event: 'progress', phase, source, processed, total, remaining, page }` 输出，
> `item` / `done` 事件也携带 `count/total/remaining`。

CLI 默认不输出原始响应。需要 raw 时，在 SDK 中使用 `config.hooks.onRaw` 或 `streamArchive({ onRaw })` 接收并自行保存，具体规则见 [contract-itweet-v1.md §4.1](../engineering/contract-itweet-v1.md)。

## 输出形态速查

| 子命令 | 底层 Service 方法 | 输出 |
|---|---|---|
| `user info` | `users.getById()` | `User` 领域模型 |
| `user timeline` | `tweets.listByUserId()` | `TweetPageResult`（`page`/`hasMore`/`tweets[]`） |
| `user mentions` | `users.listMentions()` | `UserMentionsPageResult`（`cursor`/`hasMore`/`total?`/`tweets[]`） |
| `user mentions-stream` | `users.streamMentions()` | NDJSON `{ event: 'progress', ... }` / `{ event: 'item', count, tweet }` / `{ event: 'done', count }` |
| `user groups` | `users.groups()` | `UserGroup[]`（`id`/`title`/`category?`/`count?`/`type?`/`apiPath?`） |
| `user mblog-groups` | `users.mblogGroups()` | `MblogGroup[]`（`id`/`name`/`systemName?`/`pageObjectId?`） |
| `tweet detail` | `tweets.getByMblogId()` | `Tweet` 领域模型 |
| `tweet enrich` | `tweets.enrich()` | `{ tweet, raw, longText? }`（raw 为 `statuses/show` 原始响应） |
| `tweet comments` | `tweets.comments()` | raw `BuildCommentsResponse` |
| `tweet home` | `tweets.listFriendTimeline()` | `TweetPageResult`（`maxId` 翻旧页；`since_id` 仅增量） |
| `tweet home-stream` | `tweets.streamFriendTimeline()` | NDJSON `progress` / `item` / `done`（`max_id` 自动翻页 + 去重） |
| `tweet longtext` | `tweets.longText()` | raw `LongtextResponse` |
| `tweet reposts` | `tweets.getReposts()` | raw `RepostTimelineResponse` |
| `tweet search-profile` | `tweets.searchByDate()` | raw `SearchProfileResponse`（`starttime`/`endtime` 接受 unix 秒或 `YYYY-MM-DD` / `YYYYMMDD`，字符串在请求前换算为秒） |
| `tweet likers` | `tweets.likers()` | `TweetLikersPageResult`（`page`/`hasMore`/`total?`/`likers[]`） |
| `tweet likers-stream` | `tweets.streamLikers()` | NDJSON `{ event: 'progress', ... }` / `{ event: 'item', count, liker }` / `{ event: 'done', mblogId, count }` |
| `follow list` | `followings.getFollowings()` | raw `FriendshipsResponse` |
| `follow fans` | `followings.getFans()` | raw `FriendshipsResponse` |
| `follow my` | `followings.getMyFollowings()` | raw `FollowContentResponse` |
| `favorite list` | `favorites.getFavorites()` | raw `FavoritesResponse` |
| `favorite stream` | `favorites.streamFavorites()` | NDJSON `{ event: 'progress', ... }` / `{ event: 'item', count, tweet }` / `{ event: 'done', uid, count }` |
| `favorite tags` | `favorites.getTags()` | raw `FavoritesTagsResponse` |
| `media download` | `media.downloadByMblogId()` | NDJSON `progress` / `item` / `item-error` / `done` |
| `like list` | `likes.listByUserId()` | `LikePageResult`（`page`/`hasMore`/`tweets[]`） |
| `like stream` | `likes.streamByUserId()` | NDJSON `{ event: 'progress', ... }` / `{ event: 'item', count, tweet }` / `{ event: 'done', uid, count }` |
| `comment mine` | `commentHistory.listMine()` | `CommentHistoryPageResult`（`cursor`/`hasMore`/`total?`/`comments[]`） |
| `comment stream` | `commentHistory.streamMine()` | NDJSON `{ event: 'progress', ... }` / `{ event: 'item', count, comment }` / `{ event: 'done', count }` |
| `media images` | `media.streamImages()` | NDJSON `{ event: 'progress', ... }` / `{ event: 'item', count, asset }` / `{ event: 'done', uid, count }` |
| `media videos` | `media.streamVideos()` | 同上（`asset.type = 'video'`） |
| `notification comments` | `notifications.listComments()` | `CommentNotificationPageResult`（`cursor`/`hasMore`/`total?`/`items[]`） |
| `notification comments-stream` | `notifications.streamComments()` | NDJSON `{ event: 'progress', ... }` / `{ event: 'item', count, notification }` / `{ event: 'done', count }` |
| `notification likes` | `notifications.listLikes()` | `LikeNotificationPageResult`（`cursor`/`hasMore`/`total?`/`items[]`） |
| `notification likes-stream` | `notifications.streamLikes()` | 同上（`notification.user` 为点赞者） |
| `search users` | `search.searchUsers()` | raw `SearchUsersResponse` |
| `search tweets` | `search.searchTweets()` | raw `SearchTweetsResponse` |
| `trends` | `trends.hotBand(type?)` | raw `BandUnifiedResponse` |
| `whoami` | `getSession()` + `users.getById()` | `User` 领域模型 |
| `archive` | `archive.streamArchive()` | NDJSON 进度事件 `{ event, schemaVersion, source, mblogId, tweetId, count, total, remaining, checkpoint }`；另有 `progress` / `item-error` 事件（数据本体走 SDK 流；`schemaVersion` 是 ITweet 存档格式版本；`checkpoint` 可能包含 `sliceEnd`、`slicePage`、`sliceWindow` 等日期切片游标） |

## 架构

```
src/cli.ts              # 主入口，runMain()；顶层 trends / whoami / archive；子命令注册
src/cli/
  shared.ts             # getCookie / getEnvFilePath / createSDK / cookieArg（--cookie / --env-file）
  commands/
    user.ts             # user info / timeline / mentions / groups
    tweet.ts            # tweet detail / comments / home / likers / longtext / reposts / search-profile
    follow.ts           # follow list / follow fans / follow my
    favorite.ts         # favorite list / favorite stream / favorite tags
    like.ts             # like list / like stream
    comment.ts          # comment mine / comment stream
    media.ts            # media images / media videos
    notification.ts     # notification comments / comments-stream / likes / likes-stream
    search.ts           # search users / search tweets
src/utils/cookieInput.ts # Cookie header 串 / Netscape / header 文件的统一解析
```

基于 citty 的 `defineCommand` + `runMain` 模式：

- 每个子命令独立定义，支持嵌套（`user`/`tweet`/`follow`/`favorite`/`search` 为分组，`trends`/`whoami`/`archive` 为顶层命令）
- 自动生成 `--help` 文档
- 零运行时依赖
- 错误输出到 stderr 并以非零退出码退出（如 `whoami` 在 Cookie 缺失/无效时 `process.exit(1)`）
