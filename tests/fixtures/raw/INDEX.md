# Fixture 索引

> 数据已脱敏：URL → `<URL>` | 长数字ID → `<ID>` | 日期 → `<DATE>` | 其他字符串 → `<TEXT>`
> 生成：2026-05-16 | 21 文件

| 文件 | 大小 | 压缩率 | 内容 |
|------|------|--------|------|
| `timeline_u1740358225.json` | 63K | 42% | 时间线 (9条) |
| `profile_detail.json` | 0K | 13% | 用户详情 |
| `profile_info_u1740358225.json` | 1K | 33% | 用户信息 |
| `tweet_QqsYymYOS.json` | 17K | 62% | 微博详情 |
| `tweet_OgHLUyXYP.json` | 10K | 30% | 微博详情 |
| `tweet_P6yhlzD3j.json` | 7K | 51% | 微博详情 |
| `tweet_PCN4v8k6W.json` | 3K | 43% | 微博详情 |
| `comments.json` | 86K | 60% | 评论 (20条) |
| `feed_groups.json` | 17K | 46% | - |
| `feed_home.json` | 136K | 60% | Feed (25条) |
| `timeline_u2365795232.json` | 197K | 63% | 时间线 (24条) |
| `profile_detail_v2.json` | 1K | 39% | 用户详情 |
| `profile_info_u2365795232.json` | 1K | 54% | 用户信息 |
| `profile_sidedetail.json` | 33K | 66% | - |
| `search_users_p2.json` | 47K | 67% | 搜索 (2cards) |
| `search_users_p3.json` | 44K | 66% | 搜索 (1cards) |
| `hot_trends.json` | 14K | 52% | 热搜 (52条) |
| `side_cards.json` | 0K | 38% | - |
| `check_reward.json` | 3K | 43% | 用户信息 |
| `statuses_config.json` | 11K | 80% | - |
| `tweet_QFekiwGId.json` | 3K | 45% | 微博详情 |

## 新增端点（2026-05-16 浏览器抓包）

| 文件 | 大小 | 端点 |
|------|------|------|
| `friendships_followings_u7679065628.json` | 46K | `/ajax/friendships/friends` — 关注列表 (19个) |
| `friendships_followings_u2142312651.json` | 49K | 同上 (20个) |
| `followContent.json` | 188K | `/ajax/profile/followContent?sortType=all` — 我的关注 (48个) |
| `followContent_p2.json` | 177K | 同上 page=2 (48个) |
| `followContent_p3.json` | 184K | 同上 page=3 (50个) |
| `favorites_p1.json` | 78K | `/ajax/favorites/all_fav` — 收藏夹 (19条) |
| `favorites_tags.json` | 0K | `/ajax/favorites/tags` — 收藏夹标签 |
| `searchProfile_p1.json` | 203K | `/ajax/statuses/searchProfile` — 日期搜索 (50条) |
| `searchProfile_p2.json` | 250K | 同上 page=2 (50条) |
| `longtext.json` | 1K | `/ajax/statuses/longtext` — 长微博全文 |

## 新增端点（2026-08-09 API 抓取，scripts/sanitize-raw.mjs 脱敏）

| 文件 | 大小 | 端点 |
|------|------|------|
| `repost_timeline.json` | 273K | `/ajax/statuses/repostTimeline` — 转发列表 (24条, 原博 QEV15en4k) |
| `repost_timeline_p2.json` | 22K | 同上 page=2 (2条) |
| `friendships_fans_u2365795232.json` | 5K | `/ajax/friendships/friends?relate=fans` — 粉丝 (2个) |
| `friendships_fans_u2365795232_p2.json` | 5K | 同上 page=2 (2个) |
| `comments_feed.json` | 13K | `/ajax/statuses/buildComments` — 全参数 (3条) |

> 分页观察：repostTimeline 的 `next_cursor` 参数无效（两页返回相同），用 `page`；粉丝 API 每页固定返回 2 条（`count` 无效）。
