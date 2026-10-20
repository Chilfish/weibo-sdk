# 调研：无登录访客模式（Guest Mode）端点与接入方案（2026-10-20）

> **目的**：把「不依赖登录 Cookie 的微博读取能力」摸清楚，作为后续 guest mode 行动计划的依据。
> **方法**：阅读现有端点目录 + 对 `weibo.com` / `m.weibo.cn` 做真实匿名探针（只使用访客 token，不使用任何登录 Cookie）；样本账号 `2365795232`、单条微博 `OgHLUyXYP`（数字 mid `5039815108333719`）。
> **结论**：访客模式可行，且能力比预想广；但**匿名翻页是硬边界**。推荐采用「移动端 visitor token 作为唯一访客身份 + PC 端点负责可翻页的公开读 + m 站端点负责用户维度第一页」的组合。

---

## 0. 结论先行（TL;DR）

1. **唯一推荐 token 来源**：`visitor.passport.weibo.cn` 的移动端 `genvisitor → incarnate` 流程。它下发的 `SUB/SUBP`（domain=`.weibo.cn`）在 **`weibo.com` 和 `m.weibo.cn` 都能用**，是覆盖面最广、实现最稳的方案。
2. **`passport.weibo.com/visitor/genvisitor2` 仍保留为兜底**：它的 `SUB/SUBP` domain 是 `.weibo.com`，对 `weibo.com` 有效，但 m 站 `container/getIndex` / 搜索会 302 到登录页。
3. **鉴权模型建议**：`auth: 'auto' | 'cookie' | 'guest'`。默认 `auto` = 有 Cookie 用 Cookie；**Cookie 失效时不静默降级到 guest**（数据完整性会变），必须显式 `guest` 或 `auto` 且构造时就没有 Cookie。
4. **能力边界**：
   - guest 可做：单条微博、评论（全量翻页）、转发（翻页）、图片墙 / 视频瀑布 / 相册（翻页）、点赞者、热搜、超话、搜索（不稳定）、用户资料、用户第一页动态、点赞/关注/粉丝第一页。
   - guest 不可做：完整用户时间线翻页、收藏、历史评论、通知、@我、个人主页日期搜索、好友首页时间线。
   - 匿名 `m.weibo.cn` container 列表**只有第一页**，第 2 页 / `since_id` 一律 302 登录页。
5. **必须排除的「假成功」**：`ajax/favorites/*`、`ajax/message/*`、`ajax/statuses/mentions`、`ajax/mblog/querygroup` 在访客身份下会返回 `ok:1`，但数据属于访客账号自己，不能当目标账号数据。

---

## 1. 适用范围与前提

### 1.1 下游运行环境

按当前已知消费方式，guest mode 的优先级如下：

| 环境 | 可行性 | 说明 |
|---|---|---|
| Node.js（SDK / CLI / 服务端） | ✅ 主目标 | 可自由读取 `Set-Cookie`，可手动注入 `Cookie`，无 CORS 限制 |
| `weibo.com` 页面内脚本 / 油猴 | ✅ 可用 | 同源请求会自动带 HttpOnly Cookie；脚本无需也不应读取 `SUB` |
| 浏览器扩展 / Service Worker | ✅ 可用 | 扩展 host permissions 下可直接请求；需要读 Cookie 时用扩展 API，不依赖 `document.cookie` |
| 普通网页跨域调用 `m.weibo.cn` | ❌ 不承诺 | CORS + HttpOnly，不应作为 guest mode 的支持面 |

> 结论：**Node 优先**。浏览器相关场景只保证「同源脚本 / 扩展」可用，不把普通网页跨域纳入设计目标。

### 1.2 请求头约定

| 目标 | User-Agent | Referer | 备注 |
|---|---|---|---|
| `weibo.com/ajax/*` | 桌面 Chrome UA | `https://weibo.com/` 或详情页 | 与现有 SDK 一致 |
| `m.weibo.cn/api/*` | 移动端 iPhone UA | `https://m.weibo.cn/` | 与 PC UA 不通用；搜索 / container 对 UA 敏感 |
| 访客 token 发放 | 移动端 UA（推荐） | `https://m.weibo.cn/` | `genvisitor2` 用桌面 UA |
| 媒体 CDN | 现有 MediaHttpClient | 现有规则 | 不需要访客 token |

`m.weibo.cn` 请求建议附带 `WEIBOCN_FROM=1110003030`，实测可选，但带上更接近真实移动端。

---

## 2. 访客 token 发放机制

### 2.1 方案 A：桌面 `genvisitor2`（现有代码片段）

```http
POST https://passport.weibo.com/visitor/genvisitor2
Content-Type: multipart/form-data
Referer: https://weibo.com/
Origin: https://weibo.com

cb=visitor_gray_callback
```

响应是 JSONP：

```js
window.visitor_gray_callback && visitor_gray_callback({ "retcode": 20000000, "msg": "succ", "data": { "sub": "...", ... } })
```

同时下发 Cookie：

| Cookie | Domain | 说明 |
|---|---|---|
| `SUB` | `.weibo.com` | HttpOnly，核心访客身份 |
| `SUBP` | `.weibo.com` | 普通 Cookie |
| `SVB` | `passport.weibo.com` | passport 侧辅助 |
| `SRT` / `SRF` | `.passport.weibo.com` | 长有效期辅助 Cookie |

**限制**：这个 `SUB` 在 `m.weibo.cn` 的 `container/getIndex` / 搜索上会被 302 到 `passport.weibo.com/sso/signin`。只适合作为兜底。

### 2.2 方案 B：移动端 `genvisitor → incarnate`（推荐）

**Step 1：拿 tid**

```http
POST https://visitor.passport.weibo.cn/visitor/genvisitor
Content-Type: application/x-www-form-urlencoded
User-Agent: <mobile>
Referer: https://m.weibo.cn/

cb=gen_callback&fp=%7B%22os%22%3A%221%22%7D
```

响应：

```js
window.gen_callback && gen_callback({ "retcode": 20000000, "msg": "succ", "data": { "tid": "01AR..." } })
```

**Step 2：用 tid 换 SUB/SUBP**

```http
GET https://visitor.passport.weibo.cn/visitor/visitor
  ?a=incarnate
  &t=<tid>
  &w=2
  &c=095
  &gc=
  &cb=cross_domain
  &from=sinawap
  &_rand=<random>
User-Agent: <mobile>
Referer: https://m.weibo.cn/
```

