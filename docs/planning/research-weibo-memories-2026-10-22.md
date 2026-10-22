# 调研：微博「那年今日 / 微博回忆」接口（2026-10-22）

> **状态：调研完成，暂缓实施（2026-10-22）。** 协议与实施设计保留在第 6 节，后续按需拾起。
> **目的**：摸清微博「那年今日（微博回忆）」的入口与数据接口，判断它能否作为 SDK 的稳定能力接入。
> **方法**：OpenCLI browser bridge 复用已登录 Chrome，打开 H5 页面后读取它自己发出的 XHR；再用页面内 `fetch` 做参数矩阵探针，最后用 `.env` Cookie 从 Node 侧复现。
> **样本**：本次登录账号（uid 略），抓包日期 `2026-10-22`（服务器当天）。
> **结论**：只有一个 m 站容器端点，固定 `containerid=232544`，单页、无分页、无日期参数，必须登录 Cookie；**`232544` 是产品级常量，无法从服务端接口发现，SDK 必须硬编码**。综合评估后暂不接入。

---

## 0. 结论先行（TL;DR）

1. **页面入口**：`https://m.weibo.cn/p/cardlist?containerid=232544_-_index`（页面标题「微博回忆」，`cardlistInfo.title_top` 也是「微博回忆」）。
2. **数据接口**：`GET https://m.weibo.cn/api/container/getIndex?containerid=232544`。`_-_index` 后缀**可选且被忽略**，`232544_-_annual` 也返回完全相同的数据。
3. **没有分页**：`page` / `since_id` / `count` 全部被上游忽略，任何组合都返回同一份 11 张卡片；页面上也没有「加载更多」。
4. **不能指定日期**：`date` / `day` / `ymd` / `month+day` / `starttime` 全部被忽略。永远是「服务器当天」往前 **3 年**（本次为 2025 / 2024 / 2023 年的 10 月 22 日）。
5. **必须登录 Cookie**：访客 token 返回 `HTTP 200 + ok:0 + "这里还没有内容" + cards:[]`（假空）；完全无 Cookie 时返回 `HTTP 432` 空 body。
6. **`232544` 是固定值，不是按 uid 拼出来的**：请求里的 `uid` / `luicode` / `lfid` 都被忽略，数据始终属于当前登录会话；响应里的 `actionlog.cardid` 才是 `232544<uid>_-_ANNUAL_BANNER`，uid 由服务端注入。
7. **服务端没有「入口发现」接口**：`232544` 不在任何已加载的 H5 bundle 里；个人页容器里一度出现 `232544`，但那是 Referer 的 `lfid` 被回显，清掉 `lfid` 后消失。入口只存在于 App「我」页的「那年今日」卡片。**SDK 侧只能把 `232544` 作为常量。**
8. **PC 端没有等价入口**：`https://weibo.com/today` 不是「那年今日」，它触发的 `ajax/profile/info?custom=today` 返回 `{"ok":0,"msg":"Bad Request"}`。该能力实际是 m 站 H5 / App 能力。
9. **决策（2026-10-22）**：能力面太窄（单页、最多 3 年、不能指定日期、只能看自己），与 `searchByDate` 重叠，**暂不接入**；协议、类型契约、伪代码与实施顺序保留在第 6 节。

---

## 1. 抓包环境与请求链路

### 1.1 页面

```text
https://m.weibo.cn/p/cardlist?containerid=232544_-_index
```

打开页面后只产生一个业务 XHR：

```http
GET https://m.weibo.cn/api/container/getIndex?containerid=232544_-_index HTTP/2
Referer: https://m.weibo.cn/p/cardlist?containerid=232544_-_index
User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ...
X-Requested-With: XMLHttpRequest
```

响应约 **62 KB / 11 张卡片**，`data.cardlistInfo.v_p = "42"`。

### 1.2 复现命令（OpenCLI）

