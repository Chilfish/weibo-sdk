import type { GuestFetch, GuestFetchResponse } from '~/services/internal/GuestTokenService'
import { describe, expect, it } from 'vitest'
import { WeiboSessionExpiredError } from '~/models/errors/BusinessError'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { RateLimitError } from '~/models/errors/TransportError'
import {
  GuestTokenService,
  MOBILE_USER_AGENT,
  parseJsonp,
  readSetCookie,
} from '~/services/internal/GuestTokenService'

const ISSUED_AT = 1_700_000_000_000
const GEN_VISITOR_URL = 'https://visitor.passport.weibo.cn/visitor/genvisitor'
const INCARNATE_URL = 'https://visitor.passport.weibo.cn/visitor/visitor'

interface FakeGuestClock {
  now: () => number
  advanceTo: (value: number) => void
}

/** 可注入时钟（`GuestTokenClock` 的最小实现，带推进方法）。 */
function createFakeClock(start: number = ISSUED_AT): FakeGuestClock {
  let current = start
  return {
    now: () => current,
    advanceTo: (value: number) => {
      current = value
    },
  }
}

interface FakeResponseInit {
  status?: number
  body?: string
  setCookies?: string[]
}

/** 构造符合 `GuestFetchResponse` 契约的假响应（不触碰真实网络）。 */
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

interface FetchCall {
  url: string
  method: string
  body?: string
  headers?: Record<string, string>
}

type FetchStep = GuestFetchResponse | ((call: FetchCall) => GuestFetchResponse)

/** 顺序应答的假 fetch：记录调用并按顺序返回预设响应。 */
function createFakeFetch(steps: FetchStep[]): {
  fetch: GuestFetch
  calls: FetchCall[]
} {
  const pending = [...steps]
  const calls: FetchCall[] = []
  const fetchImpl: GuestFetch = async (url, init) => {
    const call: FetchCall = {
      url,
      method: init?.method ?? 'GET',
      body: init?.body,
      headers: init?.headers,
    }
    calls.push(call)
    const step = pending.shift()
    if (!step)
      throw new Error(`Unexpected guest fetch call: ${call.method} ${url}`)
    return typeof step === 'function' ? step(call) : step
  }
  return { fetch: fetchImpl, calls }
}

function genvisitorBody(tid: string = 'TID_FAKE_1'): string {
  return `window.gen_callback && gen_callback({"retcode":20000000,"msg":"succ","data":{"tid":"${tid}"}})`
}

const INCARNATE_BODY = 'cross_domain_callback({"retcode":20000000,"msg":"succ"})'

function incarnationSetCookies(sub: string, subp?: string): string[] {
  return [
    `SUB=${sub}; Path=/; Domain=.weibo.cn; HttpOnly`,
    ...(subp === undefined ? [] : [`SUBP=${subp}; Path=/; Domain=.weibo.cn`]),
  ]
}

/** 断言同步调用抛错并返回错误（没有抛错时让测试失败，而不是跳过）。 */
function captureError(fn: () => unknown): unknown {
  try {
    fn()
  }
  catch (error) {
    return error
  }
  throw new Error('Expected the call to throw, but it returned normally.')
}

describe('parseJsonp', () => {
  it('parses the standard window.cb && cb(...) wrapper', () => {
    expect(parseJsonp('window.cb && cb({"retcode":20000000})')).toEqual({ retcode: 20000000 })
  })

  it('tolerates leading and trailing whitespace', () => {
    const body = '\n  window.gen_callback && gen_callback({"data":{"tid":"TID_X"}})  \n\t'

    expect(parseJsonp(body)).toEqual({ data: { tid: 'TID_X' } })
  })

  it('returns undefined when the body contains no JSON object', () => {
    expect(parseJsonp('rate limited')).toBeUndefined()
    expect(parseJsonp('')).toBeUndefined()
    expect(parseJsonp('cb()')).toBeUndefined()
  })

  it('returns undefined for malformed JSON instead of throwing', () => {
    expect(parseJsonp('cb({"a":1,})')).toBeUndefined()
    expect(parseJsonp('cb({"a":oops})')).toBeUndefined()
    expect(parseJsonp('cb({"a":1')).toBeUndefined()
  })
})

