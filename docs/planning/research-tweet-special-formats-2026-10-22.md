# 调研：微博特殊内容格式适配（2026-10-22）

> **状态：方案已定，P0 待实施（2026-10-22）。** 先修 m 站视频 / `page_pic` 失真，再上 `attachments`。
> **目标**：把「微博正文里除了文字和普通图片之外的格式」摸清楚，定义统一的归一化契约，避免视频、文章、投票、直播、抽奖在 SDK / 归档 / Agent 视图里丢失。
> **方法**：OpenCLI browser bridge 在已登录浏览器里打开真实微博、文章页、投票微博、直播微博，读取 `ajax/statuses/show`、m 站 `api/statuses/show` 与页面自己的 XHR；对照现有 `Tweet` 归一化代码逐项核对。
> **样本**：本次登录账号（uid 略）；真实样本包括普通视频、头条文章、`hudongvote` 投票、`live` 直播、抽奖链接卡，以及 m 站搜索/时间线里的视频卡。
> **结论**：**新增一个 additive 的 `ITweet.attachments?` 契约**，统一承载 `article` / `vote` / `live` / `lottery`；同时修复 m 站视频与 `page_pic` 的归一化缺口。全部只读，不做点赞、投票、关注等写操作。

---

## 0. 结论先行（TL;DR）

1. **视频已经部分覆盖，但 m 站会丢**：现有 `extractMediaFromPageInfo()` 只认 `media_info.media_type === 'video'`；m 站真实结构是 `page_info.object_type: 11` + `page_info.type: "video"`，视频会被漏掉。
2. **`page_pic` 在 m 站是对象不是字符串**：现有 `String(page.page_pic)` 会得到 `"[object Object]"`，需要兼容 `{ url, width, height }` 与字符串两种形态。
3. **文章（头条文章）只有卡片元数据**：`page_info.object_type: "article"` 里有标题、作者、封面、文章 id，但正文是 SSR 内联在 `weibo.com/ttarticle/p/show` 的 HTML 里，没有发现 JSON 正文接口；付费文章还可能截断。
4. **投票（`hudongvote`）信息非常完整，但位置分两套**：
   - PC：`page_info.card_info.vote_object`（问题、选项、票数、比例、截止时间、多选）。
   - m：`url_objects[].object.object.vote_object` + `url_objects[].vote_dynamic`（JSON 字符串，当前票数）。
   - 现有代码完全没读 `card_info` / `url_objects`，投票信息全部丢失。
5. **直播（`live`）同样分两套**：PC 在 `page_info.media_info`（直播状态、开播时间、在线人数、live/replay m3u8），m 在 `url_objects[].object.object`（`stream` / `urls` / `author` / `status`）。
6. **抽奖是链接卡不是 `page_info`**：`url_struct[]` 里 `url_type: 39`、`h5_target_url` 命中 `lottery.media.weibo.com`，现有 `linkCards` 能保留 URL，但没有结构化的 `lottery` 语义。
7. **建议优先级**：
   - **P0**：修 m 站视频 / `page_pic`；新增 `article` / `vote` / `live` 三类 attachments。
   - **P1**：抽奖检测；`ITweetContext` 投影 attachments 与 unknowns。
   - **P2**：文章正文抓取（HTML 解析，opt-in）；其它网页能力（文章列表、完整热搜榜、视频 feed）。
8. **非目标**：点赞、投票、转发、关注、发帖等写操作；付费文章绕过付费墙；直播流下载。

---

## 1. 现状与缺口

### 1.1 覆盖矩阵

| 格式 | 上游标识 | 现有 `ITweet` 字段 | 现状 | 优先级 |
|---|---|---|---|---|
| 普通图片 / GIF / LivePhoto | `pic_ids` / `pic_infos` / `mix_media_info` | `media[]` | ✅ 已覆盖 | — |
| 视频（PC） | `page_info.object_type: "video"` + `media_info.media_type: "video"` | `media[]`、`pageInfo`、`permanentVideoUrl`、`playCount` | ✅ 基本可用 | — |
| 视频（m 站） | `page_info.object_type: 11` + `type: "video"` | 同上 | ❌ **会丢视频** | **P0** |
| 头条文章 | `page_info.object_type: "article"` / m `url_objects[].object.object` | `pageInfo` 浅层 | ⚠️ 只有标题/URL，正文缺失 | **P0** |
| 微博投票 | `page_info.object_type: "hudongvote"` / m `url_objects` | 无 | ❌ 完全丢失 | **P0** |
| 微博直播 | `page_info.object_type: "live"` / m `url_objects` | 无 | ❌ 完全丢失 | **P0** |
| 抽奖 | `url_struct[]` + `lottery.media.weibo.com` | `linkCards` 浅层 | ⚠️ 只有链接 | P1 |
| 音频 / 播客 | `page_info.object_type: "podcast_audio"` / `"audio"` | `audio[]` | ✅ 已覆盖，有 `audio_status.json` fixture | — |
| cardlist / webpage / topic | `page_info.object_type` / `url_objects` / `url_struct` | `pageInfo`、`linkCards` | ⚠️ 通用卡片，够用 | — |
| 长微博 | `isLongText` + longtext 接口 | `text` 全文 | ✅ 已覆盖 | — |

### 1.2 已发现的归一化 bug（P0 必须一起修）

| # | 位置 | 现象 | 影响 |
|---|---|---|---|
| B1 | `extractMediaFromPageInfo()` | 只认 `mediaInfo.media_type === 'video'` 或 `page.object_type === 'video'`；m 站是 `object_type: 11` + `type: "video"` | m 站时间线 / 搜索里的视频 `media` 为空 |
| B2 | `extractPageInfo()` | `String(page.page_pic ?? '')`；m 站 `page_pic` 是 `{ url, width, height }` | `pageInfo.pagePic` 变成 `"[object Object]"` |
| B3 | `extractPageInfo()` | `type: getNumber(page.type)`；m 站 `type` 是 `"video"` / `"live"` 字符串 | `pageInfo.type` 恒为 `0`，无法区分 |
| B4 | `extractPageInfo()` | `objectType: String(page.object_type ?? '')`；m 站 `object_type` 是数字 `11` | `pageInfo.objectType` 变成 `"11"`，语义丢失 |
| B5 | `Tweet` 归一化 | 完全不读 `url_objects` | m 站详情里的投票 / 直播 / 文章全部丢失 |
| B6 | `Tweet` 归一化 | 不读 `page_info.card_info` | PC 投票选项、票数全部丢失 |

> 这些不是「新增功能」而是「现有契约在 m 站失真」，建议与 attachments 一起提交，避免下游先拿到错误数据。

---

## 2. 真实协议

### 2.1 PC 与 m 站的位置矩阵

同一个对象在两端字段位置不同，归一化必须双读：

