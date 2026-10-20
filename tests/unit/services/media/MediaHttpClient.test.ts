import type { AxiosRequestConfig } from 'axios'
import { describe, expect, it } from 'vitest'
import { MediaDownloadError, MediaInvalidResponseError } from '~/models/errors/MediaError'
import { createAxiosMediaHttpClient, DEFAULT_MEDIA_ALLOWED_HOSTS } from '~/services/internal/media/MediaHttpClient'

function createTransport(
  handler: (config: AxiosRequestConfig) => {
    status: number
    headers?: Record<string, string>
    data?: AsyncIterable<Uint8Array> & { destroy?: () => void }
  },
) {
  const calls: AxiosRequestConfig[] = []
  return {
    calls,
    transport: {
      async request(config: AxiosRequestConfig) {
        calls.push(config)
        const response = handler(config)
        return {
          status: response.status,
          headers: response.headers ?? {},
          data: response.data ?? { async* [Symbol.asyncIterator]() {} },
        }
      },
    },
  }
}

const baseRequest = {
  url: 'https://wx1.sinaimg.cn/large/pid.jpg',
  referer: 'https://weibo.com/',
  timeoutMs: 1000,
  allowedHosts: DEFAULT_MEDIA_ALLOWED_HOSTS,
}

describe('mediaHttpClient', () => {
  it('sends no cookies and uses streaming config', async () => {
    const { calls, transport } = createTransport(() => ({ status: 200, headers: { 'content-type': 'image/jpeg; charset=x', 'content-length': '3' } }))
    const client = createAxiosMediaHttpClient({ transport })

    const response = await client.open(baseRequest)

    expect(response.contentType).toBe('image/jpeg')
    expect(response.contentLength).toBe(3)
    expect(calls[0].responseType).toBe('stream')
    expect(calls[0].maxRedirects).toBe(0)
    expect(calls[0].headers?.referer).toBe('https://weibo.com/')
    expect(calls[0].headers?.['accept-encoding']).toBe('identity')
    expect(calls[0].headers).not.toHaveProperty('Cookie')
    expect(calls[0].headers).not.toHaveProperty('cookie')
  })

  it('follows same-host redirects but rejects unknown hosts', async () => {
    const { calls, transport } = createTransport((config): { status: number, headers?: Record<string, string> } => {
      if (config.url === baseRequest.url)
        return { status: 302, headers: { location: '/large/next.jpg' } }
      return { status: 200, headers: { 'content-type': 'image/jpeg' } }
    })
    const client = createAxiosMediaHttpClient({ transport })
    const response = await client.open(baseRequest)
    expect(response.finalUrl).toBe('https://wx1.sinaimg.cn/large/next.jpg')
    expect(calls).toHaveLength(2)

    const evil = createTransport(() => ({ status: 302, headers: { location: 'https://evil.com/a.jpg' } }))
    const evilClient = createAxiosMediaHttpClient({ transport: evil.transport })
    await expect(evilClient.open(baseRequest)).rejects.toBeInstanceOf(MediaInvalidResponseError)
  })

  it('maps 403/404/410 to expired and 5xx/429 to retryable errors', async () => {
    for (const status of [403, 404, 410]) {
      const { transport } = createTransport(() => ({ status }))
      const client = createAxiosMediaHttpClient({ transport })
      const error = await client.open(baseRequest).catch(value => value)
      expect(error).toBeInstanceOf(MediaDownloadError)
      expect(error.context?.reason).toBe('expired')
    }

    const { transport } = createTransport(() => ({ status: 429, headers: { 'retry-after': '2' } }))
    const client = createAxiosMediaHttpClient({ transport })
    const error = await client.open(baseRequest).catch(value => value)
    expect(error).toBeInstanceOf(MediaDownloadError)
    expect(error.context?.reason).toBe('rate-limit')
    expect(error.context?.retryAfterMs).toBe(2000)
  })

  it('rejects non-media statuses and disallowed initial hosts', async () => {
    const { transport } = createTransport(() => ({ status: 400 }))
    const client = createAxiosMediaHttpClient({ transport })
    await expect(client.open(baseRequest)).rejects.toBeInstanceOf(MediaInvalidResponseError)

    await expect(client.open({ ...baseRequest, url: 'https://evil.com/a.jpg' }))
      .rejects
      .toBeInstanceOf(MediaInvalidResponseError)
  })
})
