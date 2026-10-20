import type { MediaFileStore, MediaWriteStream } from '~/services/internal/media/MediaFileStore'

export interface FakeMediaStore {
  store: MediaFileStore
  files: Map<string, Uint8Array>
  writes: Array<{ path: string, bytes: number }>
  renames: Array<{ from: string, to: string }>
  unlinks: string[]
  failOn: (op: 'mkdir' | 'write' | 'rename' | 'unlink' | 'stat', error: Error) => void
}

function joinPath(parts: string[]): string {
  return parts
    .filter(part => part !== '')
    .join('/')
    .replace(/\/+/g, '/')
}

function dirnameOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index <= 0 ? '' : path.slice(0, index)
}

export function createFakeMediaStore(seed: Record<string, number> = {}): FakeMediaStore {
  const files = new Map<string, Uint8Array>()
  for (const [path, size] of Object.entries(seed))
    files.set(path, new Uint8Array(size))

  const writes: FakeMediaStore['writes'] = []
  const renames: FakeMediaStore['renames'] = []
  const unlinks: string[] = []
  const failures = new Map<string, Error>()

  const maybeFail = (op: string): void => {
    const error = failures.get(op)
    if (error)
      throw error
  }

  const store: MediaFileStore = {
    caseInsensitive: false,
    resolve: (...parts) => joinPath(parts),
    dirname: dirnameOf,
    async ensureDir() {
      maybeFail('mkdir')
    },
    async stat(path) {
      maybeFail('stat')
      const data = files.get(path)
      return data ? { size: data.byteLength } : undefined
    },
    createWriteStream(path) {
      maybeFail('write')
      const chunks: Uint8Array[] = []
      const stream: MediaWriteStream = {
        write(chunk) {
          chunks.push(chunk)
          return true
        },
        once() {},
        off() {},
        end(callback) {
          const data = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
          let offset = 0
          for (const chunk of chunks) {
            data.set(chunk, offset)
            offset += chunk.byteLength
          }
          files.set(path, data)
          writes.push({ path, bytes: data.byteLength })
          callback?.()
        },
        destroy() {},
      }
      return stream
    },
    async rename(from, to) {
      maybeFail('rename')
      const data = files.get(from)
      if (!data)
        throw new Error(`ENOENT: ${from}`)
      files.delete(from)
      files.set(to, data)
      renames.push({ from, to })
    },
    async unlink(path) {
      maybeFail('unlink')
      files.delete(path)
      unlinks.push(path)
    },
    async writeFile(path, data) {
      maybeFail('write')
      files.set(path, new TextEncoder().encode(data))
      writes.push({ path, bytes: data.length })
    },
  }

  return {
    store,
    files,
    writes,
    renames,
    unlinks,
    failOn(op, error) {
      failures.set(op, error)
    },
  }
}
