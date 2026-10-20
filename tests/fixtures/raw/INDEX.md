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
>
> **2026-10-20 复测（账号相关漂移）**：部分账号 `since_id` 与 `total` 已恢复真实值，且 `since_id` 翻页与 `page` 等价。`since_id` 形态不固定：本账号返回 **number**（如 `5353953288260002`），另一公开账号返回带后缀的 **string**（如 `"5348185968740754kp2"`）；但也有公开账号（uid `1111681197`）仍返回 `""` + `total: -1`。schema 必须同时接受 `string | number`，且不能依赖 `total` 判断更多页。样本见下方 `mymblog_page1_since_id_numeric.json`。
>
> | 文件 | 大小 | 端点 |
> |------|------|------|
> | `mymblog_page1_since_id_numeric.json` | 65K | `/ajax/statuses/mymblog?page=1` — 2026-10-20 抓包：`since_id` 为 number、`total` 为真实值 |

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

## 新增端点（2026-10-20 媒体集合：图片墙 / 视频瀑布）

> 抓包环境：已登录 Chrome（uid `2365795232`），经 `fetch(..., { credentials: 'include' })` 取原始响应。
> 已建模：`image_wall_*` → `imageWallSpec`，`waterfall_*` → `waterfallSpec`（`FIXTURE_RULES` 均为 mapped）。

| 文件 | 大小 | 端点 | 说明 |
|------|------|------|------|
| `image_wall_p1.json` | 4.5K | `/ajax/profile/getImageWall?uid=&sinceid=0` | 第 1 页，23 条（22 条有效 `pid` + 1 条缺 `pid` 的破损项）；`pic` + `livephoto` 混合 |
| `image_wall_p2.json` | 4.6K | 同上 `sinceid=<第1页 data.since_id>` | 第 2 页，23 条 |
| `waterfall_p1.json` | 126K | `/ajax/profile/getWaterFallContent?uid=&cursor=0` | 第 1 页，17 条视频微博 |
| `waterfall_p2.json` | 63K | 同上 `cursor=<第1页 data.next_cursor>` | 第 2 页，8 条视频微博 |

### D4 图片墙 —— `/ajax/profile/getImageWall`（复合游标 `sinceid`）

- **响应**：`{ ok: 1, data: { since_id: string, list: Array<媒体资产> }, bottom_tips_visible: boolean, bottom_tips_text: string }`
- **媒体资产**：`{ pid, mid, is_paid, timeline_year, timeline_month, object_id, type, video? }`
  - `type` 实测为 `pic` / `livephoto`；`video` 仅 livephoto 下发（`video.weibo.com/media/play?livephoto=...mov`）。
  - 图片 URL 由 `pid` 构造：`https://wx3.sinaimg.cn/large/<pid>.jpg`（GIF 用 `.gif`）。
  - 真实样本存在 `pid` 缺失、`object_id: null` 的破损条目，schema 允许并在服务层过滤。
- **分页**：首屏 `sinceid=0`，下一页传上一页 `data.since_id`；`sinceid=-1` 等同第一页。结束条件按「空列表 / 游标缺失 / 游标不前进」判断（未抓到明确空页样本）。

### D5 视频瀑布 —— `/ajax/profile/getWaterFallContent`（游标 `cursor`）

- **响应**：`{ ok: 1, data: { list: Array<微博>, next_cursor: string } }`
- **微博条目**与 mymblog 同构；视频在 `page_info.media_info`（`media_type: 'video'`、`h5_url`、`mp4_hd_url` / `stream_url_hd`、`big_pic_info.pic_big` 封面）。
- **分页**：首屏 `cursor=0`，下一页传上一页 `data.next_cursor`；**`cursor=-1` 返回 HTTP 400**（不要发送负游标）。
- 归一化后可复用 `normalizeTweet`（已支持 `page_info.media_info` → `TweetMedia`）。