```bash
opencli browser open "https://m.weibo.cn/p/cardlist?containerid=232544_-_index" --session wbm --window background
opencli browser network --since 60s --session wbm
opencli browser network --detail "GET m.weibo.cn/api/container/getIndex" --session wbm
```

### 1.3 Node 侧复现（Cookie 只从 `.env` 读取）

用 m 站 UA + `Referer: https://m.weibo.cn/` + `.env` 的 `WEIBO_COOKIE` 直接请求即可，不依赖页面上下文：

```bash
# Cookie 从 .env 的 WEIBO_COOKIE 读取（仓库约定：不读 shell 环境变量）
curl -s 'https://m.weibo.cn/api/container/getIndex?containerid=232544' \
  -H "Cookie: $(sed -n 's/^WEIBO_COOKIE *=//p' .env)" \
  -H 'User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' \
  -H 'Referer: https://m.weibo.cn/' \
  -H 'X-Requested-With: XMLHttpRequest'
```

> 首次探针曾返回 `ok:-100`，紧接着复测恢复 `ok:1`，判断为 m 站瞬时风控而非稳定鉴权要求。实现时仍建议把 `ok:-100` 映射为 `AUTH_SESSION_EXPIRED`，不要当成空结果。

---

## 2. 响应契约

### 2.1 顶层骨架（字段已脱敏）

```jsonc
{
  "ok": 1,
  "data": {
    "cardlistInfo": {
      "v_p": "42",
      "containerid": "232544_-_index",
      "since_id": "",
      "title_top": "微博回忆",
      "show_style": 1,
      "cardlist_menus": [
        { "name": "刷新", "type": "button_menus_refresh" },
        { "name": "返回首页", "type": "gohome" }
      ],
      "page": null
    },
    "cards": [ /* 11 张，见 2.2 */ ],
    "scheme": "sinaweibo://cardlist?containerid=232544_-_index&luicode=10000011&lfid=232544_-_index&v_p=42&launchid=10000360-page_H5",
    "showAppTips": 0
  }
}
```

`data.scheme` 是服务端回显的 canonical deeplink，里面的 `containerid` 与请求一致，可用来确认「这个容器就是微博回忆」。

### 2.2 卡片结构

外层统一是 `card_type: 11` 的容器卡，真实内容在 `card_group` 里：

| `card_type` | 含义 | 关键字段 |
|---|---|---|
| `11` | 容器卡（每条回忆一个外层卡） | `card_group[]` |
| `22` | 顶部年度 banner（仅第一张） | `pic`、`width`、`height`、`actionlog` |
| `101` | 年份分隔头 | `title`（`一年前` / `两年前` / `三年前`）、`sub_title`（`2025年10月22日`）、`title_is_bold` |
| `9` | 微博本体 | `itemid`、`mblog`、`scheme`、`show_type`、`hidebtns` |
| `6` | 「分享回忆」按钮 | `desc: "分享回忆"`、`scheme`（App 转发 deeplink）、`actionlog` |

结构示例（去掉真实正文）：

```jsonc
{
  "card_type": 11,
  "show_type": 0,
  "openurl": "",
  "card_group": [
    { "card_type": 101, "title": "两年前", "sub_title": "2024年10月22日", "title_is_bold": 1 },
    {
      "card_type": 9,
      "itemid": "<itemid>",
      "show_type": 0,
      "hidebtns": [],
      "scheme": "https://m.weibo.cn/status/<mid>?mblogid=<mid>&launchid=10000360-page_H5",
      "mblog": { "id": "<mid>", "mid": "<mid>", "bid": "<mblogid>", "text": "<TEXT>", "created_at": "<DATE>", "user": { "id": "<uid>" } }
    },
    {
      "card_type": 6,
      "desc": "分享回忆",
      "scheme": "https://m.weibo.cn/feature/applink?scheme=sinaweibo%3A%2F%2Frepost%3Fsrcid%3D<mid>...",
      "actionlog": { "act_code": "5980", "uicode": "10001268" }
    }
  ]
}
```