| 类型 | PC `weibo.com/ajax/statuses/show` | m `m.weibo.cn/api/statuses/show` |
|---|---|---|
| 文章 | `page_info.object_type: "article"`；`type: 24`；`page_id`；`content1`（标题）；`content3`（作者）；`page_pic`；`page_url` 是 `sinaweibo://articlebrowser?...` | `url_objects[].object.object.object_type: "article"`；`display_name`；`article_summary` / `summary`；`author.display_name`；`ispay`；`url` / `target_url` |
| 投票 | `page_info.object_type: "hudongvote"`；`type: 23`；`page_id`；`page_url` 指向 `vote.weibo.com/h5/index/index?vote_id=...`；`card_info.card_type: 122`；`card_info.vote_object` | `url_objects[].object.object.object_type: "hudongvote"`；`vote_object`（票数可能是 0）；`url_objects[].vote_dynamic`（JSON 字符串，当前票数）；顶层 `is_vote: 1` |
| 直播 | `page_info.object_type: "live"`；`type: 26`；`page_id`；`media_info`（`live_id` / `live_status` / `real_status` / `live_start_time` / `real_chatroom_users` / `live_ld` / `replay_ld` / `stream_url`）；`page_info.live` / `author` / `status` | `url_objects[].object.object.object_type: "live"`；`status` / `real_status` / `stime` / `etime` / `duration`；`stream { url, hd_url, format }`；`urls { live_hd, live_ld, replay_hd, replay_ld }`；`author`；`image` |
| 视频 | `page_info.object_type: "video"`；`type: 5`；`media_info.media_type: "video"`；`page_pic` 字符串 | `page_info.object_type: 11`；`type: "video"`；`media_info` 直接给 `stream_url` / `duration`；`page_pic` 对象；`urls.mp4_*`；`play_count` 是「34万次播放」文案 |
| 抽奖 | `url_struct[]`：`url_type: 39`、`url_title: "抽奖详情"`、`h5_target_url` 命中 `lottery.media.weibo.com` | 通常在 `url_objects` / `url_struct` 里，结构同上 |

> 判断口诀：**PC 优先读 `page_info`，m 站优先读 `url_objects[].object.object`；两者都要保留 fallback。**

### 2.2 视频（video）

**PC 形态**：

```jsonc
{
  "page_info": {
    "type": 5,
    "object_type": "video",
    "page_id": "<media id 风格>",
    "page_title": "<作者昵称>的微博视频",
    "page_pic": "https://...jpg",
    "page_url": "sinaweibo://infopage?containerid=...",
    "media_info": {
      "media_type": "video",
      "duration": 123.4,
      "stream_url": "https://...mp4",
      "stream_url_hd": "https://...mp4",
      "mp4_hd_url": "https://...mp4",
      "big_pic_info": { "pic_big": { "url": "https://...jpg", "width": "720", "height": "1280" } },
      "h5_url": "https://video.weibo.com/show?fid=..."
    },
    "play_count": "34万次播放"
  }
}
```

**m 形态**（关键差异）：

```jsonc
{
  "page_info": {
    "object_type": 11,          // 数字，不是 "video"
    "type": "video",            // 字符串，不是 5
    "object_id": "1034:<id>",
    "page_title": "<作者昵称>的微博视频",
    "page_pic": { "url": "https://...jpg", "width": "480", "height": "893" },
    "page_url": "https://video.weibo.com/show?fid=1034%3A<id>",
    "play_count": "34万次播放",
    "media_info": {
      "duration": 303.113,
      "stream_url": "https://...mp4",
      "stream_url_hd": "https://...mp4"
    },
    "urls": {
      "mp4_720p_mp4": "https://...mp4",
      "mp4_hd_mp4": "https://...mp4",
      "mp4_ld_mp4": "https://...mp4"
    }
  }
}
```

**归一化要求**：

- 视频判定：`object_type === 'video'`（PC）**或** `type === 'video'`（m）**或** `media_info.media_type === 'video'`。
- 视频直链 fallback 链：`mp4_hd_url` → `stream_url_hd` → `stream_url` → `mp4_sd_url` → `urls.mp4_720p_mp4` → `urls.mp4_hd_mp4` → `urls.mp4_ld_mp4`。
- 封面：`page_pic` 字符串 / `page_pic.url` → `big_pic_info.pic_big.url`。
- 宽高：`page_pic.width/height`（字符串转数字）→ `big_pic_info.pic_big.width/height` → 0。
- `play_count` 是格式化文案（「34万次播放」），**不要**直接塞进 `playCount: number`；现有 `playCount` 只在 `media_info.online_users_number` 明确时映射，保持现状。

### 2.3 头条文章（article）

**PC `page_info`**：

```jsonc
{
  "type": 24,
  "object_type": "article",
  "page_id": "230940<article id>",
  "object_id": "1022:230940<article id>",
  "page_title": "@ <作者昵称> ",
  "page_pic": "https://...jpg",
  "page_desc": "",
  "content1": "<文章标题>",
  "content2": "",
  "content3": "<作者昵称>",
  "content4": "",
  "source_type": "article",
  "page_url": "sinaweibo://articlebrowser?object_id=1022%3A230940...&url=https%3A%2F%2Fweibo.com%2Fttarticle%2F...",
  "user": { "id": "<author uid>", "screen_name": "<作者昵称>" },
  "transition_pics": [{ "pic_big": { "url": "https://...jpg" } }]
}
```

**m `url_objects[]`**：

```jsonc
{
  "info": { "type": 39, "url_long": "https://weibo.com/ttarticle/p/show?id=<article id>" },
  "object": {
    "object_type": "article",
    "object": {
      "id": "1022:230940<article id>",
      "object_type": "article",
      "display_name": "<文章标题>",
      "article_summary": "<摘要>",
      "summary": "",
      "ispay": false,
      "is_article_free": true,
      "author": { "id": "<uid>", "display_name": "<作者昵称>" },
      "url": "https://weibo.com/ttarticle/p/show?id=<article id>",
      "target_url": "https://media.weibo.cn/article?id=<article id>",
      "image": { "url": "https://...jpg", "width": 120, "height": 120 }
    }
  }
}
```

**正文**：

- 没有发现 JSON 正文接口。`GET https://weibo.com/ttarticle/p/show?id=<article id>` 返回 SSR HTML，正文在页面内联脚本里：

  ```js
  var htmlStr = filterXSS("<section>...</section>")
  // ...
  createNodeFromHTMLStr(htmlStr)
  ```

  本次样本 `htmlStr` 约 21 KB；正文 HTML 需要从脚本文本里提取并反转义（`\"`、`\/`、`\uXXXX`）。
- 付费文章会出现 `#vplus_payread` / 「付费」标记，正文可能只是试读；必须允许 `truncated: true`，不能伪装成全文。
- **建议**：核心 `ITweet.attachments` 只放元数据；正文抓取作为 P2 的显式方法（如 `tweets.article(id)`），不进入默认归一化，避免每条文章微博都发一次 HTML 请求。

**归一化要求**：

| 字段 | PC 来源 | m 来源 |
|---|---|---|
| `id` | `page_id` / `object_id` 去掉 `1022:` | `object.id` 去掉 `1022:` |
| `title` | `content1` → `page_title` | `display_name` |
| `summary?` | `page_desc` → `content2` | `article_summary` → `summary` |
| `author?` | `content3` / `user.screen_name` | `author.display_name` |
| `coverUrl?` | `page_pic` / `transition_pics[0].pic_big.url` | `image.url` |
| `url` | `page_url` 里 `url=` 参数 → `https://weibo.com/ttarticle/p/show?id=<id>` | `url` → `target_url` |
| `isPaid?` | 顶层 `is_paid`（若有） | `ispay` |

---

### 2.4 微博投票（hudongvote）

**PC `page_info.card_info.vote_object`**（字段已按语义整理）：

