import { describe, expect, it, vi } from 'vitest'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { WeiboSDK } from '~/WeiboSDK'

describe('weiboSDK', () => {
  it('uses guest mode when auth is auto and cookie is missing', () => {
    expect(new WeiboSDK({ cookie: '' }).authMode).toBe('guest')
    expect(new WeiboSDK({ auth: 'guest' }).authMode).toBe('guest')
  })

  it('throws InvalidConfigError when auth is cookie but cookie is missing', () => {
    expect(() => new WeiboSDK({ cookie: '', auth: 'cookie' })).toThrowError(InvalidConfigError)
    expect(() => new WeiboSDK({ auth: 'cookie' })).toThrowError(InvalidConfigError)
  })

  it('emits sdk_init lifecycle event', async () => {
    const onLifecycle = vi.fn()

    // lazy mode: no network self-check in constructor
    const sdk = new WeiboSDK({
      cookie: 'SUB=abc',
      hooks: { onLifecycle },
      selfCheck: { mode: 'lazy' },
    })
    void sdk

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(onLifecycle).toHaveBeenCalledWith(expect.objectContaining({
      event_name: 'sdk_init',
      trace_id: expect.any(String),
      timestamp: expect.any(Number),
    }))
  })

  it('shares one rate limiter across every service', () => {
    const sdk = new WeiboSDK({ auth: 'guest', selfCheck: { mode: 'none' } })
    const limiter = (sdk.tweets as unknown as { rateLimitService: unknown }).rateLimitService

    expect(limiter).toBeDefined()
    for (const service of [sdk.users, sdk.followings, sdk.favorites, sdk.likes, sdk.media]) {
      expect((service as unknown as { rateLimitService: unknown }).rateLimitService).toBe(limiter)
    }

    // 432 暂停必须对整实例生效，而不是只停某一个服务自己的桶。
    ;(limiter as { pause: (ms: number) => void }).pause(1000)
    expect((sdk.users as unknown as { rateLimitService: { isPaused: () => boolean } }).rateLimitService.isPaused()).toBe(true)
  })

  it.each([
    ['burst 0', { burst: 0 }],
    ['burst -1', { burst: -1 }],
    ['burst 1.5', { burst: 1.5 }],
    ['burst NaN', { burst: Number.NaN }],
    ['delay -1', { delay: -1 }],
    ['delay NaN', { delay: Number.NaN }],
    ['delay Infinity', { delay: Number.POSITIVE_INFINITY }],
  ])('rejects invalid %s with CONFIG_INVALID at construction', (_label, limits) => {
    let caught: unknown
    try {
      void new WeiboSDK({ auth: 'guest', selfCheck: { mode: 'none' }, ...limits })
    }
    catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(InvalidConfigError)
    expect(caught).toMatchObject({ code: 'CONFIG_INVALID', retryable: false })
  })

  it('accepts delay 0 as explicit no-throttle and burst 1', () => {
    expect(() => new WeiboSDK({
      auth: 'guest',
      burst: 1,
      delay: 0,
      selfCheck: { mode: 'none' },
    })).not.toThrow()
  })
})