## 新增端点（2026-10-20 真实抓包：D8 点赞者 / D9 @我 / D10 消息 / D11 分组）

> 抓包环境：已登录 Chrome，经 `fetch(..., { credentials: 'include' })` 取原始响应。
> 脱敏：ID 使用确定性假值（同一原始 ID 跨页映射一致），分页游标保留真实数值。
> 已建模：`likers_*` → `likersSpec`，`mentions_*` → `mentionsSpec`，`message_cmt_*` → `messageCommentsSpec`，
> `message_attitudes_*` → `messageAttitudesSpec`，`mblog_groups` → `mblogGroupsSpec`，`feed_groups` → `feedGroupsSpec`。

| 文件 | 大小 | 端点 | 说明 |
|------|------|------|------|
| `likers_p1.json` | 19K | `m.weibo.cn/api/attitudes/show?id=&page=1` | 50 条点赞者；`data.total_number = 107` |
| `likers_p2.json` | 17K | 同上 `page=2` | 45 条 |
| `likers_end.json` | 0K | 同上 `page=3` | `data.data: null`（越界停止态） |
| `mentions_p1.json` | 64K | `/ajax/statuses/mentions` | 第 1 页，16 条；`next_cursor = 5337232611217339` |
| `mentions_p2.json` | 44K | 同上 `max_id=<第1页 next_cursor>` | 第 2 页，11 条 |
| `mentions_end.json` | 0K | 同上越界 `page=999` | `statuses: []`、`next_cursor: 0` |
| `message_cmt_p1.json` | 428K | `/ajax/message/cmt` | 评论通知第 1 页，18 条 |
| `message_cmt_p2.json` | 467K | 同上 `max_id=<第1页 next_cursor>` | 第 2 页，20 条 |
| `message_cmt_end.json` | 0K | 同上越界 `page=999` | `comments: []`、`next_cursor: 0` |
| `message_attitudes_p1.json` | 316K | `/ajax/message/attitudes` | 点赞通知第 1 页，20 条（1 条缺 `status`） |
| `message_attitudes_p2.json` | 329K | 同上 `max_id=<第1页 next_cursor>` | 第 2 页，20 条（2 条缺 `status`） |
| `message_attitudes_end.json` | 0K | 同上越界 `page=999` | `attitudes: []`、`next_cursor: 0` |
| `mblog_groups.json` | 0K | `/ajax/mblog/querygroup` | `data.join_groups`，2 个分组 |
| `feed_groups.json` | 18K | `/ajax/feed/allGroups` | 5 个分类、共 68 个分组；`groups[].group[]` |

### D8 微博点赞者 —— 网页端 `likeShow` vs m 站 `attitudes/show`

- **网页端** `GET /ajax/statuses/likeShow?id=<mid>&page=<n>`：`id` 必须是数字 mid（字母 mblogid 返回 400），响应能返回正确的 `total_number`，但 `data` 恒为 `[]`（2026-10-20 实测多账号/多微博；疑似隐私/风控门控）。
- **m 站** `GET https://m.weibo.cn/api/attitudes/show?id=<mid>&page=<n>`：可用。
  - **响应**：`{ ok: 1, msg, data: { max, total_number, data: Array<{ id, created_at, source, user }> | null } }`
  - **分页**：page 型（1 基），每页约 50 条；越界页 `data: null`（仍 `ok: 1`），服务层按空页停止。
  - `total_number` 可能大于实际可翻到的条数（隐藏点赞者 / 隐私设置），停止以空页为准。
- SDK 采用 m 站端点；字段与网页端一致（`data.data[]` / `total_number`）。

### D9 @我的微博 —— `/ajax/statuses/mentions`

- **响应**：`{ ok: 1, data: { statuses: Array<微博>, next_cursor, previous_cursor, total_number } }`。
- **分页**：`page=<n>` 与 `max_id=<上一页 data.next_cursor>` 等价；`since_id` 被上游忽略（始终返回第一页）。
- 到底：`next_cursor: 0` + `statuses: []`。

