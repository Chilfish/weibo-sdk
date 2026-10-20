import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { resolveMediaCliOptions, toDoneEvent, toItemErrorEvent, toItemEvent } from '~/cli/commands/media'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { MediaDownloadError } from '~/models/errors/MediaError'
import { MediaType } from '~/types/domain/ITweet'

const cwd = 'C:/work'
const absoluteOut = process.platform === 'win32' ? 'C:/tmp/media' : '/tmp/media'

describe('resolveMediaCliOptions', () => {
  it('resolves defaults and relative output dirs', () => {
    const { mblogId, options } = resolveMediaCliOptions({ id: 'M1' }, cwd)
    expect(mblogId).toBe('M1')
    expect(options.dir).toBe(join(cwd, 'weibo-media'))
    expect(options.include).toBeUndefined()
    expect(options.retries).toBeUndefined()
    expect(options.refreshExpired).toBe(true)
  })

  it('parses include, numbers and negated refresh', () => {
    const { options } = resolveMediaCliOptions({
      'id': 'M1',
      'out': absoluteOut,
      'include': ' PIC, video ,pic, livephoto ',
      'concurrency': '5',
      'retries': '0',
      'timeout': '12000',
      'idle-timeout': '9000',
      'max-bytes': '1024',
      'overwrite': true,
      'fail-fast': true,
      'dry-run': true,
      'refresh': false,
    }, cwd)

    expect(options.dir).toBe(absoluteOut)
    expect(options.include).toEqual([MediaType.PIC, MediaType.VIDEO, MediaType.LIVEPHOTO])
    expect(options.concurrency).toBe(5)
    expect(options.retries).toBe(0)
    expect(options.timeoutMs).toBe(12000)
    expect(options.idleTimeoutMs).toBe(9000)
    expect(options.maxBytes).toBe(1024)
    expect(options.overwrite).toBe(true)
    expect(options.failFast).toBe(true)
    expect(options.dryRun).toBe(true)
    expect(options.refreshExpired).toBe(false)
  })

  it('rejects missing ids and unknown include values', () => {
    expect(() => resolveMediaCliOptions({}, cwd)).toThrow(InvalidConfigError)
    expect(() => resolveMediaCliOptions({ id: 'M1', include: '' }, cwd)).toThrow(InvalidConfigError)
    expect(() => resolveMediaCliOptions({ id: 'M1', include: 'pic,nope' }, cwd)).toThrow(InvalidConfigError)
  })
})

describe('media CLI events', () => {
  const base = {
    mediaId: 'p1',
    index: 1,
    type: MediaType.PIC,
    variant: 'image' as const,
    url: 'https://wx1.sinaimg.cn/large/p1.jpg',
    path: 'out/M1-01-p1.jpg',
    attempts: 1,
  }

  it('emits flat item events', () => {
    expect(toItemEvent({ ...base, status: 'downloaded', bytes: 3, contentType: 'image/jpeg', refreshed: false }, 'M1')).toEqual({
      event: 'item',
      mblogId: 'M1',
      mediaId: 'p1',
      index: 1,
      type: 'pic',
      variant: 'image',
      status: 'downloaded',
      url: base.url,
      path: base.path,
      attempts: 1,
      bytes: 3,
      contentType: 'image/jpeg',
      refreshed: false,
    })

    expect(toItemEvent({ ...base, attempts: 0, status: 'skipped', reason: 'exists', bytes: 3 }, 'M1'))
      .toMatchObject({ event: 'item', status: 'skipped', reason: 'exists', bytes: 3 })
  })

  it('emits item-error and done events', () => {
    const error = new MediaDownloadError('boom', { status: 500 })
    expect(toItemErrorEvent({
      mblogId: 'M1',
      mediaId: 'p1',
      index: 1,
      type: MediaType.PIC,
      variant: 'image',
      url: base.url,
      attempts: 2,
      fatal: false,
      httpStatus: 500,
    }, error)).toMatchObject({
      event: 'item-error',
      code: 'MEDIA_DOWNLOAD_FAILED',
      message: 'boom',
      httpStatus: 500,
    })

    expect(toDoneEvent({
      mblogId: 'M1',
      dir: 'out',
      dryRun: false,
      items: [],
      failures: [],
      totals: { total: 1, downloaded: 1, skipped: 0, failed: 0, planned: 0, bytes: 3 },
      durationMs: 4,
    })).toEqual({
      event: 'done',
      mblogId: 'M1',
      dir: 'out',
      dryRun: false,
      total: 1,
      downloaded: 1,
      skipped: 0,
      failed: 0,
      planned: 0,
      bytes: 3,
      errorsFile: undefined,
      durationMs: 4,
    })
  })
})
