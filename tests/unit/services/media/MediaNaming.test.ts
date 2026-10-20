import { describe, expect, it } from 'vitest'
import { MediaInvalidResponseError } from '~/models/errors/MediaError'
import {
  buildMediaFileName,
  isAllowedHost,
  isRejectedContentType,
  resolveExtension,
  sanitizePathSegment,
} from '~/services/internal/media/MediaNaming'
import { MediaType } from '~/types/domain/ITweet'

describe('mediaNaming', () => {
  it('maps content types to extensions', () => {
    expect(resolveExtension({ contentType: 'image/jpeg; charset=utf-8', url: 'https://x/a.bin', type: MediaType.PIC, variant: 'image' })).toBe('jpg')
    expect(resolveExtension({ contentType: 'image/png', url: 'https://x/a.bin', type: MediaType.PIC, variant: 'image' })).toBe('png')
    expect(resolveExtension({ contentType: 'video/mp4', url: 'https://x/a.bin', type: MediaType.VIDEO, variant: 'video' })).toBe('mp4')
    expect(resolveExtension({ contentType: 'video/quicktime', url: 'https://x/a.bin', type: MediaType.LIVEPHOTO, variant: 'video' })).toBe('mov')
  })

  it('falls back to URL and media type defaults', () => {
    expect(resolveExtension({ url: 'https://x/a.webp?sign=1', type: MediaType.PIC, variant: 'image' })).toBe('webp')
    expect(resolveExtension({ url: 'https://x/no-ext', type: MediaType.PIC, variant: 'image' })).toBe('jpg')
    expect(resolveExtension({ url: 'https://x/no-ext', type: MediaType.GIF, variant: 'image' })).toBe('gif')
    expect(resolveExtension({ url: 'https://x/no-ext', type: MediaType.VIDEO, variant: 'video' })).toBe('mp4')
  })

  it('rejects HTML and mismatched media families', () => {
    expect(isRejectedContentType('text/html; charset=utf-8')).toBe(true)
    expect(() => resolveExtension({ contentType: 'text/html', url: 'https://x/a', type: MediaType.PIC, variant: 'image' }))
      .toThrow(MediaInvalidResponseError)
    expect(() => resolveExtension({ contentType: 'image/jpeg', url: 'https://x/a.mp4', type: MediaType.VIDEO, variant: 'video' }))
      .toThrow(/Expected a video/)
  })

  it('sanitizes Windows-unsafe and reserved names', () => {
    expect(sanitizePathSegment('a<b>c:"d/e\\f|g?h*i', 'fallback')).toBe('a_b_c__d_e_f_g_h_i')
    expect(sanitizePathSegment('name. ', 'fallback')).toBe('name')
    expect(sanitizePathSegment('CON', 'fallback')).toBe('_CON')
    expect(sanitizePathSegment('', 'fallback')).toBe('fallback')
    expect(sanitizePathSegment('a'.repeat(100), 'fallback')).toHaveLength(60)
  })

  it('builds stable flat names and a motion suffix for LivePhoto', () => {
    expect(buildMediaFileName({ mblogId: 'M1', index: 1, mediaId: 'p1', type: MediaType.PIC, variant: 'image', ext: 'jpg' }))
      .toBe('M1-01-p1.jpg')
    expect(buildMediaFileName({ mblogId: 'M1', index: 10, mediaId: 'p1', type: MediaType.LIVEPHOTO, variant: 'video', ext: 'mov' }))
      .toBe('M1-10-p1-motion.mov')
  })

  it('matches host suffixes without allowing lookalikes', () => {
    const hosts = ['sinaimg.cn', 'weibocdn.com']
    expect(isAllowedHost('wx2.sinaimg.cn', hosts)).toBe(true)
    expect(isAllowedHost('f.video.weibocdn.com', hosts)).toBe(true)
    expect(isAllowedHost('evilsinaimg.cn', hosts)).toBe(false)
    expect(isAllowedHost('sinaimg.cn.evil.com', hosts)).toBe(false)
  })
})
