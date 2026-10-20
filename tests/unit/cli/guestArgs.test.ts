import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSDK } from '~/cli/shared'

/**
 * `.env` 读取被替换成 spy：guest 模式必须一次都不调用它。
 *
 * 这里只构造 SDK（`selfCheck: 'lazy'`），不会发起任何网络请求。
 */
const envFileSpy = vi.hoisted(() => ({ readEnvValue: vi.fn() }))

vi.mock('~/utils/envFile', () => ({
  readEnvValue: envFileSpy.readEnvValue,
  readEnvFile: vi.fn(() => ({})),
}))

/** 不存在的 .env 路径：若 guest 分支去读它，说明实现没有完全跳过 Cookie 读取。 */
const missingEnvFile = join(tmpdir(), 'weibo-sdk-guest-args-does-not-exist.env')

describe('createSDK guest args', () => {
  beforeEach(() => {
    envFileSpy.readEnvValue.mockReset()
    envFileSpy.readEnvValue.mockReturnValue(undefined)
  })

  it('resolves guest mode with --guest and never reads the env file', () => {
    const sdk = createSDK({ 'guest': true, 'env-file': missingEnvFile })

    expect(sdk.authMode).toBe('guest')
    expect(envFileSpy.readEnvValue).not.toHaveBeenCalled()
  })

  it('stays in guest mode when --guest is combined with a cookie', () => {
    const sdk = createSDK({
      'guest': true,
      'cookie': 'SUB=loggedin',
      'env-file': missingEnvFile,
    })

    expect(sdk.authMode).toBe('guest')
    // 显式 guest 会忽略 Cookie，同样不读 .env。
    expect(envFileSpy.readEnvValue).not.toHaveBeenCalled()
  })

  it('resolves cookie mode when a cookie is provided without --guest', () => {
    const sdk = createSDK({ 'cookie': 'SUB=abc', 'env-file': missingEnvFile })

    expect(sdk.authMode).toBe('cookie')
  })

  it('lets auth auto fall back to guest when the env file has no cookie', () => {
    const sdk = createSDK({ 'env-file': missingEnvFile })

    expect(sdk.authMode).toBe('guest')
    expect(envFileSpy.readEnvValue).toHaveBeenCalled()
  })
})