**组织规律**：

- 第 1 张是年度 banner；之后的每一张外层卡对应**一条**微博。
- 年份分隔头 `101` 只出现在该年份的**第一条**微博卡里；同一年后续微博卡不再重复 `101`。
- 本次样本：`一年前` 2 条、`两年前` 2 条、`三年前` 6 条，共 10 条微博 + 1 张 banner = 11 张卡。
- **顺序不可靠**：同一年内既不严格按 mid 降序，也不严格按 `created_at` 倒序（2023 年样本顺序为 22:04、20:17、16:39、19:17、16:44、16:42）。需要时间序就必须自己按 `mblog.created_at` 排序。

### 2.3 banner 的 `actionlog`

```jsonc
{
  "act_code": "5980",
  "cardid": "232544<uid>_-_ANNUAL_BANNER",
  "ext": "",
  "fid": "232544_-_index",
  "oid": "232544",
  "uicode": "10001268"
}
```

`cardid` = `232544` + 当前 uid + `_-_ANNUAL_BANNER`，是「`232544` 为产品级 ID、uid 由服务端拼接」的直接证据。

### 2.4 mblog 字段

`mblog` 是完整的 m 站微博对象，本次样本的顶层字段：

```text
visible, created_at, id, mid, can_edit, text, textLength, source, favorited,
pic_ids, thumbnail_pic, bmiddle_pic, original_pic, is_paid, mblog_vip_type,
user, reposts_count, comments_count, reprint_cmt_count, attitudes_count,
mixed_count, favorites_count, pending_approval_count, isLongText, show_mlevel,
darwin_tags, ad_marked, mblogtype, item_category, number_display_strategy,
content_auth, ask_zhisou, is_show_mixed, safe_tags, comment_manage_info,
pic_num, mlevel, region_name, region_opt, detail_bottom_bar, raw_text, pics, bid
```

要点：

- **没有 `mblogid` 字段**，但有 `bid`；`bid` 就是网页端的字母 mblogid，与 `midToMblogId(mid)` 结果一致（沿用已登记示例：`5039815108333719 ↔ OgHLUyXYP`）。
- `id` 与 `mid` 都是数字串，`created_at` 是 `"Wed Oct 22 17:52:46 +0800 2025"` 形态。
- `isLongText` 可能为 `true`；`text` 是 HTML（含 `<br />`），同时有 `raw_text`。
- **转发微博会出现** `retweeted_status`（本次样本 10 条里有 4 条）。
- `pics[]` 字段：`pid` / `url` / `size` / `geo` / `large`；视频等字段本次样本未出现，按完整 mblog 处理即可。
- `visible.type = 0` 表示公开；私密 / 好友圈可见性会影响「分享回忆」按钮是否出现（见微博客服说明），但接口本身仍会返回该微博。

---

## 3. 参数矩阵实测

### 3.1 containerid

| 请求 | HTTP | `ok` | cards | `title_top` | 说明 |
|---|---|---|---|---|---|
| `232544` | 200 | 1 | 11 | 微博回忆 | **最小可用形态** |
| `232544_-_index` | 200 | 1 | 11 | 微博回忆 | 页面 URL 使用的形态 |
| `232544_-_annual` | 200 | 1 | 11 | 微博回忆 | 后缀被忽略 |
| `232544_-_index_<uid>` | 200 | 1 | 11 | 微博回忆 | 后缀仍被忽略 |
| `232544_<uid>_-_index` | 200 | 0 | 0 | — | 拼接 uid 不成立 |
| `232545` | 200 | 0 | 0 | — | 不存在的容器 |

> 解析规律：只认前导数字 `232544`；`_-_` 之后的字符串不影响结果。

### 3.2 分页 / 日期 / 账号参数

