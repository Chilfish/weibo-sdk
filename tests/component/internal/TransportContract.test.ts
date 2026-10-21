import type { AxiosInstance, AxiosRequestConfig } from 'axios'
import type { TransportRequest, TransportResponse, WeiboTransport } from '~/services/internal/transport'
import { createFakeFetch, fakeFetchResponse } from 'tests/testkit'
import { describe, expect, it } from 'vitest'
import { axiosTransport, fetchTransport, TransportFailure } from '~/services/internal/transport'

interface FakeAxiosResponse {
  status?: number
  data?: unknown
  headers?: Record<string, string | string[]>
}

/**
 * axios 替身：保留 `status` / `headers`（testkit 的 `createFakeAxios` 只回 `data`），
 * 供 transport 契约断言使用。
 */
function createStatusAxios(handler: (config: AxiosRequestConfig) => FakeAxiosResponse | Promise<FakeAxiosResponse>) {
  let calls = 0
  let lastConfig: AxiosRequestConfig | undefined

  const client = {
    interceptors: {
      request: { use() { return 0 } },
      response: { use() { return 0 }, eject() {}, clear() {} },
    },
    async request(config: AxiosRequestConfig) {
      calls += 1
      lastConfig = config
      const response = await handler(config)
      return {
        data: response.data,
        status: response.status ?? 200,
        statusText: 'OK',
        headers: response.headers ?? {},
        config,
      }
    },
  } as unknown as AxiosInstance

  return {
    client,
    getCalls: () => calls,
    getLastConfig: () => lastConfig,
  }
}

/** 两个 transport 共用的同一份请求（headers 键统一小写）。 */
function transportRequest(overrides: Partial<TransportRequest> = {}): TransportRequest {
  return {
    method: 'GET',
    url: 'https://weibo.com/ajax/test',
    headers: { 'referer': 'https://weibo.com/', 'x-contract': 'lowercase' },
    query: { uid: '1', tags: ['a', 'b'] },
    timeoutMs: 5000,
    redirect: 'follow',
    meta: { attempt: 1, traceId: 'trace-contract', authMode: 'cookie' },
    ...overrides,
  }
}

/** header 名小写化（大小写不敏感比较）；数组值拼成逗号串。 */
function lowerHeaders(headers: TransportResponse['headers']): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined)
      continue
    result[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value
  }
  return result
}

async function captureFailure(transport: WeiboTransport, request = transportRequest()): Promise<TransportFailure> {
  const error = await transport.send(request).then(() => undefined, (err: unknown) => err)
  expect(error).toBeInstanceOf(TransportFailure)
  return error as TransportFailure
}

function axiosError(options: { code?: string, isAxiosError?: boolean, message?: string } = {}): Error {
  const error = new Error(options.message ?? options.code ?? 'axios failure') as Error & Record<string, unknown>
  if (options.isAxiosError !== false)
    error.isAxiosError = true
  if (options.code !== undefined)
    error.code = options.code
  return error
}

