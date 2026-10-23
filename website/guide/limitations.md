---
title: 范围与限制
---

# 范围与限制

## 只读

SDK 读取公开数据和归档，覆盖用户资料、微博、评论、转发、媒体、热搜、超话与通知。发帖、点赞、转发、评论、关注等写操作在范围外；私信、仅粉丝可见和付费内容也在范围外。

## 访客模式

没有 Cookie 时使用访客身份。访客可读：

- 用户资料、单条微博、长文、评论、转发、点赞者；
- 图片墙、视频、相册、超话、热搜。

访客只能读取第一页：

- 用户时间线、点赞、关注、粉丝；结果带 `partial: true`，关注 / 粉丝的 `cursor` 为 `0`。

以下能力需要 Cookie：

- 首页关注时间线、日期搜索、收藏、通知、@ 我、历史评论、微博分组；
- 归档。访客调用返回 `CONFIG_INVALID`，归档需要完整时间线。

需要 Cookie 的能力在发出请求前就会检查。访客调用时返回 `AUTH_SESSION_EXPIRED`，`context.requiredAuth` 为 `'cookie'`。

## 账号级数据

`favorites`、`commentHistory`、`notifications`、`myDetails`、`myFollowings` 读取 Cookie 对应账号的数据，结果始终属于该账号。

## 已知上游问题

| 能力 | 状态 | 说明 |
|---|---|---|
| `search.searchUsers` / `search.searchTweets` | 不可用 | 公开关键词搜索接口已失效，调用返回 `API_BAD_RESPONSE` |
| `tweets.likers` | 受限 | 网页端 `likeShow` 返回空数组，SDK 改用 `m.weibo.cn/api/attitudes/show`，入参需要数字 mid（传 mblogId / URL 时自动解析） |
| 首页 Feed 的 `total_number` | — | 约 2000 的上限值，不代表剩余条数 |
| 评论顶层 `total_number` | — | 包含楼中楼和不可见评论，按游标判断结束 |
| 媒体 URL | — | 短期签名地址，约一小时后失效，归档时及时下载 |

## 合规

- 使用自己的账号 Cookie，或以访客身份读取公开数据。
- 遵守微博服务条款、限流规则和隐私政策。
- 提交问题或分享归档前，移除真实 Cookie 和未脱敏的个人数据。
