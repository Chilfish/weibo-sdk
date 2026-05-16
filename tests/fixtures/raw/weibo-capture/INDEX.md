# 抓包数据索引

> 来源：浏览器 DevTools 抓包，覆盖"首页 Feed → 微博详情页 → 个人主页"流程
> 抓取时间：2026-05-16
> 原始 47 个请求/响应对，筛选保留 12 个有价值的 API 响应
> 搜索流程（2026-05-16 补充）：2 对 m.weibo.cn 搜索 API

## 端点列表

| 端点 | 文件 | 大小 | 状态 | 说明 |
|------|------|------|------|------|
| `GET /ajax/statuses/show` | `statuses_show_QFekiwGId.json` | 6.2K | 已有实现 | 单条微博详情，含完整 user、pic_infos、tag_struct 字段 |
| `GET /ajax/statuses/buildComments` | `buildComments_5298265227790685.json` | 225.9K | 新发现 | 微博评论列表，含 filter_group（热度/时间排序）、data 数组含完整用户信息 |
| `GET /ajax/feed/friendstimeline` | `friendstimeline_home.json` | 359.2K | 新发现 | 首页 Feed 时间线，返回 statuses 数组 + since_id 分页 |
| `GET /ajax/profile/info` | `profile_info_2365795232.json` | 2.4K | 已有实现 | 用户基本信息，含 user 对象 + tabList |
| `GET /ajax/profile/detail` | `profile_detail_2365795232.json` | 978B | 已有实现 | 用户详细信息（教育/信用/生日等） |
| `GET /ajax/statuses/mymblog` | `mymblog_2365795232.json` | 561.9K | 已有实现 | 用户微博列表，返回 data.list 数组 + since_id 分页 |
| `GET /ajax/profile/sidedetail` | `profile_sidedetail_2365795232.json` | 100.3K | 新发现 | 个人主页侧边栏，含粉丝群信息、推荐关注用户 |
| `GET /ajax/statuses/config` | `statuses_config.json` | 58.1K | 新发现 | 微博配置数据，含全部表情列表（PC 热门表情/绿植/掌宝等 16 组） |
| `GET /ajax/side/bandUnified` | `side_bandUnified_hot.json` | 35.0K | 新发现 | 热搜榜单，含 50 条实时热搜 + 置顶时政词条 |
| `GET /ajax/side/cards` | `side_cards_detail.json` | 650B | 新发现 | 详情页侧边栏卡片（profile / scheme / hotSearch 三类卡片） |
| `GET /ajax/statuses/checkReward` | `statuses_checkReward.json` | 4.8K | 新发现 | 打赏状态查询，含 reward_button_scheme 等字段 |
| `GET /ajax/feed/allGroups` | `feed_allGroups.json` | 33.2K | 新发现 | 用户所有 Feed 分组/频道列表，含默认分组、订阅分组、频道推荐 |
| `GET m.weibo.cn/api/container/getIndex` (type=3) | `search_users_page2.json` | 12.1K | ✅ 已修复 | 搜索用户（m.weibo.cn），含 cards/card_group 结构，cardlistInfo 分页 |
| `GET m.weibo.cn/api/container/getIndex` (type=3, page=3) | `search_users_page3.json` | 11.4K | ✅ 已修复 | 搜索用户第 3 页 |

## 搜索 API 特殊说明

**host 更换**：搜索 API 使用 `m.weibo.cn`（移动端），而非 `weibo.com`（桌面端）。

**containerid 格式**：`100103type={type}&q={query}&t=`（需 URL 编码嵌套在查询参数中）
- `type=3` → 用户搜索
- `type=1` → 微博搜索

**响应结构**：`{ ok, data: { cards: [{ card_type, card_group: [{ user }] }], cardlistInfo: { page, total } } }`
- `card_type=11` → 用户卡片
- 分页通过 `page` 参数 + `cardlistInfo.total`

## 已有端点的参数差异

对比抓包请求参数与现有代码实现的差异：

| 端点 | 抓包实际参数 | 现有 Spec 参数 | 差异 |
|------|-------------|---------------|------|
| `statuses/show` | `id=QFekiwGId&locale=en-US&isGetLongText=true` | `id` + `isGetLongText` | 缺少 `locale` 参数（可能不重要，浏览器默认行为） |
| `statuses/mymblog` | `uid=2365795232&page=1&feature=0` | `uid` + `since_id?` + `count?` | 抓包使用 `page` 分页，而非 `since_id`；另含 `feature=0` 参数 |
| `profile/info` | `uid=2365795232&scene=profile` | `uid` | 缺少 `scene` 参数 |
| `profile/detail` | `uid=2365795232` | `uid` | 完全匹配 |

## 新发现的高价值端点

### 1. `GET /ajax/feed/friendstimeline`（最高优先级）
首页核心 Feed 接口。返回 `statuses` 数组（每条结构与 `statuses/show` 类似），以及 `since_id` 用于分页。抓包参数包含 `list_id`、`refresh`、`since_id`、`count`。这是实现"首页刷微博"功能必须的端点。

### 2. `GET /ajax/statuses/buildComments`
微博评论接口。返回 `filter_group`（按热度/时间排序）、`data` 数组（评论条目包含完整用户信息、楼层回复等），以及 `max_id` 用于分页。抓包参数含 `id`、`is_reload`、`is_show_bulletin`、`is_mix`、`count`、`uid`、`fetch_level`。

### 3. `GET /ajax/side/bandUnified?type=hot`
热搜榜单接口。返回 50 条实时热搜词条，每条包含 `word`、`num`（搜索热度）、`label_name`（新/热/沸标签）、`icon_desc`、`flag` 等字段。另有置顶时政词条 `hotgovs`。

### 4. `GET /ajax/profile/sidedetail`
个人主页侧边栏信息。包含粉丝群信息（`fansgroup`）、推荐关注用户列表（`recom.recomm_users`，含完整 user 对象 + 推荐原因）、服务入口等。

### 5. `GET /ajax/feed/allGroups`
用户 Feed 频道/分组列表。返回所有分组树结构（默认分组、我的分组、订阅分组、我的频道、频道推荐），以及 `total_number`、`fetch_hot` 等信息。对实现频道切换功能有参考价值。

## 低价值已丢弃的端点

从 47 个原始请求/响应对中筛选后丢弃了约 35 个，主要属于以下类型：

| 类型 | 端点示例 | 数量 |
|------|---------|------|
| **日志/追踪** | `POST /ajax/log/read`、`GET /ajax/log/action`、`POST /ajax/log/rum`、`GET /ajax/log/detectVideoCodecSupport` | ~12 |
| **推送通知** | `GET /2/remind/push_count.json`（rm.api.weibo.com x2 + api.weibo.com x1） | ~3 |
| **广告** | `GET /ajax/feed/getTipsAd?posid=pc_login_banner_top/right`、侧边栏推荐广告 | ~4 |
| **UI 配置** | `GET /ajax/config/get_config`、`GET /ajax/getNavConfig`、`GET /ajax/common/getCopyright` | ~3 |
| **低价值侧边栏** | `GET /ajax/side/cards/sideInterested`、`GET /ajax/side/cards/sideUser`、`GET /ajax/side/cards`（无参数） | ~3 |
| **其他** | `GET /mygroups`、`GET /ajax/message/unreadHint`、`GET /ajax/statuses/checkAllowCommentWithPic` | ~3 |
| **重复/同序列** | 同一端点的多次请求（如 bandUnified 两次、allGroups 两次） | ~7 |
