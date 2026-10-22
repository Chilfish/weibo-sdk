import type { WeiboSDKRawMeta } from '../../../../src/types/hooks'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRawRecorder, prepareRawPath } from '../../../../scripts/archive-user/raw'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'weibo-archive-raw-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

function baseOptions(dir: string) {
  const outPath = join(dir, 'archive.json')
  return {
    cwd: dir,
    outPath,
    legacyJournalPath: `${outPath}.journal.jsonl`,
    metaPath: join(dir, 'archive.json.slices', 'meta.json'),
    partsDir: `${outPath}.slices`,
    force: false,
    resuming: false,
  }
}

describe('prepareRawPath', () => {
  it('notRequested_returnsUndefined', () => {
    expect(prepareRawPath({ ...baseOptions(tempDir()), raw: false })).toBeUndefined()
  })

  it('rawFlag_derivesSidecarAndTruncatesIt', () => {
    const dir = tempDir()
    const options = baseOptions(dir)
    writeFileSync(`${options.outPath}.raw.ndjson`, 'stale', 'utf8')

    expect(() => prepareRawPath({ ...options, raw: true })).toThrow(/raw 文件已存在/)

    const path = prepareRawPath({ ...options, raw: true, force: true })
    expect(path).toBe(`${options.outPath}.raw.ndjson`)
    expect(readFileSync(path!, 'utf8')).toBe('')
  })

  it('explicitRawOut_resolvesAgainstCwd', () => {
    const dir = tempDir()
    const path = prepareRawPath({ ...baseOptions(dir), raw: false, rawOut: 'nested/raw.jsonl' })
    expect(path).toBe(join(dir, 'nested', 'raw.jsonl'))
  })

  it('conflictsWithJournalPaths_throw', () => {
    const dir = tempDir()
    const options = baseOptions(dir)

    expect(() => prepareRawPath({ ...options, raw: false, rawOut: options.outPath })).toThrow(/不能与归档 JSON/)
    expect(() => prepareRawPath({ ...options, raw: false, rawOut: options.metaPath })).toThrow(/不能与归档 JSON/)
    expect(() => prepareRawPath({
      ...options,
      raw: false,
      rawOut: join(options.partsDir, 'x.jsonl'),
    })).toThrow(/不能与归档 JSON/)
  })

  it('resuming_keepsExistingContent', () => {
    const dir = tempDir()
    const options = baseOptions(dir)
    const path = `${options.outPath}.raw.ndjson`
    writeFileSync(path, 'previous\n', 'utf8')

    expect(prepareRawPath({ ...options, raw: true, resuming: true })).toBe(path)
    expect(readFileSync(path, 'utf8')).toBe('previous\n')
  })
})

describe('createRawRecorder', () => {
  it('withoutPath_hasNoHooks', () => {
    const recorder = createRawRecorder(undefined)
    expect(recorder.hooks).toBeUndefined()
    expect(recorder.lines).toBe(0)
  })

  it('appendsOneJsonLinePerRawResponse', () => {
    const dir = tempDir()
    const path = join(dir, 'raw.ndjson')
    writeFileSync(path, '', 'utf8')
    const recorder = createRawRecorder(path)

    const meta = {
      timestamp: 123,
      trace_id: 'trace',
      endpoint: '/ajax/statuses/show',
      resourceType: 'tweet',
      args: { id: 'A' },
    } as unknown as WeiboSDKRawMeta

    recorder.hooks!.onRaw({ ok: 1 }, meta)
    recorder.hooks!.onRaw({ ok: 1 }, meta)

    expect(recorder.lines).toBe(2)
    const [first, second] = readFileSync(path, 'utf8').trim().split('\n')
    expect(JSON.parse(first)).toMatchObject({
      timestamp: 123,
      traceId: 'trace',
      endpoint: '/ajax/statuses/show',
      resourceType: 'tweet',
      raw: { ok: 1 },
    })
    expect(JSON.parse(second)).toMatchObject({ raw: { ok: 1 } })
  })
})