响应：

```js
window.cross_domain && cross_domain({ "retcode": 20000000, "msg": "succ", "data": { "sub": "...", "subp": "..." } })
```

同时下发 `SUB/SUBP`，domain=`.weibo.cn`。

**验证结果**：该 token 对以下两类端点同时有效：

- `weibo.com/ajax/profile/info`、`ajax/statuses/show` 等 PC 端点 ✅
- `m.weibo.cn/api/container/getIndex`、搜索、`comments/show`、`attitudes/show` ✅

因此 guest mode **只需要维护一种 token**。

### 2.3 JSONP body 兜底（必须实现）

实测在连续发放/限流后，出现过「响应 body 里有 `data.sub` / `data.subp`，但 `Set-Cookie` 缺失」的情况。实现时不要只读 Set-Cookie：

```ts
function parseJsonp(text: string): any | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try { return JSON.parse(text.slice(start, end + 1)) } catch { return null }
}
```

优先级：

1. `Set-Cookie` 中的 `SUB` / `SUBP`
2. JSONP body 的 `data.sub` / `data.subp`
3. 两者都没有 → 视为发放失败，抛结构化错误并退避

### 2.4 有效期、轮换与限流

实测（2026-10-20）：

- `SUB` / `SUBP` 的 `Expires` 约 **1 年**（2027-10-20），`SRT` 约 10 年。
- 每次发放的 `SUB` 都不同（会轮换）。
- **发放接口本身会限流**：连续请求后可能只回 body 不回 cookie，或直接 432。
- 432 是请求限流信号，**不是 token 过期**；应走现有退避 / 令牌桶，而不是重新发 token。

实现要求：

- 实例级缓存 + single-flight：并发请求共享同一个发放 Promise。
- 只有收到明确的鉴权失效信号才刷新（见 §3.7），且每请求最多刷新一次，避免死循环。
- 刷新失败要保留旧 token 的可用性判断，不要把旧 token 直接丢弃后无限重试。
- telemetry 中不得记录 token 明文；只记录 `auth_mode`、`guest_token_age_ms`、`guest_refresh_count`。

### 2.5 最小实现示意

```ts
interface GuestToken {
  cookie: string        // SUB=...; SUBP=...; WEIBOCN_FROM=1110003030
  issuedAt: number
}

async function issueGuestToken(): Promise<GuestToken> {
  const gen = await fetch('https://visitor.passport.weibo.cn/visitor/genvisitor', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': MOBILE_UA,
      'referer': 'https://m.weibo.cn/',
    },
    body: 'cb=gen_callback&fp=%7B%22os%22%3A%221%22%7D',
  })
  const tid = parseJsonp(await gen.text())?.data?.tid
  if (!tid) throw new Error('guest token: no tid')

  const inc = await fetch(
    `https://visitor.passport.weibo.cn/visitor/visitor?a=incarnate&t=${encodeURIComponent(tid)}`
    + `&w=2&c=095&gc=&cb=cross_domain&from=sinawap&_rand=${Math.random()}`,
    { headers: { 'user-agent': MOBILE_UA, 'referer': 'https://m.weibo.cn/' } },
  )
  const body = parseJsonp(await inc.text())
  const cookies = inc.headers.getSetCookie?.() ?? []
  const sub = readCookie(cookies, 'SUB') ?? body?.data?.sub
  const subp = readCookie(cookies, 'SUBP') ?? body?.data?.subp
  if (!sub) throw new Error('guest token: no SUB')

  return {
    cookie: [`SUB=${sub}`, subp && `SUBP=${subp}`, 'WEIBOCN_FROM=1110003030'].filter(Boolean).join('; '),
    issuedAt: Date.now(),
  }
}
```

> Node 侧 `fetch` 的 `Headers.getSetCookie()` 可用；axios 侧对应 `response.headers['set-cookie']`。浏览器同源脚本不需要手动读 token。

---

## 3. 实测端点矩阵（2026-10-20）

> 所有请求均未携带登录 Cookie；「guest」列使用 §2.2 的移动端 token。结果为单次样本，上游可能漂移，落地前需用 fixture 再验证。

### 3.1 完全不需要 Cookie

| 端点 | 结果 |
|---|---|
| `GET https://weibo.com/ajax/side/hotSearch` | ✅ `ok:1` |
| `GET https://weibo.com/ajax/feed/allGroups` | ✅ `ok:1` |
| `GET https://weibo.com/ajax/side/bandUnified` | ❌ `{ok:-100,url:...}` |
| `GET https://weibo.com/ajax/statuses/config` | ❌ `{ok:-100,url:...}` |
| `GET https://weibo.com/ajax/profile/info?uid=` | ❌ `{ok:-100,url:...}` |
| `GET https://weibo.com/ajax/statuses/buildComments` | ❌ `{ok:-100,url:...}` |

### 3.2 PC 端点：访客可用

| 端点 | 实测 | 分页 |
|---|---|---|
| `ajax/profile/info?uid=` | ✅ 用户资料 | — |
| `ajax/profile/detail?uid=` | ✅ 用户详情 | — |
| `ajax/statuses/show?id=<mblogid>` | ✅ 单条微博 | — |
| `ajax/statuses/longtext?id=<mblogid>` | ✅ 长文接口 | — |
| `ajax/statuses/buildComments?id=<数字 mid>` | ✅ 评论 | ✅ `max_id` |
| `ajax/statuses/repostTimeline?id=<mblogid>` | ✅ 转发 | ✅ `page` |
| `ajax/statuses/likeShow?id=<mid>` | ⚠️ `ok:1` 但 `data` 恒空 | 已知降级 |
| `ajax/profile/getImageWall?uid=` | ✅ 图片墙 | ✅ `sinceid` |
| `ajax/profile/getWaterFallContent?uid=` | ✅ 视频瀑布 | ✅ `cursor` |
| `ajax/profile/albumlist?uid=` | ✅ 相册列表 | — |
| `ajax/side/bandUnified` | ✅ 热搜榜 | — |
| `ajax/side/hotSearch` | ✅ 热搜 | — |
| `ajax/side/cards` | ✅ 侧栏卡片 | — |
| `ajax/statuses/config` | ✅ 配置 | — |
| `ajax/stopic/cates` | ✅ 超话分类（19 项） | — |
| `ajax/stopic/list?keyword=` | ✅ 超话列表 / 搜索 | ✅ `page` |
| `ajax/feed/allGroups` | ✅ 分组配置（66 项） | — |