### D10 消息中心 —— `/ajax/message/cmt` 与 `/ajax/message/attitudes`

- `cmt`：`data.comments[]`，每条为评论（含内嵌 `status` 被评论微博）；`attitudes`：`data.attitudes[]`，每条为点赞记录（`attitude: 'heart'` + `user` + 内嵌 `status`）。
- **分页**：两者都用 `max_id=<上一页 data.next_cursor>`（`page` 等价）；`cursor` 被忽略；到底 `next_cursor: 0` + 空数组。
- 被赞/被评论微博已删除时，条目可能没有 `status`（schema 允许 optional，服务层跳过）。
- `message/count` 与 `message/likeNotice` 已失效（200 + HTML 404 页），不建模。

### D11 分组 —— `/ajax/feed/allGroups` 与 `/ajax/mblog/querygroup`

- `feed/allGroups`：`groups[]` 是分类（默认分组 / 我的分组 / 订阅分组 / 我的频道），每个分类下 `group[]` 才是分组（`gid` / `title` / `count` / `type` / `apipath`）。
- `mblog/querygroup`：`data.join_groups[]`，元素为 `{ page_objectid, name, system_name, id }`；不带 `gid` 即返回当前账号加入的分组。

## 新增端点（2026-10-20 首页「最新微博」feed：`/ajax/feed/friendstimeline`）

> 抓包环境：OpenCLI browser bridge + 已登录 Chrome（uid `7679065628`），在 `weibo.com` 页面内用 `fetch(..., { credentials: 'include' })` 复放接口。
> 已建模：4 个 fixture 均映射到 `friendstimelineSpec`（mapped）。

| 文件 | 大小 | 端点 | 说明 |
|------|------|------|------|
| `feed_latest_p1.json` | 177K | `/ajax/feed/friendstimeline?list_id=&refresh=4&since_id=0&count=25&fid=` | 第 1 页（25 条）；响应 `max_id` = 下一页游标 |
| `feed_latest_p2.json` | 131K | 同上 `max_id=<p1 响应 max_id>` | 第 2 页（25 条，含游标本身，需去重） |
| `feed_latest_incremental.json` | 12K | 同上 `since_id=<已知微博 id>` | 增量：只返回更新的 3 条 |
| `feed_latest_end.json` | 0K | 同上 `max_id=4000000000000000`（越界） | `statuses: []`、`max_id: 0`、`since_id: 0`（停止态） |

### 首页「最新微博」 —— `/ajax/feed/friendstimeline`（`max_id` 游标）

- **URL**：`GET https://weibo.com/ajax/feed/friendstimeline?list_id=<gid>&refresh=4&since_id=0&count=25&fid=<gid>`
- **参数**：
  - `list_id` / `fid`：关注分组 id（浏览器两者都带且通常相同）。缺省任一参数都返回默认首页时间线；「最新微博」对应 `gid = 11000 + uid`（如 `110007679065628`）。
  - `refresh`：首屏浏览器传 `4`；实测 `0` / `4` 结果一致。
  - `since_id`：**增量过滤**，只返回比该微博 id 更新的条目；不是翻页游标，与 `max_id` 同传时不会返回两者之间的数据。
  - `max_id`：**翻旧页游标**，传上一页响应里的 `max_id`；下一页首条等于游标本身（含边界，需按 `mblogid` 去重）。
  - `count`：被上游忽略（传 5 / 10 / 50 / 100 均固定返回 25 条）。
- **分页**：`max_id` 型，停止条件「`statuses` 为空」；空页响应为 `{ ok: 1, statuses: [], total_number: 2000, since_id: 0, max_id: 0 }`。
- **响应**：`{ ok: 1, statuses: Array<微博>, total_number: 2000, since_id, max_id, since_id_str, max_id_str }`。
  - `total_number` 实测恒为 `2000`（上限值），**不能**用来判断是否还有下一页。
  - `statuses[]` 与 `mymblog` 同构（复用 `MyMBlogItemSchema`）；实测本接口 `mblogtype` 均为 `0`、无 `isAd`。