```jsonc
{
  "card_info": {
    "card_type": 122,
    "page_id": "2317162026_<vote id>",
    "vote_object": {
      "id": "2026_<vote id>",
      "object_id": "1022:2317162026_<vote id>",
      "content": "<投票问题>",
      "choice_count": 4,
      "is_multi_select": 0,
      "minimum": 1,
      "maximum": 1,
      "expire_date": 1794724203,
      "part_info": 313,              // 总票数
      "part_num_unitname": "票",
      "parted": 0,
      "state": 1,
      "vote_type": 1,
      "user_id": "<创建者 uid>",
      "user_nick": "<创建者昵称>",
      "target_url": "https://vote.weibo.com/h5/index/index?vote_id=2026_...",
      "report_url": "https://m.weibo.cn/c/wbox?route=v2&vote_id=2026_...",
      "vote_list": [
        {
          "id": "26253083",
          "content": "<选项文案>",
          "part_num": "34",          // 注意：字符串
          "part_ratio": "0.11",      // 0..1 的字符串
          "selected": 0,
          "is_answer": 0,
          "pic": "https://...jpg",
          "pid": "<pic id>"
        }
      ]
    }
  }
}
```

**m `url_objects[]`**：

```jsonc
{
  "isActionType": true,
  "object": {
    "object_type": "hudongvote",
    "object": {
      "object_type": "hudongvote",
      "vote_object": {
        "content": "<投票问题>",
        "expire_date": 1794724203,
        "is_multi_select": 0,
        "minimum": 1,
        "maximum": 1,
        "state": 1,
        "part_info": 0,              // ⚠️ 可能是 stale 的 0
        "vote_list": [{ "id": "26253083", "content": "...", "part_num": 0, "part_ratio": 0 }]
      }
    }
  },
  "vote_dynamic": "{\"object_id\":\"1022:...\",\"part_info\":313,\"vote_list\":[{\"id\":\"26253083\",\"part_num\":34,\"part_ratio\":\"0.11\",\"selected\":0}]}"
}
```

**归一化要求**：

- 入口判定：
  - PC：`page_info.object_type === 'hudongvote'` → `page_info.card_info.vote_object`。
  - m：`url_objects[].object.object.object_type === 'hudongvote'` → `object.vote_object`。
- **m 站必须用 `vote_dynamic` 覆盖 `vote_object` 的票数**：`vote_dynamic` 是 JSON 字符串，`part_info` 和每个选项的 `part_num` / `part_ratio` 才是当前值；`vote_object.part_info` 可能是 0。
- 数字字段统一转 number：`part_num`、`part_ratio`、`expire_date`、`minimum`、`maximum`、`selected`。
- `is_multi_select` 0/1 → `boolean`；`selected` 0/1 → `boolean`；`expire_date` 是 unix 秒。
- 选项图片是投票选项配图，**不要**并入 `media[]`；放在 `options[].imageUrl`。
- `parted` / `state` / `vote_type` 原样保留为可选数字，避免猜测语义。

---

### 2.5 微博直播（live）

**PC `page_info`**：

```jsonc
{
  "type": 26,
  "object_type": "live",
  "page_id": "232132<container id>",
  "page_title": "<作者昵称>的微博直播",
  "page_pic": "https://...jpg",
  "page_url": "sinaweibo://chatroom?container_id=232132...&live_id=1022:232132...",
  "status": "3",
  "watch_limit": 0,
  "live": { "width": "720", "height": "1280", "bitrate": "" },
  "author": { "screen_name": "<作者昵称>", "vip": "" },
  "media_info": {
    "live_id": "1022:232132<container id>",
    "live_status": 3,
    "real_status": 3,
    "live_start_time": 1792634590,
    "real_chatroom_users": 29733,
    "live_replay_counts": 29733,
    "stream_url": "https://wblive-out.api.weibo.com/2/wblive/room/play?id=1022:...",
    "live_ld": "https://...m3u8",
    "replay_ld": "https://...m3u8",
    "replay_hd": "https://...m3u8",
    "watch_limit": 0,
    "subscribe": { "cover": "https://...jpg", "is_expired": true }
  }
}
```

**m `url_objects[].object.object`**：

```jsonc
{
  "object_type": "live",
  "id": "1022:232132<container id>",
  "display_name": "<作者昵称>的微博直播",
  "status": 3,
  "real_status": 3,
  "stime": "2026-10-22 10:03:10",
  "etime": "2026-10-22 11:21:24",
  "duration": 4543,
  "watch_limit": 0,
  "author": { "id": "<uid>", "display_name": "<作者昵称>", "avatar": "https://...jpg" },
  "image": { "url": "https://...jpg", "width": 996, "height": 996 },
  "stream": { "format": "m3u8", "url": "https://...flv", "hd_url": "https://...flv" },
  "urls": {
    "live_hd": "https://...m3u8",
    "live_ld": "https://...m3u8",
    "replay_hd": "https://...m3u8",
    "replay_ld": "https://...m3u8"
  },
  "url": "https://weibo.com/l/wblive/p/show/1022:232132<container id>"
}
```

**归一化要求**：

| 字段 | PC 来源 | m 来源 |
|---|---|---|
| `id` / `liveId` | `media_info.live_id` → `object_id` | `id` |
| `title` | `page_title` → `content1` | `display_name` |
| `url` | 由 `liveId` 拼 `https://weibo.com/l/wblive/p/show/<liveId>` | `url` / `target_url` |
| `coverUrl?` | `page_pic` → `media_info.subscribe.cover` | `image.url` |
| `status?` | `media_info.real_status` → `page_info.status` | `real_status` → `status` |
| `startedAt?` | `media_info.live_start_time`（unix 秒） | `stime` 解析为 unix 秒 |
| `viewerCount?` | `media_info.real_chatroom_users` | 无直接字段（`real_chatroom_users` 未下发） |
| `replayCount?` | `media_info.live_replay_counts` | 无直接字段 |
| `streamUrl?` | `media_info.live_ld` → `media_info.stream_url` | `urls.live_ld` → `stream.url` |
| `replayUrl?` | `media_info.replay_ld` → `replay_hd` | `urls.replay_ld` → `urls.replay_hd` |
| `watchLimit?` | `page_info.watch_limit` → `media_info.watch_limit` | `watch_limit` |

- `status` 本次样本为 `3`（直播已结束、有回放）；**不要自己定义 0/1/2 的含义**，原样保留并在文档标注「语义未确认」。
- `streamUrl` / `replayUrl` 是 m3u8 / 临时地址，必须标注 `temporary: true`；直播流不是长期存档资产。
- 直播封面 `page_pic` 可能是字符串（PC），也可能来自 `subscribe.cover`。

---

### 2.6 抽奖（lottery）

抽奖不是 `page_info`，而是 `url_struct[]` 的链接卡：

```jsonc
{
  "url_title": "抽奖详情",
  "url_type": 39,
  "url_type_pic": "https://...png",
  "h5_target_url": "https://lottery.media.weibo.com/lottery/h5/history/list?mid=<mid>&from=...",
  "long_url": "https://lottery.media.weibo.com/lottery/h5/history/list?mid=<mid>&mark_id=...",
  "short_url": "http://t.cn/...",
  "page_id": "230423<page id>"
}
```

**归一化要求**：

