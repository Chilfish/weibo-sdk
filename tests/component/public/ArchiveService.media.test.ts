import type { ArchiveServiceDeps } from '~/services/public/ArchiveService'
import { describe, expect, it, vi } from 'vitest'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { ArchiveService } from '~/services/public/ArchiveService'

function mkRaw(mblogid: string) {
  return {
    id: 1,
    idstr: mblogid,
    mblogid,
    created_at: 'Mon Oct 19 12:00:00 +0800 2026',
    text: '',
    text_raw: `text-${mblogid}`,
    user: { id: 2, idstr: '2', screen_name: 'u' },
  }
}

function mkVideoTweet(mblogid: string) {
  return {
    ...mkRaw(mblogid),
    page_info: {
      object_type: 'video',
      page_pic: 'https://example.com/cover.jpg',
      media_info: {
        media_type: 'video',
        mp4_hd_url: 'https://example.com/video.mp4',
        duration: 12,
        h5_url: 'https://video.weibo.com/show?fid=1',
      },
    },
  }
}

function mkEmptyTimeline() {
  return { ok: 1, data: { since_id: '', list: [], total: 0 } }
}

function createDeps(): {
  deps: ArchiveServiceDeps
  imagePage: ReturnType<typeof vi.fn>
  videoPage: ReturnType<typeof vi.fn>
} {
  const imagePage = vi.fn()
  const videoPage = vi.fn()
  const deps: ArchiveServiceDeps = {
    tweets: {
      fetchRawUserTimelinePage: vi.fn().mockResolvedValue(mkEmptyTimeline()),
      fetchRawReposts: vi.fn().mockResolvedValue({ ok: 1, data: [], total_number: 0 }),
    },
    favorites: {
      fetchRawFavorites: vi.fn().mockResolvedValue({ ok: 1, data: { status: [], total_number: 0 } }),
    },
    media: {
      fetchRawImagePage: imagePage,
      fetchRawVideoPage: videoPage,
    },
  }
  return { deps, imagePage, videoPage }
}

async function collect(stream: AsyncIterableIterator<any>) {
  const out: any[] = []
  for await (const item of stream)
    out.push(item)
  return out
}

describe('archiveService media sources', () => {
  it('archives images and videos after timeline with assets and cursors', async () => {
    const { deps, imagePage, videoPage } = createDeps()
    imagePage.mockImplementation((_uid: string, options: { sinceId?: string }) => {
      if (options.sinceId === undefined)
        return Promise.resolve({ ok: 1, data: { since_id: 'I2', list: [{ pid: 'P1', type: 'pic' }, { pid: 'P2', type: 'pic' }] } })
      return Promise.resolve({ ok: 1, data: { since_id: '', list: [{ pid: 'P3', type: 'gif' }] } })
    })
    videoPage.mockImplementation((_uid: string, options: { cursor?: string }) => {
      if (options.cursor === undefined)
        return Promise.resolve({ ok: 1, data: { next_cursor: 'V2', list: [mkVideoTweet('V1')] } })
      return Promise.resolve({ ok: 1, data: { next_cursor: '', list: [] } })
    })

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', {
      includeReposts: false,
      includeFavorites: false,
      includeImages: true,
      includeVideos: true,
    }))

    expect(items.map(item => item.source)).toEqual(['image', 'image', 'image', 'video'])
    expect(items.map(item => item.asset.id)).toEqual(['P1', 'P2', 'P3', 'V1'])
    expect(items[3].tweet.mblogId).toBe('V1')
    expect(items[3].asset.videoUrl).toBe('https://example.com/video.mp4')
    expect(items[0].checkpoint).toMatchObject({ phase: 'images' })
    expect(items[0].checkpoint.imagesCursor).toBeUndefined()
    expect(items[2].checkpoint.imagesCursor).toBe('I2')
    expect(items[3].checkpoint).toMatchObject({ phase: 'videos' })
    expect('imagesCursor' in items[3].checkpoint).toBe(false)
    expect(imagePage).toHaveBeenCalledTimes(2)
    expect(videoPage).toHaveBeenCalledTimes(2)
  })

  it('resumes media phases from checkpoint cursors', async () => {
    const { deps, imagePage, videoPage } = createDeps()
    imagePage.mockResolvedValue({ ok: 1, data: { since_id: '', list: [{ pid: 'P9', type: 'pic' }] } })
    videoPage.mockResolvedValue({ ok: 1, data: { next_cursor: '', list: [mkVideoTweet('V9')] } })

    const service = new ArchiveService(deps)
    const items = await collect(service.streamArchive('111', {
      includeReposts: false,
      includeFavorites: false,
      includeImages: true,
      includeVideos: true,
      checkpoint: { uid: '111', phase: 'images', imagesCursor: 'I9' },
    }))

    expect(imagePage).toHaveBeenCalledWith('111', { sinceId: 'I9' })
    expect(items.map(item => item.source)).toEqual(['image', 'video'])
    expect((deps.tweets as any).fetchRawUserTimelinePage).not.toHaveBeenCalled()
  })

  it('requires media deps when enabled', async () => {
    const { deps } = createDeps()
    const service = new ArchiveService({ ...deps, media: undefined })

    await expect(service.streamArchive('111', { includeImages: true }).next())
      .rejects
      .toBeInstanceOf(InvalidConfigError)
    await expect(service.streamArchive('111', { includeVideos: true }).next())
      .rejects
      .toBeInstanceOf(InvalidConfigError)
  })
})
