---
title: media
outline: deep
---

# media

图片墙、视频瀑布、相册与媒体下载。

| 方法 | 返回 | 分页 |
|---|---|---|
| `fetchRawImagePage(uid, options?)` | `ImageWallResponse` | `since_id` |
| `fetchRawVideoPage(uid, options?)` | `WaterfallResponse` | `cursor` |
| `listAlbums(uid)` | `AlbumListResult` | 无 |
| `listAlbumPhotos(containerId, options?)` | `AlbumPhotoPageResult` | `since_id` |
| `streamAlbumPhotos(containerId, options?)` | `IUserMediaAsset` 流 | `since_id` |
| `listImages(uid, options?)` | `ImageWallPageResult` | `since_id` |
| `streamImages(uid, options?)` | `IUserMediaAsset` 流 | `since_id` |
| `listVideos(uid, options?)` | `VideoWaterfallPageResult` | `cursor` |
| `streamVideos(uid, options?)` | `IUserMediaAsset` 流 | `cursor` |
| `downloadTweetMedia(tweet, options)` | `TweetMediaDownloadResult` | 无 |
| `downloadByMblogId(mblogId, options)` | `TweetMediaDownloadResult` | 无 |

访客可读取图片墙、视频与相册，分页完整，边界见 [范围与限制](/guide/limitations)。

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

返回上游原始响应；需要归一化字段时用 [`listImages`](#listimages-uid-options)。归档层用它生成 `schemaDigest`。

## 视频瀑布

### `listVideos(uid, options?)`

`cursor` 为上游 `next_cursor`；缺省 / `0` / `-1` = 第一页。返回 `{ cursor?, hasMore, assets }`。

### `streamVideos(uid, options?)`

选项与停止条件同 `streamImages`。

### `fetchRawVideoPage(uid, options?)`

返回上游原始响应；需要归一化字段时用 [`listVideos`](#listvideos-uid-options)。

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

传入已归一化的 `ITweet`，省掉一次详情请求：

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

## 边界

- 媒体 URL 是短期签名地址，约一小时后失效，归档时及时下载。
- 下载器的 CDN 请求只带 `Referer`（默认 `https://weibo.com/`），主机按 [白名单](/reference/media-download) 校验。

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