以下参数逐个与 `containerid=232544` 组合，响应完全一致（`ok:1`、11 张卡、年份头仍是 2025 / 2024 / 2023）：

```text
page=1 | page=2 | page=3 | page=99
since_id=0
count=50
date=2024-10-22 | date=1022 | day=1022 | ymd=20241022
month=10&day=22
starttime=1729526400
uid=1234567890
luicode=10000011&lfid=231522type%3D1
```

结论：

- **分页不存在**：不要为它实现 `page` / `hasMore`。
- **不能查历史某天**：`date` 类参数一律忽略，窗口固定为服务器当天。
- **不能查别人**：`uid` 被忽略，始终返回当前登录账号的回忆。

---

## 4. 鉴权与错误形态

| 身份 / 条件 | HTTP | 响应 | 解释 |
|---|---|---|---|
| 浏览器已登录 Cookie（页面内 fetch） | 200 | `ok:1` + 11 张卡 | 正常 |
| `.env` Cookie + m 站 UA / Referer（Node） | 200 | `ok:1` + 11 张卡 | 可离线脚本复现 |
| 访客 token（SDK `GuestTokenService`） | 200 | `{"ok":0,"msg":"这里还没有内容","data":{"cards":[]}}` | **假空**，不是真实结果 |
| 完全无 Cookie（`credentials:'omit'`） | 432 | 空 body | 风控 / 未登录拦截 |
| 正常账号但当天无回忆 | 200 | 预期同样是 `ok:0` + 空 `cards` | 需作为空结果处理，不是错误 |
| 不存在的 containerid（如 `232545`） | 200 | `ok:0` + 空 `cards` | 与「真实空」不可区分 |

因此接入时：

1. 端点必须声明 `auth: 'cookie'`，guest 模式在发请求前就拒绝（`AUTH_SESSION_EXPIRED`，`context.requiredAuth = 'cookie'`），不能让调用方拿到「假空」。
2. `ok:0` + `msg` 属于已知空文案 + `cards: []` 时按**空结果**返回；其它 `ok !== 1` 仍按 `BusinessError`。
3. 现有 `isEmptyMobileContainer()` 的已知文案集合已经包含「这里还没有内容」，可以直接复用。

---

## 5. `containerid` 是固定的还是能发现的

**结论：固定值 `232544`，但服务端没有发现接口；入口信息只存在于客户端。**

### 5.1 不是按 uid 生成

- `232544` 只有 6 位；m 站其它用户级容器都是「前缀 + uid」（如 `107603<uid>`、`230869<uid>`），而这里请求不带 uid、带 uid 参数也被忽略。
- `actionlog.cardid = "232544<uid>_-_ANNUAL_BANNER"`：uid 是服务端在响应里拼进去的。
- 换 `containerid=232544_<uid>_...` 反而返回空，进一步证明 uid 不参与容器 ID。

### 5.2 不在 H5 前端代码里

- 页面 HTML 中没有 `232544`，也没有「回忆」字样（SSR 只渲染骨架）。
- 逐一检索本次加载的 `app.*.js`、`page.*.js`、`chunk-*`、`collect-main-page-*` bundle，均没有 `232544` / 「回忆」。
- 说明前端只是读取 `location` 里的 `containerid`，**没有内置常量**。

### 5.3 个人页容器里的 `232544` 是 Referer 污染

在从回忆页发起的个人页请求里，`data.scheme` 曾出现：

```text
sinaweibo://userinfo?uid=<uid>&luicode=10000011&lfid=232544_-_index&...
```

但显式把 `lfid` 改成个人页自己的 containerid 后，`232544` 立即消失。这是服务端按 Referer 回显 `lfid`，**不是入口发现来源**。

### 5.4 可靠的可发现信号

一旦拿到页面 URL / 请求，服务端会把 canonical deeplink 放进 `data.scheme`：

