import type { MediaFileStore, MediaWriteStream } from './MediaFileStore'
import type { MediaByteStream } from './MediaHttpClient'
import { MediaDownloadError, MediaInvalidResponseError, MediaStorageError } from '~/models/errors/MediaError'
import { WeiboSDKError } from '~/models/errors/WeiboSDKError'

export interface MediaTimers {
  set: (fn: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
}

const defaultTimers: MediaTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>)
  },
}

export interface WriteBodyOptions {
  maxBytes: number
  idleTimeoutMs: number
  expectedBytes?: number
  signal?: AbortSignal
  timers?: MediaTimers
}

export interface PersistStreamOptions extends WriteBodyOptions {
  store: MediaFileStore
  finalPath: string
  overwrite: boolean
  random?: () => number
}

function createAbortError(signal?: AbortSignal): Error {
  const reason = signal?.reason
  if (reason instanceof Error)
    return reason
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
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
  return new MediaStorageError(`Media storage ${syscall} failed: ${error instanceof Error ? error.message : String(error)}`, {
    path,
    syscall,
    code: errorCode(error),
  })
}

function waitForDrain(stream: MediaWriteStream): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let cleanup: () => void = () => {}
    const onDrain = (): void => {
      cleanup()
      resolve()
    }
    const onError = (...args: unknown[]): void => {
      cleanup()
      reject(toStorageError(args[0], '', 'write'))
    }
    const onClose = (): void => {
      cleanup()
      reject(new MediaStorageError('Media write stream closed before draining.', { syscall: 'write' }))
    }
    cleanup = (): void => {
      stream.off?.('drain', onDrain)
      stream.off?.('error', onError)
      stream.off?.('close', onClose)
    }
    stream.once('drain', onDrain)
    stream.once('error', onError)
    stream.once('close', onClose)
  })
}

function endStream(stream: MediaWriteStream): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    stream.end((error?: Error | null) => {
      if (error)
        reject(toStorageError(error, '', 'write'))
      else
        resolve()
    })
  })
}

/**
 * 把字节流写入目标流：手动背压、字节上限、空闲超时、Content-Length 校验。
 *
 * 网络流错误原样抛出（`MediaDownloadError`）；本地写入错误统一映射为 `MediaStorageError`。
 */
export async function writeBodyToStream(
  body: MediaByteStream,
  out: MediaWriteStream,
  options: WriteBodyOptions,
): Promise<{ bytes: number }> {
  const timers = options.timers ?? defaultTimers
  let bytes = 0
  let idleHandle: unknown
  let idleError: MediaDownloadError | undefined

  const clearIdle = (): void => {
    if (idleHandle !== undefined) {
      timers.clear(idleHandle)
      idleHandle = undefined
    }
  }

  const resetIdle = (): void => {
    clearIdle()
    idleHandle = timers.set(() => {
      idleError = new MediaDownloadError('Media download idle timeout.', { reason: 'idle-timeout' })
      body.destroy?.(idleError)
    }, options.idleTimeoutMs)
  }

  try {
    resetIdle()

    for await (const chunk of body) {
      if (options.signal?.aborted)
        throw createAbortError(options.signal)
      if (idleError)
        throw idleError

      bytes += chunk.byteLength
      if (bytes > options.maxBytes) {
        throw new MediaInvalidResponseError(`Media file exceeds maxBytes (${options.maxBytes}).`, {
          reason: 'too-large',
          bytes,
          maxBytes: options.maxBytes,
        })
      }

      let writable = false
      try {
        writable = out.write(chunk)
      }
      catch (error) {
        throw toStorageError(error, '', 'write')
      }
      if (!writable)
        await waitForDrain(out)

      resetIdle()
    }

    if (idleError)
      throw idleError
    if (options.signal?.aborted)
      throw createAbortError(options.signal)

    await endStream(out)

    if (bytes === 0)
      throw new MediaDownloadError('Media response is empty.', { reason: 'empty' })
    if (options.expectedBytes !== undefined && bytes !== options.expectedBytes) {
      throw new MediaDownloadError('Media response is truncated.', {
        reason: 'truncated',
        bytes,
        contentLength: options.expectedBytes,
      })
    }

    return { bytes }
  }
  finally {
    clearIdle()
  }
}

/** 同目录临时文件路径；保证 rename 不跨卷。 */
export function tempPathFor(finalPath: string, random: () => number = Math.random): string {
  const value = random()
  const suffix = Math.floor((Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5) * 36 ** 8)
    .toString(36)
    .padStart(8, '0')
  return `${finalPath}.${suffix}.tmp`
}

/**
 * 完整落盘事务：`mkdir` → 写临时文件 → 校验 → `rename`。
 *
 * 任何失败/取消都会在 `finally` 删除临时文件。
 */
export async function persistStream(
  body: MediaByteStream,
  options: PersistStreamOptions,
): Promise<{ bytes: number }> {
  const { store, finalPath, overwrite } = options
  await store.ensureDir(store.dirname(finalPath))

  const tempPath = tempPathFor(finalPath, options.random)
  let out: MediaWriteStream | undefined

  try {
    out = store.createWriteStream(tempPath)
    const result = await writeBodyToStream(body, out, options)
    if (overwrite)
      await store.unlink(finalPath)
    await store.rename(tempPath, finalPath)
    return result
  }
  catch (error) {
    out?.destroy()
    if (error instanceof WeiboSDKError || (error instanceof Error && error.name === 'AbortError'))
      throw error
    throw toStorageError(error, finalPath, 'write')
  }
  finally {
    await store.unlink(tempPath).catch(() => {})
  }
}
