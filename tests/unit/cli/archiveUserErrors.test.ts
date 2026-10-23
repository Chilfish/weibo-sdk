import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareRawPath } from '~/cli/archiveUser/raw'
import { createUserArchivePaths, FileUserArchiveStore } from '~/cli/archiveUser/store'
import { runArchiveUser } from '~/cli/commands/archiveUser'
import { formatCliError } from '~/cli/shared'
import { InvalidConfigError } from '~/models/errors/ConfigError'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'weibo-archive-user-errors-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

/** 捕获同步 / 异步调用抛出的错误（成功时返回返回值，由断言报错）。 */
async function capture(run: () => unknown | Promise<unknown>): Promise<unknown> {
  try {
    return await run()
  }
  catch (error) {
    return error
  }
}

/** 断言是结构化错误，并走 CLI 同一条信封路径（`formatCliError`）校验错误码。 */
function expectConfigInvalid(error: unknown, field: string): Record<string, unknown> {
  expect(error).toBeInstanceOf(InvalidConfigError)
  const envelope = formatCliError(error)
  expect(envelope).toMatchObject({ code: 'CONFIG_INVALID', level: 'business', retryable: false })
  expect(envelope.context).toMatchObject({ field })
  return envelope
}

function rawOptions(dir: string, overrides: Partial<Parameters<typeof prepareRawPath>[0]> = {}): Parameters<typeof prepareRawPath>[0] {
  return {
    cwd: dir,
    raw: false,
    paths: createUserArchivePaths(join(dir, 'archive.json')),
    force: true,
    resuming: false,
    ...overrides,
  }
}

describe('archive user 误用路径的结构化错误', () => {
  it('输出文件已存在且没有 --force / --merge 时为 CONFIG_INVALID', async () => {
    const dir = tempDir()
    const outPath = join(dir, 'archive.json')
    writeFileSync(outPath, '{}\n', 'utf8')

    const error = await capture(() => runArchiveUser({ uid: '1234567890', out: 'archive.json' }, dir))

    const envelope = expectConfigInvalid(error, 'out')
    expect(envelope.context).toMatchObject({ value: outPath })
    expect(envelope.next).toBe('--force')
    expect(String(envelope.message)).toContain('输出文件已存在')
  })

  it('检测到旧版单文件 journal 时为 CONFIG_INVALID', async () => {
    const dir = tempDir()
    const legacyJournalPath = createUserArchivePaths(join(dir, 'archive.json')).legacyJournalPath
    writeFileSync(legacyJournalPath, '{}\n', 'utf8')

    const error = await capture(() => runArchiveUser({ uid: '1234567890', out: 'archive.json' }, dir))

    const envelope = expectConfigInvalid(error, 'resume')
    expect(envelope.context).toMatchObject({ value: legacyJournalPath })
    expect(envelope.next).toBe('--fresh')
    expect(String(envelope.message)).toContain('检测到旧版单文件 journal')
  })

  it('meta 无法解析时为 CONFIG_INVALID', async () => {
    const dir = tempDir()
    const store = new FileUserArchiveStore(join(dir, 'archive.json'))
    mkdirSync(store.paths.partsDir, { recursive: true })
    writeFileSync(store.paths.metaPath, '{ not json', 'utf8')

    const error = await capture(() => store.loadMeta())

    const envelope = expectConfigInvalid(error, 'resume')
    expect(envelope.context).toMatchObject({ value: store.paths.metaPath })
    expect(envelope.next).toBe('--fresh')
    expect(String(envelope.message)).toContain('meta 无法解析')
  })

  it('meta 不兼容时为 CONFIG_INVALID', async () => {
    const dir = tempDir()
    const store = new FileUserArchiveStore(join(dir, 'archive.json'))
    mkdirSync(store.paths.partsDir, { recursive: true })
    writeFileSync(store.paths.metaPath, JSON.stringify({ schema: 'weibo-user-archive-journal/v1' }), 'utf8')

    const error = await capture(() => store.loadMeta())

    const envelope = expectConfigInvalid(error, 'resume')
    expect(envelope.context).toMatchObject({ value: store.paths.metaPath })
    expect(envelope.next).toBe('--fresh')
    expect(String(envelope.message)).toContain('meta 不兼容')
  })

  it('raw 路径与归档 JSON 相同时为 CONFIG_INVALID', async () => {
    const dir = tempDir()
    const paths = createUserArchivePaths(join(dir, 'archive.json'))

    const error = await capture(() => prepareRawPath(rawOptions(dir, { rawOut: 'archive.json' })))

    const envelope = expectConfigInvalid(error, 'raw')
    expect(envelope.context).toMatchObject({ value: paths.outPath, archive: paths.outPath })
    expect(String(envelope.message)).toContain('raw 路径不能与归档 JSON / 切片进度目录相同')
  })

  it('raw 路径落在切片进度目录内时为 CONFIG_INVALID', async () => {
    const dir = tempDir()
    const paths = createUserArchivePaths(join(dir, 'archive.json'))

    const error = await capture(() => prepareRawPath(rawOptions(dir, { rawOut: join('archive.json.slices', 'x.ndjson') })))

    const envelope = expectConfigInvalid(error, 'raw')
    expect(envelope.context).toMatchObject({ parts: paths.partsDir })
  })

  it('raw 文件已存在且没有 --force 时为 CONFIG_INVALID', async () => {
    const dir = tempDir()
    const paths = createUserArchivePaths(join(dir, 'archive.json'))
    const rawPath = `${paths.outPath}.raw.ndjson`
    writeFileSync(rawPath, '', 'utf8')

    const error = await capture(() => prepareRawPath(rawOptions(dir, { raw: true, force: false })))

    const envelope = expectConfigInvalid(error, 'raw')
    expect(envelope.context).toMatchObject({ value: rawPath })
    expect(envelope.next).toBe('--force')
    expect(String(envelope.message)).toContain('raw 文件已存在')
  })
})
