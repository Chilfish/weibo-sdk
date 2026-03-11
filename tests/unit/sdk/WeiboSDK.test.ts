import { describe, expect, it } from 'vitest'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { WeiboSDK } from '~/WeiboSDK'

describe('weiboSDK', () => {
  it('throws InvalidConfigError when cookie is missing', () => {
    expect(() => new WeiboSDK({ cookie: '' })).toThrowError(InvalidConfigError)
  })
})