### 3.3 PC 端点：访客不可用（需要登录）

| 端点 | 实测表现 |
|---|---|
| `ajax/statuses/mymblog` | HTTP 403，`前方有点拥堵，请登录后使用` |
| `ajax/feed/friendstimeline` | HTTP 403，`请登录后使用` |
| `ajax/statuses/searchProfile` | HTTP 200，空对象 `{}`（静默登录门控） |
| `ajax/statuses/likelist` | HTTP 200，空对象 `{}` |
| `ajax/friendships/friends` | HTTP 200，空对象 `{}` |
| `ajax/profile/followContent` | HTTP 200，无业务数据 |
| `ajax/profile/sideDetail` | 本次 404（可能与参数/路径有关，未继续确认） |

### 3.4 m 站端点：访客可用（仅第一页）

| 端点 | 实测 | 说明 |
|---|---|---|
| `container/getIndex?type=uid&value=<uid>` | ✅ | 资料 + `tabsInfo` + 粉丝/关注/微博数 |
| `containerid=107603<uid>` | ✅ 10 条 | 用户微博，`total` 正确 |
| `containerid=230869<uid>` | ✅ 10 条 | 点赞列表 |
| `containerid=231567<uid>` | ✅ 17 条 | 视频瀑布 |
| `containerid=107803<uid>` | ✅ | 相册 tab（全部图片 / 相册专辑入口） |
| `containerid=107803<uid>_-_photoall` | ✅ | 全部图片 |
| `containerid=231051_-_followers_-_<uid>` | ✅ | **实际是「关注列表」**（total≈`follow_count`） |
| `containerid=231051_-_follows_-_<uid>` | ✅ | **实际是「粉丝列表」**（命名相反） |
| `api/statuses/show?id=<mblogid>` | ✅ | 单条微博 |
| `api/comments/show?id=<mid>&page=` | ✅ | 旧版评论，`page` 分页 |
| `api/attitudes/show?id=<mid>&page=` | ✅ | 点赞者，实测第 2 页可用，响应 `max=4` |
| `containerid=100103type=1&q=` | ✅ | 微博搜索 |
| `containerid=100103type=3&q=` | ✅ | 用户搜索（total 500） |
| `containerid=100103type=38&q=` | ⚠️ | 话题搜索，样本返回 `total:0` |
| `containerid=106003type=25&t=3&disable_hot=1&filter_type=realtimehot` | ✅ | 热搜榜 |
| `api/config` | ✅ | 登录状态 / 配置 |

### 3.5 m 站端点：访客受限

| 端点 / 参数 | 实测表现 |
|---|---|
| 任意 container 列表 `page=2` | 302 → `passport.weibo.com/sso/signin` |
| 任意 container 列表 `since_id=` | 302 → 登录页 |
| `api/statuses/repostTimeline` | 302 → 登录页（转发改用 PC 端点） |
| `comments/show` 第 2 页 | 样本返回 `{ok:0,msg:"暂无数据"}`；该样本仅 3 条，不能据此判断被门控；可靠做法仍是用 PC `buildComments` 翻页 |
| `containerid=107803<uid>_-_photolike` | `{ok:0,msg:"这里还没有内容"}`（样本账号无点赞相册） |

### 3.6 「假成功」：`ok:1` 但数据属于访客账号

这些端点在 guest 下**不能**当作目标账号数据使用：

| 端点 | 实测现象 |
|---|---|
| `ajax/favorites/all_fav` | `ok:1`，但出现非标准 HTTP 19；返回内容与传入 uid 不一致，不可信 |
| `ajax/favorites/tags` | 访客自身标签 |
| `ajax/message/myCmt` | 返回访客自己的 14 条「欢迎新用户」类评论 |
| `ajax/message/cmt` / `ajax/message/attitudes` | 访客自身通知 |
| `ajax/statuses/mentions` | 访客自身 @ |
| `ajax/mblog/querygroup` | `ok:1`，`join_groups: []`（访客没加入任何分组） |

> 现有 `capabilities.accountScoped` 已经能表达「账号级数据」；guest mode 下这些能力必须继续标 `auth: 'cookie'`，不能因为「请求成功」就放行。

### 3.7 鉴权失败的判定信号（实现时统一分类）

| 信号 | 含义 | 处置 |
|---|---|---|
| 302 + `Location` 含 `passport.weibo.com/sso/signin` | 需要登录 | 刷新 guest token 后重试一次；仍失败 → `AUTH_SESSION_EXPIRED` |
| 302 + `Location` 含 `visitor.passport.weibo.cn/visitor/visitor?entry=sinawap&a=enter` | 无访客身份 | 发放 token 后重试一次 |
| `{ ok: -100, url: ... }` | 未登录 | 同 302 |
| HTTP 403 + `请登录后使用` / `前方有点拥堵，请登录后使用` | 需要登录 | 同 302 |
| HTTP 200 + `{}` | 静默登录门控 | 同 302（但要和真实空结果区分） |
| HTML（登录页 / 风控页） | 非 JSON | 同 302；错误信息标注「可能是登录页」 |
| HTTP 432 / 429 | 限流 | **不刷新 token**，走 `RateLimitError` + 退避 |
| `{ ok: 0, msg: "暂无数据" / "这里还没有内容" / "还没有人赞过" }` | 真实空结果 | 正常返回空页，不要当鉴权失败 |

### 3.8 现有 SDK 能力的 guest 映射

