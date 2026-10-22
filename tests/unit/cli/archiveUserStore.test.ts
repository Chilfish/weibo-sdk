import type { UserArchiveRecord } from '~/types/archive/IUserArchive'
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeArchiveCheckpoint, makeArchiveUser } from 'tests/testkit/userArchive'
import { afterEach, describe, expect, it } from 'vitest'
import { createUserArchivePaths, FileUserArchiveStore, writeFileAtomic } from '~/cli/archiveUser/store'
import { buildUserArchiveConfig } from '~/services/public/userArchive/config'

const dirs: string[] = []

function tempOutPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'weibo-user-archive-store-'))
  dirs.push(dir)
  return join(dir, 'archive.json')
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

function makeRecord(mblogId: string, issues: UserArchiveRecord['issues'] = []): UserArchiveRecord {
  return {
    slice: 's000-1-2',
    mblogId,
    record: {
      mblogId,
      source: 'timeline',
      tweet: {
        id: mblogId,
        mblogId,
        createdAt: '2025-01-15T00:00:00.000Z',
        text: '',
        source: '微博网页版',
        user: {} as never,
        stats: { likes: 0, comments: 0, reposts: 0 },
        visible: {} as never,
        media: [],
      },
      comments: [],
    },
    issues,
  }
}

function createStore() {
  const outPath = tempOutPath()
  const store = new FileUserArchiveStore(outPath)
  const config = buildUserArchiveConfig('1234567890', { since: '2025-01-01', until: '2025-01-31', sliceDays: 0 })
  const slice = { index: 0, key: 's000-1-2', since: 1, until: 2 }
  const meta = {
    type: 'meta' as const,
    schema: 'weibo-user-archive-journal/v2' as const,
    createdAt: '2025-02-01T00:00:00.000Z',
    config,
    slices: [slice],
    user: makeArchiveUser('1234567890'),
  }
  return { store, meta, slice, paths: createUserArchivePaths(outPath) }
}

describe('fileUserArchiveStore', () => {
  it('metaRoundTrip', async () => {
    const { store, meta } = createStore()
    await store.saveMeta(meta)
    expect(await store.loadMeta()).toEqual(meta)
  })

  it('recordsCheckpointsAndDoneRoundTrip', async () => {
    const { store, meta, slice } = createStore()
    await store.saveMeta(meta)
    await store.saveCheckpoint(slice, makeArchiveCheckpoint('1234567890', { sliceEnd: 2 }))
    await store.appendRecord(makeRecord('A'))
    await store.markSliceDone(slice)

    expect(await store.loadRecords()).toEqual([makeRecord('A')])
    expect(await store.loadSlices()).toEqual([
      { slice, done: true, checkpoint: makeArchiveCheckpoint('1234567890', { sliceEnd: 2 }) },
    ])
  })

  it('issuesRoundTrip', async () => {
    const { store, meta, slice } = createStore()
    await store.saveMeta(meta)
    const issue = { stage: 'timeline' as const, code: 'UNKNOWN', message: 'boom' }
    await store.appendIssue(issue, slice)
    expect(await store.loadIssues()).toEqual([issue])
  })

  it('truncatedJournalTailIsRepaired', async () => {
    const { store, meta, paths } = createStore()
    await store.saveMeta(meta)
    await store.appendRecord(makeRecord('A'))
    appendFileSync(paths.slicePath('s000-1-2'), '{"type":"tweet","slice":', 'utf8')

    expect(await store.loadRecords()).toEqual([makeRecord('A')])
    const content = readFileSync(paths.slicePath('s000-1-2'), 'utf8')
    expect(content.endsWith('\n')).toBe(true)
    expect(() => content.trim().split('\n').forEach(line => JSON.parse(line))).not.toThrow()
  })

  it('unknownSchemaRejectsMeta', async () => {
    const { store, paths } = createStore()
    writeFileAtomic(paths.metaPath, JSON.stringify({ schema: 'old/v1' }))
    await expect(store.loadMeta()).rejects.toThrow(/meta 不兼容/)
  })

  it('clearRemovesPartsDirectoryAndLegacyJournal', async () => {
    const { store, meta, paths } = createStore()
    await store.saveMeta(meta)
    writeFileAtomic(paths.legacyJournalPath, '{}\n')
    await store.clear()
    expect(await store.loadMeta()).toBeUndefined()
    expect(() => readFileSync(paths.metaPath, 'utf8')).toThrow()
    expect(() => readFileSync(paths.legacyJournalPath, 'utf8')).toThrow()
  })

  it('loadRecordsCanFilterBySlice', async () => {
    const { store, meta } = createStore()
    await store.saveMeta(meta)
    await store.appendRecord(makeRecord('A'))
    expect(await store.loadRecords('s000-1-2')).toEqual([makeRecord('A')])
    expect(await store.loadRecords('missing')).toEqual([])
  })
})
