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
    const { client, getLastConfig } = createFakeAxios(async (cfg) => {
      expect(cfg.url).toBe('https://weibo.com/ajax/statuses/longtext')
      return fixture
    })
    const service = new TweetService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
    )
    const data = await service.longText('AbCdEf123')
    expect(data.ok).toBe(1)
    expect(data.data.longTextContent).toBe('full text')
    const cfg = getLastConfig()
    expect(cfg?.params).toEqual({ id: 'AbCdEf123' })
    expect(cfg?.headers?.referer).toBe('https://weibo.com/detail/AbCdEf123')
  })

  it('emits telemetry on request', async () => {
    const { client } = createFakeAxios(async () => fixture)
    const telemetry = { emit: vi.fn(async () => {}) }
    const service = new TweetService(
      { cookie: 'SUB=abc', telemetry },
      { client, rateLimitService: new NoopRateLimitService() as any, telemetry },
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
