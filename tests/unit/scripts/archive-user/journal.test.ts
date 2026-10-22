import type { JournalTweetEntry } from '../../../../scripts/archive-user/types'
import type { ArchivedTweet, ArchiveIssue } from '../../../../src/types/archive/IArchiveFile'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendJournal,
  createJournalPaths,
  dedupeJournalTweets,
  readMeta,
  readSliceJournal,
  stripRaw,
  writeFileAtomic,
} from '../../../../scripts/archive-user/journal'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'weibo-archive-user-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

function makeRecord(mblogId: string): ArchivedTweet {
  return {
    mblogId,
    source: 'timeline',
    tweet: {
      id: mblogId,
      mblogId,
      createdAt: '2025-01-01T00:00:00.000Z',
      text: '',
      source: '微博网页版',
      user: {} as ArchivedTweet['tweet']['user'],
      stats: { likes: 0, comments: 0, reposts: 0 },
      visible: {} as ArchivedTweet['tweet']['visible'],
      media: [],
    },
    comments: [],
  }
}

function makeEntry(mblogId: string, issues: ArchiveIssue[] = []): JournalTweetEntry {
  return { type: 'tweet', slice: 's000-0-10', mblogId, record: makeRecord(mblogId), issues }
}

describe('createJournalPaths', () => {
  it('derivesPartsAndLegacyPathsFromOutPath', () => {
    const paths = createJournalPaths(join('tmp', 'archive.json'))
    expect(paths.partsDir).toBe(join('tmp', 'archive.json.slices'))
    expect(paths.metaPath).toBe(join('tmp', 'archive.json.slices', 'meta.json'))
    expect(paths.legacyJournalPath).toBe(join('tmp', 'archive.json.journal.jsonl'))
    expect(paths.slicePath('s000')).toBe(join('tmp', 'archive.json.slices', 's000.journal.jsonl'))
  })
})

describe('readSliceJournal', () => {
  it('missingFile_returnsEmptyState', () => {
    expect(readSliceJournal(join(tempDir(), 'missing.jsonl'))).toEqual({
      tweets: [],
      errors: [],
      done: false,
      repaired: false,
    })
  })

  it('roundTrip_restoresTweetsCheckpointAndDone', () => {
    const path = join(tempDir(), 'slice.jsonl')
    const entry = makeEntry('A')
    const issue: ArchiveIssue = { stage: 'comments', code: 'UNKNOWN', message: 'boom' }

    mkdirSync(dirname(path), { recursive: true })
    appendJournal(path, entry)
    appendJournal(path, { type: 'error', slice: 's000-0-10', issue })
    appendJournal(path, { type: 'checkpoint', slice: 's000-0-10', checkpoint: { uid: '1', cursor: 'x' } as never })
    appendJournal(path, { type: 'slice-done', slice: 's000-0-10' })

    const loaded = readSliceJournal(path)
    expect(loaded.tweets).toEqual([entry])
    expect(loaded.errors).toEqual([issue])
    expect(loaded.checkpoint).toMatchObject({ uid: '1', cursor: 'x' })
    expect(loaded.done).toBe(true)
    expect(loaded.repaired).toBe(false)
  })

  it('truncatedTail_isDroppedAndFileRepaired', () => {
    const path = join(tempDir(), 'slice.jsonl')
    const entry = makeEntry('A')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(entry)}\n{"type":"tweet","slice":`, 'utf8')

    const loaded = readSliceJournal(path)
    expect(loaded.tweets).toHaveLength(1)
    expect(loaded.repaired).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe(`${JSON.stringify(entry)}\n`)
  })

  it('lastCheckpointWinsAcrossEntryTypes', () => {
    const path = join(tempDir(), 'slice.jsonl')
    mkdirSync(dirname(path), { recursive: true })
    appendJournal(path, { type: 'checkpoint', slice: 's', checkpoint: { uid: '1', cursor: 'first' } as never })
    appendJournal(path, {
      ...makeEntry('A'),
      checkpoint: { uid: '1', cursor: 'second' } as never,
    })

    expect(readSliceJournal(path).checkpoint).toMatchObject({ cursor: 'second' })
  })
})

describe('stripRaw', () => {
  it('removesLegacyRawFieldWithoutMutatingInput', () => {
    const record = { ...makeRecord('A'), raw: { big: true } } as ArchivedTweet
    const stripped = stripRaw(record)
    expect('raw' in stripped).toBe(false)
    expect('raw' in record).toBe(true)
  })
})

describe('dedupeJournalTweets', () => {
  it('sameId_keepsEntryWithFewerIssues', () => {
    const noisy = makeEntry('A', [{ stage: 'detail', code: 'X', message: 'x' }])
    const clean = makeEntry('A')
    const deduped = dedupeJournalTweets([noisy, clean])
    expect(deduped).toEqual([clean])
  })

  it('sameIdSameIssues_keepsLaterEntry', () => {
    const first = makeEntry('A')
    const second = { ...makeEntry('A'), slice: 'later' }
    expect(dedupeJournalTweets([first, second])).toEqual([second])
  })
})

describe('readMeta', () => {
  it('missingFile_returnsUndefined', () => {
    expect(readMeta(join(tempDir(), 'meta.json'))).toBeUndefined()
  })

  it('incompatibleSchema_throws', () => {
    const path = join(tempDir(), 'meta.json')
    writeFileSync(path, JSON.stringify({ schema: 'old/v1' }), 'utf8')
    expect(() => readMeta(path)).toThrow(/meta 不兼容/)
  })

  it('validMeta_roundTrips', () => {
    const path = join(tempDir(), 'meta.json')
    const meta = {
      type: 'meta',
      schema: 'weibo-user-archive-journal/v2',
      createdAt: '2025-01-01T00:00:00.000Z',
      config: {
        uid: '1',
        range: {
          since: { input: '2025-01-01', unix: 1 },
          until: { input: '2025-01-02', unix: 2 },
        },
        sliceDays: 0,
        options: {},
      },
      slices: [{ index: 0, key: 's000-1-2', since: 1, until: 2 }],
      user: {},
    }
    writeFileAtomic(path, JSON.stringify(meta))
    expect(readMeta(path)).toEqual(meta)
  })
})

describe('writeFileAtomic', () => {
  it('createsParentDirectoriesAndOverwritesTarget', () => {
    const path = join(tempDir(), 'nested', 'file.txt')
    writeFileAtomic(path, 'one')
    writeFileAtomic(path, 'two')
    expect(readFileSync(path, 'utf8')).toBe('two')
  })

  it('appendFileAfterAtomicWrite_startsWithValidLine', () => {
    const path = join(tempDir(), 'slice.jsonl')
    writeFileAtomic(path, '')
    appendFileSync(path, 'line\n', 'utf8')
    expect(readFileSync(path, 'utf8')).toBe('line\n')
  })
})
