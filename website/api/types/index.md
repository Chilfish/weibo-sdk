---
title: 导出索引
outline: deep
---

# 导出索引

包根共导出 253 个名称：Stable 167 / Evolving 86。本页由 `pnpm check:api --write` 生成；类型字段与签名以包内 `.d.mts` 为准。

Stable 是下游可以依赖的契约；Evolving 可以调用，但形状可能随 minor 版本演进，不属于破坏性承诺。

## Stable（167）

| 名称 | 种类 |
|---|---|
| `AlbumListResult` | interface |
| `AlbumPhotoPageResult` | interface |
| `ARCHIVE_SCHEMA_ID` | const |
| `ARCHIVE_SCHEMA_URL` | const |
| `ArchiveCheckpoint` | interface |
| `ArchivedTweet` | interface |
| `ArchiveFile` | interface |
| `ArchiveIssue` | interface |
| `ArchiveIssueStage` | type |
| `ArchiveItem` | interface |
| `ArchiveUserItem` | interface |
| `BeforeRetryResult` | interface |
| `CapabilityFilter` | interface |
| `CommentHistoryPageResult` | interface |
| `CommentNotification` | interface |
| `CommentNotificationPageResult` | interface |
| `ConnectionTimeoutError` | class |
| `createConsoleLogger` | function |
| `createJsonlLogger` | function |
| `createJsonlTelemetry` | function |
| `createLoggerPlugin` | function |
| `createMemoryUserArchiveStore` | function |
| `createMultiLogger` | function |
| `ErrorContext` | interface |
| `FavoritePageResult` | interface |
| `FavoriteTag` | interface |
| `FavoriteTagList` | interface |
| `FetchLike` | type |
| `FetchResponseLike` | interface |
| `fetchTransport` | function |
| `FollowingPageResult` | interface |
| `Gender` | enum |
| `ImageWallPageResult` | interface |
| `InvalidConfigError` | class |
| `IProxyProvider` | interface |
| `IProxyRequestContext` | interface |
| `ISelfProfile` | interface |
| `ITweet` | interface |
| `ITweetComment` | interface |
| `ITweetContext` | interface |
| `IUser` | interface |
| `IUserAlbum` | interface |
| `IUserLabel` | interface |
| `IUserMediaAsset` | interface |
| `IUserVerification` | interface |
| `IWeiboConfig` | interface |
| `IWeiboGuestConfig` | interface |
| `IWeiboRetryConfig` | interface |
| `JsonlLogger` | interface |
| `JsonlTelemetry` | interface |
| `LikeNotification` | interface |
| `LikeNotificationPageResult` | interface |
| `LikePageResult` | interface |
| `MblogGroup` | interface |
| `MediaDownloadError` | class |
| `MediaDownloadItem` | type |
| `MediaDownloadItemBase` | interface |
| `MediaDownloadTotals` | interface |
| `MediaInvalidResponseError` | class |
| `MediaItemErrorContext` | interface |
| `MediaSkipReason` | type |
| `MediaStorageError` | class |
| `MediaType` | enum |
| `MediaVariant` | type |
| `mergeArchiveFiles` | function |
| `MergeArchiveResult` | interface |
| `NetworkRequestError` | class |
| `RateLimitError` | class |
| `RequestContext` | type |
| `ResponseContext` | interface |
| `ResumeMismatchError` | class |
| `RetryContext` | interface |
| `SearchTweetPageResult` | interface |
| `SearchUserPageResult` | interface |
| `SuperTopic` | interface |
| `SuperTopicCategory` | interface |
| `SuperTopicPageResult` | interface |
| `TelemetryEvent` | type |
| `TelemetryEventBase` | interface |
| `TelemetryJsonlInput` | type |
| `TelemetryPrimitive` | type |
| `TransportMethod` | type |
| `TransportRequest` | interface |
| `TransportRequestMeta` | interface |
| `TransportResponse` | interface |
| `TrendItem` | interface |
| `TWEET_CONTRACT_VERSION` | const |
| `TweetArticleAttachment` | interface |
| `TweetAttachment` | type |
| `TweetAtUser` | interface |
| `TweetAudio` | interface |
| `TweetCommentPic` | interface |
| `TweetCommentsPageResult` | interface |
| `TweetContextAttachment` | interface |
| `TweetContextAttachmentKind` | type |
| `TweetContextAuthor` | interface |
| `TweetContextComment` | interface |
| `TweetContextFlags` | interface |
| `TweetContextKind` | type |
| `TweetContextLink` | interface |
| `TweetContextMedia` | interface |
| `TweetContextMediaDownload` | interface |
| `TweetContextMediaRelation` | type |
| `TweetContextPost` | interface |
| `TweetContextProvenance` | interface |
| `TweetContextRepostEntry` | interface |
| `TweetContextStats` | interface |
| `TweetContextVisibility` | type |
| `TweetContractVersion` | type |
| `TweetEnrichResult` | interface |
| `TweetGeo` | interface |
| `TweetLiker` | interface |
| `TweetLikersPageResult` | interface |
| `TweetLinkCard` | interface |
| `TweetLiveAttachment` | interface |
| `TweetLongText` | interface |
| `TweetLotteryAttachment` | interface |
| `TweetMedia` | interface |
| `TweetMediaDownloadResult` | interface |
| `TweetPageCard` | interface |
| `TweetPageResult` | interface |
| `TweetRepostEntry` | interface |
| `TweetRepostsPageResult` | interface |
| `TweetSearchByDatePageResult` | interface |
| `TweetUser` | interface |
| `TweetVisible` | enum |
| `TweetVoteAttachment` | interface |
| `TweetVoteOption` | interface |
| `UnexpectedAPIResponseError` | class |
| `USER_ARCHIVE_JOURNAL_SCHEMA` | const |
| `UserArchiveMeta` | interface |
| `UserArchiveRecord` | interface |
| `UserArchiveResult` | interface |
| `UserArchiveRunConfig` | interface |
| `UserArchiveSlice` | interface |
| `UserArchiveSliceState` | interface |
| `UserArchiveStore` | interface |
| `UserArchiveSummary` | interface |
| `UserBrief` | interface |
| `UserGroup` | interface |
| `UserMentionsPageResult` | interface |
| `VerificationType` | enum |
| `VERSION` | const |
| `VideoWaterfallPageResult` | interface |
| `WeiboAPINotOkError` | class |
| `WeiboAuthMode` | type |
| `WeiboCapability` | interface |
| `WeiboEvent` | type |
| `WeiboLogger` | interface |
| `WeiboLogLevel` | type |
| `WeiboLogRecord` | interface |
| `WeiboPlugin` | interface |
| `WeiboProxyInput` | type |
| `WeiboRetryKind` | type |
| `WeiboSDK` | class |
| `WeiboSDKError` | class |
| `WeiboSDKErrorMeta` | interface |
| `WeiboSDKHookBaseMeta` | interface |
| `WeiboSDKHooks` | interface |
| `WeiboSDKLifecycleEvent` | type |
| `WeiboSDKRawMeta` | interface |
| `WeiboSDKRequestMeta` | interface |
| `WeiboSDKSelfCheckMode` | type |
| `WeiboSDKTelemetry` | interface |
| `WeiboSessionContext` | interface |
| `WeiboSessionExpiredError` | class |
| `WeiboTransport` | interface |

