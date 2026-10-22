---
title: 范围与限制
---

# 范围与限制

## 只读

SDK 只读取公开数据与归档，不提供发帖、点赞、转发、评论、关注等写操作。私信、仅粉丝可见和付费内容不在范围内。

## 访客模式

没有 Cookie 时自动使用访客身份。访客能读：

- 用户资料、单条微博、长文、评论、转发、点赞者；
- 图片墙、视频、相册、超话、热搜。

只有第一页：

- 用户时间线、点赞、关注、粉丝（结果带 `partial: true`，`next_cursor: 0`）。

需要 Cookie：

- 首页关注时间线、日期搜索、收藏、通知、@ 我、历史评论、微博分组；
- 归档（访客调用会报 `CONFIG_INVALID`，因为匿名列表只有第一页）。

访客能力在调用前就会检查：只能 Cookie 的能力返回 `AUTH_SESSION_EXPIRED`，并在 `context.requiredAuth` 标注 `'cookie'`。

## 账号级数据

`favorites`、`commentHistory`、`notifications`、`myDetails`、`myFollowings` 只返回 Cookie 对应账号的数据。传其他 uid 不会改变结果。

## 已知上游问题

| 能力 | 状态 | 说明 |
|---|---|---|
| `search.searchUsers` / `search.searchTweets` | unavailable | 公开关键词搜索接口失效，产品暂缓；调用会抛 `API_BAD_RESPONSE` |
| `tweets.likers` | degraded | 网页端 `likeShow` 返回空数组，SDK 改用 `m.weibo.cn/api/attitudes/show`；入参需数字 mid（传 mblogId / URL 会自动解析） |
| 首页 Feed 的 `total_number` | — | 约 2000 的上限值，不代表剩余条数 |
| 评论顶层 `total_number` | — | 包含楼中楼和不可见评论，不能作为停止条件 |
| 媒体 URL | — | 短期签名，约一小时后失效；归档时及时下载 |

## 合规

- 只使用自己的账号 Cookie，或访客身份读取公开数据。
- 遵守微博服务条款、限流规则和隐私政策。
- 不要提交真实 Cookie 或未脱敏的个人数据。