- 判定：`h5_target_url` / `long_url` / `ori_url` 命中 `^https?://lottery\.media\.weibo\.com/`。
- 从 URL query 取 `mid`；取不到时回退当前微博 `id`。
- `title` 用 `url_title`（通常是「抽奖详情」），`url` 用 `h5_target_url` → `long_url`。
- 抽奖详情页是 HTML，未发现结构化 JSON 接口；**P1 只做识别与链接**，不承诺开奖结果 / 参与人数。
- 该卡片可能同时出现在 `linkCards`，允许重复；`attachments` 去重键用 `kind:id`。

---

### 2.7 其它格式

| 格式 | 处理 |
|---|---|
| `cardlist`（如活动日历） | 保留现有 `pageInfo`；不新增结构 |
| `webpage`（活动页 / 商品页） | 保留现有 `pageInfo` / `linkCards`；不新增结构 |
| `topic` / `search_topic` | `linkCards` 已覆盖；不新增结构 |
| `podcast_audio` / `audio` | 已有 `audio[]`；本次不改 |
| 长微博 | 已有 `isLongText` + longtext 补全；本次不改 |
| 未知 `object_type` | **不报错、不猜测**；保留 `pageInfo`，不生成 attachment |

## 3. 契约设计

### 3.1 新增 `ITweet.attachments?`（additive optional）

`ITweet` v2 的规则允许「新增 optional 字段 = minor」；本次不修改任何既有字段语义，新增：

```ts
// src/types/domain/ITweet.ts
export interface ITweet {
  // ...既有字段保持不变
  /** 结构化附件（文章 / 投票 / 直播 / 抽奖）；无则缺省 */
  attachments?: TweetAttachment[]
}
```

**为什么不直接用 `pageInfo`**：

- `pageInfo` 是上游卡片的浅层投影，字段语义按 `object_type` 变化，且 m 站会把对象藏在 `url_objects`，不足以承载投票选项、直播状态、文章作者等结构。
- `attachments` 用判别联合（discriminated union），下游可以安全地 `switch (a.kind)`。
- `pageInfo` **保留不动**，老读取方不受影响；`attachments` 是同一份数据的结构化视图，两者允许重复。

### 3.2 类型定义

```ts
/** 微博正文里的结构化附件。 */
export type TweetAttachment =
  | TweetArticleAttachment
  | TweetVoteAttachment
  | TweetLiveAttachment
  | TweetLotteryAttachment

interface TweetAttachmentBase {
  /** 附件类型 */
  kind: 'article' | 'vote' | 'live' | 'lottery'
  /** 上游 id（去掉 `1022:` 前缀；取不到用 page_id / mid） */
  id: string
  /** 上游 object_type（`article` / `hudongvote` / `live`；lottery 为合成值） */
  objectType: string
  /** 标题 / 问题 / 直播标题 */
  title: string
  /** 可点击的网页地址（http/https，优先上游 web URL；scheme 会被转换） */
  url: string
  /** 封面（临时 URL） */
  coverUrl?: string
  /** 数据来源，便于排障：PC page_info / m url_objects / url_struct */
  source: 'page_info' | 'url_objects' | 'url_struct'
}

/** 头条文章（正文默认不抓，`content` 仅显式抓取时存在）。 */
export interface TweetArticleAttachment extends TweetAttachmentBase {
  kind: 'article'
  /** 摘要（上游 article_summary / page_desc） */
  summary?: string
  /** 作者昵称 */
  author?: string
  /** 是否付费文章（上游 ispay / is_paid） */
  isPaid?: boolean
  /** 正文 HTML / 纯文本；默认缺省，见 `tweets.article()` */
  content?: string
  /** 正文是否可能被截断（付费、未登录、解析失败） */
  truncated?: boolean
}

/** 微博投票。票数是抓取时快照，不代表实时。 */
export interface TweetVoteAttachment extends TweetAttachmentBase {
  kind: 'vote'
  /** 是否多选 */
  multiSelect: boolean
  /** 最少选择数 */
  minChoices?: number
  /** 最多选择数 */
  maxChoices?: number
  /** 截止时间（unix 秒） */
  expiresAt?: number
  /** 总票数（m 站以 vote_dynamic 为准） */
  totalVotes?: number
  /** 上游状态码（语义未确认，原样保留） */
  state?: number
  /** 选项 */
  options: TweetVoteOption[]
}

export interface TweetVoteOption {
  id: string
  text: string
  /** 票数（字符串转 number） */
  votes?: number
  /** 占比 0..1 */
  ratio?: number
  /** 当前登录用户是否选择（仅读，不写） */
  selected?: boolean
  /** 选项配图（临时 URL；不要并入 media[]） */
  imageUrl?: string
}

/** 微博直播 / 回放。stream / replay 地址是临时地址。 */
export interface TweetLiveAttachment extends TweetAttachmentBase {
  kind: 'live'
  /** 直播 id（上游 `1022:...`） */
  liveId: string
  /** 上游状态码（样本 3 = 已结束/有回放；语义未确认，原样保留） */
  status?: number
  /** 开播时间（unix 秒） */
  startedAt?: number
  /** 在线人数（抓取时快照） */
  viewerCount?: number
  /** 回放观看数（抓取时快照） */
  replayCount?: number
  /** 直播流（m3u8 / API 地址，临时） */
  streamUrl?: string
  /** 回放流（m3u8，临时） */
  replayUrl?: string
  /** 观看限制（上游 watch_limit，语义未确认） */
  watchLimit?: number
  /** 直播时长（秒；m 站 `duration`） */
  durationSeconds?: number
  /** 直播作者昵称（m 站 `author.display_name`） */
  authorName?: string
}

/** 抽奖链接卡（详情页未结构化）。 */
export interface TweetLotteryAttachment extends TweetAttachmentBase {
  kind: 'lottery'
  /** 抽奖所属微博 id */
  mid: string
  /** 抽奖详情页（HTML） */
  detailUrl: string
}
```

### 3.3 契约与发布约束

- `ITweet` 新增 optional 字段：**minor**，但必须同步：
  - `docs/engineering/contract-itweet-v2.md` 的字段冻结表；
  - `schemas/weibo-user-archive/v2.json`（`pnpm schema:archive` + `pnpm schema:check`）；
  - 契约键集测试（若存在）与 `CHANGELOG.md`。
- 不修改 `pageInfo` / `linkCards` / `media` / `audio` 的既有语义。
- `attachments` 缺失 = 没有识别到附件；**不要**用空数组区分「没有」和「不认识」。
- 未知 `object_type` 不生成 attachment；仍保留 `pageInfo` 以保数据。

### 3.4 接线位置

```ts
// src/models/data/Tweet.ts
function normalizeTweet(raw: RawTweet): ITweet {
  // ...既有字段
  const attachments = extractAttachments(raw)
  return {
    // ...既有字段
    ...(attachments.length > 0 ? { attachments } : {}),
  }
}
```

- `retweetedStatus` 是递归同构的 `ITweet`，其 attachments 由 `Tweet` 构造函数递归归一化，不需要额外处理。
- `src/types/index.ts` 需要导出新增的 `TweetAttachment` / `TweetArticleAttachment` / `TweetVoteAttachment` / `TweetLiveAttachment` / `TweetLotteryAttachment`，否则下游拿不到类型。
- 如果 `Tweet` 不是纯 `normalizeTweet` 而是 class 构造函数，接线点改为构造函数末尾；原则不变：**只读原始 raw，不发请求**。