## Evolving（86）

按 shape 分组；shape 由名字推导，只用于说明「这是什么形状」，不构成额外承诺。

### 选项类型（Options）（45）

| 名称 | 种类 |
|---|---|
| `AlbumPhotoListOptions` | interface |
| `AlbumPhotoStreamOptions` | interface |
| `ArchiveIncrementalOptions` | interface |
| `ArchiveStreamOptions` | interface |
| `ArchiveUsersOptions` | interface |
| `CommentHistoryListOptions` | interface |
| `CommentHistoryStreamOptions` | interface |
| `ConsoleLoggerOptions` | interface |
| `FavoriteListOptions` | interface |
| `FavoriteStreamOptions` | interface |
| `FollowingsStreamOptions` | interface |
| `ImageWallListOptions` | interface |
| `ImageWallStreamOptions` | interface |
| `JsonlLoggerOptions` | interface |
| `JsonlTelemetryOptions` | interface |
| `LikeListOptions` | interface |
| `LikeStreamOptions` | interface |
| `MediaDownloadOptions` | interface |
| `MergeArchiveOptions` | interface |
| `NotificationListOptions` | interface |
| `NotificationStreamOptions` | interface |
| `StreamLimitOptions` | interface |
| `StreamRangeOptions` | interface |
| `SuperTopicListOptions` | interface |
| `SuperTopicStreamOptions` | interface |
| `TweetCommentsOptions` | interface |
| `TweetCommentsStreamOptions` | interface |
| `TweetContextOptions` | interface |
| `TweetEnrichOptions` | interface |
| `TweetFriendTimelineListOptions` | interface |
| `TweetFriendTimelineStreamOptions` | interface |
| `TweetLikersOptions` | interface |
| `TweetLikersStreamOptions` | interface |
| `TweetRepliesOptions` | interface |
| `TweetRepostsListOptions` | interface |
| `TweetRepostsStreamOptions` | interface |
| `TweetSearchByDateOptions` | interface |
| `TweetUserTimelineListOptions` | interface |
| `TweetUserTimelineStreamOptions` | interface |
| `UserArchiveContentOptions` | interface |
| `UserArchiveOptions` | interface |
| `UserMentionsListOptions` | interface |
| `UserMentionsStreamOptions` | interface |
| `VideoWaterfallListOptions` | interface |
| `VideoWaterfallStreamOptions` | interface |