| 能力 | 现有端点 | guest 结论 |
|---|---|---|
| `users.myDetails` | `ajax/profile/detail`（无 uid） | ❌ 访客自身 / 无意义 |
| `users.info` / `getById` | `ajax/profile/info` + `detail` | ✅ |
| `users.timeline` | `ajax/statuses/mymblog` | ❌ 403；只能改用 m 站第一页 |
| `users.listMentions` / `streamMentions` | `ajax/statuses/mentions` | ❌ 访客自身 |
| `users.groups` | `ajax/feed/allGroups` | ✅ |
| `users.mblogGroups` | `ajax/mblog/querygroup` | ⚠️ 访客空分组 |
| `tweets.getByMblogId` / `enrich` | `ajax/statuses/show` | ✅ |
| `tweets.comments` / `streamComments` | `ajax/statuses/buildComments` | ✅ 含翻页 |
| `tweets.getReposts` / `streamReposts` | `ajax/statuses/repostTimeline` | ✅ 含翻页 |
| `tweets.likers` / `streamLikers` | `m.weibo.cn/api/attitudes/show` | ✅ 含翻页 |
| `tweets.friendTimeline` | `ajax/feed/friendstimeline` | ❌ 403 |
| `tweets.searchByDate` | `ajax/statuses/searchProfile` | ❌ `{}` |
| `followings.getFollowings` / `getFans` | `ajax/friendships/friends` | ❌ `{}`；m 站第一页可用 |
| `favorites.*` | `ajax/favorites/*` | ❌ 访客自身 / 不可信 |
| `likes.*` | `ajax/statuses/likelist` | ❌ `{}`；m 站 `230869` 第一页可用 |
| `commentHistory.*` | `ajax/message/myCmt` | ❌ 访客自身 |
| `media.images` | `ajax/profile/getImageWall` | ✅ 含翻页 |
| `media.videos` | `ajax/profile/getWaterFallContent` | ✅ 含翻页 |
| `media.albums` | `getImageWall?has_album` + `getAlbumDetail` | ✅ |
| `media.download` | CDN | ✅（与鉴权无关） |
| `topics.cates` / `list` / `stream` | `ajax/stopic/*` | ✅ |
| `notifications.*` | `ajax/message/*` | ❌ 访客自身 |
| `trends.hotBand` | `ajax/side/bandUnified` | ✅ |
| `search.users` / `search.tweets` | `m container 100103` | ⚠️ 可用但不稳定 |
| `archive.streamArchive` | 混合 | ⚠️ 仅部分能力；完整时间线仍需 Cookie |

---

## 4. 分页能力矩阵（最重要的边界）

| 能力 | guest 分页 | 结论 |
|---|---|---|
| PC 评论 `buildComments`（`max_id`） | ✅ 20 + 20 实测 | 可完整抓评论 |
| PC 转发 `repostTimeline`（`page`） | ✅ | 可完整抓转发 |
| PC 图片墙（`sinceid`） | ✅ 23 + 23 实测 | 可完整抓图片墙 |
| PC 视频瀑布（`cursor`） | ✅ 17 + 8 实测 | 可完整抓视频 |
| m 站点赞者（`page`） | ✅ 第 2 页可用（响应 `max=4`） | 可翻页 |
| m 站用户微博（`page` / `since_id`） | ❌ 第 2 页 302 | 只有第一页 10 条 |
| m 站点赞列表（`230869`） | ❌ 第 2 页 302 | 只有第一页 |
| m 站关注 / 粉丝 | ❌ 第 2 页 302 | 只有第一页 |
| m 站视频 / 相册 | ❌ 第 2 页 302 | 只有第一页 |
| m 站搜索 | ⚠️ 第 1 页可用，结果不稳定 | 不建议依赖翻页 |

**产品含义**：

- guest mode 不能承诺「完整归档某人的时间线」；最多是第一页采样。
- guest mode 可以承诺「单条微博 + 评论全量 + 转发全量 + 媒体墙全量 + 热搜/超话/资料」。
- `ArchiveService` 在 guest 下必须对 timeline / favorites / commentHistory 显式拒绝或标注不完整，不能静默只抓 10 条。

### 4.1 m 站 containerid 速查

| containerid 形态 | 用途 | 备注 |
|---|---|---|
| `107603<uid>` | 用户微博 | 第一页 |
| `230869<uid>` | 点赞列表 | 第一页 |
| `231567<uid>` | 视频瀑布 | 第一页 |
| `107803<uid>` | 相册 tab | 返回「全部图片 / 相册专辑」入口 |
| `107803<uid>_-_photoall` | 全部图片 | 第一页 |
| `107803<uid>_-_photolike` | 赞过的图片 | 样本为空 |
| `231051_-_followers_-_<uid>` | **关注列表** | 命名与直觉相反 |
| `231051_-_follows_-_<uid>` | **粉丝列表** | 命名与直觉相反 |
| `100103type=1&q=<kw>` | 微博搜索 | `page_type=searchall` |
| `100103type=3&q=<kw>` | 用户搜索 | |
| `100103type=38&q=<kw>` | 话题搜索 | |
| `106003type=25&t=3&disable_hot=1&filter_type=realtimehot` | 热搜榜 | |

---

## 5. 推荐架构：最稳妥、能力最广

> **选型结论**：采用 **方案 B（移动端 `visitor.passport.weibo.cn` token）作为唯一访客身份**；数据路径 **PC-first**（评论 / 转发 / 媒体 / 热搜 / 超话 / 资料），m 站只负责「用户维度第一页」；鉴权用 **显式 `auth` 模式**，Cookie 失效不静默降级；guest 不默认开放完整归档。

### 5.1 设计原则

1. **单一访客身份**：只维护移动端 `visitor.passport.weibo.cn` token，PC / m 站共用，避免双 token 域问题。
2. **显式模式，不静默降级**：Cookie 失效不能悄悄换成 guest，否则「归档完整性」会无声变化。
3. **端点声明鉴权要求**：`EndpointSpec.auth` 决定该用 Cookie / guest / 无需鉴权，避免在 Service 里散落判断。
4. **失败分类统一**：302 / `ok:-100` / 403 登录文案 / 空对象 / HTML / 432 统一映射，重试策略只对 432 生效。
5. **token 实例级缓存 + single-flight**：发放接口自身有限流，绝不能每请求发一次。
6. **可观测但不泄密**：telemetry 记录 `auth_mode` / `guest_refresh_count`，不记录 token 明文。

### 5.2 配置形态

```ts
// src/types/config.ts
export type WeiboAuthMode = 'auto' | 'cookie' | 'guest'

export interface IWeiboConfig {
  /** 登录 Cookie；auth='guest' 时可选 */
  cookie?: string

  /** 鉴权模式（默认 auto） */
  auth?: WeiboAuthMode

  guest?: {
    /** 预置访客 Cookie（SUB=...; SUBP=...），用于复用外部已发放的 token */
    token?: string
    /** 发放失败时的兜底方式（默认 mobile；desktop 仅对 PC 端点有效） */
    issuer?: 'mobile' | 'desktop' | 'auto'
    /** 是否允许在 token 失效时自动刷新（默认 true） */
    autoRefresh?: boolean
  }
}
```

行为矩阵：

