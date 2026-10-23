# CLI 命令食谱

这里收集了日常使用中最常见的命令，可以直接复制运行。`playground` 的 `cli:*` 场景会自动把 `.env` 作为 `--env-file` 注入。

CLI 默认从 `.env` 读取 Cookie，默认读取当前目录的 `.env`。可以用 `--env-file` 指定其他文件，或用 `--cookie` 临时覆盖。查询命令默认输出 JSON，多数命令可加 `--format markdown` 换成可读卡片 / 列表；`*-stream`、`archive` 和 `media download` 输出 NDJSON。

没有 Cookie 时可以用 `--guest` 走访客身份，`.env` 不参与。访客可读公开数据；用户时间线、点赞、关注、粉丝只有第一页（`--page 2` 报 `CONFIG_INVALID`），收藏、通知、@ 我、历史评论、首页关注时间线和归档需要 Cookie。

```bash
# 登录态 / 能力
weibo-cli whoami
weibo-cli capabilities --status stable
weibo-cli capabilities --status degraded

# 访客模式：忽略 .env
weibo-cli whoami --guest
weibo-cli tweet detail <id> --guest
weibo-cli tweet comments <id> --guest
weibo-cli trends --guest
weibo-cli user timeline <uid> --guest   # 只有第一页

# 用户
weibo-cli user info 1111681197
weibo-cli user timeline 1111681197 --page 1
weibo-cli user mentions-stream --max-pages 1
weibo-cli user groups
weibo-cli user mblog-groups

# 微博
weibo-cli tweet detail QqsYymYOS
weibo-cli tweet comments QqsYymYOS
weibo-cli tweet comments-stream QqsYymYOS --max-pages 1
weibo-cli tweet replies QqsYymYOS <rootCommentId>
weibo-cli tweet home
weibo-cli tweet home-stream --max-pages 2
weibo-cli tweet home --since-id <微博数字 id>
weibo-cli tweet likers <数字 mid>
weibo-cli tweet search-profile 1111681197 --starttime 2026-01-01 --endtime 2026-12-31
weibo-cli tweet enrich QqsYymYOS --longtext

# 关注 / 粉丝
weibo-cli follow list 1111681197 --page 1
weibo-cli follow fans-stream 1111681197 --max-pages 1
weibo-cli follow my --page 1

# 收藏 / 点赞 / 历史评论
weibo-cli favorite tags
weibo-cli favorite stream 1111681197 --max-pages 1
weibo-cli favorite stream 1111681197 --tag 技术 --max-pages 1
weibo-cli like stream 1111681197 --max-pages 1
weibo-cli comment stream --max-pages 1

# 媒体
weibo-cli media images 1111681197 --max-pages 1
weibo-cli media videos 1111681197 --max-pages 1
weibo-cli media albums 1111681197
weibo-cli media album <containerId> --max-pages 1
weibo-cli media download QqsYymYOS --out ./output/media --dry-run
weibo-cli media download QqsYymYOS --out ./output/media --include pic,video

# 热搜 / 超话
weibo-cli trends
weibo-cli trends --type entertainment
weibo-cli topic cates
weibo-cli topic stream --keyword 游戏 --max-pages 1

# 通知
weibo-cli notification comments-stream --max-pages 1
weibo-cli notification likes-stream --max-pages 1

# 归档
weibo-cli archive 1111681197 --no-favorites --max-pages 1
weibo-cli archive 1111681197 --likes --images --videos --max-pages 1
weibo-cli archive 1111681197 --state ./output/cli-archive-state.json --max-pages 1
weibo-cli archive --uid-file ./uids.txt --state ./output/cli-archive-state.json

# 范围归档：单个 JSON + 可续跑 journal
weibo-cli archive user 1111681197 --since 2025-01-01 --until 2025-01-31 --out ./output/weibo-archive.json
weibo-cli archive user 1111681197 --since 2025-01-01 --until 2025-01-31 --no-comments --reposts

# 增量更新：已有输出文件作为基线，跑完合并写回
weibo-cli archive user 1111681197 --since 2026-01-01 --until 2026-03-31 --out ./output/weibo-archive.json --merge

# 合并归档（本地，不请求微博；评论 / 楼中楼 / 转发按 id 取并集）
weibo-cli archive merge ./output/weibo-archive.json ./output/weibo-archive-2026.json --out ./output/merged.json
weibo-cli archive merge ./output/weibo-archive.json ./output/weibo-archive.json --out ./output/merged.json --force   # 同一个文件传两次，演示幂等

# 管道消费
weibo-cli tweet home-stream --max-pages 2 | jq -c 'select(.event=="item") | .mblogId'
weibo-cli archive 1111681197 --no-favorites --max-pages 1 >./output/archive.ndjson
```

## 输出形态

| 命令 | 输出 |
|---|---|
| 普通查询 | JSON（`JSON.stringify(data, null, 2)`）；`--format markdown` 为可读卡片 / 列表 |
| `*-stream` | NDJSON：`progress` / `item` / `done` |
| `archive` | NDJSON：`progress` / `item` / `item-error` / `done` / `user-*` |
| `archive user` | 写入 `--out` 指定的单个 JSON；stdout 一行 `done` 摘要，stderr 为进度 / issue NDJSON |
| `archive merge` | 本地合并，写入 `--out`；stdout 一行 `done` 摘要（含 `inputs` / `deduped`），stderr 两行诊断 |
| `media download` | NDJSON：`progress` / `item` / `item-error` / `done` |

错误统一走 stderr，并以非零退出码退出；错误信封包含 `code / level / retryable / message / hint? / next? / context?`。

## 有界运行

示例默认都加了 `--max-pages 1`。去掉上限前，先确认账号规模和微博的限流情况。`archive` 的 `--max-pages` 限制每个阶段。
