---
title: 实验性原始类型
outline: deep
---

# 实验性原始类型

以下导出是上游响应的 `z.infer` 形状（snake_case），随微博接口漂移，**不承诺字段稳定**：

- 仍可直接使用，适合排障、落盘 raw 或写一次性脚本；
- 不要把它们当作长期契约；需要稳定字段时使用对应的归一化方法。

## 响应类型

| 类型 | 对应端点 |
|---|---|
| `MyMblogResponse` | `ajax/statuses/mymblog` |
| `StatusShowResponse` | `ajax/statuses/show` |
| `UserInfoResponse` / `UserDetailsResponse` | `ajax/profile/info` / `ajax/profile/detail` |
| `BuildCommentsResponse` | `ajax/statuses/buildComments` |
| `RepostTimelineResponse` | `ajax/statuses/repostTimeline` |
| `LongtextResponse` | `ajax/statuses/longtext` |
| `SearchProfileResponse` | `ajax/statuses/searchProfile` |
| `FriendstimelineResponse` | `ajax/feed/friendstimeline` |
| `FavoritesResponse` / `FavoritesTagsResponse` | `ajax/statuses/favorites` / 标签 |
| `LikeListResponse` / `LikeItem` | `ajax/statuses/likelist` |
| `LikersResponse` | `m.weibo.cn/api/attitudes/show` |
| `MyCommentsResponse` / `MyCommentItem` | `ajax/statuses/myCmt` |
| `MessageCommentsResponse` / `MessageAttitudesResponse` / `AttitudeItem` | 通知 |
| `ImageWallResponse` / `WaterfallResponse` / `AlbumDetailResponse` | 媒体集合 |
| `FriendshipsResponse` / `FollowContentResponse` | 关注 / 粉丝 |
| `FeedGroupsResponse` / `MblogGroupsResponse` | 分组 |
| `MentionsViewResponse` | @ 我 |
| `SearchUsersResponse` / `SearchTweetsResponse` | 公开搜索（不可用） |
| `STopicCatesResponse` / `STopicListResponse` | 超话 |
| `BandUnifiedResponse` | 热搜 |
| `MobileCard` / `MobileCardPic` / `MobileContainerResponse` | m 站容器 |

## 实验性方法选项

| 类型 | 方法 |
|---|---|
| `TweetCommentsOptions` | `tweets.comments` |
| `TweetRepliesOptions` | `tweets.replies` |
| `TweetRepostsListOptions` | `tweets.getReposts` |
| `TweetSearchByDateOptions` | `tweets.searchByDate` |

## 辅助函数

| 函数 | 说明 |
|---|---|
| `normalizeTweet` / `normalizeComment` / `normalizeLiker` / `normalizeTweetUser` | 原始对象 → 领域模型 |
| `migrateTweetV1toV2` | 删除 v1 的 `textHtml`，递归处理转发 |
| `buildTweetContext` | 由已抓取的数据构造 `ITweetContext` |
| `renderTweetContextMarkdown` | 渲染 Markdown 卡片 |
| `diffSchemaDigest` / `formatSchemaDrift` | 对比两份 raw 结构快照 |
| `parseTweetIdInput` / `normalizeTweetIdInput` / `midToMblogId` | 微博 id 解析 |

完整名单与分类见 [导出索引](/api/types/)。