| `cookie` | `auth` | 行为 |
|---|---|---|
| 有 | `auto` / `cookie` | 只用 Cookie；鉴权失败直接报错 |
| 有 | `guest` | 只用 guest（显式忽略 Cookie） |
| 无 | `auto` / `guest` | 使用 guest |
| 无 | `cookie` | 构造时抛 `InvalidConfigError` |

> `auto` **不包含**「Cookie 失败后降级 guest」。如果未来确实需要，必须新增显式 `fallback: 'guest'`，并在 telemetry / capabilities 中标出。

### 5.3 鉴权策略抽象

```ts
interface AuthProvider {
  readonly mode: 'cookie' | 'guest'
  /** 返回注入到请求头的字段（Cookie / X-XSRF-TOKEN） */
  getHeaders(ctx: { url: string; endpoint?: string }): Promise<Record<string, string>>
  /** 鉴权失败时调用；返回 true 表示已刷新、可重试一次 */
  refresh?(ctx: { url: string; endpoint?: string; reason: AuthFailureReason }): Promise<boolean>
  /** 当前会话 uid；guest 固定 undefined */
  getSessionUid?(): Promise<string | undefined>
}

type AuthFailureReason =
  | 'redirect_to_login'
  | 'ok_minus_100'
  | 'forbidden'
  | 'html'
  | 'empty_object'
```

实现建议：

- `CookieAuthProvider`：包装现有 `AuthService`，行为不变。
- `GuestAuthProvider`：内部持有 `GuestTokenService`，`getHeaders()` 返回 `Cookie: SUB=...; SUBP=...; WEIBOCN_FROM=...`。
- `FetcherService` 只依赖 `AuthProvider`，不关心 token 从哪来。

### 5.4 `GuestTokenService`

```ts
class GuestTokenService {
  constructor(deps: {
    fetch?: typeof fetch
    clock?: { now(): number }
    issuer?: 'mobile' | 'desktop' | 'auto'
    presetToken?: string
  })

  /** 缓存 + single-flight */
  getToken(): Promise<GuestToken>

  /** 强制刷新；并发调用共享同一个 Promise */
  refresh(reason: AuthFailureReason): Promise<GuestToken>
}
```

要求：

- 默认只缓存内存；不写磁盘（避免 token 泄漏到仓库/日志）。
- `presetToken` 优先；若携带 `SUB`，直接使用，不触发放接口。
- 发放顺序：`mobile` 优先；`auto` 时 mobile 失败再尝试 `genvisitor2`（兜底仅对 PC 端点有意义，需在结果里带 `scope: 'pc' | 'all'`）。
- 刷新时保留旧 token，直到新 token 发放成功；避免刷新失败导致原本可用的请求全部失败。
- 每个请求最多刷新一次，失败后抛 `AUTH_SESSION_EXPIRED`（context 带 `auth_mode: 'guest'`、`reason`）。
- 注入 `clock` 便于离线测试；TTL 不作为主要刷新依据（实测 1 年），以失败信号为准。

### 5.5 `EndpointSpec` 元数据

在 `src/services/internal/EndpointSpec.ts` 增加：

```ts
export type EndpointAuth = 'cookie' | 'guest' | 'none'

interface EndpointSpec<...> {
  // ...
  /** 默认 'cookie'，保持现有行为 */
  auth?: EndpointAuth
}
```

约定：

| `auth` | 含义 | 示例 |
|---|---|---|
| `'none'` | 不需要任何凭证 | `ajax/side/hotSearch`（实测无 cookie 可用）、媒体 CDN |
| `'guest'` | 访客 token 可用 | `ajax/statuses/show`、`buildComments`、`getImageWall`、`m container` |
| `'cookie'` | 必须登录 | `mymblog`、`friendstimeline`、`favorites`、`message/*`、`mentions` |

> 默认值保持 `'cookie'`，避免已有端点被意外放行。

### 5.6 `FetcherService` 改动

1. **按 spec.auth 选择 provider**：
   - `none`：不注入 Cookie（或仅注入 `referer` / UA）。
   - `guest`：使用 `GuestAuthProvider`；若当前是 Cookie 模式且 `auth: 'auto'`，优先用 Cookie。
   - `cookie`：使用 `CookieAuthProvider`；guest 模式下直接抛 `AUTH_SESSION_EXPIRED`（附 `requiredAuth: 'cookie'`），不要发请求。
2. **重定向处理**：
   - guest 模式建议 `maxRedirects: 0` + `validateStatus: s => s >= 200 && s < 400`。
   - 识别 3xx 的 `Location`：登录页 / visitor 入口 → 触发一次 `refresh()` 后重试；其他 3xx 按协议错误处理。
3. **响应分类**（在 `okPolicy` / Zod 之前）：
   - `{ ok: -100 }` → `AUTH_SESSION_EXPIRED`（reason `ok_minus_100`）。
   - `{}` 且端点已知是静默门控 → `AUTH_SESSION_EXPIRED`（reason `empty_object`）。
   - 403 + 登录文案 → `AUTH_SESSION_EXPIRED`（reason `forbidden`）。
   - HTML 登录页 → 保留现有 `API_BAD_RESPONSE` 语义，但 context 增加 `auth_mode` 与 `next` 提示。
   - 432/429 → 现有 `RateLimitError`，**不触发 refresh**。
4. **每请求一次鉴权重试**：
   ```
   attempt(request)
     -> auth failure? refresh() -> retry once
     -> still auth failure? throw
   ```
5. **telemetry 扩展字段**：
   - `auth_mode`（`cookie` / `guest` / `none`）
   - `guest_refresh_count`
   - `auth_failure_reason`
   - 禁止写入 `cookie` / `token` / `SUB` 明文。

### 5.7 自检与会话上下文

当前 `WeiboSDK.ensureReady()` / `getSession()` 依赖 `users.myDetails()`（无 uid 的 `profile/detail`）。guest 下该请求虽然可能返回 `ok:1`，但没有业务意义。

建议：

- `WeiboSessionContext` 增加 `authMode: 'cookie' | 'guest'`。
- guest 模式：
  - `getSession()` 不调用 `myDetails()`，直接返回 `{ uid: undefined, authMode: 'guest', checkedAt }`；
  - `checkSession()` 用轻量探测（例如 `ajax/side/bandUnified` 或 token 发放本身）判断 token 是否可用；
  - `ensureReady()` 默认 `selfCheck.mode: 'none'`，或在 guest 下只做 token 可用性检查，不要求登录 uid。
