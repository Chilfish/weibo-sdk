import type { MediaByteStream, MediaHttpClient, MediaHttpRequest } from '~/services/internal/media/MediaHttpClient'

export interface FakeMediaResponse {
  status?: number
  headers?: Record<string, string>
  chunks?: Uint8Array[]
  failWith?: unknown
  onDestroy?: () => void
}

export interface FakeMediaHttp {
  client: MediaHttpClient
  calls: MediaHttpRequest[]
  destroyed: boolean[]
}

function createBody(chunks: Uint8Array[], onDestroy?: () => void): MediaByteStream {
  return {
    async* [Symbol.asyncIterator]() {
      for (const chunk of chunks)
        yield chunk
    },
    destroy() {
      onDestroy?.()
    },
  }
}

export function createFakeMediaHttpClient(
  handler: (request: MediaHttpRequest) => FakeMediaResponse | Promise<FakeMediaResponse>,
): FakeMediaHttp {
  const calls: MediaHttpRequest[] = []
  const destroyed: boolean[] = []

  return {
    calls,
    destroyed,
    client: {
      async open(request) {
        calls.push(request)
        const response = await handler(request)
        if (response.failWith !== undefined)
          throw response.failWith

        let disposed = false
        const chunks = response.chunks ?? [new Uint8Array([1, 2, 3])]
        return {
          status: response.status ?? 200,
          finalUrl: request.url,
          contentType: response.headers?.['content-type'] ?? 'image/jpeg',
          contentLength: response.headers?.['content-length'] !== undefined
            ? Number(response.headers['content-length'])
            : chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
          body: createBody(chunks, () => {
            destroyed.push(true)
            response.onDestroy?.()
          }),
          dispose: () => {
            if (disposed)
              return
            disposed = true
            destroyed.push(true)
            response.onDestroy?.()
          },
        }
      },
    },
  }
}