## 新增抓包（2026-10-20：关键词搜索 / 二级评论 / 置顶 / 音频 / 相册 / 超话 / 用户字段）

> 抓包环境：OpenCLI browser bridge 复用已登录 Chrome；原始响应经 `scripts/sanitize-raw.mjs` 脱敏后入库。
> 已建模：`searchProfile_q` → `searchProfileSpec`；`comment_replies_*` → `buildCommentsSpec`；
> `mymblog_pinned` → `myMblogSpec`；`at_status` / `audio_status` → `statusShowSpec`；
> `image_wall_with_albums` → `imageWallSpec`；`album_detail_*` → `albumDetailSpec`；
> `stopic_cates` / `stopic_list_*` → `stopicCatesSpec` / `stopicListSpec`；
> `profile_detail_hometown` → `userDetailsSpec`。

| 文件 | 大小 | 端点 | 说明 |
|------|------|------|------|
| `searchProfile_q.json` | 17K | `/ajax/statuses/searchProfile?uid=&q=&starttime=&endtime=&page=` | 关键词 4 条；`q` 与日期窗口可组合 |
| `comment_replies_p1.json` | 111K | `/ajax/statuses/buildComments?is_reply=1&fetch_level=1&id=<根评论>&max_id=` | 二级评论第 1 页，20 条；`total_number=137` |
| `comment_replies_p2.json` | 200K | 同上 `max_id=<p1 max_id>` | 第 2 页，20 条；`max_id` 继续前进 |
| `comment_replies_end.json` | 39K | 同上（另一根评论，`total_number=4`） | 一页到底：4 条、`max_id=0` |
| `mymblog_pinned.json` | 187K | `/ajax/statuses/mymblog?uid=&page=1` | 置顶项 `isTop: 1`（2 条）；非置顶项无该字段 |
| `at_status.json` | 7K | `/ajax/statuses/show?id=` | `text` HTML 含 `<a href=/n/...>` 的 @ 用户（用于 `ITweet.atUsers`） |
| `audio_status.json` | 7K | `/ajax/statuses/show?id=` | `page_info.object_type=podcast_audio`；`media_info.stream_url` / `duration` / `author_info` |
| `image_wall_with_albums.json` | 4.7K | `/ajax/profile/getImageWall?uid=&sinceid=0&has_album=true` | `data.album_list`（原创 / 头像）+ 图片墙；pc containerid |
| `album_detail_p1.json` | 4.4K | `/ajax/profile/getAlbumDetail?containerid=&since_id=0` | 相册第 1 页，24 条；`since_id` 为下一页游标 |
| `album_detail_p2.json` | 2.8K | 同上 `since_id=<p1 since_id>` | 第 2 页，15 条；`since_id: 0` 到底 |
| `album_list.json` | 0.2K | `/ajax/profile/albumlist?uid=` | mobile containerid（3 个相册）；与 `getAlbumDetail` 不兼容，unmodeled |
| `stopic_cates.json` | 0.6K | `/ajax/stopic/cates` | 19 个分类；`id` 作为 `sort_id` |
| `stopic_list_p1.json` | 14.6K | `/ajax/stopic/list?sort_id=123333&keyword=&page=1` | 30 条；`count=10`（总页数） |
| `stopic_list_p2.json` | 9.9K | 同上 `page=2` | 20 条；`count=10` |
| `stopic_list_search.json` | 9.3K | `/ajax/stopic/list?sort_id=0&keyword=游戏&page=1` | 关键词搜索 21 条；`count=2` |
| `profile_detail_hometown.json` | 1.8K | `/ajax/profile/detail?uid=` | 真实 `hometown: "家乡：广东 深圳"`（已去前缀归一化） |
| `tweet_RmITUtJpd.json` | 47K | `/ajax/statuses/show?id=` | 8 层转发链（`text_raw` 已脱敏为 `<TEXT>`）：`url_struct` 有 10 个 reppic 条目（5 个 `pic_id` 各重复一次），末端原微博 1 图；用于 `repostChain` 去重与计数 |
| `tweet_RmyjwrKDs.json` | 3.0K | `/ajax/statuses/show?id=` | B 站视频网页卡：`page_info.content2` = `812播放  74点赞  0弹幕`、`object_id`；`url_struct` 含 `long_url` / `ori_url` / `url_type: 39`（用于 `pageInfo` / `linkCards` 元数据） |
| `tweet_ReZzZFxVQ.json` | 3.0K | `/ajax/statuses/show?id=` | 网易云音乐音频卡：`page_info.object_type=audio`、`content2` 为空、`page_pic` 原始为 http（脱敏为 `<URL>`）；`url_struct` 含 `long_url` / `ori_url` / `url_type: 39` |