- `ArchiveService` 的 `sessionUid` 守卫在 guest 下得到 `undefined`：
  - `includeFavorites` / `includeCommentHistory` 应直接抛 `InvalidConfigError`，提示「guest 模式无法读取账号级数据」；
  - 不要用 `undefined` 去和目标 uid 比较后给出误导性错误。
- `whoami` / CLI：
  - Cookie 模式保持现状；
  - guest 模式输出 `{ auth: 'guest', login: false, tokenIssuedAt }`，而不是报「Cookie 为空」。

### 5.8 能力注册表

```ts
interface WeiboCapability {
  // ...
  auth: 'cookie' | 'guest' | 'none'
  /** guest 模式下的分页能力 */
  guestPagination?: 'none' | 'first_page' | 'full'
  /** guest 模式的已知限制 */
  guestNote?: string
  accountScoped?: boolean
}
```

建议标注：

| 能力 | `auth` | `guestPagination` | `guestNote` |
|---|---|---|---|
| users.profile | guest | none | |
| users.timeline | cookie | — | 需登录；guest 仅 m 站第一页 |
| tweets.detail / enrich | guest | none | |
| tweets.comments | guest | full | `max_id` |
| tweets.reposts | guest | full | `page` |
| tweets.likers | guest | full | |
| tweets.friendTimeline | cookie | — | |
| tweets.searchProfile | cookie | — | |
| followings.* | cookie | — | guest 仅 m 站第一页 |
| likes.list | cookie | — | guest 仅 m 站第一页 |
| favorites.* | cookie | — | 账号级 |
| commentHistory.* | cookie | — | 账号级 |
| media.images / videos / albums | guest | full | |
| media.download | none | none | |
| topics.* | guest | full | |
| notifications.* | cookie | — | 账号级 |
| trends.hotBand | guest | none | 无 cookie 也可 `hotSearch` |
| search.users / tweets | guest | first_page | 不稳定，标 degraded |
| archive.stream | cookie | — | guest 不支持完整时间线 |

### 5.9 CLI

- 新增 `--guest`（或 `--auth guest`）；显式开启时不读取 `.env` Cookie。
- `capabilities` 输出带 `auth` / `guestPagination` / `guestNote`。
- `whoami --guest`：输出访客身份，不报错；退出码 0。
- 文档补 `playground` 示例：`weibo-cli tweet detail <id> --guest`、`weibo-cli tweet comments <id> --guest`。

### 5.10 端点回退映射（实现顺序）

| 能力 | Cookie 模式 | Guest 模式 |
|---|---|---|
| 用户资料 | `ajax/profile/info` + `detail` | 同左 |
| 单条微博 | `ajax/statuses/show` | 同左 |
| 评论 | `ajax/statuses/buildComments` | 同左 |
| 转发 | `ajax/statuses/repostTimeline` | 同左 |
| 点赞者 | `m attitudes/show` | 同左 |
| 图片墙 / 视频 / 相册 | PC `getImageWall` / `getWaterFallContent` / `getAlbumDetail` | 同左 |
| 超话 / 热搜 | PC `stopic/*` / `side/*` | 同左 |
| 用户时间线 | `ajax/statuses/mymblog` | **新增** `m containerid=107603<uid>`（仅第一页） |
| 点赞列表 | `ajax/statuses/likelist` | **新增** `m containerid=230869<uid>`（仅第一页） |
| 关注 / 粉丝 | `ajax/friendships/friends` | **新增** `m 231051_-_followers_-_` / `231051_-_follows_-_`（仅第一页） |
| 搜索 | `m 100103`（当前标 unavailable） | 同左，但标 degraded |
| 收藏 / 通知 / @我 / 历史评论 | 现有 | **不支持** |

实现方式建议：**新增独立的 mobile endpoint spec**，Service 根据 `authMode` 分支选择；不要在一个 spec 里塞两套 URL / schema，避免类型和错误语义混乱。

### 5.11 归档边界

`streamArchive` 在 guest 模式下：

- 不支持 `timeline` 完整翻页（只有第一页）→ 建议直接抛 `CONFIG_INVALID`，或提供显式的 `mode: 'partial'` 并只产出第一页。
- 不支持 `favorites` / `commentHistory`（账号级）。
- 支持 `includeImages` / `includeVideos`（PC 端点可翻页）、`includeLikes`（仅第一页）。
- 归档产物 / 进度事件应带 `authMode: 'guest'`，避免下游误以为数据完整。

> 最稳妥的做法：**guest 模式不默认开放 `archive`**，只开放单条 / 评论 / 媒体 / 热搜等明确定义的能力。归档主线仍要求 Cookie。

---

## 6. 行动计划

### P0：鉴权基础设施（必须先做）

| # | 任务 | 文件 | DoD |
|---|---|---|---|
| P0-1 | 配置与类型：`cookie?`、`auth`、`guest` | `src/types/config.ts` | 类型通过；无 Cookie + `auth:'cookie'` 抛 `CONFIG_INVALID` |
| P0-2 | `GuestTokenService`：移动端发放、JSONP + Set-Cookie 双解析、single-flight、缓存、刷新 | 新增 `src/services/internal/GuestTokenService.ts` | 离线测试覆盖发放成功 / 无 Set-Cookie / 无 tid / 刷新一次 |
| P0-3 | `AuthProvider` 抽象 + `CookieAuthProvider` / `GuestAuthProvider` | `src/services/internal/Auth*.ts` | 现有 Cookie 行为不变；guest 可注入 |
| P0-4 | `EndpointSpec.auth` + Fetcher 按端点选 provider | `EndpointSpec.ts` / `FetcherService.ts` | 默认 `'cookie'`；`'none'` 不注入 Cookie |
| P0-5 | 鉴权失败分类与一次重试 | `FetcherService.ts` | 302 / `ok:-100` / 403 / `{}` / HTML 全覆盖；432 不刷新 |
| P0-6 | 自检 / `getSession` guest 分支 | `WeiboSDK.ts` / `types/session.ts` | guest 不请求 `myDetails`；`sessionUid=undefined` |
| P0-7 | `capabilities` 增加 `auth:'guest'` / `guestPagination` / `guestNote` | `src/capabilities.ts` | 现有能力不回归 |

**P0 测试**（全部离线）：

