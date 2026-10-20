# CLI 命令食谱

这里收集了日常使用中最常见的命令，可以直接复制运行。`playground` 的 `cli:*` 场景会自动把 `.env` 作为 `--env-file` 注入。

CLI 只从 `.env` 读取 Cookie，默认读取当前目录的 `.env`。可以用 `--env-file` 指定其他文件，或用 `--cookie` 临时覆盖。普通命令输出 JSON，`*-stream`、`archive` 和 `media download` 输出 NDJSON。

```bash
# 登录态 / 能力
weibo-cli whoami
weibo-cli capabilities --status stable
weibo-cli capabilities --status degraded

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

# 管道消费
weibo-cli tweet home-stream --max-pages 2 | jq -c 'select(.event=="item") | .mblogId'
weibo-cli archive 1111681197 --no-favorites --max-pages 1 >./output/archive.ndjson
```

## 输出形态

| 命令 | 输出 |
|---|---|
| 普通查询 | JSON（`JSON.stringify(data, null, 2)`） |
| `*-stream` | NDJSON：`progress` / `item` / `done` |
| `archive` | NDJSON：`progress` / `item` / `item-error` / `done` / `user-*` |
| `media download` | NDJSON：`progress` / `item` / `item-error` / `done` |

错误统一走 stderr，并以非零退出码退出；错误信封包含 `code / level / retryable / message / hint? / next? / context?`。

## 有界运行

示例默认都加了 `--max-pages 1`。去掉上限前，先确认账号规模和微博的限流情况。`archive` 的 `--max-pages` 限制的是每个阶段，不是整个归档任务。