function abortError(): Error {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

interface Scenario {
  name: string
  status: number
  data: unknown
  headers: Record<string, string>
  /** 需要单独按小写键断言的头。 */
  headerCase?: { name: string, value: string }
}

const SCENARIOS: Scenario[] = [
  {
    name: '200 JSON object',
    status: 200,
    data: { ok: 1, data: { id: 42, text: 'hi' } },
    headers: { 'Content-Type': 'application/json', 'X-Trace-Id': 'trace-abc' },
    headerCase: { name: 'Content-Type', value: 'application/json' },
  },
  {
    name: 'empty JSON object',
    status: 200,
    data: {},
    headers: { 'content-type': 'application/json' },
  },
  {
    name: 'HTML string body',
    status: 200,
    data: '<html><body>请登录 passport.weibo.com</body></html>',
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    headerCase: { name: 'CONTENT-TYPE', value: 'text/html; charset=utf-8' },
  },
  {
    name: '302 with location header',
    status: 302,
    data: '',
    headers: { 'Location': 'https://passport.weibo.com/sso/signin?url=x', 'Content-Type': 'text/html' },
    headerCase: { name: 'location', value: 'https://passport.weibo.com/sso/signin?url=x' },
  },
  {
    name: '403 JSON',
    status: 403,
    data: { ok: -100, message: 'forbidden' },
    headers: { 'Content-Type': 'application/json' },
  },
  {
    name: '432 JSON',
    status: 432,
    data: { ok: 0, message: 'frequent request' },
    headers: { 'Content-Type': 'application/json', 'Retry-After': '2' },
    headerCase: { name: 'retry-after', value: '2' },
  },
]

describe('transport contract (axios vs fetch)', () => {
  function transports(response: FakeAxiosResponse) {
    const axiosFake = createStatusAxios(() => response)
    const fetchFake = createFakeFetch(() => fakeFetchResponse({
      status: response.status,
      body: response.data,
      headers: response.headers as Record<string, string>,
    }))
    return {
      axios: axiosFake,
      fetch: fetchFake,
      send: {
        axios: (request = transportRequest()) => axiosTransport({ client: axiosFake.client }).send(request),
        fetch: (request = transportRequest()) => fetchTransport({ fetch: fetchFake.fetch }).send(request),
      },
    }
  }

  for (const scenario of SCENARIOS) {
    it(`agrees on status / data / headers for ${scenario.name}`, async () => {
      const harness = transports({
        status: scenario.status,
        data: scenario.data,
        headers: scenario.headers,
      })
      // 同一份 TransportRequest 同时驱动两种实现
      const viaAxios = await harness.send.axios()
      const viaFetch = await harness.send.fetch()

      expect(viaAxios.status).toBe(scenario.status)
      expect(viaFetch.status).toBe(scenario.status)
      expect(viaAxios.data).toEqual(scenario.data)
      expect(viaFetch.data).toEqual(viaAxios.data)

      // header 值（大小写不敏感）与请求头都在两种实现上一致
      expect(lowerHeaders(viaFetch.headers)).toEqual(lowerHeaders(viaAxios.headers))
      if (scenario.headerCase) {
        const key = scenario.headerCase.name.toLowerCase()
        expect(viaAxios.headers[key]).toBe(scenario.headerCase.value)
        expect(viaFetch.headers[key]).toBe(scenario.headerCase.value)
      }

      // 两者都把请求头下发（axios 见 config.headers，fetch 见 init.headers）
      expect(harness.axios.getLastConfig()?.headers).toMatchObject({ 'x-contract': 'lowercase' })
      expect(harness.fetch.getLastInit()?.headers).toMatchObject({ 'x-contract': 'lowercase' })
    })
  }

  it('returns HTTP statuses instead of throwing', async () => {
    for (const status of [302, 403, 432, 500]) {
      const harness = transports({ status, data: { ok: 0 }, headers: {} })
      await expect(harness.send.axios()).resolves.toMatchObject({ status })
      await expect(harness.send.fetch()).resolves.toMatchObject({ status })
    }
  })

  it('wraps timeouts in TransportFailure(kind: timeout) on both transports', async () => {
    const axiosFake = createStatusAxios(() => {
      throw axiosError({ code: 'ECONNABORTED', message: 'timeout of 5000ms exceeded' })
    })
    const fetchFake = createFakeFetch(() => {
      throw abortError()
    })

    const axiosFailure = await captureFailure(
      axiosTransport({ client: axiosFake.client }),
      transportRequest({ timeoutMs: 50 }),
    )
    const fetchFailure = await captureFailure(
      fetchTransport({ fetch: fetchFake.fetch }),
      transportRequest({ timeoutMs: 50 }),
    )

    expect(axiosFailure.kind).toBe('timeout')
    expect(fetchFailure.kind).toBe('timeout')
    expect(fetchFailure.name).toBe('TransportFailure')
  })

  it('wraps network failures in TransportFailure(kind: network) on both transports', async () => {
    const axiosFake = createStatusAxios(() => {
      throw axiosError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:443' })
    })
    const fetchFake = createFakeFetch(() => {
      throw new TypeError('fetch failed')
    })

    const axiosFailure = await captureFailure(axiosTransport({ client: axiosFake.client }))
    const fetchFailure = await captureFailure(fetchTransport({ fetch: fetchFake.fetch }))

    expect(axiosFailure.kind).toBe('network')
    expect(fetchFailure.kind).toBe('network')
  })

  it('treats a non-axios exception as a network failure', async () => {
    // axios 适配器抛出的非 AxiosError（例如 adapter 内部异常）也必须是 network
    const axiosFake = createStatusAxios(() => {
      throw new Error('socket hang up')
    })

    const failure = await captureFailure(axiosTransport({ client: axiosFake.client }))
    expect(failure.kind).toBe('network')
  })

  describe('fakeFetchResponse (testkit)', () => {
    it('exposes case-insensitive header reads and multi-value set-cookie', async () => {
      const response = fakeFetchResponse({
        status: 302,
        body: { ok: 1 },
        headers: { 'Content-Type': 'application/json', 'Location': 'https://passport.weibo.com/x' },
        setCookies: ['a=1', 'b=2'],
      })

      expect(response.status).toBe(302)
      expect(response.headers.get('content-type')).toBe('application/json')
      expect(response.headers.get('CONTENT-TYPE')).toBe('application/json')
      expect(response.headers.get('missing')).toBeNull()
      expect(response.headers.getSetCookie?.()).toEqual(['a=1', 'b=2'])
      await expect(response.text()).resolves.toBe('{"ok":1}')
    })
  })

  describe('fetchTransport', () => {
    it('appends query values including arrays', async () => {
      const fake = createFakeFetch(() => fakeFetchResponse({ body: { ok: 1 } }))
      const transport = fetchTransport({ fetch: fake.fetch })

      await transport.send(transportRequest({ query: { uid: '1', tags: ['a', 'b'], skip: undefined } }))

      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe('https://weibo.com/ajax/test?uid=1&tags=a&tags=b')
    })

    it('serializes a POST JSON body and defaults content-type', async () => {
      const fake = createFakeFetch(() => fakeFetchResponse({ body: { ok: 1 } }))
      const transport = fetchTransport({ fetch: fake.fetch })

      await transport.send(transportRequest({
        method: 'POST',
        query: undefined,
        body: { a: 1, b: '2' },
      }))

      const init = fake.getLastInit()
      expect(init?.method).toBe('POST')
      expect(init?.body).toBe('{"a":1,"b":"2"}')
      expect(init?.headers?.['content-type']).toBe('application/json')
    })

    it('serializes form-urlencoded body when content-type is set', async () => {
      const fake = createFakeFetch(() => fakeFetchResponse({ body: { ok: 1 } }))
      const transport = fetchTransport({ fetch: fake.fetch })

      await transport.send(transportRequest({
        method: 'POST',
        query: undefined,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: { a: 1, b: 'two words' },
      }))

      const init = fake.getLastInit()
      expect(init?.body).toBe('a=1&b=two+words')
      expect(init?.headers?.['content-type']).toBe('application/x-www-form-urlencoded')
    })

    it('passes redirect through and lowercases caller headers', async () => {
      const fake = createFakeFetch(() => fakeFetchResponse({ body: { ok: 1 } }))
      const transport = fetchTransport({ fetch: fake.fetch })

      await transport.send(transportRequest({
        headers: { 'X-Trace-Id': 'ABC', 'Accept': '*/*' },
        redirect: 'manual',
      }))

      const init = fake.getLastInit()
      expect(init?.redirect).toBe('manual')
      expect(init?.headers).toEqual({ 'x-trace-id': 'ABC', 'accept': '*/*' })
    })

    it('exposes multi-value set-cookie through getSetCookie', async () => {
      const fake = createFakeFetch(() => fakeFetchResponse({
        body: { ok: 1 },
        headers: { 'set-cookie': 'SUB=guest' },
        setCookies: ['SUB=guest; Path=/', 'SUBP=x; Path=/'],
      }))
      const transport = fetchTransport({ fetch: fake.fetch })

      const response = await transport.send(transportRequest())
      expect(response.headers['set-cookie']).toEqual(['SUB=guest; Path=/', 'SUBP=x; Path=/'])
    })

    it('reads a single set-cookie header through a case-insensitive get', async () => {
      // 无 getSetCookie 时回落到 headers.get('set-cookie')
      const fake = createFakeFetch(() => fakeFetchResponse({
        body: { ok: 1 },
        headers: { 'Set-Cookie': 'SUB=guest; Path=/' },
      }))
      const transport = fetchTransport({ fetch: fake.fetch })

      const response = await transport.send(transportRequest())
      expect(response.headers['set-cookie']).toBe('SUB=guest; Path=/')
    })

    it('times out via AbortController when the fetch never settles in time', async () => {
      // fetch 不 settle，等 transport 自己的 timeout 触发 abort → AbortError → timeout
      const fake = createFakeFetch((_url, init) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(abortError()))
      }))
      const transport = fetchTransport({ fetch: fake.fetch })

      const failure = await captureFailure(transport, transportRequest({ timeoutMs: 1 }))
      expect(failure.kind).toBe('timeout')
    })
  })

  describe('axiosTransport', () => {
    it('maps redirect: manual to maxRedirects: 0', async () => {
      const fake = createStatusAxios(() => ({ status: 200, data: { ok: 1 } }))
      const transport = axiosTransport({ client: fake.client })

      await transport.send(transportRequest({ redirect: 'manual' }))
      expect(fake.getLastConfig()?.maxRedirects).toBe(0)

      await transport.send(transportRequest({ redirect: 'follow' }))
      expect(fake.getLastConfig()?.maxRedirects).toBeUndefined()
    })

    it('never throws on HTTP error statuses (validateStatus returns true)', async () => {
      const fake = createStatusAxios(() => ({ status: 432, data: { ok: 0 } }))
      const transport = axiosTransport({ client: fake.client })

      const response = await transport.send(transportRequest())
      expect(response.status).toBe(432)

      const validateStatus = fake.getLastConfig()?.validateStatus
      expect(typeof validateStatus).toBe('function')
      expect(validateStatus?.(432)).toBe(true)
      expect(validateStatus?.(500)).toBe(true)
    })

    it('parses a proxy URL into axios proxy config', async () => {
      const fake = createStatusAxios(() => ({ status: 200, data: { ok: 1 } }))
      const transport = axiosTransport({ client: fake.client })

      await transport.send(transportRequest({ proxy: 'http://127.0.0.1:7890' }))
      expect(fake.getLastConfig()?.proxy).toMatchObject({
        protocol: 'http',
        host: '127.0.0.1',
        port: 7890,
      })

      await transport.send(transportRequest({ proxy: 'https://proxy.local' }))
      expect(fake.getLastConfig()?.proxy).toMatchObject({
        protocol: 'https',
        host: 'proxy.local',
        port: 443,
      })
    })

    it('passes proxy: false through and leaves proxy undefined when unset', async () => {
      const fake = createStatusAxios(() => ({ status: 200, data: { ok: 1 } }))
      const transport = axiosTransport({ client: fake.client })

      await transport.send(transportRequest({ proxy: false }))
      expect(fake.getLastConfig()?.proxy).toBe(false)

      await transport.send(transportRequest())
      expect(fake.getLastConfig()?.proxy).toBeUndefined()
    })

    it('returns the response from an AxiosError that carries one', async () => {
      // 某些 adapter 即使 validateStatus 通过也会带 response 抛错：仍需作为正常响应返回
      const fake = createStatusAxios(() => {
        const error = axiosError({ code: 'ERR_BAD_RESPONSE', message: 'max content length' }) as Error & Record<string, unknown>
        error.response = { status: 403, data: { ok: -100 }, headers: { 'Content-Type': 'application/json' } }
        throw error
      })
      const transport = axiosTransport({ client: fake.client })

      const response = await transport.send(transportRequest())
      expect(response.status).toBe(403)
      expect(response.data).toEqual({ ok: -100 })
      expect(response.headers['content-type']).toBe('application/json')
    })
  })
})
