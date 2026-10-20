import { createFakeMediaStore } from 'tests/testkit'
import { describe, expect, it } from 'vitest'
import { MediaDownloadError, MediaInvalidResponseError, MediaStorageError } from '~/models/errors/MediaError'
import { persistStream } from '~/services/internal/media/MediaStreamWriter'

function body(chunks: Uint8Array[]): AsyncIterable<Uint8Array> & { destroy: () => void } {
  return {
    async* [Symbol.asyncIterator]() {
      for (const chunk of chunks)
        yield chunk
    },
    destroy() {},
  }
}

const baseOptions = {
  overwrite: false,
  maxBytes: 1024,
  idleTimeoutMs: 1000,
}

describe('mediaStreamWriter', () => {
  it('writes to a temp file and renames on success', async () => {
    const fake = createFakeMediaStore()
    const result = await persistStream(body([new Uint8Array([1, 2]), new Uint8Array([3])]), {
      ...baseOptions,
      store: fake.store,
      finalPath: 'out/M1-01-p1.jpg',
      expectedBytes: 3,
      random: () => 0,
    })

    expect(result.bytes).toBe(3)
    expect(fake.files.get('out/M1-01-p1.jpg')).toEqual(new Uint8Array([1, 2, 3]))
    expect(fake.renames).toEqual([{ from: 'out/M1-01-p1.jpg.00000000.tmp', to: 'out/M1-01-p1.jpg' }])
    expect(fake.files.has('out/M1-01-p1.jpg.00000000.tmp')).toBe(false)
  })

  it('enforces the byte cap', async () => {
    const fake = createFakeMediaStore()
    await expect(persistStream(body([new Uint8Array([1, 2, 3])]), {
      ...baseOptions,
      maxBytes: 2,
      store: fake.store,
      finalPath: 'out/a.jpg',
    })).rejects.toBeInstanceOf(MediaInvalidResponseError)
  })

  it('rejects truncated and empty bodies', async () => {
    const fake = createFakeMediaStore()
    await expect(persistStream(body([new Uint8Array([1])]), {
      ...baseOptions,
      expectedBytes: 2,
      store: fake.store,
      finalPath: 'out/a.jpg',
    })).rejects.toMatchObject({ code: 'MEDIA_DOWNLOAD_FAILED', context: { reason: 'truncated' } })

    await expect(persistStream(body([]), {
      ...baseOptions,
      store: fake.store,
      finalPath: 'out/b.jpg',
    })).rejects.toBeInstanceOf(MediaDownloadError)
  })

  it('unlinks the target before overwrite and maps rename failures', async () => {
    const fake = createFakeMediaStore({ 'out/a.jpg': 1 })
    await persistStream(body([new Uint8Array([1])]), {
      ...baseOptions,
      overwrite: true,
      store: fake.store,
      finalPath: 'out/a.jpg',
    })
    expect(fake.unlinks).toContain('out/a.jpg')

    const failing = createFakeMediaStore()
    failing.failOn('rename', new Error('EPERM'))
    await expect(persistStream(body([new Uint8Array([1])]), {
      ...baseOptions,
      store: failing.store,
      finalPath: 'out/c.jpg',
    })).rejects.toBeInstanceOf(MediaStorageError)
  })

  it('cleans up temp files when aborted', async () => {
    const fake = createFakeMediaStore()
    const controller = new AbortController()
    controller.abort()

    await expect(persistStream(body([new Uint8Array([1])]), {
      ...baseOptions,
      store: fake.store,
      finalPath: 'out/a.jpg',
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })

    expect([...fake.files.keys()].some(path => path.endsWith('.tmp'))).toBe(false)
  })
})