```text
sinaweibo://cardlist?containerid=232544_-_index&luicode=10000011&lfid=232544_-_index&v_p=42&...
```

可以用它做「这个容器是不是微博回忆」的自校验，但**无法用它反推出 ID**。

### 5.5 入口位置（外部资料）

微博客服说明：入口是 **App「我」页面 → 微博 → 那年今日卡片**；部分可见性设置会隐藏「分享回忆」按钮。PC 网页没有等价入口。

- <https://kefu.weibo.com/faqdetail?id=21479>
- <https://weibo.com/2016713117/NpaW5tMUa?mod=weibotime>

### 5.6 对 SDK 的含义

- `232544` 必须作为**常量**写进 endpoint spec（推荐命名 `USER_MEMORIES_CONTAINER_ID`）。
- 不要尝试「先查个人页 / 导航配置拿容器 ID」；实测没有下发。
- 如果上游将来改 ID，表现为 `ok:0` + 空 `cards`（而不是 4xx），需要靠 E2E / 监控发现。建议在 service 层对「已知 ID 返回空」发 `normalize_done` 宽事件（`item_count: 0`），便于观察长期空结果。

---

## 6. 实施计划（暂缓，按需拾起）

### 6.1 决策与范围

**状态：2026-10-22 调研完成，暂不实施。**

暂缓原因：

- 能力面很窄：只有一页、最多 3 年、不能指定日期、只能看登录账号自己。
- 与现有能力重叠：需要按日期回溯时，`tweets.searchByDate`（`searchProfile`）能覆盖任意日期区间；「回忆」更像展示层聚合，不是归档缺口。
- 维护成本不低：多一个 m 站端点、一套卡片协议和年份分组，收益主要是「今天这一天的历史微博」。

保留本次调研的全部协议与设计，后续有需求时按本节直接实现。**非目标**：翻页、任意日期、查看他人回忆、任何写操作。

### 6.2 接口协议（实现时以此为准）

```http
GET https://m.weibo.cn/api/container/getIndex?containerid=232544 HTTP/2
Cookie: <登录 Cookie>
User-Agent: <移动端 iPhone UA>
Referer: https://m.weibo.cn/
X-Requested-With: XMLHttpRequest
```

| 项 | 约定 |
|---|---|
| 容器 ID | 固定 `232544`；`_-_<suffix>` 可选且被忽略 |
| 参数 | 无业务参数；`page` / `since_id` / `count` / `date` / `uid` 均被上游忽略，不要发送 |
| 账号范围 | 始终是 Cookie 对应账号；`accountScoped: true` |
| 时间窗口 | 服务器当天（`+0800`）往前 1–3 年 |
| 成功 | `HTTP 200` + `ok: 1` + `data.cards[]` |
| 空结果 | `HTTP 200` + `ok: 0` + `msg` ∈ 已知空文案 + `data.cards: []` |
| 未登录 / 登录失效 | `ok: -100`；完全无 Cookie 时可能直接 `HTTP 432` 空 body |
| 鉴权声明 | `auth: 'cookie'`（不能用 guest，否则会拿到假空） |
| 分页 | 无；不要声明 `pagination: 'page'` |

响应不变量：

1. `data.cards[0]` 是 `card_type: 22` 的年度 banner（可能缺失，按可选处理）。
2. 年份头是 `card_type: 101`，`title` ∈ `一年前` / `两年前` / `三年前`，`sub_title` 是具体日期。
3. **年份头只出现在该年份的第一条微博卡里**；后续同年度卡片没有 `101`。
4. 微博是 `card_type: 9`，正文在 `card_group[].mblog`；`card_type: 6` 是「分享回忆」按钮，必须跳过。
5. 未知 `card_type` 一律跳过，不报错。
6. 同一年内顺序不保证时间序，必须自行排序。

### 6.3 类型契约（伪代码）

