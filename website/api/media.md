---
title: media
outline: deep
---

# media

图片墙、视频瀑布、相册与媒体下载。

| 方法 | 返回 | 分页 | 访客 | 稳定性 |
|---|---|---|---|---|
| `fetchRawImagePage(uid, options?)` | `ImageWallResponse` | `since_id` | 可用 | 实验性 |
| `fetchRawVideoPage(uid, options?)` | `WaterfallResponse` | `cursor` | 可用 | 实验性 |
| `listAlbums(uid)` | `AlbumListResult` | — | 可用 | 稳定 |
| `listAlbumPhotos(containerId, options?)` | `AlbumPhotoPageResult` | `since_id` | 可用 | 稳定 |
| `streamAlbumPhotos(containerId, options?)` | `IUserMediaAsset` 流 | `since_id` | 可用 | 稳定 |
| `listImages(uid, options?)` | `ImageWallPageResult` | `since_id` | 可用 | 稳定 |
| `streamImages(uid, options?)` | `IUserMediaAsset` 流 | `since_id` | 可用 | 稳定 |
| `listVideos(uid, options?)` | `VideoWaterfallPageResult` | `cursor` | 可用 | 稳定 |
| `streamVideos(uid, options?)` | `IUserMediaAsset` 流 | `cursor` | 可用 | 稳定 |
| `downloadTweetMedia(tweet, options)` | `TweetMediaDownloadResult` | — | 可用 | 稳定 |
| `downloadByMblogId(mblogId, options)` | `TweetMediaDownloadResult` | — | 可用 | 稳定 |

## 图片墙

### `listImages(uid, options?)`

| 选项 | 类型 | 说明 |
|---|---|---|
| `sinceId` | `string \| number` | 起始游标；缺省 / `0` / `-1` = 第一页 |

返回 `{ sinceId?, hasMore, assets: IUserMediaAsset[] }`。空页、游标缺失或游标不前进时 `hasMore` 为 false。

### `streamImages(uid, options?)`

```ts
for await (const asset of sdk.media.streamImages(uid, { maxPages: 3 })) {
  console.log(asset.id, asset.imageUrl)
}
```

选项：`sinceId`、`maxPages`、`maxItems`、`onProgress`。

### `fetchRawImagePage(uid, options?)`

未归一化的图片墙响应，归档层用于 `schemaDigest`。

## 视频瀑布

### `listVideos(uid, options?)`

`cursor` 为上游 `next_cursor`；缺省 / `0` / `-1` = 第一页。返回 `{ cursor?, hasMore, assets }`。

### `streamVideos(uid, options?)`

与 `streamImages` 相同的选项与停止条件。

### `fetchRawVideoPage(uid, options?)`

未归一化的视频瀑布响应。

## 相册

### `listAlbums(uid)`

```ts
const { albums } = await sdk.media.listAlbums(uid)
// [{ containerId, title, count?, coverUrl? }, ...]
```

`containerId` 来自图片墙的相册条目（`pc_profile_album`）。

### `listAlbumPhotos(containerId, options?)`

`sinceId` 游标，返回 `{ sinceId?, hasMore, assets }`。

### `streamAlbumPhotos(containerId, options?)`

选项：`sinceId`、`maxPages`、`maxItems`、`onProgress`。

## 下载

### `downloadTweetMedia(tweet, options)`

传入已归一化的 `ITweet`，避免再次请求详情：

```ts
const tweet = await sdk.tweets.getByMblogId('QqsYymYOS')
const result = await sdk.media.downloadTweetMedia(tweet, { dir: './media' })
```

### `downloadByMblogId(mblogId, options)`

```ts
const result = await sdk.media.downloadByMblogId('QqsYymYOS', {
  dir: './media',
  include: [MediaType.PIC, MediaType.VIDEO],
  dryRun: false,
})
```

选项与结果字段见 [下载媒体](/guide/media)。

## 访客与边界

- 图片墙 / 视频 / 相册访客可用且可完整分页。
- 媒体 URL 是短期签名地址，约一小时后失效。
- 下载器只带 Referer，不带 Cookie，并限制允许的媒体主机。
- `fetchRaw*` 返回原始形状，实验性。

## CLI

```bash
weibo-cli media images 1111681197
weibo-cli media images 1111681197 --max-pages 2
weibo-cli media videos 1111681197 --max-pages 2
weibo-cli media albums 1111681197
weibo-cli media album <containerId>
weibo-cli media download QqsYymYOS --out ./media
weibo-cli media download QqsYymYOS --out ./media --dry-run
```