describe('readSetCookie', () => {
  it('finds SUB and SUBP in a Set-Cookie array', () => {
    const cookies = [
      'SUB=abc123; Path=/; Domain=.weibo.cn; HttpOnly',
      'SUBP=def456; Path=/; Domain=.weibo.cn',
    ]

    expect(readSetCookie(cookies, 'SUB')).toBe('abc123')
    expect(readSetCookie(cookies, 'SUBP')).toBe('def456')
  })

  it('matches cookie names case-sensitively', () => {
    expect(readSetCookie(['sub=abc123; Path=/'], 'SUB')).toBeUndefined()
    expect(readSetCookie(['SUB=abc123; Path=/'], 'sub')).toBeUndefined()
  })

  it('returns undefined when SUBP is absent', () => {
    expect(readSetCookie(['SUB=abc123; Path=/'], 'SUBP')).toBeUndefined()
  })

  it('handles a combined header whose Expires values contain commas', () => {
    const combined = 'SUBP=def456; Expires=Wed, 21 Oct 2015 07:28:00 GMT, '
      + 'SUB=abc123; Path=/; Expires=Thu, 22 Oct 2015 07:28:00 GMT'

    expect(readSetCookie([combined], 'SUB')).toBe('abc123')
    expect(readSetCookie([combined], 'SUBP')).toBe('def456')
  })

  it('returns undefined for empty cookie lists', () => {
    expect(readSetCookie([], 'SUB')).toBeUndefined()
    expect(readSetCookie(['', ''], 'SUB')).toBeUndefined()
  })
})

describe('guestTokenService mobile issuance', () => {
  it('posts genvisitor then gets incarnate and builds the cookie header', async () => {
    const { fetch, calls } = createFakeFetch([
      fakeResponse({ body: genvisitorBody('TID_FAKE_1') }),
      fakeResponse({
        body: INCARNATE_BODY,
        setCookies: incarnationSetCookies('_2A25FAKE', '0033WrFAKE'),
      }),
    ])
    const clock = createFakeClock()
    const service = new GuestTokenService({ fetch, clock })

    const token = await service.getToken()

    expect(calls).toHaveLength(2)

    expect(calls[0].url).toBe(GEN_VISITOR_URL)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].body).toContain('cb=gen_callback')
    expect(calls[0].headers?.['user-agent']).toBe(MOBILE_USER_AGENT)

    expect(calls[1].method).toBe('GET')
    expect(calls[1].url.startsWith(`${INCARNATE_URL}?a=incarnate&t=TID_FAKE_1&`)).toBe(true)

    expect(token.cookie).toContain('SUB=')
    expect(token.cookie).toContain('SUBP=')
    expect(token.cookie).toContain('WEIBOCN_FROM=1110003030')
    expect(token.cookie).toBe('SUB=_2A25FAKE; SUBP=0033WrFAKE; WEIBOCN_FROM=1110003030')
    expect(token.source).toBe('mobile')
    expect(token.scope).toBe('all')
    expect(token.issuedAt).toBe(ISSUED_AT)
  })

  it('falls back to JSONP data.sub / data.subp when Set-Cookie is absent', async () => {
    const { fetch, calls } = createFakeFetch([
      fakeResponse({ body: genvisitorBody() }),
      fakeResponse({
        body: 'cross_domain_callback({"retcode":20000000,"data":{"sub":"SUB_FROM_BODY","subp":"SUBP_FROM_BODY"}})',
      }),
    ])
    const service = new GuestTokenService({ fetch, clock: createFakeClock() })

    const token = await service.getToken()

    expect(calls).toHaveLength(2)
    expect(token.cookie).toBe('SUB=SUB_FROM_BODY; SUBP=SUBP_FROM_BODY; WEIBOCN_FROM=1110003030')
  })

  it('omits SUBP when only data.sub is returned', async () => {
    const { fetch } = createFakeFetch([
      fakeResponse({ body: genvisitorBody() }),
      fakeResponse({
        body: 'cross_domain_callback({"retcode":20000000,"data":{"sub":"SUB_ONLY"}})',
      }),
    ])
    const service = new GuestTokenService({ fetch, clock: createFakeClock() })

    const token = await service.getToken()

    expect(token.cookie).toBe('SUB=SUB_ONLY; WEIBOCN_FROM=1110003030')
  })
})