- JSONP 解析：标准 / 前后空格 / 非 JSONP。
- token 发放：Set-Cookie 路径、body 路径、两者都有、两者都无。
- 并发 `getToken()` 只发一次请求。
- 鉴权失败刷新一次后成功；连续两次失败抛错且不循环。
- 432 不触发刷新。
- `auth:'cookie'` 且无 Cookie → 构造失败。
- `auth:'auto'` 且无 Cookie → guest。
- `auth:'guest'` 且有 Cookie → 忽略 Cookie。

### P1：能力扩展

| # | 任务 | 文件 | DoD |
|---|---|---|---|
| P1-1 | 新增 m 站 container endpoint specs | `src/services/endpoints/mobile.ts` | timeline / likes / followings / fans / video / album 第一页 |
| P1-2 | Service 按 `authMode` 分支 | `UserService` / `LikeService` / `FollowingsService` / `MediaService` | Cookie 路径不回归；guest 路径显式标注第一页 |
| P1-3 | 搜索能力重估 | `SearchService` / `capabilities.ts` | guest 下可用；状态改 `degraded`；失败信息说明不稳定 |
| P1-4 | `ArchiveService` guest 守卫 | `ArchiveService.ts` | timeline / favorites / commentHistory 在 guest 下明确拒绝 |
| P1-5 | CLI `--guest` | `src/cli/**` | 不读 `.env` Cookie；所有命令 JSON 输出不变 |
| P1-6 | 真实 fixture | `tests/fixtures/raw/guest_*` | 每个 guest 端点至少 1 条脱敏样本，登记 INDEX |

### P2：DX / 可观测性

| # | 任务 | 说明 |
|---|---|---|
| P2-1 | telemetry 字段 | `auth_mode` / `guest_refresh_count` / `auth_failure_reason` |
| P2-2 | E2E guest smoke | 独立 `WEIBO_GUEST_E2E=1`；默认跳过；432 记 skip |
| P2-3 | 文档同步 | `technical-spec.md` / `AGENTS.md` / `.agents/skills/weibo-sdk/SKILL.md` / `cli.md` |
| P2-4 | playground 示例 | `tweet detail --guest`、`tweet comments --guest`、`trends --guest` |

---

## 7. 测试策略（默认离线）

### 7.1 单元测试

| 目标 | 用例 |
|---|---|
| JSONP 解析 | 标准 `window.cb && cb({...})`、前后空白、无 JSON、非法 JSON |
| Cookie 解析 | `Set-Cookie` 数组、大小写、缺少 `SUBP`、只有 body 没有 header |
| `GuestTokenService` | 发放成功；无 tid；无 SUB；并发 single-flight；刷新成功；刷新失败保留旧 token |
| 鉴权分类 | 302→login、`ok:-100`、403 登录文案、`{}`、HTML、432、真实空结果（`暂无数据`） |
| 配置模式 | `auto` / `cookie` / `guest` × 有/无 Cookie 的行为矩阵 |
| EndpointSpec | 默认 `auth='cookie'`；`'none'` 不注入 Cookie；`'guest'` 使用访客头 |

### 7.2 组件测试

- 注入 fake `fetch` / fake axios，断言：
  - 首次请求触发 token 发放；
  - 第二个请求复用缓存（发放请求计数 = 1）；
  - 收到 302 后刷新一次并重放原请求；
  - 连续两次 302 抛 `AUTH_SESSION_EXPIRED`，不无限循环；
  - 432 不刷新 token，走 `RateLimitError`。
- 断言 telemetry：`auth_mode` / `guest_refresh_count` / `auth_failure_reason` 存在，且不含 token 明文。

### 7.3 E2E（显式开启）

- 默认 `pnpm test` 不触网。
- 新增 guest smoke：使用独立开关 `WEIBO_GUEST_E2E=1`，避免与现有「需要 `WEIBO_COOKIE` 才运行」的 E2E 冲突；默认跳过。
- 最小用例：
  1. `tweet detail <公开 mblogid>` 成功；
  2. `tweet comments <公开 mid>` 第一页成功；
  3. `user info <公开 uid>` 成功；
  4. `trends` 成功；
  5. `users.timeline` 在 guest 下返回明确的「仅第一页 / 不支持」错误。
- 用例必须允许 432 跳过（记 skip，不记 fail），避免 CI 被上游限流卡死。

### 7.4 Fixture 策略

- 新增 `tests/fixtures/raw/guest_*.json`：每个 guest 可用端点至少 1 条真实响应，按现有 `scripts/sanitize-raw.mjs` 脱敏后入库。
- 在 `tests/fixtures/raw/INDEX.md` 登记：端点、日期、是否第一页、分页字段、已知限制。
- 对 `ok:-100` / `{}` / 302 的失败样本也各留 1 条，供错误分类回归。

---

## 8. 风险与边界

| 风险 | 影响 | 缓解 |
|---|---|---|
| 访客 token 发放限流 | 首次请求失败 / 启动抖动 | 缓存 + single-flight + 指数退避；不要把发行放在每个请求前 |
| 匿名翻页被登录门控 | 只能拿第一页 | 产品上明确「guest 不承诺完整归档」；能力表标 `first_page` |
| 端点漂移 | 今天是 guest 可用，明天可能 403/空对象 | fixture + E2E 监控；错误信息带 `auth_mode` 与端点 |
| 「假成功」数据 | 把访客自身数据当目标账号数据 | 端点白名单 + `accountScoped`；guest 下直接禁止 |
| 搜索不稳定 | 结果时有时无 / 退回推荐流 | 标 `degraded`；不纳入归档主线 |
| token 泄漏 | 日志 / telemetry / 错误 context | 统一脱敏；禁止记录 Cookie / SUB |
| 浏览器跨域 | 普通网页不可用 | 只承诺 Node / 同源脚本 / 扩展；文档写明 |
| 上游条款 / 隐私 | 合规风险 | 只读公开数据；不绕过登录墙；遵循限流 |

> **产品边界建议**：guest mode 是「公开数据只读采样 + 单条深挖」能力，不是「免登录完整归档」。归档主线仍以登录 Cookie 为准。

---

## 9. 待决问题（实现前需要拍板）

1. **`auto` 是否允许 Cookie → guest 降级？**
   本文建议：**不允许**。显式 `guest` 或构造时无 Cookie 才用 guest；否则数据完整性不可预测。
2. **guest 是否默认开放 `archive`？**
   本文建议：**不默认开放**；只开放单条 / 评论 / 媒体 / 热搜等已定义能力。