```ts
// src/types/domain/IUserMemories.ts
import type { Tweet } from '~/models/data/Tweet'

/** 一年的回忆分组。 */
export interface IUserMemoriesYear {
  /** 上游年份头 title：一年前 / 两年前 / 三年前 */
  label: string
  /** 上游年份头 sub_title：2025年10月22日 */
  date: string
  /** 按 createdAt 倒序 */
  tweets: Tweet[]
}

/** `sdk.memories.list()` 的返回。 */
export interface IUserMemories {
  /** 服务端当天（从年份头 sub_title 解析）；没有任何年份头时为 undefined */
  date?: string
  /** 从新到旧；当前最多 3 组，但不假设一定有 3 组 */
  years: IUserMemoriesYear[]
  /** 上游明确返回空结果时为 true（不是鉴权失败） */
  isEmpty: boolean
}
```

资源类型：

```ts
// src/types/resources.ts
export interface ResourceMap {
  // ...
  USER_MEMORIES: MobileContainerResponse
}
```

### 6.4 Endpoint spec 伪代码

```ts
// src/services/endpoints/mobile.ts
export const USER_MEMORIES_CONTAINER_ID = '232544'

export const userMemoriesSpec: EndpointSpec<'USER_MEMORIES', typeof UserMemoriesArgsSchema> = defineEndpoint({
  resourceType: 'USER_MEMORIES',
  endpoint: 'api/container/getIndex',
  argsSchema: z.object({}).strict(), // 无参数：窗口固定，账号来自 Cookie
  buildResource: () => ({
    method: 'GET',
    url: `https://m.weibo.cn/api/container/getIndex?containerid=${USER_MEMORIES_CONTAINER_ID}`,
    headers: {
      'referer': 'https://m.weibo.cn/',
      'user-agent': MOBILE_USER_AGENT,
    },
  }),
  auth: 'cookie', // 关键：不能复用 auth: 'guest' 的 mobileContainerSpec
  okPolicy: {
    mode: 'require_ok_1',
    isEmptyResult: ({ raw }) => isEmptyMobileContainer(raw),
  },
  schema: MobileContainerResponseSchema, // 当前未导出，需要 export
})
```

### 6.5 归一化伪代码

先做一个小重构（行为不变）：把 `extractMobileMblogs()` 里「补齐 mblogid」的逻辑抽成单卡纯函数，供两处复用。

```ts
// src/services/endpoints/mobile.ts
export function normalizeMobileCard(card: MobileCard): Record<string, unknown> | undefined {
  const mblog = card.mblog
  if (!mblog)
    return undefined

  const existing = readId(mblog.mblogid)
  const id = existing ?? readId(mblog.mid) ?? readId(mblog.id)
  if (id === undefined)
    return undefined

  const mblogid = existing ?? readId(mblog.bid) ?? midToMblogId(id)
  if (mblogid === '')
    return undefined

  return existing === undefined ? { ...mblog, mblogid } : mblog
}
```

> 现状 `extractMobileMblogs()` 用 `midToMblogId(mid)`；实测 `mblog.bid` 与之一致，优先用 `bid` 更稳（不依赖换算算法）。

年份分组（纯函数，放 `src/models/data/UserMemories.ts`）：

```ts
export function groupMemoriesByYear(raw: MobileContainerResponse): IUserMemoriesYear[] {
  const years: IUserMemoriesYear[] = []
  let current: IUserMemoriesYear | undefined

  for (const card of raw.data.cards) {
    for (const child of card.card_group ?? []) {
      if (child.card_type === 101) {
        current = {
          label: child.title ?? '',
          date: child.sub_title ?? '',
          tweets: [],
        }
        years.push(current)
        continue
      }

      if (child.card_type !== 9)
        continue

      const mblog = normalizeMobileCard(child)
      if (mblog === undefined || !isRawTweet(mblog))
        continue

      // 防御：没有年份头时归入空标签组，不丢数据
      if (current === undefined) {
        current = { label: '', date: '', tweets: [] }
        years.push(current)
      }
      current.tweets.push(new Tweet(mblog))
    }
  }

  for (const year of years)
    year.tweets.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))

  return years
}
```

### 6.6 Service 伪代码

```ts
// src/services/public/MemoriesService.ts
export class MemoriesService extends FetcherService {
  /**
   * 读取当前登录账号的「微博回忆」。
   *
   * 无参数：日期窗口固定为服务器当天，账号由 Cookie 决定。
   * @throws AUTH_SESSION_EXPIRED Cookie 缺失 / 失效（requiredAuth: 'cookie'）
   * @throws API_NOT_OK 上游返回未知失败
   */
  public async list(): Promise<IUserMemories> {
    const startedAt = Date.now()
    const raw = await this.request(userMemoriesSpec, {})
    const years = groupMemoriesByYear(raw)

    await this.emitTelemetry({
      event_name: 'normalize_done',
      timestamp: Date.now(),
      trace_id: this.newTraceId(),
      model: 'Tweet',
      count: years.reduce((sum, year) => sum + year.tweets.length, 0),
      duration_ms: Date.now() - startedAt,
    })

    return {
      date: years[0]?.date,
      years,
      isEmpty: years.length === 0,
    }
  }
}
```

> `FetcherService.request()` 目前只接受 `{ skipPreflight }`，不接受 `AbortSignal`；如果以后需要中断，按 `UserArchiveService` 的做法在调用前后检查 `signal.aborted`，不要伪造第三个参数。

门面：

```ts
// src/WeiboSDK.ts
/** 微博回忆服务（那年今日，仅当前登录账号）。 */
public readonly memories: MemoriesService