describe('guestTokenService failures', () => {
  it('rejects with AUTH_SESSION_EXPIRED when genvisitor returns no tid', async () => {
    const { fetch, calls } = createFakeFetch([
      fakeResponse({ body: 'window.gen_callback && gen_callback({"retcode":-1,"msg":"no tid"})' }),
    ])
    const service = new GuestTokenService({ fetch, clock: createFakeClock() })

    const issuance = service.getToken()

    await expect(issuance).rejects.toBeInstanceOf(WeiboSessionExpiredError)
    await expect(issuance).rejects.toMatchObject({ code: 'AUTH_SESSION_EXPIRED' })
    expect(calls).toHaveLength(1)
  })

  it('rejects with AUTH_SESSION_EXPIRED when incarnate returns no SUB', async () => {
    const { fetch, calls } = createFakeFetch([
      fakeResponse({ body: genvisitorBody() }),
      fakeResponse({ body: INCARNATE_BODY }),
    ])
    const service = new GuestTokenService({ fetch, clock: createFakeClock() })

    const issuance = service.getToken()

    await expect(issuance).rejects.toBeInstanceOf(WeiboSessionExpiredError)
    await expect(issuance).rejects.toMatchObject({ code: 'AUTH_SESSION_EXPIRED' })
    expect(calls).toHaveLength(2)
  })

  it('rejects with RateLimitError on HTTP 432 and does not retry', async () => {
    const { fetch, calls } = createFakeFetch([
      fakeResponse({ status: 432, body: 'rate limited' }),
    ])
    const service = new GuestTokenService({ fetch, clock: createFakeClock() })

    const issuance = service.getToken()

    await expect(issuance).rejects.toBeInstanceOf(RateLimitError)
    await expect(issuance).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    expect(calls).toHaveLength(1)
  })

  it('rejects when genvisitor fails with a non-2xx status', async () => {
    const { fetch, calls } = createFakeFetch([
      fakeResponse({ status: 500, body: 'boom' }),
    ])
    const service = new GuestTokenService({ fetch, clock: createFakeClock() })

    const issuance = service.getToken()

    await expect(issuance).rejects.toBeInstanceOf(WeiboSessionExpiredError)
    await expect(issuance).rejects.toMatchObject({ code: 'AUTH_SESSION_EXPIRED' })
    expect(calls).toHaveLength(1)
  })
})

describe('guestTokenService caching and single-flight', () => {
  it('issues exactly once for two concurrent getToken() calls', async () => {
    const { fetch, calls } = createFakeFetch([
      fakeResponse({ body: genvisitorBody() }),
      fakeResponse({
        body: INCARNATE_BODY,
        setCookies: incarnationSetCookies('SUB_SHARED', 'SUBP_SHARED'),
      }),
    ])
    const service = new GuestTokenService({ fetch, clock: createFakeClock() })

    const [first, second] = await Promise.all([service.getToken(), service.getToken()])

    expect(first).toBe(second)
    expect(calls.filter(call => call.url === GEN_VISITOR_URL)).toHaveLength(1)
    expect(calls.filter(call => call.url.startsWith(INCARNATE_URL))).toHaveLength(1)
    expect(calls).toHaveLength(2)
  })

  it('serves the cached token without calling fetch again', async () => {
    const { fetch, calls } = createFakeFetch([
      fakeResponse({ body: genvisitorBody() }),
      fakeResponse({
        body: INCARNATE_BODY,
        setCookies: incarnationSetCookies('SUB_CACHED', 'SUBP_CACHED'),
      }),
    ])
    const service = new GuestTokenService({ fetch, clock: createFakeClock() })

    const first = await service.getToken()
    const second = await service.getToken()

    expect(second).toBe(first)
    expect(calls).toHaveLength(2)
    expect(service.getStatus()).toMatchObject({ source: 'mobile', scope: 'all', issuedAt: ISSUED_AT })
  })
})