3. **`users.timeline` 的 guest 语义**
   选项 A：直接报「需要登录」；选项 B：返回第一页并标注 `partial: true`。本文倾向 B，但必须在类型 / 文档中显式表达，不能静默。
4. **搜索能力状态**
   是否把 `search.users` / `search.tweets` 从 `unavailable` 改为 `degraded`？需要产品确认（现有 backlog 记录为「产品暂缓」）。
5. **桌面 token 是否保留**
   本文建议只保留为 `issuer: 'auto'` 的兜底，不作为默认；避免维护两套 domain。
6. **CLI 命令形态**
   `--guest` 还是 `--auth guest`？建议 `--guest` 作为糖，底层仍映射到 `auth: 'guest'`。

---

## 10. 附录：探针方法与原始观察

### 10.1 探针方法

- 环境：Windows / Node 26 / 原生 `fetch`；未使用任何登录 Cookie。
- 样本：`uid=2365795232`、`mblogid=OgHLUyXYP`、`mid=5039815108333719`、热搜 / 搜索关键词「人工智能」。
- 每次请求间隔 0.4–1s；记录 HTTP status、`ok`、`msg`、`data` 形状、分页字段、`Set-Cookie`。
- 关键脚本逻辑（伪代码）：

```ts
const tid = parseJsonp(await post(genvisitorUrl, 'cb=gen_callback&fp={"os":"1"}'))?.data?.tid
const inc = await get(`${visitorUrl}?a=incarnate&t=${tid}&w=2&c=095&gc=&cb=cross_domain&from=sinawap&_rand=${Math.random()}`)
const token = readSetCookie(inc, 'SUB') ?? parseJsonp(await inc.text())?.data?.sub
```

### 10.2 关键原始结果

| 请求 | 结果 |
|---|---|
| `genvisitor2`（桌面） | 200；Set-Cookie: SVB/SUB/SUBP/SRT/SRF；SUB domain `.weibo.com` |
| `genvisitor`（移动） | 200；JSONP；含 `data.tid` |
| `incarnate`（移动） | 200；Set-Cookie: SUB/SVB/SUBP/SRT/SRF；SUB domain `.weibo.cn` |
| `m container/getIndex?type=uid`（移动 token） | 200；`ok:1`；`userInfo` + 4 个 tab |
| `m container 107603` 第 1 页 | 200；10 条；`cardlistInfo.total=13718`、`page=2` |
| `m container 107603` 第 2 页 | 302 → `passport.weibo.com/sso/signin` |
| `m 231051_-_followers_-_` | 200；标题「他的全部关注」；`total=2385` |
| `m 231051_-_follows_-_` | 200；标题「他的全部粉丝」 |
| `m 230869` 点赞 | 200；10 条；`total=1000` |
| `m 231567` 视频 | 200；17 条；`total=28`；有 `since_id` |
| `m 107803_-_photoall` | 200；4 个图片卡片；`total=534` |
| `m 107803_-_photoall` 第 2 页 | 302 → 登录页 |
| `m comments/show`（已知 mid） | 200；`ok:1`；3 条 |
| `m attitudes/show` 第 1 页 | 200；50 条 |
| `m attitudes/show` 第 2 页 | 200；50 条；`max=4` |
| `m search type=1` | 第一次 200 / 9 卡片 / `total=914`；另一次 200 / 3 卡片 / `total=0`（不稳定） |
| `m search type=3` | 200；`total=500` |
| `m 热搜 container` | 200；5 个卡片；`total=20` |
| `w statuses/show?id=OgHLUyXYP` | 200；`ok:1`；完整微博 |
| `w buildComments?id=5039815108333719` | 200；20 条；`total_number=1051`；`max_id` 有值 |
| `w buildComments` 第 2 页 | 200；20 条 | 
| `w repostTimeline` | 200；`ok:1` |
| `w getImageWall` 第 1/2 页 | 200；23 / 23 条；`since_id` 前进 |
| `w getWaterFallContent` 第 1/2 页 | 200；17 / 8 条；`next_cursor` 前进 |
| `w stopic/cates` | 200；`ok:1`；19 项 |
| `w stopic/list` | 200；`ok:1`；22 项；`count=2` |
| `w mymblog` | 403；`前方有点拥堵，请登录后使用` |
| `w friendstimeline` | 403；`请登录后使用` |
| `w searchProfile` | 200；`{}` |
| `w likelist` | 200；`{}` |
| `w friendships/friends` | 200；`{}` |
| `w favorites/all_fav` | 非标准 HTTP 19；`ok:1`；数据与 uid 不一致 |
| `w message/myCmt` | 200；`ok:1`；访客自身 14 条 |
| `w side/hotSearch`（无 Cookie） | 200；`ok:1` |
| `w feed/allGroups`（无 Cookie） | 200；`ok:1` |
| `w bandUnified`（无 Cookie） | 200；`ok:-100` |

### 10.3 复核方式

- 任何 guest 端点落地前，用 `capture/` 或手工请求重新抓一条真实响应，存入 fixtures。
- 关注字段漂移：`ok`、`msg`、`cardlistInfo.since_id/page`、`data.*` 形状。
- 维护者可在 `.env` 缺失时，用 `weibo-cli --guest ...` 直接复现，不需要准备登录 Cookie。

---

## 11. 参考

- [zhanglihai/skills — weibo-skill](https://github.com/zhanglihai/skills/tree/main/weibo-skill)：m 站 visitor 流程与 containerid 示例
- [How to scrape Weibo in 2026 — the Sina Visitor System](https://dev.to/sami_8858131362756585e4f4/how-to-scrape-weibo-wei-bo-data-with-python-in-2026-the-sina-visitor-system-and-how-to-handle-it-1j6g)：访客系统能力边界
- [golang 微博爬虫 — 无登录获取 cookie](https://juejin.cn/post/7120121570676178957)：`genvisitor → incarnate` 参数说明
- [bidabrain/weiboX](https://github.com/bidabrain/weiboX)：访客 Cookie 自动获取（WebView）实践
- 仓库内相关文档：[endpoint-authoring.md](../engineering/endpoint-authoring.md)、[technical-spec.md](../engineering/technical-spec.md)、[backlog.md](./backlog.md)、[research-weibo-ecosystem-2026-10-19.md](./research-weibo-ecosystem-2026-10-19.md)

> 本文为调研记录，不代表已实现。实现进度以 `backlog.md` 与开发日志为准。

