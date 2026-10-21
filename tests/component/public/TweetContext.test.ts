import type { AxiosRequestConfig } from 'axios'
import { createFakeAxios, NoopRateLimitService } from 'tests/testkit/fakeAxios'
import { describe, expect, it, vi } from 'vitest'
import { TweetService } from '~/services/public/TweetService'

const SHOW_RESPONSE = {
  ok: 1,
  id: '1',
  idstr: '1',
  mblogid: 'X',
  created_at: 'Tue Oct 20 15:40:07 +0800 2026',
  text: '正文',
  text_raw: '正文',
  source: '微博网页版',
  isLongText: false,
  isAd: false,
  visible: { type: 0 },
  user: { id: '2', idstr: '2', screen_name: '作者', verified: true, verified_type: 0 },
  attitudes_count: 1,
  comments_count: 1,
  reposts_count: 0,
}

const AUTHOR = {
  idstr: '2',
  screen_name: '作者',
  profile_url: '/u/2',
  verified: true,
  verified_type: 0,
  verified_reason: '认证说明',
  description: '简介',
  followers_count: 12345,
  following: true,
  follow_me: false,
}

function createService(handler: (config: AxiosRequestConfig) => unknown) {
  const requests: AxiosRequestConfig[] = []
  const { transport } = createFakeAxios(async (config) => {
    requests.push(config)
    return handler(config)
  })
  const authorProfile = vi.fn(async () => AUTHOR)
  const service = new TweetService(
    { cookie: 'SUB=abc' },
    { transport, rateLimitService: new NoopRateLimitService() as any },
    { authorProfile },
  )
  return { service, requests, authorProfile }
}

describe('tweetService.context', () => {
  it('makes one request by default and enriches the author', async () => {
    const { service, requests, authorProfile } = createService(() => SHOW_RESPONSE)

    const context = await service.context('X', { authMode: 'cookie' })

    expect(requests.map(request => request.url)).toEqual([
      'https://weibo.com/ajax/statuses/show',
    ])
    expect(authorProfile).toHaveBeenCalledWith('2')
    expect(context.post.text).toBe('正文')
    expect(context.post.author).toMatchObject({
      id: '2',
      name: '作者',
      url: 'https://weibo.com/u/2',
      verifiedReason: '认证说明',
      description: '简介',
      followers: 12345,
      following: true,
      followedBy: false,
    })
    expect(context.provenance.authMode).toBe('cookie')
    expect(context.hints).toContain('no_media')
  })

  it('skips the author request with author: false', async () => {
    const { service, requests, authorProfile } = createService(() => SHOW_RESPONSE)

    const context = await service.context('X', { author: false })

    expect(requests).toHaveLength(1)
    expect(authorProfile).not.toHaveBeenCalled()
    expect(context.post.author).toEqual({
      id: '2',
      name: '作者',
      verified: true,
      verifiedType: 0,
    })
  })

  it('fetches the long text only when the raw tweet is marked isLongText', async () => {
    const { service, requests } = createService((config) => {
      if (config.url?.endsWith('/longtext'))
        return { ok: 1, data: { longTextContent_raw: '完整正文' } }
      return { ...SHOW_RESPONSE, isLongText: true, text: '短', text_raw: '短' }
    })

    const context = await service.context('X', { author: false })

    expect(requests.map(request => request.url)).toEqual([
      'https://weibo.com/ajax/statuses/show',
      'https://weibo.com/ajax/statuses/longtext',
    ])
    expect(context.post.text).toBe('完整正文')
    expect(context.post.flags.textTruncated).toBeUndefined()
    expect(context.provenance.longTextFetched).toBe(true)
  })

  it('does not fetch the long text when it is disabled', async () => {
    const { service, requests } = createService(() => ({
      ...SHOW_RESPONSE,
      isLongText: true,
      text: '短',
      text_raw: '短',
    }))

    const context = await service.context('X', { author: false, longText: false })

    expect(requests).toHaveLength(1)
    expect(context.post.flags.textTruncated).toBe(true)
    expect(context.unknowns.join('\n')).toContain('isLongText=true')
  })

  it('samples comments with the requested flow', async () => {
    const { service, requests } = createService((config) => {
      if (config.url?.endsWith('/buildComments')) {
        return {
          ok: 1,
          data: [{
            id: 1,
            idstr: 'c1',
            text_raw: '热评',
            user: { id: '3', idstr: '3', screen_name: '路人' },
            like_counts: 2,
          }],
          total_number: 1,
          max_id: 0,
        }
      }
      return SHOW_RESPONSE
    })

    const context = await service.context('X', {
      author: false,
      comments: 5,
      commentFlow: 'time',
    })

    const commentRequest = requests.find(request => request.url?.endsWith('/buildComments'))
    expect(commentRequest?.params).toMatchObject({ id: '1', flow: 1 })
    // time 排序直接用数字 idstr，不额外发一次 statuses/show 解析
    expect(requests).toHaveLength(2)
    expect(context.discussion).toEqual([
      expect.objectContaining({ author: '路人', text: '热评', likes: 2 }),
    ])
    expect(context.provenance.commentsSampled).toBe(1)
  })

  it('runs long-text, author and comment requests in parallel', async () => {
    let releaseLongText!: () => void
    const longTextGate = new Promise<void>((resolve) => {
      releaseLongText = resolve
    })
    let markCommentStarted!: () => void
    const commentStarted = new Promise<void>((resolve) => {
      markCommentStarted = resolve
    })

    const { service, authorProfile } = createService(async (config) => {
      if (config.url?.endsWith('/longtext')) {
        await longTextGate
        return { ok: 1, data: { longTextContent_raw: '完整正文' } }
      }
      if (config.url?.endsWith('/buildComments')) {
        markCommentStarted()
        return {
          ok: 1,
          data: [{
            id: 1,
            idstr: 'c1',
            text_raw: '热评',
            user: { id: '3', idstr: '3', screen_name: '路人' },
          }],
          total_number: 1,
          max_id: 0,
        }
      }
      return { ...SHOW_RESPONSE, isLongText: true, text: '短', text_raw: '短' }
    })

    let markAuthorStarted!: () => void
    const authorStarted = new Promise<void>((resolve) => {
      markAuthorStarted = resolve
    })
    authorProfile.mockImplementation(async () => {
      markAuthorStarted()
      return AUTHOR
    })

    const result = service.context('X', { comments: 5 })
    // 长文仍被 gate 住时，作者与评论请求应该已经发出（串行实现会一直等到 gate 释放）。
    const outcome = await Promise.race([
      Promise.all([commentStarted, authorStarted]).then(() => 'parallel' as const),
      new Promise<'timeout'>(resolve => setTimeout(resolve, 100, 'timeout')),
    ])
    releaseLongText()

    expect(outcome).toBe('parallel')
    const context = await result
    expect(context.post.text).toBe('完整正文')
    expect(context.discussion).toHaveLength(1)
  })
})
