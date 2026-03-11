import { describe, expect, it, vi } from 'vitest'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { WeiboSDK } from '~/WeiboSDK'

describe('weiboSDK', () => {
  it('throws InvalidConfigError when cookie is missing', () => {
    expect(() => new WeiboSDK({ cookie: '' })).toThrowError(InvalidConfigError)
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
})
