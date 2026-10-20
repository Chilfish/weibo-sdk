import type { AxiosRequestConfig } from 'axios'
import { createFakeAxios, NoopRateLimitService } from 'tests/testkit'
import { describe, expect, it } from 'vitest'
import { MediaService } from '~/services/public/MediaService'
import { TweetService } from '~/services/public/TweetService'

const MID = '5356120103455672'
const MBLOG_ID = 'RnxWieuYE'
const SHOW_URL = 'https://weibo.com/ajax/statuses/show'

function showPayload(): Record<string, unknown> {
  return {
    ok: 1,
    id: MID,
    idstr: MID,
    mid: MID,
    mblogid: MBLOG_ID,
    created_at: 'now',
    text: '<span>html</span>',
    text_raw: 'plain',
    visible: { type: 0, list_id: 0 },
    user: { id: 2, idstr: '2', screen_name: 'u' },
    pic_ids: [],
  }
}

function createService(handler: (config: AxiosRequestConfig) => Promise<unknown>) {
  const { client, getLastConfig } = createFakeAxios(handler)
  const service = new TweetService(
    { cookie: 'SUB=abc' },
    { client, rateLimitService: new NoopRateLimitService() as any },
  )
  return { service, getLastConfig }
}

describe('tweet id input normalization', () => {
  it('getByMblogId accepts a m.weibo.cn status URL and requests its numeric mid', async () => {
    const { service, getLastConfig } = createService(async () => showPayload())

    const tweet = await service.getByMblogId(`https://m.weibo.cn/status/${MID}`)

    expect(tweet.id).toBe(MID)
    expect(tweet.mblogId).toBe(MBLOG_ID)
    expect(getLastConfig()?.url).toBe(SHOW_URL)
    expect(getLastConfig()?.params).toEqual({ id: MID, isGetLongText: true })
  })

  it('comments resolves a status URL to a numeric mid when flow=1', async () => {
    const calls: Array<{ url?: string, params?: unknown }> = []
    const { service } = createService(async (config) => {
      calls.push({ url: config.url, params: config.params })
      if (config.url?.endsWith('/buildComments'))
        return { ok: 1, data: [], max_id: 0, total_number: 0 }
      return showPayload()
    })

    await service.comments(`https://weibo.com/7679065628/${MBLOG_ID}`, { flow: 1 })

    expect(calls.map(call => call.url)).toEqual([
      SHOW_URL,
      'https://weibo.com/ajax/statuses/buildComments',
    ])
    expect(calls[0].params).toEqual({ id: MBLOG_ID, isGetLongText: false })
    expect(calls[1].params).toMatchObject({ id: MID, flow: 1 })
  })

  it('getReposts accepts a weibo.com/uid/mblogid URL', async () => {
    const { service, getLastConfig } = createService(async () => ({ ok: 1, data: [] }))

    await service.getReposts(`https://weibo.com/7679065628/${MBLOG_ID}?type=comment`)

    expect(getLastConfig()?.params).toEqual({ id: MBLOG_ID })
    expect(getLastConfig()?.headers?.referer).toBe(`https://weibo.com/detail/${MBLOG_ID}`)
  })

  it('likers resolves a mblogid URL to a numeric mid before calling attitudes/show', async () => {
    const calls: Array<{ url?: string, params?: unknown }> = []
    const { service } = createService(async (config) => {
      calls.push({ url: config.url, params: config.params })
      if (config.url?.endsWith('/attitudes/show'))
        return { ok: 1, data: { max: 1, total_number: 0, data: [] } }
      return showPayload()
    })

    await service.likers(`https://weibo.com/7679065628/${MBLOG_ID}`)

    expect(calls.map(call => call.url)).toEqual([
      SHOW_URL,
      'https://m.weibo.cn/api/attitudes/show',
    ])
    expect(calls[0].params).toEqual({ id: MBLOG_ID, isGetLongText: false })
    expect(calls[1].params).toEqual({ id: MID, page: 1 })
  })

  it('media download accepts a status URL and resolves it through statuses/show', async () => {
    const { client, getLastConfig } = createFakeAxios(async () => showPayload())
    const service = new MediaService(
      { cookie: 'SUB=abc' },
      { client, rateLimitService: new NoopRateLimitService() as any },
      { fileStore: null },
    )

    await expect(service.downloadByMblogId(`https://m.weibo.cn/status/${MID}`, { dir: 'out' }))
      .rejects
      .toMatchObject({ code: 'CONFIG_INVALID', context: { field: 'runtime' } })

    expect(getLastConfig()?.url).toBe(SHOW_URL)
    expect(getLastConfig()?.params).toEqual({ id: MID, isGetLongText: false })
  })
})
