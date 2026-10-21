# weibo-cli 命令参考

所有命令都通过 `weibo`（或 `bash /skills/weibo-sdk/scripts/weibo.sh`）调用，用 bun 跑源码。
`weibo` 后面直接接下面表格里的命令，例如 `weibo tweet comments Rnzctqb28 --guest`。

## 通用约定

| 项 | 说明 |
|---|---|
| 通用 flag | `-c/--cookie <串或文件>`、`--env-file <path>`、`--guest`（三者互斥语义：`--guest` 忽略前两者） |
| 默认 Cookie | `<pwd>/.env` 的 `WEIBO_COOKIE`；不读 shell 环境变量 |
| `<ID>` 格式 | mblogId（`QqsYymYOS`）、数字 mid、或状态 URL；SDK 统一归一化，`tweet likers` 也会自动解析 |
| 普通命令输出 | 默认格式化 JSON 到 stdout；多数查询命令可用 `--format markdown`（`md` 同义）换成可读卡片 / 列表 |
| `-stream` 命令输出 | NDJSON，每行一个 `progress` / `item` / `done` 事件 |
| 错误输出 | 单行 JSON 到 stderr，字段 `code` / `level` / `retryable` / `message` / `endpoint` / `context` |
| 退出码 | 0 成功；非 0 表示失败（脚本层环境错误是 64 / 78） |
| 日期参数 | `--since` / `--until` / `--starttime` / `--endtime` 接受 `YYYY-MM-DD`、`YYYYMMDD` 或 unix 秒，含当天 |

## 命令树

| 命令 | 作用 | 访客可用性 | 游标 |
|---|---|---|---|
| `whoami` | 登录态 / 访客 token 元信息 | ✅ | – |
| `capabilities` | 列出能力、`auth`、分页、是否账号级 | ✅ | – |
| `user info <uid>` | 用户资料（info + details 归一化） | ✅ | – |
| `user timeline <uid>` / `timeline-stream` | 用户微博 | 首屏 | page |
| `user mentions` / `mentions-stream` | @我 | ❌ | max_id |
| `user groups` / `mblog-groups` | 关注分组 / 微博分组 | ✅ / ❌ | – |
| `tweet detail <id>` | 单条微博（归一化 `ITweet`） | ✅ | – |
| `tweet context <id>` | Agent 视角上下文（Markdown/JSON） | ✅ | – |
| `tweet enrich <id>` | 原始响应 + 模型，可补长文 | ✅ | – |
| `tweet longtext <id>` | 长微博全文 | ✅ | – |
| `tweet comments` / `comments-stream` | 评论（`--flow 0` 热度 / `1` 时间） | ✅ | max_id |
| `tweet replies` / `replies-stream` | 楼中楼 | ✅ | max_id |
| `tweet reposts` / `reposts-stream` | 转发列表 | ✅ | page |
| `tweet likers` / `likers-stream` | 点赞者 | ✅ | page |
| `tweet home` / `home-stream` | 首页关注时间线 | ❌ | max_id |
| `tweet search-profile <uid>` | 个人主页日期搜索 | ❌ | page |
| `follow list` / `fans` / `my` (+`-stream`) | 关注 / 粉丝 / 我的关注 | 首屏 | page |
| `favorite list` / `stream` / `tags` | 收藏夹（`--tag` 过滤） | ❌ | page |
| `like list` / `stream` | 我赞过的 | 首屏 | page |
| `comment mine` / `stream` | 当前账号历史评论 | ❌ | max_id |
| `media images <uid>` | 图片墙 | ✅ | since_id |
| `media videos <uid>` | 视频瀑布 | ✅ | cursor |
| `media albums <uid>` / `album <containerId>` | 相册 / 相册照片 | ✅ | – / since_id |
| `media download <id> -o <dir>` | 下载单条微博全部媒体 | ✅ | – |
| `topic cates` / `list` / `stream` | 超话分类 / 列表 / 关键词搜索 | ✅ | page |
| `trends` | 热搜榜 | ✅ | – |
| `notification comments` / `likes` (+`-stream`) | 评论 / 点赞通知 | ❌ | max_id |
| `search users` / `tweets` | 公开搜索 | ❌（上游 unavailable） | page |
| `archive <uid>` / `--uid-file` | 归档（`-stream` 形态的 NDJSON） | ❌ | mixed |
| `schema diff` | 对比两份 schemaDigest，看字段漂移 | 本地 | – |

## 常用 flag（省略通用的 cookie / env-file / guest）

