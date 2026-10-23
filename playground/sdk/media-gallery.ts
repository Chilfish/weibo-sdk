import type { SdkScenario } from '../lib/types'
import { argument, flagNumber } from '../lib/args'
import { defaultUid } from '../lib/defaults'
import { printAsset } from '../lib/format'

/** 图片墙 / 视频瀑布 / 相册：三种媒体集合的游标差异。 */
export const scenario: SdkScenario = {
  kind: 'sdk',
  id: 'media-gallery',
  title: '用户媒体集合',
  summary: 'listImages / streamImages（since_id）+ streamVideos（cursor）+ albums / album photos',
  usage: 'pnpm play media-gallery [uid] [--max-pages 1]',
  async run({ sdk, args, env, log }) {
    const uid = argument(args, 0, 'PLAYGROUND_UID', env.values, defaultUid(env.values))
    const maxPages = flagNumber(args, 'max-pages', 1)

    log.heading('图片墙（sinceid 游标）')
    const images = await sdk.media.listImages(uid)
    log.kv('page', `assets=${images.assets.length} hasMore=${images.hasMore}`)
    for (const asset of images.assets.slice(0, 5))
      printAsset(asset, log)

    let streamedImages = 0
    for await (const asset of sdk.media.streamImages(uid, { maxPages })) {
      if (++streamedImages <= 3)
        printAsset(asset, log)
    }
    log.kv('streamImages', streamedImages)

    log.heading('视频瀑布（cursor 游标）')
    let videos = 0
    for await (const asset of sdk.media.streamVideos(uid, {
      maxPages,
      onProgress: progress => log.progress('videos', progress.processed),
    })) {
      if (++videos <= 5)
        printAsset(asset, log)
    }
    log.kv('videos', videos)

    const videosPage = await sdk.media.listVideos(uid)
    log.kv('listVideos', `assets=${videosPage.assets.length} cursor=${videosPage.cursor ?? 'n/a'} hasMore=${videosPage.hasMore}`)

    log.heading('相册')
    const { albums } = await sdk.media.listAlbums(uid)
    log.kv('albums', albums.length)
    for (const album of albums.slice(0, 5))
      log.info(`- ${album.title} containerId=${album.containerId}`)

    const album = albums[0]
    if (album) {
      const photos = await sdk.media.listAlbumPhotos(album.containerId)
      log.kv(`album ${album.title}`, `photos=${photos.assets.length} hasMore=${photos.hasMore}`)
      for (const photo of photos.assets.slice(0, 5))
        printAsset(photo, log)

      log.heading('相册流（streamAlbumPhotos）')
      let streamed = 0
      for await (const photo of sdk.media.streamAlbumPhotos(album.containerId, { maxPages })) {
        if (++streamed <= 3)
          printAsset(photo, log)
      }
      log.kv('streamAlbumPhotos', streamed)
    }
    else {
      log.info('该账号没有可用相册；可换一个 uid 再试。')
    }
  },
}