### D12 个人主页关键词搜索 —— `/ajax/statuses/searchProfile`

- `q` 与 `starttime` / `endtime` **可组合**；`q` 为空 / 不传 = 不过滤，`data.total` 会按关键词收窄（实测 1000 → 33 / 4）。
- 其余参数与分页语义见上方既有 `searchProfile` 章节；日期字符串仍会被上游静默忽略，SDK 在边界换算为 unix 秒。

### D13 二级评论 —— `/ajax/statuses/buildComments`（`is_reply=1` + `fetch_level=1`）

- **请求**：`id=<一级评论 id>`、`is_reply=1`、`fetch_level=1`、`max_id=<上一页 data.max_id>`；
  `is_reply` 在该路径下可省略（`fetch_level=1` 即可），但保留以对齐网页端。
- **响应**：与顶层评论同构；每条带 `rootid/rootidstr`（指向根评论）、`reply_comment`（被回复评论）。
  `total_number` 是该根评论的回复总数，`max_id=0` 到底。
- 传 `fetch_level=0` 返回空列表；传顶层微博 id 也返回空列表（必须传根评论 id）。

### D4 相册 —— `getImageWall?has_album=true` + `getAlbumDetail`

- **列表**：`GET /ajax/profile/getImageWall?uid=<uid>&sinceid=0&has_album=true` → `data.album_list[]`
  （`containerid` / `pic` / `pic_title`），同时仍返回 `data.list` 图片墙。
- **详情**：`GET /ajax/profile/getAlbumDetail?containerid=<pc_containerid>&since_id=0`
  → `{ data: { list, since_id, type } }`；`since_id` 为下一页游标，`0` 到底。
- **雷区**：`/ajax/profile/albumlist` 返回的 `mobile_profile_album` containerid 在本账号实测为空列表；
  必须使用相册 tab（`has_album=true`）下发的 `pc_profile_album` containerid。

### D7 超话 —— `/ajax/stopic/cates` + `/ajax/stopic/list`

- **分类**：`GET /ajax/stopic/cates` → `{ ok, code, data: [{ id, name }] }`（19 个）。
- **列表 / 搜索**：`GET /ajax/stopic/list?sort_id=<cates.id>&keyword=&page=<n>`（分类浏览）；
  `sort_id=0&keyword=<kw>&page=<n>`（搜索）。响应 `{ ok, code, count, since_id, data }`；
  **`count` 是总页数**（30 条/页），不是条目总数；失败时返回 `{ errno, errmsg, errcode }`。

## 新增抓包（2026-10-20：评论区参数 / 分页 / 防火墙）

> 抓包环境：OpenCLI browser bridge + 已登录 Chrome；另用同一 Cookie 做参数对照探针。
> 真实浏览器请求（`weibo.com/ajax/statuses/buildComments`）：
> `is_reload=1&id=<数字 mid>&is_show_bulletin=2&is_mix=0&count=10&uid=<uid>&fetch_level=0&locale=zh-CN`
> 注意：**没有 `type=feed`**。
> 已建模：5 个 fixture 均映射到 `buildCommentsSpec`。

