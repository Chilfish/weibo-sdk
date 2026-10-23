import { createFakeAxios, NoopRateLimitService } from 'tests/testkit/fakeAxios'
import { describe, expect, it, vi } from 'vitest'
import { TweetService } from '~/services/public/TweetService'

describe('longtext', () => {
  const fixture = {
    ok: 1,
    data: {
      longTextContent: 'full text',
      topic_struct: [{ topic_title: 'test' }],
      url_struct: [{ url_title: 'link' }],
      isMarkdown: false,
      longTextContent_raw: 'raw',
    },
  }

  it('calls longtext endpoint with correct params', async () => {
    const { transport, getLastConfig } = createFakeAxios(async (cfg) => {
      expect(cfg.url).toBe('https://weibo.com/ajax/statuses/longtext')
      return fixture
    })
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )
    const longText = await service.longText('AbCdEf123')
    // 归一化契约：text 优先 longTextContent_raw
    expect(longText.text).toBe('raw')
    expect(longText.isMarkdown).toBe(false)
    const cfg = getLastConfig()
    expect(cfg?.params).toEqual({ id: 'AbCdEf123' })
    expect(cfg?.headers?.referer).toBe('https://weibo.com/detail/AbCdEf123')
  })

  it('keeps the raw longtext shape behind fetchRawLongText', async () => {
    const { transport } = createFakeAxios(async () => fixture)
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    const raw = await service.fetchRawLongText('AbCdEf123')
    expect(raw.ok).toBe(1)
    expect(raw.data.longTextContent).toBe('full text')
    expect(raw.data.longTextContent_raw).toBe('raw')
    expect(raw.data.topic_struct).toHaveLength(1)
    expect(raw.data.url_struct).toHaveLength(1)
  })

  it('falls back to longTextContent when longTextContent_raw is absent', async () => {
    const { transport } = createFakeAxios(async () => ({ ok: 1, data: { longTextContent: 'full text' } }))
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { transport, rateLimitService: new NoopRateLimitService() as any },
    )

    const longText = await service.longText('AbCdEf123')
    expect(longText.text).toBe('full text')
    // isMarkdown 缺省时不伪造
    expect(longText.isMarkdown).toBeUndefined()
  })

  it('emits telemetry on request', async () => {
    const { transport } = createFakeAxios(async () => fixture)
    const telemetry = { emit: vi.fn(async () => {}) }
    const service = new TweetService(
      { cookie: 'SUB=abc', telemetry },
      { transport, rateLimitService: new NoopRateLimitService() as any, telemetry },
    )
    await service.longText('test')
    expect(telemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ event_name: 'request_start' }),
    )
    expect(telemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ event_name: 'request_success' }),
    )
  })
})