describe('guestTokenService refresh', () => {
  it('replaces the cached token on success', async () => {
    const { fetch, calls } = createFakeFetch([
      fakeResponse({ body: genvisitorBody('TID_FIRST') }),
      fakeResponse({
        body: INCARNATE_BODY,
        setCookies: incarnationSetCookies('SUB_FIRST', 'SUBP_FIRST'),
      }),
      fakeResponse({ body: genvisitorBody('TID_SECOND') }),
      fakeResponse({
        body: INCARNATE_BODY,
        setCookies: incarnationSetCookies('SUB_SECOND', 'SUBP_SECOND'),
      }),
    ])
    const clock = createFakeClock()
    const service = new GuestTokenService({ fetch, clock })

    const first = await service.getToken()
    expect(first.cookie).toContain('SUB=SUB_FIRST')

    clock.advanceTo(ISSUED_AT + 60_000)
    const refreshed = await service.refresh()

    expect(refreshed).toBe(true)
    expect(calls).toHaveLength(4)

    const second = await service.getToken()
    expect(second.cookie).toContain('SUB=SUB_SECOND')
    expect(second.cookie).not.toContain('SUB=SUB_FIRST')
    expect(second.issuedAt).toBe(ISSUED_AT + 60_000)
  })

  it('keeps the previous token and returns false when refresh fails', async () => {
    const { fetch, calls } = createFakeFetch([
      fakeResponse({ body: genvisitorBody() }),
      fakeResponse({
        body: INCARNATE_BODY,
        setCookies: incarnationSetCookies('SUB_STABLE', 'SUBP_STABLE'),
      }),
      fakeResponse({ status: 432, body: 'rate limited' }),
    ])
    const service = new GuestTokenService({ fetch, clock: createFakeClock() })

    const first = await service.getToken()
    const refreshed = await service.refresh()

    expect(refreshed).toBe(false)
    expect(calls).toHaveLength(3)

    const still = await service.getToken()
    expect(still).toBe(first)
    expect(still.cookie).toBe('SUB=SUB_STABLE; SUBP=SUBP_STABLE; WEIBOCN_FROM=1110003030')
    expect(still.issuedAt).toBe(first.issuedAt)
  })

  it('shares one in-flight refresh between concurrent calls', async () => {
    const { fetch, calls } = createFakeFetch([
      fakeResponse({ body: genvisitorBody('TID_FIRST') }),
      fakeResponse({
        body: INCARNATE_BODY,
        setCookies: incarnationSetCookies('SUB_FIRST'),
      }),
      fakeResponse({ body: genvisitorBody('TID_SECOND') }),
      fakeResponse({
        body: INCARNATE_BODY,
        setCookies: incarnationSetCookies('SUB_SECOND'),
      }),
    ])
    const service = new GuestTokenService({ fetch, clock: createFakeClock() })

    await service.getToken()
    const [a, b] = await Promise.all([service.refresh(), service.refresh()])

    expect(a).toBe(true)
    expect(b).toBe(true)
    expect(calls).toHaveLength(4)
  })
})

describe('guestTokenService preset token', () => {
  it('returns the preset token without calling fetch', async () => {
    const calls: string[] = []
    const fetchImpl: GuestFetch = async (url) => {
      calls.push(url)
      throw new Error('fetch must not be called when a preset token is provided')
    }
    const clock = createFakeClock()
    const service = new GuestTokenService({
      presetToken: 'SUB=preset_sub; SUBP=preset_subp',
      fetch: fetchImpl,
      clock,
    })

    const token = await service.getToken()

    expect(token.cookie).toBe('SUB=preset_sub; SUBP=preset_subp')
    expect(token.source).toBe('preset')
    expect(token.scope).toBe('all')
    expect(token.issuedAt).toBe(ISSUED_AT)
    expect(calls).toHaveLength(0)
  })

  it('throws CONFIG_INVALID when the preset token has no SUB', () => {
    const error = captureError(() => new GuestTokenService({
      presetToken: 'SUBP=only_subp; WEIBOCN_FROM=1110003030',
      fetch: async () => fakeResponse(),
    }))

    expect(error).toBeInstanceOf(InvalidConfigError)
    expect(error).toMatchObject({ code: 'CONFIG_INVALID' })
  })

  // 源码缺陷（未修改源码，仅记录）：构造函数用 `deps.presetToken?.trim()` 保存 token，
  // 但校验 `hasSub(deps.presetToken)` 跑在未 trim 的原始字符串上，`hasSub` 要求 SUB 位于
  // 开头或 `;` 之后，因此带前导空白的合法 token（如来自环境变量的 ' SUB=...'）会被
  // 误判为 CONFIG_INVALID，而同样的 token 尾部空白却能通过。修复应在校验前 trim。
  it('accepts a preset token with surrounding whitespace (known source bug)', async () => {
    const calls: string[] = []
    const fetchImpl: GuestFetch = async (url) => {
      calls.push(url)
      throw new Error('fetch must not be called when a preset token is provided')
    }
    const service = new GuestTokenService({
      presetToken: '  SUB=preset_sub; SUBP=preset_subp \n',
      fetch: fetchImpl,
      clock: createFakeClock(),
    })

    const token = await service.getToken()

    expect(token.cookie).toBe('SUB=preset_sub; SUBP=preset_subp')
    expect(token.source).toBe('preset')
    expect(calls).toHaveLength(0)
  })
})
