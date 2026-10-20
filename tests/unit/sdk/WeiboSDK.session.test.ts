import { describe, expect, it, vi } from 'vitest'
import { WeiboSDK } from '~/WeiboSDK'

function details(verifiedUrl?: string) {
  return {
    ok: 1,
    data: {
      ...(verifiedUrl === undefined ? {} : { verified_url: verifiedUrl }),
    },
  } as any
}

describe('weiboSDK session context', () => {
  it('parses uid and caches the session (single-flight)', async () => {
    const sdk = new WeiboSDK({ cookie: 'SUB=abc', selfCheck: { mode: 'none' } })
    const myDetails = vi.spyOn(sdk.users, 'myDetails')
      .mockResolvedValue(details('https://verified.weibo.com/verify?fr=myverified?uid=42'))

    const [first, second] = await Promise.all([sdk.getSession(), sdk.getSession()])

    expect(first.uid).toBe('42')
    expect(second).toBe(first)
    expect(first.checkedAt).toEqual(expect.any(Number))
    expect(myDetails).toHaveBeenCalledTimes(1)
    expect(await sdk.getSession()).toBe(first)
    expect(myDetails).toHaveBeenCalledTimes(1)
  })

  it('shares the request with lazy self-check', async () => {
    const sdk = new WeiboSDK({ cookie: 'SUB=abc', selfCheck: { mode: 'lazy' } })
    const myDetails = vi.spyOn(sdk.users, 'myDetails')
      .mockResolvedValue(details('https://verified.weibo.com/verify?fr=myverified?uid=42'))

    await sdk.selfCheck()
    const session = await sdk.getSession()

    expect(session.uid).toBe('42')
    expect(myDetails).toHaveBeenCalledTimes(1)
  })

  it('forces a fresh probe with refresh and reuses it afterwards', async () => {
    const sdk = new WeiboSDK({ cookie: 'SUB=abc', selfCheck: { mode: 'none' } })
    const myDetails = vi.spyOn(sdk.users, 'myDetails')
      .mockResolvedValueOnce(details('https://verified.weibo.com/verify?fr=myverified?uid=1'))
      .mockResolvedValueOnce(details('https://verified.weibo.com/verify?fr=myverified?uid=2'))

    expect((await sdk.getSession()).uid).toBe('1')
    expect((await sdk.getSession({ refresh: true })).uid).toBe('2')
    expect((await sdk.getSession()).uid).toBe('2')
    expect(myDetails).toHaveBeenCalledTimes(2)
  })

  it('does not cache failures', async () => {
    const sdk = new WeiboSDK({ cookie: 'SUB=abc', selfCheck: { mode: 'none' } })
    const myDetails = vi.spyOn(sdk.users, 'myDetails')
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(details('https://verified.weibo.com/verify?fr=myverified?uid=42'))

    await expect(sdk.getSession()).rejects.toThrow('network')
    await expect(sdk.getSession()).resolves.toMatchObject({ uid: '42' })
    expect(myDetails).toHaveBeenCalledTimes(2)
  })

  it('reuses the cached session in checkSession', async () => {
    const sdk = new WeiboSDK({ cookie: 'SUB=abc', selfCheck: { mode: 'none' } })
    const myDetails = vi.spyOn(sdk.users, 'myDetails')
      .mockResolvedValue(details('https://verified.weibo.com/verify?fr=myverified?uid=42'))

    expect(await sdk.checkSession()).toBe(true)
    expect(await sdk.checkSession()).toBe(true)
    expect(myDetails).toHaveBeenCalledTimes(1)
  })
})