### 进度类型（Progress）（19）

| 名称 | 种类 |
|---|---|
| `AlbumStreamProgress` | interface |
| `ArchiveProgress` | interface |
| `ArchiveProgressEvent` | type |
| `ArchiveProgressSummary` | interface |
| `CommentHistoryStreamProgress` | interface |
| `FavoriteStreamProgress` | interface |
| `FollowingsStreamProgress` | interface |
| `formatArchiveProgress` | function |
| `isArchiveProgress` | function |
| `LikeStreamProgress` | interface |
| `MediaDownloadProgress` | interface |
| `MediaStreamProgress` | interface |
| `NotificationStreamProgress` | interface |
| `PaginationProgress` | interface |
| `TweetCommentsStreamProgress` | interface |
| `TweetLikersStreamProgress` | interface |
| `TweetRepostsStreamProgress` | interface |
| `UserArchiveProgress` | interface |
| `UserMentionsStreamProgress` | interface |

### 运行时标签（14）

| 名称 | 种类 |
|---|---|
| `ArchiveErrorAction` | type |
| `ArchiveErrorStage` | type |
| `ArchiveItemErrorContext` | interface |
| `ArchivePhase` | type |
| `ArchiveRawMeta` | interface |
| `ArchiveTimelineSource` | type |
| `CapabilityAuth` | type |
| `CapabilityGuestPagination` | type |
| `CapabilityPagination` | type |
| `CapabilityStatus` | type |
| `FollowingsSource` | type |
| `listCapabilities` | function |
| `UserArchiveEvent` | type |
| `WEIBO_CAPABILITIES` | const |

### 扩展点形状（Credential / Plugin / Transport）（7）

| 名称 | 种类 |
|---|---|
| `Credential` | interface |
| `CredentialResolveContext` | interface |
| `CredentialResolver` | interface |
| `LogWriteStream` | interface |
| `PluginRequestInfo` | interface |
| `TransportFailure` | class |
| `TransportFailureKind` | type |

### 模型与契约（1）

| 名称 | 种类 |
|---|---|
| `UserArchiveResumeMode` | type |