---

## 4. 归一化伪代码

### 4.1 公共 helper

```ts
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string')
    return value.trim() === '' ? undefined : value
  if (typeof value === 'number' && Number.isFinite(value))
    return String(value)
  return undefined
}

function asNumber(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined)
    return undefined
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : undefined
}

function asBool01(value: unknown): boolean | undefined {
  const num = asNumber(value)
  return num === undefined ? undefined : num === 1
}

function stripObjectPrefix(id: string | undefined): string {
  return id?.replace(/^1022:/, '') ?? ''
}

/** `page_pic` 在 PC 是字符串，在 m 站是 `{ url, width, height }`。 */
function picUrl(value: unknown): string | undefined {
  const direct = asString(value)
  if (direct)
    return direct.replace(/^http:\/\//i, 'https://')
  const record = asRecord(value)
  const url = asString(record?.url)
  return url?.replace(/^http:\/\//i, 'https://')
}

function queryParam(url: string | undefined, key: string): string | undefined {
  if (!url)
    return undefined
  try {
    const parsed = new URL(url)
    return parsed.searchParams.get(key) ?? undefined
  }
  catch {
    return undefined
  }
}

function parseJson(value: string | undefined): unknown {
  if (!value)
    return undefined
  try {
    return JSON.parse(value)
  }
  catch {
    return undefined
  }
}

/**
 * 统一的 page_info 语义类型。
 *
 * PC：object_type 是 `"video"` / `"article"` / `"live"` / `"hudongvote"`；
 * m：object_type 可能是数字 `11`，语义在 `type: "video"` / `"live"`。
 */
function pageObjectType(page: Record<string, unknown>): string {
  const raw = page.object_type
  if (typeof raw === 'string' && raw !== '')
    return raw
  return asString(page.type) ?? asString(raw) ?? ''
}

/** 把 `2026-10-22 10:03:10`（+0800）解析为 unix 秒；失败返回 undefined。 */
function parseCnDate(value: string | undefined): number | undefined {
  if (!value)
    return undefined
  const ms = Date.parse(value.replace(' ', 'T') + '+08:00')
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined
}

function dedupeAttachments(items: TweetAttachment[]): TweetAttachment[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.kind}:${item.id}`
    if (seen.has(key))
      return false
    seen.add(key)
    return true
  })
}
```

### 4.2 总入口

```ts
export function extractAttachments(raw: unknown): TweetAttachment[] {
  const record = asRecord(raw)
  if (!record)
    return []

  const out: TweetAttachment[] = []

  // 1) PC：page_info 上的结构化卡片
  const page = asRecord(record.page_info)
  if (page)
    out.push(...fromPageInfo(page))

  // 2) m 站：url_objects[].object.object
  for (const item of asArray(record.url_objects))
    out.push(...fromUrlObject(item))

  // 3) 抽奖：url_struct 链接卡
  for (const item of asArray(record.url_struct)) {
    const lottery = fromUrlStructLottery(item)
    if (lottery)
      out.push(lottery)
  }

  return dedupeAttachments(out)
}

function fromPageInfo(page: Record<string, unknown>): TweetAttachment[] {
  switch (pageObjectType(page)) {
    case 'article': {
      const article = normalizeArticleFromPage(page)
      return article ? [article] : []
    }
    case 'hudongvote': {
      const vote = normalizeVoteFromPage(page)
      return vote ? [vote] : []
    }
    case 'live': {
      const live = normalizeLiveFromPage(page)
      return live ? [live] : []
    }
    default:
      return []
  }
}

function fromUrlObject(item: unknown): TweetAttachment[] {
  const wrapper = asRecord(asRecord(item)?.object)
  const obj = asRecord(wrapper?.object)
  if (!obj)
    return []

  switch (asString(obj.object_type)) {
    case 'article': {
      const article = normalizeArticleFromObject(obj)
      return article ? [article] : []
    }
    case 'hudongvote': {
      const vote = normalizeVoteFromObject(obj, wrapper)
      return vote ? [vote] : []
    }
    case 'live': {
      const live = normalizeLiveFromObject(obj)
      return live ? [live] : []
    }
    default:
      return []
  }
}
```

### 4.3 文章

```ts
function normalizeArticleFromPage(page: Record<string, unknown>): TweetArticleAttachment | undefined {
  const pageId = asString(page.page_id)
  const objectId = stripObjectPrefix(asString(page.object_id))
  const id = objectId || pageId
  if (!id)
    return undefined

  const scheme = asString(page.page_url)
  // URLSearchParams 已经解码，不要再 decodeURIComponent 一次
  const webUrl = queryParam(scheme, 'url')
    ?? `https://weibo.com/ttarticle/p/show?id=${encodeURIComponent(pageId ?? id)}`

  const transition = asArray(page.transition_pics)
  const firstTransition = asRecord(asRecord(transition[0])?.pic_big)

  return {
    kind: 'article',
    id,
    objectType: 'article',
    source: 'page_info',
    title: asString(page.content1) ?? asString(page.page_title) ?? '',
    summary: asString(page.page_desc) || asString(page.content2),
    author: asString(page.content3) ?? asString(asRecord(page.user)?.screen_name),
    coverUrl: picUrl(page.page_pic) ?? picUrl(firstTransition),
    url: webUrl,
  }
}

function normalizeArticleFromObject(obj: Record<string, unknown>): TweetArticleAttachment | undefined {
  const id = stripObjectPrefix(asString(obj.id))
  if (!id)
    return undefined

  const author = asRecord(obj.author)
  return {
    kind: 'article',
    id,
    objectType: 'article',
    source: 'url_objects',
    title: asString(obj.display_name) ?? '',
    summary: asString(obj.article_summary) ?? asString(obj.summary),
    author: asString(author?.display_name),
    coverUrl: picUrl(obj.image),
    url: asString(obj.url) ?? asString(obj.target_url) ?? `https://weibo.com/ttarticle/p/show?id=${encodeURIComponent(id)}`,
    isPaid: obj.ispay === true ? true : undefined,
  }
}
```

### 4.4 投票

```ts
function normalizeVoteFromPage(page: Record<string, unknown>): TweetVoteAttachment | undefined {
  const vote = asRecord(asRecord(page.card_info)?.vote_object)
  return vote ? buildVote(vote, undefined, page, 'page_info') : undefined
}

function normalizeVoteFromObject(
  obj: Record<string, unknown>,
  wrapper: Record<string, unknown> | undefined,
): TweetVoteAttachment | undefined {
  const vote = asRecord(obj.vote_object)
  return vote
    ? buildVote(vote, asString(wrapper?.vote_dynamic), obj, 'url_objects')
    : undefined
}

