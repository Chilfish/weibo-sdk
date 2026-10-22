# Weibo CLI（`weibo-cli`）

`weibo-cli` 是 SDK 附带的命令行工具，基于 [citty](https://github.com/unjs/citty) 构建。它和 SDK 使用同一套服务与参数校验：查询命令默认输出 JSON，流式命令输出 NDJSON，方便直接交给脚本、`jq` 或 Agent 处理；需要给人或 Agent 直接阅读时，可用 `--format markdown` 换成可读卡片。

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

CLI 默认从 `.env` 文件读取 Cookie，不读取 shell 环境变量。默认读取当前目录的 `.env`，可以用 `--env-file <path>` 指定其他文件：

```bash
# .env（项目根目录）

# 1. Cookie header 串
WEIBO_COOKIE="SUB=xxx; XSRF-TOKEN=xxx; ..."

# 2. Netscape Cookie 文件（浏览器扩展 / curl cookies.txt 导出）
# WEIBO_COOKIE="C:/Users/me/cookies.txt"

# 3. 内容为 header 串的文本文件（可带 Cookie: 前缀、可多行）
# WEIBO_COOKIE="./cookies.header.txt"
```

相对路径按当前工作目录解析。Netscape 格式按 7 列 TSV 解析，支持 `#HttpOnly_` 前缀和 `#` 注释；只保留 `weibo.com`、`weibo.cn`、`sina.com.cn` 域名的 Cookie，过期条目会被跳过，同名 Cookie 以文件中靠后的为准。路径不存在、读取失败或文件里没有可用 Cookie 时，CLI 会输出 `CONFIG_INVALID` 错误并以非零状态退出。完全没有 Cookie（`.env` 里没有 `WEIBO_COOKIE`、也没传 `--cookie`）不算错误，会走访客身份。

之所以不读取 `WEIBO_COOKIE` 环境变量，是因为本机残留的旧值会静默遮蔽 `.env` 中的新 Cookie。每个子命令都支持 `--cookie` / `-c` 临时覆盖，优先级高于 `.env`，取值规则与 `.env` 相同。

普通命令输出格式化后的 JSON，可以接管道处理：

```bash
weibo-cli user info 1111681197 | jq '.name, .stats'
weibo-cli tweet detail QqsYymYOS | jq '.media[0]'
weibo-cli search users 新闻 | jq '.data.cards[0].card_group[:3]'
```

## 访客模式（`--guest`）

没有 Cookie 也能读公开数据。每个命令都支持 `--guest`，它和 `--cookie` / `--env-file` 属于同一组共享参数：

```bash
weibo-cli whoami --guest
weibo-cli tweet detail QqsYymYOS --guest
weibo-cli tweet comments QqsYymYOS --guest
weibo-cli trends --guest
weibo-cli user timeline 1111681197 --guest
```

- `--guest` 完全不读 `.env`，也不看 `--cookie`（访客身份会忽略 Cookie）。
- 不传 `--guest` 又没有可用 Cookie 时，同样会走访客身份，这是默认的 `auth: 'auto'` 行为。区别在于：Cookie 是「路径不存在 / 解析失败」这类非法输入时仍然报 `CONFIG_INVALID`，不会静默降级。
- `whoami --guest` 不请求登录态，只输出访客 token 的元信息，并以状态码 0 退出：

  ```json
  {
    "auth": "guest",
    "login": false,
    "tokenIssuedAt": 1760937600000,
    "token": { "issuedAt": 1760937600000, "scope": "all", "source": "mobile" }
  }
  ```

  `source` 为 `mobile` / `desktop` / `preset`，`scope` 为 `all`（m 站与主站通用）或 `pc`。token 明文不会出现在任何输出里。

访客能读的范围：

| 能力 | 访客可用性 |
|---|---|
| `user info`、`tweet detail` / `enrich` / `longtext`、`media download` | 可用 |
| `tweet comments` / `comments-stream` | 可用，可翻页 |
| `tweet reposts` / `reposts-stream`、`tweet likers` / `likers-stream` | 可用 |
| `media images` / `videos` / `albums` / `album` | 可用 |
| `topic`、`trends`、`user groups` | 可用 |
| `user timeline`、`like list`、`follow list` / `follow fans` | **只有第一页**：时间线 / 点赞输出带 `partial: true`，关注 / 粉丝用 `next_cursor: 0` 表示到底；`--page 2` 会报 `CONFIG_INVALID`；对应的 `-stream` 命令也只产出这一页 |
| `tweet home`、`tweet search-profile`、`user mentions`、`user mblog-groups`、`follow my`、`favorite`、`comment`、`notification` | 不可用，报 `AUTH_SESSION_EXPIRED`，`context.requiredAuth = 'cookie'` |
| `archive` | 不可用，报 `CONFIG_INVALID`（匿名只有首屏数据，无法保证归档完整） |

`search users` / `search tweets` 与 Cookie 模式一样仍是 `unavailable`，访客不能搜索。

访客 token 由 `visitor.passport.weibo.cn` 发放，按进程缓存；被上游拒绝时 SDK 会自动刷新一次再重试。遇到 432 / 429 只会退避重试，不会刷新 token。

## 输出格式（`--format`）

查询命令默认输出 2 空格缩进的 JSON，保持脚本与 `jq` 兼容；需要直接阅读时加 `--format markdown`（`md` 同义）：

```bash
weibo-cli user info 1111681197 --format markdown
weibo-cli user info 1111681197 -f json          # 显式指定默认值
```

| 取值 | 输出 |
|---|---|
| `json`（默认） | `JSON.stringify(data, null, 2)` |
| `markdown` / `md` | 该命令的 Markdown 卡片（确定性投影，不含总结） |

- 未知取值报 `CONFIG_INVALID`（`context.field = 'format'`），不会静默回退到 JSON；格式在发请求前校验。
- 列表类 Markdown 只截取正文摘要（默认 200 字符），完整字段仍需 `--format json`；分页游标、总数、`partial` 采样会写在标题下。
- 标注「原始响应」的命令（如 `tweet enrich`）在 Markdown 视图里会显式说明 raw 只在 JSON 中输出。

已接入的查询命令：

| 分组 | 命令 |
|---|---|
| `user` | `info` / `timeline` / `mentions` / `groups` / `mblog-groups` |
| `tweet` | `detail` / `enrich` / `comments` / `replies` / `home` / `reposts` / `likers` / `longtext` / `search-profile` |
| `follow` | `list` / `fans` / `my` |
| `favorite` | `list` |
| `like` | `list` |
| `comment` | `mine` |
| `notification` | `comments` / `likes` |
| `media` | `albums` |
| `topic` | `cates` / `list` |
| 其他 | `trends` / `whoami`（含 `--guest`） |

未接入：`*-stream` / `archive` / `media download` 的 NDJSON 是逐行协议；`favorite tags` 的标签元素结构尚未抓包；`search users` / `search tweets` 上游不可用；`capabilities` / `schema diff` 是诊断输出。`tweet context` 保留自己的 `--format`（默认 `markdown`）。

渲染器与数据模型同层（`src/models/view/`），是纯函数：新增格式 = 一个渲染函数 + 在命令里注册。

## 命令参考

> 所有 `<mblogId>` / `<mid>` 参数都接受 mblogId、数字 mid 或微博状态 URL
> （`https://m.weibo.cn/status/<mid>`、`https://weibo.com/<uid>/<mblogid>`）。SDK 在请求前统一归一化；
> `tweet likers` 会自动用 `statuses/show` 解析数字 mid。

### 用户操作（`user`）

```bash
# 获取用户信息（info + details 归一化为 User 模型）
weibo-cli user info <uid> [--format json|markdown]
weibo-cli user info 1111681197 --format markdown   # 可读用户卡片

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

# Agent 视角的微博上下文：谁说的 / 时间 / 正文 / 媒体归属与下载 / 转发关系 / 评论抽样 / 未知项
# 默认输出 Markdown；--format json 输出结构化数据（weibo.tweet-context/v1）
weibo-cli tweet context <mblogId> [--format markdown|json] [--comments <n>] [--comment-flow hot|time] \
  [--no-author] [--no-longtext] [--no-quoted] [--no-chain] [--max-media <n>] [--max-chars <n>] \
  [--download-media <dir>] [--overwrite]
weibo-cli tweet context RnxWieuYE --download-media ./weibo-media   # 下载后可直接读取本地图片
weibo-cli tweet context RnANTz33M --comments 5 --format json       # 转发链 + 原微博 + 热评

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

#### `tweet context`：给 Agent 理解用的上下文

`tweet context` 不是另一种详情格式，而是把「理解一条微博」需要的事实显式分开：

- `post.text` 只包含**当前作者本人**的发言。转发微博不会把 `//@` 链拍平塞进正文。
- `mentions` 只保留当前作者正文里的 @，转发链上的作者不算提及。
- `quoted` 是转发的原微博；原微博的媒体在 `quoted.media[]`，`owner.relation = 'quoted'`。
- `media[]` 按原顺序给出 `index`、类型、尺寸、`aspectRatio`、临时 URL、归属和确定性提示；`--download-media <dir>` 会回填 `download.path`，Agent 可以直接读取本地文件。
- `unknowns` / `hints` 明确写出「图片未描述」「视频未转写」「正文可能截断」「评论是抽样」等，不用假默认值。
- 默认不调用任何 LLM；OCR / 视觉描述 / 视频转写由调用方回填。

请求预算（默认）：1 次 `statuses/show`；`--no-author` 可省 1 次 `profile/info`；长文 +1 次；`--comments n` 至少 +1 页；`--download-media` 会为每个媒体所属微博额外请求一次以刷新临时 URL。`--max-chars` 默认 4000，`0` 表示不限；`--max-media` 超出部分会写入 `unknowns`。

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
# 访客身份：不校验登录态，只输出 token 元信息（source / scope / issuedAt）
weibo-cli whoami --guest

# 镜像单个账号（timeline + 日期切片 + reposts + favorites + 媒体，可断点续传 / 增量 / 批量）
# 输出 NDJSON 进度事件；checkpoint 落盘 .weibo-sdk-archive-<uid>.json，中断后重跑即续传
weibo-cli archive <uid> [--no-reposts] [--no-favorites] [--likes] [--comment-history] \
  [--images] [--videos] [--original-only] [--no-date-slices] \
  [--source mymblog|search] [--since <unix-seconds>] [--comments] [--comment-pages <n>] \
  [--concurrency <n>] [--max-retries <n>] [--repost-policy abort|skip|retry] [--comments-policy abort|skip|retry] \
  [--checkpoint <file>] [--max-pages <n>]

# 增量同步（状态文件记录每个 uid 的 lastMblogId / lastCreatedAt）
weibo-cli archive <uid> --state .weibo-archive-state.json [--incremental-since <date|unix>] [--stop-at <mblogId>] [--skip-pinned]

# 批量归档（每行一个 uid，# 开头为注释；单用户失败默认跳过）
# 批量默认不含收藏（收藏是账号级数据）；归档他人时 --favorites / --comment-history 会报 CONFIG_INVALID
weibo-cli archive --uid-file uids.txt [--state .weibo-archive-state.json]

# 范围归档：指定时间段 + 单条深度补全，输出单个 JSON，可断点续跑
weibo-cli archive user <uid> --since 2025-01-01 --until 2025-12-31 -o ./weibo-archive.json
weibo-cli archive user <uid> --no-comments --reposts --concurrency 6 --slice-days 30

# 能力清单（离线；可按服务 / 状态过滤）
weibo-cli capabilities [--service <name>] [--status stable|degraded|unavailable|planned]
weibo-cli capabilities --status stable | jq '.[] | {id, auth, guestPagination}'

# 对比两份 schemaDigest / 结构快照
weibo-cli schema diff before.json after.json
```

> `archive` 默认先翻 `mymblog`；翻到底后若 `total` 表明仍有剩余（或 total 不可用），
> 自动从最旧一条继续用 `searchProfile` 做日期切片。`--source search` 可跳过 mymblog
> 直接切片；`--no-date-slices` 关闭回填；`--since` 设置切片下界（unix 秒）。
>
> `--comments` 会把评论挂到 `tweet.comments`（favorite 项不拉取）；`--comment-pages` 限制每条微博评论页数。
> `--concurrency` 只并发同一页内条目之间互不依赖的子请求（评论链 / 转发首页），
> 分页与产出顺序仍严格串行；默认 3，`1` 为完全串行，上限 8。实际并发仍受令牌桶与 432 暂停约束。
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
>
> `capabilities` 的每条记录都带 `auth`（`cookie` / `guest` / `none`）、`guestPagination`（`none` / `first_page` / `full`）
> 和 `guestNote`，可以直接判断某个能力在访客身份下能不能用、能不能翻页。
> `archive` 不支持访客身份：`--guest`（或不带 Cookie）会在产出任何 item 之前报 `CONFIG_INVALID`。
> 访客只有首屏数据，归档无法保证完整；需要归档请提供 Cookie。
>
> `archive user` 是范围归档 + 深度补全：固定切片枚举，逐条重新拉取 `statuses/show`（含长文）、
> 一级评论、楼中楼和可选转发，最后合并成单个 `ArchiveFile`。进度写在 `<out>.slices/`，
> 重跑同一命令会按切片续跑；`--fresh` 丢弃进度，`--force` 覆盖输出 / raw 文件。
> stdout 只有一行 `{ event: 'done', ... }` 摘要，进度 / issue / raw 诊断走 stderr 的 NDJSON。
> 完整结束时退出码 0；枚举中止、存在未补全项或 raw 写入失败时退出码 1。
> 详细参数、SDK 接口与 store 端口见 [user-archive.md](./user-archive.md)。

CLI 默认不输出原始响应。需要 raw 时，在 SDK 中使用 `config.hooks.onRaw` 或 `streamArchive({ onRaw })` 接收并自行保存，具体规则见 [contract-itweet-v2.md §6](../engineering/contract-itweet-v2.md)。

## 终端呈现（`archive user`）

`archive user` 的进度与诊断默认按终端能力自动切换，数据契约不受影响：

| 场景 | 默认呈现 |
|---|---|
| stderr 是 TTY，且不在 CI / `TERM=dumb` | 原地刷新的单行状态 + 追加的切片 / issue 行 |
| 管道、重定向、CI、`TERM=dumb` | NDJSON（与旧行为一致） |
| `--log-format pretty` | 强制人类可读；非 TTY 时退化为普通行，不做光标控制 |
| `--log-format ndjson` | 强制机器可读 |
| `--log-format silent` / `--quiet` | 不输出诊断 |
| `--no-progress` | `pretty` 下关闭动态状态行，只输出切片完成 / issue / 汇总 |

TTY 下的样子：

```text
weibo-cli archive user 1111681197
  out      ./weibo-archive.json
  range    2025-01-01 → 2025-12-31
  ✓ s000-1770000000-1772591999 done
  ✓ s001-1772592000-1775183999 done
  s002  enumerate/search  ██████░░░░ 42/70  tweets 142  comments 320  replies 87  page 3  errors 2
  12:04:33  ✖ comments RATE_LIMITED 退避后继续
```

状态行只有一行，用 `\r` + 清行原地刷新；切片完成、issue、raw 等日志追加在状态行上方，保留 scrollback。

规则：

- **stdout 只放结果**。`archive user` 的 stdout 仍是一行 `{ event: 'done', ... }`，管道消费不受影响。
- **stderr 放诊断**。进度、切片完成、issue、raw 写入状态都在 stderr；TTY 下是状态行，非 TTY 下是 NDJSON。
- **不做全屏 TUI**。不切 alternate screen，不接管滚动；状态行是可清除的临时行，日志仍然 append-only。
- **自动降级优先**。`NO_COLOR` / `FORCE_COLOR` 只控制颜色；`CI` / `TERM=dumb` / 非 TTY 关闭动态刷新。`--log-format` 显式指定时优先。
- **零依赖**。用 ANSI + `\r` / 清行实现，不引入 `ink` / `blessed` / `listr2`。

当前只在 `archive user` 试点；`archive`、`media download`、`*-stream` 等命令保持原有输出，后续按同一 reporter 推广。

## 输出形态速查

下表是默认 JSON 形态；上方「输出格式」章节列出的查询命令都可以再加 `--format markdown`。

| 子命令 | 底层 Service 方法 | 输出 |
|---|---|---|
| `user info` | `users.getById()` | `User` 领域模型；`--format markdown` 输出可读用户卡片 |
| `user timeline` | `tweets.listByUserId()` | `TweetPageResult`（`page`/`hasMore`/`tweets[]`）；guest 模式为 m 站第一页（`partial: true`、`hasMore: false`、无 `page`） |
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
| `whoami` | `getSession()` + `users.getById()` | `User` 领域模型；`--guest` 时输出 `{ auth: 'guest', login: false, tokenIssuedAt, token: { issuedAt, scope, source } }` |
| `archive` | `archive.streamArchive()` | NDJSON 进度事件 `{ event, schemaVersion, source, mblogId, tweetId, count, total, remaining, checkpoint }`；另有 `progress` / `item-error` 事件（数据本体走 SDK 流；`schemaVersion` 是 ITweet 存档格式版本；`checkpoint` 可能包含 `sliceEnd`、`slicePage`、`sliceWindow` 等日期切片游标） |
| `archive user` | `userArchive.run()` | 写入 `--out` 指定的 `ArchiveFile`；stdout 一行 `{ event: 'done', out, tweets, comments, replies, errors, complete }`，stderr 为进度 / issue NDJSON |

## 架构

```
src/cli.ts              # 主入口，runMain()；顶层 trends / whoami / archive；子命令注册
src/cli/
  shared.ts             # getCookie / getEnvFilePath / createSDK / cookieArg（--cookie / --env-file / --guest）
  commands/
    archiveUser.ts      # archive user：参数映射、输出文件、退出码
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
- 错误输出到 stderr 并以非零退出码退出（如 `whoami` 在 Cookie 无效或访客 token 发放失败时 `process.exit(1)`；没有 Cookie 时默认走访客身份，正常退出）
