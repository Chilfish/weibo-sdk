import { describe, expect, it } from 'vitest'
import { listCapabilities, WEIBO_CAPABILITIES } from '~/capabilities'
import { WeiboSDK } from '~/WeiboSDK'

describe('capabilities', () => {
  it('registers core capabilities with stable ids', () => {
    const ids = WEIBO_CAPABILITIES.map(capability => capability.id)
    expect(ids).toContain('tweets.detail')
    expect(ids).toContain('archive.stream')
    expect(ids).toContain('archive.batch')
    expect(ids).toContain('media.download')
    expect(ids).toContain('media.albums')
    expect(ids).toContain('topics.list')
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('filters by service and status', () => {
    const tweets = listCapabilities({ service: 'tweets' })
    expect(tweets.length).toBeGreaterThan(0)
    expect(tweets.every(capability => capability.service === 'tweets')).toBe(true)

    const unavailable = listCapabilities({ status: 'unavailable' })
    expect(unavailable.map(capability => capability.id)).toEqual(['search.users', 'search.tweets'])
  })

  it('is exposed without network access on the SDK facade', () => {
    const sdk = new WeiboSDK({ cookie: 'SUB=abc' })
    const archive = sdk.capabilities({ service: 'archive' })
    expect(archive.map(capability => capability.id)).toEqual(['archive.stream', 'archive.batch'])
  })

  it('marks account-scoped capabilities', () => {
    expect(listCapabilities({ service: 'favorites' }).map(capability => capability.accountScoped))
      .toEqual([true, true])
    expect(listCapabilities({ service: 'commentHistory' })[0].accountScoped).toBe(true)
    expect(listCapabilities({ service: 'notifications' }).every(capability => capability.accountScoped)).toBe(true)
    // 点赞按目标 uid 读取，不属于账号级能力
    expect(listCapabilities({ service: 'likes' })[0].accountScoped).toBeUndefined()
  })
})