| 文件 | 大小 | 端点 | 说明 |
|------|------|------|------|
| `comments_no_type_p1.json` | 62K | `buildComments`（不带 `type`） | 首屏 20 条；`total_number=56`、`max_id` 非 0 |
| `comments_no_type_p2.json` | 31K | 同上 `max_id=<p1 max_id>` | 第 2 页 18 条 |
| `comments_no_type_end.json` | 3K | 同上 `max_id=<p2 max_id>` | 第 3 页 2 条、`max_id=0` 到底 |
| `comments_firewall.json` | 31K | 同上 | 博主开启防火墙：12 条 < `total_number=19`，`trendsText` 提示部分不展示 |
| `comments_hot_empty.json` | 0.1K | 同上 `max_id=<hot p3>` | 空页但 `max_id` 仍非 0（hot 排序的停止态） |

### 评论区 —— `/ajax/statuses/buildComments`（2026-10-20 复测）

- **`type=feed` 是静默降级开关**：带上它首屏只返回 3 条（`comments_feed.json`），且 `ok` / `total_number` / `max_id` 看起来正常；浏览器真实请求不带该参数，首屏返回 20 条。SDK 已移除该参数。
- **游标**：必须使用响应顶层的 `max_id`。传「最后一条评论的 id」在顶层评论会返回 0 条；`max_id=0` 或空页即到底。
- **空页**：hot 排序可能先返回空页（`data: []`、`max_id` 仍非 0，见 `comments_hot_empty.json`），后续再请求该 `max_id` 才变成 0。停止条件必须包含空页。
- **`count` 被忽略**：浏览器传 10、探针传 20，均返回 20 条。
- **`flow=1` 必须用数字 mid**：传字母 mblogid 返回 HTTP 400；数字 mid 正常按时间排序。SDK 在 `flow=1` 且入参非数字时自动解析。
- **`total_number` 不是顶层评论数**：实测一条微博 `total_number=115`、顶层评论仅 51 条（其余为楼中楼）；不能作为结束条件。
- **防火墙**：`trendsText` 为「博主已开启防火墙，部分内容暂不展示」时，`data` 会少于 `total_number` 且 `max_id=0`，属于上游限制。
- **楼中楼**：`id=<一级评论 id>&is_reply=1&fetch_level=1`；`rootid` 可选；回复线程的 `max_id` 同样取响应顶层值，`0` 到底。

## 新增抓包（2026-10-20：图片评论）

> 抓包环境：同一 Cookie 直接调用 `/ajax/statuses/buildComments`（微博 `RnxOYgp3J`）。
> 已建模：`comments_pic_multi.json` → `buildCommentsSpec`（mapped）；归一化产物为 `ITweetComment.pics`。

| 文件 | 大小 | 端点 | 说明 |
|------|------|------|------|
| `comments_pic_multi.json` | 15K | `buildComments` | 2 条图片评论（1 图 / 2 图）；2 图评论的两个 `url_struct` 项重复同一 `pic_infos` |

### 图片评论 —— `buildComments` 的 `url_struct[].pic_infos`

- 评论顶层没有 `pic`；`pic_num` 是图片数，`mix_media_ids[]` 是每张图的 `http://t.cn/...` 短链。
- 真正 URL 在 `url_struct[].pic_infos`（`url_title: "查看图片"`）：key = 图片 id，value 含 `thumbnail` / `bmiddle` / `large` / `woriginal`。
- 多图评论可能返回多个 `url_struct` 项，后面的项可能重复前面的 `pic_infos`；归一化按 `pic_id` 去重。
- `normalizeComment` 取 `largest → original → woriginal → mw2000 → large → bmiddle → thumbnail` 的首个可用 URL 填入 `pics[].imageUrl`（临时签名 URL）。

