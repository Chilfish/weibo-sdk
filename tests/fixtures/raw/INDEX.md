# Fixture 索引

> 数据已脱敏：URL → `<URL>` | 长数字ID → `<ID>` | 日期 → `<DATE>` | 其他字符串 → `<TEXT>`
> **治理（E5，2026-09-04）**：每个 fixture 必须在 `scripts/validate-fixtures.ts` 的 `FIXTURE_RULES` 登记——mapped（配 endpoint spec，safeParse 必须通过）或 unmodeled（注明原因）；未登记 / 登记失效会在 `pnpm run validate:fixtures` 与 CI 中 fail loudly。
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

## 新增端点（2026-08-09 晚间：mymblog 分页漂移验证）

> 实测：mymblog 已弃用 `since_id` 分页（恒返回 `""`）、`total` 恒为 `-1`，改用 `page`；翻到底时 `list: []` 且 `since_id`/`total` 缺省。

| 文件 | 大小 | 端点 |
|------|------|------|
| `mymblog_page1.json` | 91K | `/ajax/statuses/mymblog?page=1` — 用户微博 page=1 (20条, 漂移样本) |
| `mymblog_page_end.json` | 0K | 同上 `page=999` 翻到底 — 空列表 (`list:[]`，`since_id`/`total` 缺省) |

> 分页观察：repostTimeline 的 `next_cursor` 参数无效（两页返回相同），用 `page`；粉丝 API 每页固定返回 2 条（`count` 无效）。

## 新增端点（2026-10-20 真实浏览器抓包：我的评论 / 我赞过的微博）

> 抓包环境：已登录 Chrome（uid `7679065628`），经 `fetch(..., { credentials: 'include' })` 取原始响应，再按上方规则脱敏。
> 已建模：`myCmt` / `likelist` 已分别映射到 `myCommentsSpec` / `likeListSpec`（`mapped`）；`getLikeList` 仍为 `unmodeled`。
> 脱敏补充：数组元素里的字符串同样按值脱敏（原 `scripts/sanitize-raw.mjs` 只处理对象字段，数组内 URL 会漏网）；`page_info.content1/content2` 是评论正文的镜像副本，与 `text` 一并置为 `<TEXT>`。分页游标（`next_cursor` / `previous_cursor` / `total_number`）按仓库既有惯例保留真实数值，`*_cursor_str` 按「长数字 ID」规则置为 `<ID>`。

| 文件 | 大小 | 端点 | 说明 |
|------|------|------|------|
| `my_comments_p1.json` | 461K | `/ajax/message/myCmt` | 第 1 页（不带参数；`cursor` 会被忽略），20 条 |
| `my_comments_p2.json` | 460K | 同上 `max_id=<第1页 next_cursor>` | 第 2 页，20 条 |
| `my_comments_end.json` | 0K | 同上越界（`page=999`） | `comments: []`、`next_cursor: 0`（停止态） |
| `likes_p1.json` | 112K | `/ajax/statuses/likelist` | page=1，18 条 |
| `likes_p2.json` | 104K | 同上 page=2 | 18 条，时间更早 |
| `likes_end.json` | 0K | 同上越界 page=999 | `list: []`（无错误码） |
| `like_list_cursor_p1.json` | 94K | `/ajax/profile/getLikeList` | `cursor=0`，13 条（个人页「赞」瀑布流） |
| `like_list_cursor_end.json` | 0K | 同上 `cursor=-1` | `list: []`、`next_cursor: -1`（停止态） |

### D2 我的评论 —— `/ajax/message/myCmt`

- **URL**：`GET https://weibo.com/ajax/message/myCmt`（另有同族 `GET /ajax/message/cmt`、`/ajax/message/attitudes`）
- **参数**：无（取第 1 页）；翻页 `max_id=<上一页 data.next_cursor>`（前端实际用法）；`page=<n>` 同样生效（1 基，`page=0` 视同 1），`max_id` 与 `page` 等价；`cursor=<id>` **被忽略**（传 `cursor=0` 或 `cursor=1` 均返回第 1 页）。
- **分页**：游标型，游标来自 `data.next_cursor`（number）/ `data.next_cursor_str`（string）；停止条件 `data.next_cursor === 0`（此时 `comments: []`，`total_number` 仍返回）。
- **响应**：`{ ok: 1, data: { comments: Array<评论>, hasvisible: boolean, previous_cursor: number, next_cursor: number, previous_cursor_str: string, next_cursor_str: string, total_number: number, interval: number, extend_card: number, messType: 'commentsByMe' } }`
- 每条评论内嵌完整 `status`（被评论微博）与 `user`，故单页体积偏大（~460K）。

### D1 我赞过的微博 —— `/ajax/statuses/likelist`（page 型）

- **URL**：`GET https://weibo.com/ajax/statuses/likelist?uid=<uid>&page=<n>`
- **参数**：`uid`（必需，登录用户）、`page`（1 基）、`with_total=true` 被接受但**无效果**（响应里不返回 total）；`feature=3` / `since_id` 亦无效果。
- **分页**：页码型，`page` 递增；`page=0` 与 `page=1` 返回一致；越界（`page=999`）返回 `{"ok":1,"data":{"list":[]}}`，**状态码仍 200，无 400 / 无错误字段**。
- **响应**：`{ ok: 1, data: { list: Array<微博> } }`（只有 `list`，**无 total / 无 hasMore / 无 cursor**）。停止条件：`data.list.length === 0`。

### D1 备选 —— `/ajax/profile/getLikeList`（cursor 型，个人页「赞」瀑布流）

- **URL**：`GET https://weibo.com/ajax/profile/getLikeList?uid=<uid>&cursor=<n>`
- **参数**：`uid`、`cursor`（首次传 `0`）。
- **分页**：游标型，游标来自 `data.next_cursor`；停止条件 `next_cursor === -1`（注意与 myCmt 的 `0` 不同）。
- **响应**：`{ data: { list: Array<微博>, next_cursor: number, is_owner: boolean, attitude_privacy: number }, ok: 1 }` —— 注意此端点 **`data` 在 `ok` 之前**，与 `likelist` 的键序相反。
- 实测 `cursor=0` 一次即返回 `next_cursor: -1`（仅 13 条），即对当前账号只有一个分页批次。

> 探针结论：任务书候选的 `GET /ajax/statuses/likes?uid=&page=` **已下线**——返回 200 + `text/html` 的「404错误」页（同理 `/ajax/statuses/likesMe`、`/ajax/statuses/likeList`、`/ajax/message/like`、`/ajax/attitudes/myattitudes`、`/ajax/statuses/like` 全部 404 HTML）。真实路径由线上 bundle（`h5.sinaimg.cn/m/weibo-pro-next/assets/index-*.js`）中的调用点确认。

