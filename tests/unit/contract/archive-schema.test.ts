import type { ArchiveFile } from '~/types/archive/IArchiveFile'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Ajv from 'ajv'
import { describe, expect, it } from 'vitest'
import { ARCHIVE_SCHEMA_ID, ARCHIVE_SCHEMA_URL } from '~/types/archive/IArchiveFile'
import { TweetVisible } from '~/types/domain/ITweet'
import { Gender, VerificationType } from '~/types/domain/IUser'

const schema = JSON.parse(
  readFileSync(join(process.cwd(), 'schemas/weibo-user-archive/v1.json'), 'utf8'),
) as Record<string, unknown>
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema)

const USER = {
  id: '1234567890',
  name: '测试用户',
  avatar: 'https://example.com/avatar.jpg',
  url: 'https://weibo.com/u/1234567890',
  gender: Gender.Unknown,
  verification: { isVerified: false, type: VerificationType.Unverified },
  stats: { followers: 0, friends: 0, statuses: 0 },
}

function createArchive(): ArchiveFile {
  return {
    $schema: ARCHIVE_SCHEMA_URL,
    schema: ARCHIVE_SCHEMA_ID,
    generatedAt: '2026-10-20T00:00:00.000Z',
    complete: true,
    query: {
      uid: '1234567890',
      range: {
        since: { input: '2025-01-01', unix: 1735689600, iso: '2025-01-01T00:00:00.000Z' },
        until: { input: '2025-12-31', unix: 1767225599, iso: '2025-12-31T23:59:59.000Z' },
      },
      includeComments: true,
      includeReplies: true,
      includeReposts: false,
      commentOrder: 'time',
    },
    user: USER,
    stats: { tweets: 1, comments: 1, replies: 0, errors: 0 },
    tweets: [{
      mblogId: 'QqsYymYOS',
      source: 'timeline',
      tweet: {
        id: '1234567890123456',
        mblogId: 'QqsYymYOS',
        createdAt: 'Mon Oct 20 00:00:00 +0800 2026',
        text: 'hello',
        textHtml: 'hello',
        source: '微博网页版',
        user: {
          id: USER.id,
          name: USER.name,
          avatar: USER.avatar,
          verified: false,
          verifiedType: VerificationType.Unverified,
        },
        stats: { likes: 0, comments: 1, reposts: 0 },
        visible: TweetVisible.PUBLIC,
        media: [],
      },
      comments: [{
        id: '1234567890123457',
        createdAt: 'Mon Oct 20 00:01:00 +0800 2026',
        text: 'comment',
        textHtml: 'comment',
        source: '微博网页版',
        likes: 0,
        user: {
          id: USER.id,
          name: USER.name,
          avatar: USER.avatar,
          verified: false,
          verifiedType: VerificationType.Unverified,
        },
      }],
    }],
    errors: [],
  }
}

describe('weibo-user-archive v1 JSON Schema', () => {
  it('uses the raw GitHub URL as both $id and instance $schema', () => {
    expect(schema.$id).toBe(ARCHIVE_SCHEMA_URL)
    expect(ARCHIVE_SCHEMA_ID).toBe('weibo-user-archive/v1')
  })

  it('validates a minimal archive file', () => {
    const archive = createArchive()
    expect(validate(archive), JSON.stringify(validate.errors, null, 2)).toBe(true)
  })

  it('rejects an archive without $schema', () => {
    const archive = createArchive() as Partial<ArchiveFile>
    delete archive.$schema
    expect(validate(archive)).toBe(false)
  })

  it('allows unknown fields for forward compatibility', () => {
    const archive = { ...createArchive(), futureField: 'ignored' }
    expect(validate(archive), JSON.stringify(validate.errors, null, 2)).toBe(true)
  })

  it('accepts verified_type values observed in real responses', () => {
    for (const verifiedType of [
      VerificationType.Unverified,
      VerificationType.Personal,
      VerificationType.Government,
      VerificationType.Enterprise,
      VerificationType.Media,
      VerificationType.Organization,
      VerificationType.Influencer,
    ]) {
      const archive = createArchive()
      archive.tweets[0].tweet.user.verifiedType = verifiedType
      expect(validate(archive), `verifiedType=${verifiedType}`).toBe(true)
    }
  })
})
