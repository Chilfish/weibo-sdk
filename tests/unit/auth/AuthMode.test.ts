import type { GuestFetch, GuestFetchResponse } from '~/services/internal/GuestTokenService'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { createAuthContext, isAuthFailureReason, resolveAuthMode } from '~/services/internal/CredentialResolver'

const GEN_VISITOR_URL = 'https://visitor.passport.weibo.cn/visitor/genvisitor'
const INCARNATE_URL = 'https://visitor.passport.weibo.cn/visitor/visitor'

interface FakeResponseInit {
  status?: number
  body?: string
  setCookies?: string[]
}

/** 构造符�?`GuestFetchResponse` 契约的假响应（不触碰真实网络）�? */
function fakeResponse(init: FakeResponseInit = {}): GuestFetchResponse {
  const status = init.status ?? 200
  const setCookies = init.setCookies ?? []
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'set-cookie' ? setCookies[0] ?? null : null),
      getSetCookie: () => setCookies,
    },
    text: async () => init.body ?? '',
  }
}

/** 只应�?genvisitor �?incarnate 的假 fetch，并记录所有调�?URL�? */
function createGuestFetchStub(): { fetch: GuestFetch, calls: string[] } {
  const calls: string[] = []
  const fetchImpl: GuestFetch = async (url) => {
    calls.push(url)
    if (url === GEN_VISITOR_URL) {
      return fakeResponse({
        body: 'window.gen_callback && gen_callback({"retcode":20000000,"data":{"tid":"TID_STUB"}})',
      })
    }
    if (url.startsWith(INCARNATE_URL)) {
      return fakeResponse({
        body: 'cross_domain_callback({"retcode":20000000})',
        setCookies: ['SUB=guest_sub; Path=/; Domain=.weibo.cn', 'SUBP=guest_subp; Path=/'],
      })
    }
    throw new Error(`Unexpected fetch call: ${url}`)
  }
  return { fetch: fetchImpl, calls }
}

/** 断言同步调用抛错并返回错误（没有抛错时让测试失败，而不是跳过）�? */
function captureError(fn: () => unknown): unknown {
  try {
    fn()
  }
  catch (error) {
    return error
  }
  throw new Error('Expected the call to throw, but it returned normally.')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveAuthMode', () => {
  it('uses cookie for auto when a cookie is provided', () => {
    expect(resolveAuthMode({ auth: 'auto', cookie: 'SUB=abc; SUBP=def' })).toBe('cookie')
  })

  it('falls back to guest for auto when no cookie is provided', () => {
    expect(resolveAuthMode({ auth: 'auto' })).toBe('guest')
    expect(resolveAuthMode({})).toBe('guest')
  })

  it('treats a blank cookie as missing in auto mode', () => {
    expect(resolveAuthMode({ auth: 'auto', cookie: '   ' })).toBe('guest')
  })

  it('uses cookie for explicit cookie mode with a cookie', () => {
    expect(resolveAuthMode({ auth: 'cookie', cookie: 'SUB=abc' })).toBe('cookie')
  })

  it('throws CONFIG_INVALID for explicit cookie mode without a cookie', () => {
    const error = captureError(() => resolveAuthMode({ auth: 'cookie' }))

    expect(error).toBeInstanceOf(InvalidConfigError)
    expect(error).toMatchObject({ code: 'CONFIG_INVALID' })
  })

  it('throws CONFIG_INVALID for explicit cookie mode with a blank cookie', () => {
    expect(() => resolveAuthMode({ auth: 'cookie', cookie: '  ' })).toThrowError(InvalidConfigError)
  })

  it('always uses guest for explicit guest mode even when a cookie exists', () => {
    expect(resolveAuthMode({ auth: 'guest', cookie: 'SUB=abc; SUBP=def' })).toBe('guest')
  })
})

describe('createAuthContext: cookie mode', () => {
  it('exposes a cookie provider that injects the Cookie header', async () => {
    const context = createAuthContext({ auth: 'cookie', cookie: 'SUB=abc; SUBP=def' })

    expect(context.mode).toBe('cookie')
    expect(context.guestTokens).toBeUndefined()

    const provider = await context.getCredential('cookie')
    expect(provider.mode).toBe('cookie')
    await expect(provider.getHeaders()).resolves.toEqual({ Cookie: 'SUB=abc; SUBP=def' })
  })

  it('returns no headers and no Cookie for none endpoints', async () => {
    const context = createAuthContext({ auth: 'auto', cookie: 'SUB=abc; SUBP=def' })

    const provider = await context.getCredential('none')

    expect(provider.mode).toBe('none')
    await expect(provider.getHeaders()).resolves.toEqual({})
  })
})

describe('createAuthContext: guest mode', () => {
  it('issues a token and injects a Cookie containing SUB', async () => {
    const stub = createGuestFetchStub()
    vi.stubGlobal('fetch', stub.fetch)

    const context = createAuthContext({ auth: 'guest' })
    const provider = await context.getCredential('guest')

    expect(context.mode).toBe('guest')
    expect(context.guestTokens).toBeDefined()
    expect(provider.mode).toBe('guest')

    const headers = await provider.getHeaders()

    expect(headers.Cookie).toContain('SUB=')
    expect(headers.Cookie).toContain('SUBP=')
    expect(headers.Cookie).toContain('WEIBOCN_FROM=1110003030')
    expect(stub.calls).toEqual([GEN_VISITOR_URL, expect.stringContaining('a=incarnate')])
  })

  it('returns no headers and issues no token for none endpoints', async () => {
    const stub = createGuestFetchStub()
    vi.stubGlobal('fetch', stub.fetch)

    const context = createAuthContext({ auth: 'guest' })
    const provider = await context.getCredential('none')

    expect(provider.mode).toBe('none')
    await expect(provider.getHeaders()).resolves.toEqual({})
    expect(stub.calls).toHaveLength(0)
  })

  it('does not issue a token when config.guest.token is preset', async () => {
    const calls: string[] = []
    const fetchImpl: GuestFetch = async (url) => {
      calls.push(url)
      throw new Error('fetch must not be called when guest.token is preset')
    }
    vi.stubGlobal('fetch', fetchImpl)

    const context = createAuthContext({
      auth: 'guest',
      guest: { token: 'SUB=preset_sub; SUBP=preset_subp' },
    })

    const headers = await (await context.getCredential('guest')).getHeaders()

    expect(headers.Cookie).toBe('SUB=preset_sub; SUBP=preset_subp')
    expect(calls).toHaveLength(0)
  })
})

describe('isAuthFailureReason', () => {
  it('accepts all six structured reasons', () => {
    const reasons = [
      'redirect_to_login',
      'visitor_entry',
      'ok_minus_100',
      'forbidden',
      'empty_object',
      'html',
    ] as const

    for (const reason of reasons)
      expect(isAuthFailureReason(reason)).toBe(true)
  })

  it('rejects unknown or non-string values', () => {
    expect(isAuthFailureReason('ok')).toBe(false)
    expect(isAuthFailureReason('OK_MINUS_100')).toBe(false)
    expect(isAuthFailureReason('')).toBe(false)
    expect(isAuthFailureReason(undefined)).toBe(false)
    expect(isAuthFailureReason(null)).toBe(false)
    expect(isAuthFailureReason(0)).toBe(false)
    expect(isAuthFailureReason({ reason: 'html' })).toBe(false)
  })
})