function buildVote(
  vote: Record<string, unknown>,
  dynamicRaw: string | undefined,
  sourceRecord: Record<string, unknown>,
  source: 'page_info' | 'url_objects',
): TweetVoteAttachment | undefined {
  const id = stripObjectPrefix(
    asString(vote.object_id) ?? asString(sourceRecord.page_id) ?? asString(vote.id),
  )
  if (!id)
    return undefined

  // m 站：vote_object 的票数可能是 0，以 vote_dynamic 为准
  const dynamic = asRecord(parseJson(dynamicRaw))
  const dynamicById = new Map<string, Record<string, unknown>>()
  for (const item of asArray(dynamic?.vote_list)) {
    const record = asRecord(item)
    const optionId = asString(record?.id)
    if (record && optionId)
      dynamicById.set(optionId, record)
  }

  const options: TweetVoteOption[] = asArray(vote.vote_list).flatMap((item) => {
    const record = asRecord(item)
    const optionId = asString(record?.id)
    if (!record || !optionId)
      return []
    const current = dynamicById.get(optionId)
    return [{
      id: optionId,
      text: asString(record.content) ?? '',
      votes: asNumber(current?.part_num) ?? asNumber(record.part_num),
      ratio: asNumber(current?.part_ratio) ?? asNumber(record.part_ratio),
      selected: asBool01(current?.selected ?? record.selected),
      imageUrl: picUrl(record.pic),
    }]
  })

  return {
    kind: 'vote',
    id,
    objectType: 'hudongvote',
    source,
    title: asString(vote.content) ?? '',
    url: asString(vote.target_url) ?? asString(sourceRecord.page_url) ?? '',
    coverUrl: picUrl(sourceRecord.page_pic),
    multiSelect: asBool01(vote.is_multi_select) ?? false,
    minChoices: asNumber(vote.minimum),
    maxChoices: asNumber(vote.maximum),
    expiresAt: asNumber(vote.expire_date),
    totalVotes: asNumber(dynamic?.part_info) ?? asNumber(vote.part_info),
    state: asNumber(vote.state),
    options,
  }
}
```

> `part_ratio` 是字符串（`"0.11"`），`asNumber` 会转成 `0.11`；空串按 `undefined` 处理，不需要额外过滤。

### 4.5 直播

```ts
function normalizeLiveFromPage(page: Record<string, unknown>): TweetLiveAttachment | undefined {
  const media = asRecord(page.media_info)
  const liveId = asString(media?.live_id) ?? stripObjectPrefix(asString(page.object_id))
  if (!liveId)
    return undefined

  return {
    kind: 'live',
    id: stripObjectPrefix(liveId),
    objectType: 'live',
    source: 'page_info',
    title: asString(page.page_title) ?? asString(page.content1) ?? '',
    url: `https://weibo.com/l/wblive/p/show/${liveId}`,
    coverUrl: picUrl(page.page_pic) ?? picUrl(asRecord(media?.subscribe)?.cover),
    liveId,
    status: asNumber(media?.real_status) ?? asNumber(page.status),
    startedAt: asNumber(media?.live_start_time),
    viewerCount: asNumber(media?.real_chatroom_users),
    replayCount: asNumber(media?.live_replay_counts),
    streamUrl: asString(media?.live_ld) ?? asString(media?.stream_url),
    replayUrl: asString(media?.replay_ld) ?? asString(media?.replay_hd),
    watchLimit: asNumber(page.watch_limit) ?? asNumber(media?.watch_limit),
  }
}

