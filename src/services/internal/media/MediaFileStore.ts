import { MediaStorageError } from '~/models/errors/MediaError'

/** 最小写流接口；只依赖 `write/once/end/destroy`，便于测试注入。 */
export interface MediaWriteStream {
  write: (chunk: Uint8Array) => boolean
  once: (event: 'drain' | 'error' | 'close', listener: (...args: unknown[]) => void) => unknown
  off?: (event: 'drain' | 'error' | 'close', listener: (...args: unknown[]) => void) => unknown
  end: (callback: (error?: Error | null) => void) => void
  destroy: (error?: Error) => void
}

export interface MediaFileStat {
  size: number
}

/** 文件系统抽象：Node 实现 + 测试用内存实现。 */
export interface MediaFileStore {
  resolve: (...parts: string[]) => string
  dirname: (path: string) => string
  ensureDir: (dir: string) => Promise<void>
  stat: (path: string) => Promise<MediaFileStat | undefined>
  createWriteStream: (path: string) => MediaWriteStream
  rename: (from: string, to: string) => Promise<void>
  unlink: (path: string) => Promise<void>
  writeFile: (path: string, data: string) => Promise<void>
  readonly caseInsensitive: boolean
}

interface NodeFsPromises {
  mkdir: (path: string, options: { recursive: true }) => Promise<unknown>
  stat: (path: string) => Promise<{ size: number }>
  rename: (from: string, to: string) => Promise<void>
  unlink: (path: string) => Promise<void>
  writeFile: (path: string, data: string) => Promise<void>
}

interface NodeFsModule {
  promises: NodeFsPromises
  createWriteStream: (path: string) => unknown
}

interface NodePathModule {
  resolve: (...parts: string[]) => string
  dirname: (path: string) => string
}

interface NodeProcessLike {
  getBuiltinModule?: (id: string) => unknown
  platform?: string
}

let cachedStore: MediaFileStore | undefined
let didResolveStore = false

/** 惰性获取 Node 内置模块；浏览器/受限沙箱返回 `undefined`。 */
function getNodeModule<T>(id: string): T | undefined {
  const scope = globalThis as typeof globalThis & { process?: NodeProcessLike }
  const proc = scope.process
  if (typeof proc?.getBuiltinModule !== 'function')
    return undefined
  try {
    return proc.getBuiltinModule(id) as T | undefined
  }
  catch {
    return undefined
  }
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object')
    return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function toStorageError(error: unknown, path: string, syscall: string): MediaStorageError {
  if (error instanceof MediaStorageError)
    return error
  const code = errorCode(error)
  if (code === 'ENOENT' && syscall === 'unlink')
    return new MediaStorageError('Media file does not exist.', { path, syscall, code })
  return new MediaStorageError(`Media storage ${syscall} failed: ${error instanceof Error ? error.message : String(error)}`, {
    path,
    syscall,
    code,
  })
}

/**
 * 创建 Node 文件系统适配；没有 `node:fs` / `node:path` 时返回 `undefined`。
 *
 * 不静态 import `node:*`，保证浏览器构建仍可打包。
 */
export function createNodeMediaFileStore(): MediaFileStore | undefined {
  if (didResolveStore)
    return cachedStore

  didResolveStore = true
  const fs = getNodeModule<NodeFsModule>('node:fs')
  const path = getNodeModule<NodePathModule>('node:path')
  if (!fs?.promises || !path)
    return undefined

  const proc = (globalThis as typeof globalThis & { process?: NodeProcessLike }).process
  const platform = proc?.platform ?? ''

  cachedStore = {
    resolve: (...parts) => path.resolve(...parts),
    dirname: value => path.dirname(value),
    caseInsensitive: platform === 'win32' || platform === 'darwin',
    async ensureDir(dir) {
      try {
        await fs.promises.mkdir(dir, { recursive: true })
      }
      catch (error) {
        throw toStorageError(error, dir, 'mkdir')
      }
    },
    async stat(target) {
      try {
        const result = await fs.promises.stat(target)
        return { size: result.size }
      }
      catch (error) {
        if (errorCode(error) === 'ENOENT')
          return undefined
        throw toStorageError(error, target, 'stat')
      }
    },
    createWriteStream(target) {
      return fs.createWriteStream(target) as MediaWriteStream
    },
    async rename(from, to) {
      try {
        await fs.promises.rename(from, to)
      }
      catch (error) {
        throw toStorageError(error, to, 'rename')
      }
    },
    async unlink(target) {
      try {
        await fs.promises.unlink(target)
      }
      catch (error) {
        if (errorCode(error) !== 'ENOENT')
          throw toStorageError(error, target, 'unlink')
      }
    },
    async writeFile(target, data) {
      try {
        await fs.promises.writeFile(target, data)
      }
      catch (error) {
        throw toStorageError(error, target, 'writeFile')
      }
    },
  }

  return cachedStore
}
