import type { ISelfProfile } from '~/types/domain/IUser'
import { describe, expect, it, vi } from 'vitest'
import { WeiboSessionExpiredError } from '~/models/errors/BusinessError'
import { ConnectionTimeoutError } from '~/models/errors/TransportError'
import { Gender } from '~/types/domain/IUser'
import { WeiboSDK } from '~/WeiboSDK'

/** `users.myDetails()` 现在返回归一化 `ISelfProfile`（uid 为字符串）。 */
function profile(uid?: string): ISelfProfile {
  return {
    gender: Gender.Unknown,
    links: [],
    ...(uid === undefined ? {} : { uid }),
  }
}

describe('weiboSDK session context', () => {
  it('parses uid and caches the session (single-flight)', async () => {
    const sdk = new WeiboSDK({ cookie: 'SUB=abc', selfCheck: { mode: 'none' } })
    const myDetails = vi.spyOn(sdk.users, 'myDetails')
      .mockResolvedValue(profile('42'))

    const [first, second] = await Promise.all([sdk.getSession(), sdk.getSession()])

    expect(first.uid).toBe('42')
    expect(first.profile).toEqual(profile('42'))
    expect(second).toBe(first)
    expect(first.checkedAt).toEqual(expect.any(Number))
    expect(myDetails).toHaveBeenCalledTimes(1)
    expect(await sdk.getSession()).toBe(first)
    expect(myDetails).toHaveBeenCalledTimes(1)
  })

  it('shares the request with lazy self-check', async () => {
    const sdk = new WeiboSDK({ cookie: 'SUB=abc', selfCheck: { mode: 'lazy' } })
    const myDetails = vi.spyOn(sdk.users, 'myDetails')
      .mockResolvedValue(profile('42'))

    await sdk.selfCheck()
    const session = await sdk.getSession()

    expect(session.uid).toBe('42')
    expect(session.profile).toEqual(profile('42'))
    expect(myDetails).toHaveBeenCalledTimes(1)
  })

  it('forces a fresh probe with refresh and reuses it afterwards', async () => {
    const sdk = new WeiboSDK({ cookie: 'SUB=abc', selfCheck: { mode: 'none' } })
    const myDetails = vi.spyOn(sdk.users, 'myDetails')
      .mockResolvedValueOnce(profile('1'))
      .mockResolvedValueOnce(profile('2'))

    expect((await sdk.getSession()).uid).toBe('1')
    expect((await sdk.getSession({ refresh: true })).uid).toBe('2')
    expect((await sdk.getSession()).uid).toBe('2')
    expect(myDetails).toHaveBeenCalledTimes(2)
  })

  it('keeps uid undefined when the profile does not expose it', async () => {
    const sdk = new WeiboSDK({ cookie: 'SUB=abc', selfCheck: { mode: 'none' } })
    vi.spyOn(sdk.users, 'myDetails').mockResolvedValue(profile())

    const session = await sdk.getSession()

    expect(session.uid).toBeUndefined()
    expect(session.profile).toEqual(profile())
  })

  it('does not cache failures', async () => {
    const sdk = new WeiboSDK({ cookie: 'SUB=abc', selfCheck: { mode: 'none' } })
    const myDetails = vi.spyOn(sdk.users, 'myDetails')
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(profile('42'))

    await expect(sdk.getSession()).rejects.toThrow('network')
    await expect(sdk.getSession()).resolves.toMatchObject({ uid: '42' })
    expect(myDetails).toHaveBeenCalledTimes(2)
  })

  it('does not poison self-check with a retryable failure', async () => {
    const sdk = new WeiboSDK({ cookie: 'SUB=abc', selfCheck: { mode: 'lazy' } })
    const myDetails = vi.spyOn(sdk.users, 'myDetails')
      .mockRejectedValueOnce(new ConnectionTimeoutError('timeout'))
      .mockResolvedValueOnce(profile('42'))

    await expect(sdk.selfCheck()).rejects.toBeInstanceOf(ConnectionTimeoutError)
    await expect(sdk.selfCheck()).resolves.toBeUndefined()

    expect(myDetails).toHaveBeenCalledTimes(2)
  })

  it('caches a deterministic self-check failure', async () => {
    const sdk = new WeiboSDK({ cookie: 'SUB=abc', selfCheck: { mode: 'lazy' } })
    const myDetails = vi.spyOn(sdk.users, 'myDetails')
      .mockRejectedValue(new WeiboSessionExpiredError('expired'))

    await expect(sdk.selfCheck()).rejects.toBeInstanceOf(WeiboSessionExpiredError)
    await expect(sdk.selfCheck()).rejects.toBeInstanceOf(WeiboSessionExpiredError)

    expect(myDetails).toHaveBeenCalledTimes(1)
  })

  it('reuses the cached session in checkSession', async () => {
    const sdk = new WeiboSDK({ cookie: 'SUB=abc', selfCheck: { mode: 'none' } })
    const myDetails = vi.spyOn(sdk.users, 'myDetails')
      .mockResolvedValue(profile('42'))

    expect(await sdk.checkSession()).toBe(true)
    expect(await sdk.checkSession()).toBe(true)
    expect(myDetails).toHaveBeenCalledTimes(1)
  })
})
