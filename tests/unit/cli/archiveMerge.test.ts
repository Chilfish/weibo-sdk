import type { ArchiveFile } from '~/types/archive/IArchiveFile'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeArchiveTweet, makeArchiveUser } from 'tests/testkit/userArchive'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readArchiveFile, runArchiveMerge } from '~/cli/commands/archiveMerge'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { ARCHIVE_SCHEMA_ID, ARCHIVE_SCHEMA_URL } from '~/types/archive/IArchiveFile'

const UID = '1234567890'

function archive(mblogIds: string[], generatedAt = '2025-02-01T00:00:00.000Z'): ArchiveFile {
  return {
    $schema: ARCHIVE_SCHEMA_URL,
    schema: ARCHIVE_SCHEMA_ID,
    generatedAt,
    complete: true,
    query: {
      uid: UID,
      range: {
        since: { input: '2025-01-01', unix: 1735689600, iso: '2025-01-01T00:00:00.000Z' },
        until: { input: '2025-01-31', unix: 1738368000, iso: '2025-01-31T00:00:00.000Z' },
      },
      includeComments: true,
      includeReplies: true,
      includeReposts: false,
      commentOrder: 'time',
    },
    user: makeArchiveUser(UID),
    stats: { tweets: mblogIds.length, comments: 0, replies: 0, errors: 0 },
    tweets: mblogIds.map(mblogId => ({
      mblogId,
      source: 'timeline',
      tweet: makeArchiveTweet(mblogId),
      comments: [],
    })),
    errors: [],
  }
}

describe('runArchiveMerge', () => {
  let dir = ''

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'weibo-archive-merge-'))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
    process.exitCode = 0
  })

  it('writesMergedArchiveAndSummary', async () => {
    writeFileSync(join(dir, 'a.json'), JSON.stringify(archive(['A', 'B'])), 'utf8')
    writeFileSync(
      join(dir, 'b.json'),
      `\uFEFF${JSON.stringify(archive(['B', 'C'], '2025-03-01T00:00:00.000Z'))}`,
      'utf8',
    )

    const result = await runArchiveMerge(['a.json', 'b.json'], { out: 'merged.json', quiet: true }, dir)

    expect(result).toMatchObject({ inputs: 2, tweets: 3, deduped: 1, complete: true })
    const written = JSON.parse(readFileSync(join(dir, 'merged.json'), 'utf8')) as ArchiveFile
    expect(written.tweets.map(tweet => tweet.mblogId).sort()).toEqual(['A', 'B', 'C'])
    expect(written.schema).toBe(ARCHIVE_SCHEMA_ID)
  })

  it('refusesToOverwriteUnlessForced', async () => {
    writeFileSync(join(dir, 'a.json'), JSON.stringify(archive(['A'])), 'utf8')
    writeFileSync(join(dir, 'b.json'), JSON.stringify(archive(['B'])), 'utf8')
    writeFileSync(join(dir, 'merged.json'), '{}', 'utf8')

    await expect(runArchiveMerge(['a.json', 'b.json'], { out: 'merged.json', quiet: true }, dir))
      .rejects
      .toThrowError(InvalidConfigError)

    const result = await runArchiveMerge(['a.json', 'b.json'], { out: 'merged.json', force: true, quiet: true }, dir)
    expect(result.tweets).toBe(2)
  })

  it('requiresTwoInputs', async () => {
    writeFileSync(join(dir, 'a.json'), JSON.stringify(archive(['A'])), 'utf8')

    await expect(runArchiveMerge(['a.json'], { quiet: true }, dir))
      .rejects
      .toThrowError(/at least two archive files/)
  })

  it('rejectsMissingAndMalformedFiles', async () => {
    expect(() => readArchiveFile(join(dir, 'nope.json'))).toThrowError(InvalidConfigError)

    writeFileSync(join(dir, 'broken.json'), '{', 'utf8')
    expect(() => readArchiveFile(join(dir, 'broken.json'))).toThrowError(InvalidConfigError)
  })
})