function normalizeLiveFromObject(obj: Record<string, unknown>): TweetLiveAttachment | undefined {
  const liveId = asString(obj.id)
  if (!liveId)
    return undefined

  const urls = asRecord(obj.urls)
  const stream = asRecord(obj.stream)
  const author = asRecord(obj.author)

  return {
    kind: 'live',
    id: stripObjectPrefix(liveId),
    objectType: 'live',
    source: 'url_objects',
    title: asString(obj.display_name) ?? '',
    url: asString(obj.url) ?? `https://weibo.com/l/wblive/p/show/${liveId}`,
    coverUrl: picUrl(obj.image),
    liveId,
    status: asNumber(obj.real_status) ?? asNumber(obj.status),
    startedAt: parseCnDate(asString(obj.stime)),
    durationSeconds: asNumber(obj.duration),
    streamUrl: asString(urls?.live_ld) ?? asString(urls?.live_hd) ?? asString(stream?.url),
    replayUrl: asString(urls?.replay_ld) ?? asString(urls?.replay_hd),
    watchLimit: asNumber(obj.watch_limit),
    authorName: asString(author?.display_name),
  }
}
```

> `parseCnDate()` 是建议的纯函数：把 `"2026-10-22 10:03:10"` 按 `+0800` 解析成 unix 秒；解析失败返回 `undefined`。

### 4.6 抽奖

```ts
function fromUrlStructLottery(item: unknown): TweetLotteryAttachment | undefined {
  const card = asRecord(item)
  if (!card)
    return undefined

  const url = asString(card.h5_target_url)
    ?? asString(card.long_url)
    ?? asString(card.ori_url)

  if (!url || !/^https?:\/\/lottery\.media\.weibo\.com\//i.test(url))
    return undefined

  const mid = queryParam(url, 'mid') ?? ''
  return {
    kind: 'lottery',
    id: asString(card.page_id) ?? mid,
    objectType: 'lottery',
    source: 'url_struct',
    title: asString(card.url_title) ?? '抽奖详情',
    url,
    mid,
    detailUrl: url,
  }
}
```

### 4.7 视频与 `pageInfo` 的修复

```ts
function isVideoPage(page: Record<string, unknown>, media: Record<string, unknown> | undefined): boolean {
  return asString(page.object_type) === 'video'
    || asString(page.type) === 'video'
    || asString(media?.media_type) === 'video'
}

function extractMediaFromPageInfo(rawRecord: UnknownRecord): TweetMedia[] {
  const page = asRecord(rawRecord.page_info)
  if (!page)
    return []
  const media = asRecord(page.media_info)
  if (!media || !isVideoPage(page, media))
    return []

  // PC 走 media_info；m 站的 mp4 变体在 page_info.urls（不是 media_info.urls）
  const urls = asRecord(page.urls)
  const bigPic = asRecord(asRecord(media.big_pic_info)?.pic_big)
  const coverUrl = picUrl(page.page_pic) ?? picUrl(bigPic)
  const videoUrl = [
    media.mp4_hd_url,
    media.stream_url_hd,
    media.stream_url,
    media.mp4_sd_url,
    urls?.mp4_720p_mp4,
    urls?.mp4_hd_mp4,
    urls?.mp4_ld_mp4,
  ].map(asString).find(Boolean)

  if (!coverUrl || !videoUrl)
    return []

  const id = asString(media.media_id) ?? asString(page.page_id) ?? asString(page.object_id)
  if (!id)
    return []

  const pic = asRecord(page.page_pic)
  return [{
    id,
    type: MediaType.VIDEO,
    imageUrl: coverUrl,
    videoUrl,
    duration: asNumber(media.duration),
    width: asNumber(pic?.width) ?? asNumber(bigPic?.width) ?? 0,
    height: asNumber(pic?.height) ?? asNumber(bigPic?.height) ?? 0,
  }]
}

function extractPageInfo(rawRecord: UnknownRecord): TweetPageCard | undefined {
  const page = asRecord(rawRecord.page_info)
  if (!page)
    return undefined

  const card: TweetPageCard = {
    pageId: asString(page.page_id) ?? '',
    pageTitle: asString(page.page_title) ?? asString(page.content1) ?? '',
    pageUrl: asString(page.page_url) ?? '',
    pagePic: picUrl(page.page_pic) ?? '',
    type: asNumber(page.type) ?? 0,
    objectType: pageObjectType(page),
  }
  // ...objectId / subtitle 保持不变
  return card
}
```

## 5. `ITweetContext` 投影

`ITweetContext` 是 Agent 视角的确定性投影，目前只处理 `media` / `links` / `comments`，完全没有 `pageInfo` / attachments。建议新增：

```ts
// src/types/domain/ITweetContext.ts
export type TweetContextAttachmentKind = 'article' | 'vote' | 'live' | 'lottery'

export interface TweetContextAttachment {
  kind: TweetContextAttachmentKind
  title: string
  url: string
  /** 文章摘要 */
  summary?: string
  /** 文章作者 */
  author?: string
  /** 文章是否付费 */
  isPaid?: boolean

  /** 投票：问题 / 多选 / 总票数 / 选项 */
  multiSelect?: boolean
  totalVotes?: number
  expiresAt?: number
  options?: Array<{
    text: string
    votes?: number
    ratio?: number
    selected?: boolean
  }>

  /** 直播：状态 / 开播时间 / 在线人数 / 临时流地址 */
  liveStatus?: number
  startedAt?: number
  viewerCount?: number
  streamUrl?: string
  replayUrl?: string
}

export interface TweetContextPost {
  // ...既有字段
  /** 结构化附件（文章 / 投票 / 直播 / 抽奖）；无则为空数组 */
  attachments: TweetContextAttachment[]
}
```

投影规则：

- **文章**：输出 `title` / `url` / `summary` / `author` / `isPaid`；正文默认不抓，写 `unknowns`：
  - `文章正文未抓取（只有元数据）`
  - `付费文章，正文可能不完整`（`isPaid === true`）
- **投票**：输出问题、选项、票数、比例、是否已选、截止时间；写提示：
  - `投票票数是抓取时快照，不代表实时`
  - `unknowns` 不需要为投票加条目（选项已完整）
- **直播**：输出状态、开播时间、在线人数、临时流地址；写 `unknowns` / `hints`：
  - `直播流/回放地址是临时地址，需要及时处理`
  - `直播状态码语义未确认`（原样保留 `liveStatus`）
- **抽奖**：只输出 `title` / `url`；写 `unknowns`：
  - `抽奖详情未抓取（只有链接）`
- **未知格式**：不投影，保留在 `tweet.pageInfo` / `linkCards`。

> 原则与现有 context 一致：**能确定性展开的就展开，不能的写 `unknowns`，不调用 LLM、不猜。**

---

## 6. 可选能力（P2 / P3）

### 6.1 `tweets.article(id)`：文章正文抓取（P2）

**协议**：

```http
GET https://weibo.com/ttarticle/p/show?id=<article id> HTTP/1.1
Cookie: <可选，登录态可减少风控；文章通常公开>
```

**伪代码**：

```ts
async function fetchArticleContent(id: string): Promise<{ content: string, isPaid: boolean }> {
  const html = await fetchText(`https://weibo.com/ttarticle/p/show?id=${encodeURIComponent(id)}`)
  const match = html.match(/var\s+htmlStr\s*=\s*filterXSS\("([\s\S]*?)"\)/)
  if (!match)
    throw new ProtocolError('Article content not found in HTML', { articleId: id })

  return {
    content: unescapeJsString(match[1]),       // 反转义 \" \/ \uXXXX \n
    isPaid: /id="vplus_payread"|>\s*付费\s*</.test(html),
  }
}
```

> `unescapeJsString()` 需要单独实现并单测，覆盖 `\"`、`\/`、`\uXXXX`、`\n`、`\\`；`fetchText()` 复用现有 transport，不要新引一个 HTTP 客户端。

风险：

- HTML 结构随时可能变；解析失败必须结构化报错，不能返回空正文。
- 付费文章可能只有试读，`truncated: true`。
- 不建议默认在 `normalizeTweet()` 里抓正文：每条文章微博都会多一次 HTML 请求，归档成本不可控。
- 输出正文是 HTML 还是纯文本需要定契约；建议先返回 HTML + `contentType: 'html'`，由调用方决定是否 strip。

### 6.2 文章列表 `users.articles`（P2）

用户主页「文章」tab 实际是：

```http
GET https://weibo.com/ajax/statuses/mymblog?uid=<uid>&page=1&feature=10
```

- 与普通时间线同一个 schema；`feature=10` 过滤出带 `page_info.object_type: "article"` 的微博（本次样本里也混有视频，属于正常）。
- 分页 `page`，`data.total` 本次为 `-1`（不可作为总数）；停止条件用空页 / 重复页。
- CLI：`weibo-cli user articles <uid>`。
- 价值：归档长文列表；但正文仍需 6.1。

### 6.3 完整热搜榜（P2）

`/hot/mine` 使用的是：

```http
GET https://weibo.com/ajax/statuses/mineBand
```

- `data.realtime` 本次返回 62 条，字段含 `word` / `rank` / `icon_desc` / `description` / `topic_flag`。
- 「文娱」tab 另有 `GET https://weibo.com/ajax/statuses/entertainment`，`data.band_list` 50 条。
- 现有 `sdk.trends.hotBand()` 走的是 `ajax/side/hotSearch`，只覆盖首屏；如果要完整榜单，这是更合适的数据源。
- 价值：榜单快照 / 研究；与个人归档关系较弱。

### 6.4 视频 feed（P3）

`/tv` 使用：

```http
POST https://weibo.com/tv/api/component?page=%2Ftv%2Fhome&m=home
```

- 组件：`Component_Channel_Menu`（17 个频道）、`Component_Home_Recommend`（9 条 + `next_cursor`）、`Component_Home_Hot`。
- POST body 在 OpenCLI `network --detail` 里不可见，协议还没抓全；先不做。
- 价值：公开视频发现；与「单条微博附件」不是同一层需求。

### 6.5 明确不做

- 点赞 / 取消赞 / 投票 / 转发 / 评论 / 关注 / 发帖。
- 直播流下载、付费文章绕过付费墙。
- 私信、群聊、仅粉丝可见内容。

---

## 7. 测试与 fixture 清单

### 7.1 Fixture

| fixture | 来源 | 覆盖 |
|---|---|---|
| `status_article.json` | PC `ajax/statuses/show` | `page_info.object_type=article`；标题 / 作者 / 封面 / page_url scheme |
| `mobile_status_vote.json` | m `api/statuses/show` | `url_objects[].object.object.vote_object` + `vote_dynamic` |
| `status_vote.json` | PC `ajax/statuses/show` | `page_info.card_info.vote_object`；选项 / 票数 / 比例 |
| `status_live.json` | PC `ajax/statuses/show` | `page_info.object_type=live`；`media_info` 直播状态 / 流地址 |
| `mobile_status_live.json` | m `api/statuses/show` | `url_objects[].object.object` 直播结构 |
| `status_lottery.json` | PC `ajax/statuses/show` | `url_struct[]` 抽奖链接卡 |
| `mobile_video_page.json` | m `api/container/getIndex` | `object_type: 11` + `type: "video"` + `page_pic` 对象 |

要求：

- 每个 fixture 至少保留一条真实样本；按 `tests/fixtures/raw/INDEX.md` 脱敏（uid / mid / 正文 / 日期 / 临时 URL 参数）。
- 在 `INDEX.md` 与 `scripts/validate-fixtures.ts` 的 `FIXTURE_RULES` 登记（mapped / unmodeled）。
- `pnpm run validate:fixtures` 必须通过。

### 7.2 测试矩阵

| 层级 | 覆盖 |
|---|---|
| Unit | `picUrl()`：字符串 / `{url}` / `http→https` / 空值 |
| Unit | `pageObjectType()`：PC `object_type: "video"` / m `object_type: 11` + `type: "video"` |
| Unit | `extractMediaFromPageInfo()`：m 视频 URL fallback（`media.stream_url` / `page.urls.mp4_*`）、封面对象、宽高字符串 |
| Unit | `extractPageInfo()`：m `page_pic` 对象、`type` 字符串、`objectType` 语义回退 |
| Unit | 文章：PC / m 两套入口；`page_url` 的 `url=` 解码；`isPaid` |
| Unit | 投票：PC `vote_object`；m `vote_dynamic` 覆盖 0 票数；选项图片不进 `media` |
| Unit | 直播：PC `media_info`；m `object.object`；`startedAt` 时区；临时流地址 |
| Unit | 抽奖：host 命中 / 不命中；`mid` 提取；`kind:id` 去重 |
| Unit | 未知 `object_type` 不生成 attachment，`pageInfo` 仍在 |
| Component | `new Tweet(fixture)` 得到期望 `attachments`；不发额外请求 |
| Component | `tweets.getByMblogId()` / `tweets.enrich()` 保留 attachments |
| Component | `ITweetContext` 投影：文章 unknowns、投票选项、直播提示、抽奖链接 |
| Contract | `ITweet` 冻结表键集更新；`schema:archive` 生成后 `schema:check` 通过 |
| E2E（默认跳过） | 真实文章 / 投票 / 直播微博各一条，`ok:1` 且 attachments 非空 |

> 注意：m 站时间线 / 搜索的卡片**不一定带**投票、直播、文章的完整对象；测试里不要假设所有端点都能拿到 attachments。需要完整附件时应走 `statuses/show` / `tweets.enrich`。

---

## 8. 实施顺序与提交拆分

| 步骤 | 内容 | 建议 commit |
|---|---|---|
| 1 | 抓 7 份 fixture、脱敏、登记 INDEX / FIXTURE_RULES | `test(fixtures): add special-format tweet samples` |
| 2 | 修 m 站视频 / `page_pic` / `type` / `objectType`（B1–B4）+ 单测 | `fix(models): normalize m-site video page_info` |
| 3 | 新增 `TweetAttachment` 类型 + `ITweet.attachments` + 导出 | `feat(types): add tweet attachment contract` |
| 4 | `extractAttachments()`：文章 / 投票 / 直播 / 抽奖 + 单测 | `feat(models): normalize tweet attachments` |
| 5 | `ITweetContext.post.attachments` + unknowns / hints + component 测试 | `feat(context): project tweet attachments` |
| 6 | 契约文档 / archive schema / CHANGELOG | `docs: document tweet attachment formats` |
| 7（可选） | `tweets.article(id)` 正文抓取 | `feat(tweets): fetch article content` |
| 8（可选） | `users.articles`（`mymblog?feature=10`） | `feat(users): list articles` |
| 9（可选） | 完整热搜榜（`mineBand` / `entertainment`） | `feat(trends): add full hot bands` |

验收门禁：

- [ ] `pnpm test`（离线）
- [ ] `pnpm run typecheck`
- [ ] `pnpm run lint`
- [ ] `pnpm run validate:fixtures`
- [ ] `pnpm run schema:check`
- [ ] `pnpm run build`
- [ ] `docs/engineering/contract-itweet-v2.md` 与代码一致

---

## 9. 风险与开放问题

1. **m 站字段漂移最严重**：`object_type` 可能是数字或字符串，`type` 反过来可能是字符串；本次已观察到同一对象在 PC / m 两端字段互换。归一化必须双读，不能只看一个字段。
2. **投票票数是快照**：`vote_dynamic` 是抓取时的值；`vote_object` 可能是 stale 的 0。不要承诺实时，也不要用票数做排序结论。
3. **直播状态码语义未确认**：样本 `status: 3` 是「已结束、有回放」，但没有官方文档；原样保留，别自己定义枚举。
4. **直播流 / 回放 / 封面 URL 都是临时地址**：不要落盘当长期资产；与现有媒体契约一致，提示调用方及时下载或重新拉取。
5. **文章正文解析脆弱**：SSR 内联 `htmlStr` 是当前实现细节；HTML 改版就会失效。必须走 opt-in 方法 + 结构化错误，不能污染默认归一化。
6. **付费文章**：可能只有试读；`isPaid` / `truncated` 必须如实标注。
7. **附件可能只在详情端点出现**：m 站时间线 / 搜索结果不保证带 `url_objects`；归档时如果附件重要，需要 `tweets.enrich` 或 `getByMblogId` 补拉。
8. **`pageInfo` 与 `attachments` 重复**：这是有意的兼容策略；下游应优先读 `attachments`，`pageInfo` 只作为兜底 / 原始视图。
9. **archive schema 变更**：`ITweet` 进入 `IArchiveFile`，新增字段会改变生成的 JSON Schema；必须重新生成并跑 `schema:check`，否则发布门禁会挂。
10. **广告 / 抽奖卡**：抽奖链接可能来自广告微博（`actionlog.ext` 出现 `is_ad_weibo:1`），识别时应保留 `isAd` 等既有标记，不要误判为普通内容。

---

## 10. 复现命令

```bash
# 1) 打开首页 / 搜索页，让页面自己发请求
opencli browser open "https://weibo.com/" --session wb --window background
opencli browser network --since 60s --session wb

# 2) 取单条微博的完整结构（文章 / 投票 / 直播 / 抽奖）
opencli browser eval "fetch('/ajax/statuses/show?id=<mblogid>',{credentials:'include'}).then(r=>r.json())" --session wb

# 3) m 站详情（url_objects / vote_dynamic）
opencli browser open "https://m.weibo.cn/" --session wbm --window background
opencli browser eval "fetch('/api/statuses/show?id=<mid>',{credentials:'include'}).then(r=>r.json())" --session wbm

# 4) m 站搜索（视频 / 直播 / 投票样本）
opencli browser eval "fetch('/api/container/getIndex?containerid='+encodeURIComponent('100103type=1&q=直播')+'&page_type=searchall',{credentials:'include'}).then(r=>r.json())" --session wbm

# 5) 文章正文 HTML
opencli browser open "https://weibo.com/ttarticle/p/show?id=<article id>" --session wb
```

> Cookie 由浏览器的登录态自动携带；不要把真实 Cookie 写进命令、fixture 或文档。

---

## 11. 参考

- `ITweet` v2 契约：[contract-itweet-v2.md](../engineering/contract-itweet-v2.md)
- 端点开发流程：[endpoint-authoring.md](../engineering/endpoint-authoring.md)
- Agent 视角上下文：[research-agent-view-2026-10-20.md](./research-agent-view-2026-10-20.md)
- 现有 m 站容器归一化：`src/services/endpoints/mobile.ts`
- 现有微博归一化：`src/models/data/Tweet.ts`（`extractPageInfo` / `extractMediaFromPageInfo` / `extractAudio`）
- 现有音频 fixture：`tests/fixtures/raw/audio_status.json`
- 抓包通道：[opencli-browser-bridge.md](../engineering/opencli-browser-bridge.md)