### `tweet context`
| flag | 说明 |
|---|---|
| `-f, --format markdown\|json` | 默认 `markdown` |
| `--comments <n>` | 抽样评论条数，默认 0（不拉） |
| `--comment-flow hot\|time` | 评论排序，默认 `hot` |
| `--author` / `--no-author` | 补拉作者简介、粉丝数、认证、关注关系（默认开） |
| `--longtext` / `--no-longtext` | 上游标记长文时补全文（默认开） |
| `--quoted` / `--no-quoted` | 展开转发的原微博（默认开） |
| `--chain` / `--no-chain` | 展开转发链（默认开） |
| `--max-media <n>` | 最多列几个媒体，超出写进 `unknowns` |
| `--max-chars <n>` | 单字段字符上限，默认 4000，`0` 不限 |
| `--download-media <dir>` | 下载媒体并回填本地路径（会为每个归属微博刷新一次临时 URL） |
| `--overwrite` | 下载时覆盖同名文件 |

### `tweet home`
`--max-id <上一页 maxId>` 翻旧页；`--since-id <数字 id>` 只取更新的（单页增量）；`--list-id <分组 id>`、`--fid`、`--count`（上游固定 25，实测忽略）。

### `tweet search-profile <uid>`
`--q <关键词>`、`--starttime`、`--endtime`，以及布尔开关 `--hasori/--hasret/--hastext/--haspic/--hasvideo/--hasmusic`，取值 `0` / `1`。

### `media download <id>`
`-o/--out <dir>`（默认 `<pwd>/weibo-media`）、`--include pic,video,livephoto,gif,unknown`、`--concurrency`（默认 3，上限 8）、`--retries`、`--timeout`、`--idle-timeout`、`--max-bytes`（默认 512MiB）、`--overwrite`、`--dry-run`、`--fail-fast`、`--referer`、`--refresh/--no-refresh`。

下载器用独立 CDN 客户端：只带微博 Referer，**不带 Cookie**。文件是 `<mblogId>-<序号>-<mediaId>.<ext>`，扁平目录，失败清单随 `done` 事件给出。

### 流式命令（`*-stream`）
| flag | 说明 |
|---|---|
| `--max-pages <n>` / `--max-items <n>` | 双保险截断 |
| `--since <date>` / `--until <date>` | 仅时间倒序的流支持（时间线、首页、转发、@我、历史评论、通知） |
| `--page` / `--max-id` / `--since-id` / `--cursor` | 起始游标，来自上一页响应的同名字段 |

评论按热度序、点赞、收藏不提供日期边界——条目顺序和操作时间不一致。

### `archive <uid>`
| flag | 说明 |
|---|---|
| `--uid-file <path>` | 批量归档，每行一个 uid，`#` 注释 |
| `--reposts` / `--no-reposts` | 归档转发，默认开 |
| `--favorites` | 归档收藏（仅登录账号自身；单账号默认开，批量需显式） |
| `--likes` | 归档我赞过的 |
| `--comment-history` | 归档当前账号历史评论（仅登录账号自身） |
| `--images` / `--videos` | 图片墙 / 视频瀑布 |
| `--original-only` | 只归档原创 |
| `--date-slices` / `--no-date-slices` | 日期切片补齐，默认开 |
| `--source mymblog\|search` | 时间线数据源 |
| `--since <unix>` | 日期切片下界 |
| `--incremental-since <date>` | 增量下界 |
| `--stop-at <mblogId>` | 遇到即停（不产出该条） |
| `--skip-pinned` | 跳过置顶 |
| `--state <path>` | 增量 / checkpoint 状态文件 |
| `--comments` + `--comment-pages <n>` | 把评论挂到 `tweet.comments` |
| `--max-retries <n>` | 可重试错误的最大重试次数 |

## 输出形态

```bash
# JSON，接 jq
weibo user info 1111681197 --guest | jq '.name, .stats'
weibo tweet context Rnzctqb28 --guest

# Markdown，直接读（user / tweet / follow / like / favorite / notification / topic / trends / whoami）
weibo user info 1111681197 --guest --format markdown
weibo user timeline 1111681197 --guest --format markdown
weibo tweet comments Rnzctqb28 --guest --format markdown
weibo follow fans 1111681197 --guest --format markdown

# NDJSON，逐条处理
weibo media images 1111681197 --guest --max-items 20 | jq -c 'select(.event=="item") | .asset.url'

# 错误按 code 分支
if ! out=$(weibo tweet detail "$id" --guest 2>err.json); then
  jq -r '.code' err.json     # AUTH_SESSION_EXPIRED / API_NOT_OK / ...
fi
```