// constructor(deps) 内：
this.memories = new MemoriesService(this.config, deps)
```

### 6.7 CLI 伪代码

```ts
// src/cli/commands/memories.ts
export const memories = defineCommand({
  meta: {
    name: 'memories',
    description: '微博回忆（那年今日，仅当前登录账号）',
  },
  args: {
    ...outputFormatArg,
    ...cookieArg,
  },
  async run({ args }) {
    const sdk = await createSDK(args)
    const data = await sdk.memories.list()
    print(JSON.stringify(data, null, 2)) // 默认 JSON；markdown 为可选阅读视图
  },
})
```

输出契约：

```jsonc
{
  "date": "2025年10月22日",
  "isEmpty": false,
  "years": [
    {
      "label": "一年前",
      "date": "2025年10月22日",
      "tweets": [ /* ITweet */ ]
    }
  ]
}
```

`--guest`：在发请求前由 `auth: 'cookie'` 拦截，CLI 输出 `AUTH_SESSION_EXPIRED` 到 stderr，退出码非 0，提示 `context.requiredAuth = 'cookie'`。

### 6.8 capabilities 条目

```ts
{
  id: 'tweets.memories',
  service: 'memories',
  methods: ['list'],
  description: '微博回忆（那年今日）',
  auth: 'cookie',
  accountScoped: true,
  pagination: 'none',
  status: 'stable',
  cli: 'weibo-cli memories',
  note: '仅当前登录账号；固定服务器当天往前 3 年，单页，无日期参数',
}
```

### 6.9 测试与 fixture 清单

| 层级 | 覆盖 |
|---|---|
| Fixture safeParse | 正常响应（banner + 3 个年份头 + 转发 / 图片）× response schema |
| Fixture safeParse | 空响应 `{ok:0,msg:"这里还没有内容",data:{cards:[]}}` |
| Unit | 年份分组：`101` 只出现在组首、banner / `card_type 6` 被跳过、未知类型跳过、组内按时间倒序 |
| Unit | `normalizeMobileCard`：优先 `bid`、缺 `bid` 时回退 `midToMblogId`、非法 id 返回 `undefined` |
| Unit | URL 构造只含 `containerid=232544`，不包含 `page` / `date` |
| Component | fakeAxios：URL / headers / `auth: 'cookie'`；`ok:0` 空结果不抛错；`ok:-100` → `AUTH_SESSION_EXPIRED`；telemetry 的 `item_count` / `year_count` |
| E2E | 真实 Cookie + 外网（默认跳过）：`ok:1`、至少一个年份头 |

Fixture 待办：

1. 抓正常页 + 空页（空页优先找「当天无回忆」的真实账号）。
2. `scripts/sanitize-raw.mjs` 脱敏（uid / mid / 正文 / 日期）。
3. 在 `tests/fixtures/raw/INDEX.md` 与 `scripts/validate-fixtures.ts` 的 `FIXTURE_RULES` 登记。
4. `pnpm run validate:fixtures` 通过后再写 schema/service/CLI。

### 6.10 实施顺序与提交拆分

| 步骤 | 内容 | 建议 commit |
|---|---|---|
| 1 | 抓 fixture、脱敏、登记 INDEX / FIXTURE_RULES | `test(fixtures): add weibo memories samples` |
| 2 | 导出 `MobileContainerResponseSchema`、抽取 `normalizeMobileCard`（行为不变） | `refactor(endpoints): extract mobile card normalization` |
| 3 | 新增 `userMemoriesSpec` + resource type + schema 测试 | `feat(endpoints): add user memories spec` |
| 4 | `groupMemoriesByYear` + 单测 | `feat(models): group memories by year` |
| 5 | `MemoriesService` + `WeiboSDK.memories` + component 测试 | `feat(sdk): add memories service` |
| 6 | `weibo-cli memories` + CLI 测试 | `feat(cli): add memories command` |
| 7 | `capabilities` + 文档 + CHANGELOG | `docs: document memories capability` |

### 6.11 重新拾起的触发条件

- 下游明确需要「那年今日」展示或归档 `source: 'memory'`。
- 微博放开更多年份 / 分页 / 指定日期，能力价值明显上升。
- 需要把「回忆」作为 Agent 上下文的一类来源时。

---

---

## 7. 未确认项与风险

1. **空回忆的真实形态**：本次账号有数据，未能直接观察到 `.env` 账号的「当天无回忆」响应；预期与访客一致（`ok:0` + 空 `cards`），实现前应补一份真实空样本。
2. **年份上限**：实测只有最近 3 年（不含当前年），但无法确认这是产品固定上限还是当前账号数据造成；建议按「最多 3 个年份头」实现，不假设一定有 3 个。
3. **时区**：窗口按服务器日期（`+0800`），本地时区不同时「今天」可能差一天；不要用客户端日期反推 `date` 参数。
4. **可见性过滤**：仅自己 / 好友圈 / 粉丝可见的微博仍会返回；「分享回忆」按钮可能被隐藏，但接口数据不受影响。
5. **风控**：m 站无 Cookie 请求返回 432；登录态也会偶发 `ok:-100`。不要循环轰炸，错误按结构化错误处理。
6. **卡片协议漂移**：`card_type` 属于上游内部协议；新增类型时应跳过而不是报错。归一化只依赖 `101` / `9`。
7. **响应体积**：10 条微博约 62 KB，含完整 user / pics；不需要的字段不要全部透传给下游。

---

## 8. 参考

- 抓包工具与通道选型：[opencli-browser-bridge.md](../engineering/opencli-browser-bridge.md)
- 端点开发流程：[endpoint-authoring.md](../engineering/endpoint-authoring.md)
- 现有 m 站容器实现：`src/services/endpoints/mobile.ts`（`mobileContainerSpec` / `extractMobileMblogs` / `isEmptyMobileContainer`）
- 访客 token 行为：[research-guest-mode-2026-10-20.md](./research-guest-mode-2026-10-20.md)
- 微博客服「那年今日」入口说明：<https://kefu.weibo.com/faqdetail?id=21479>
