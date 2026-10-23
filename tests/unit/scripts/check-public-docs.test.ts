import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  extractCodeSegments,
  findDocMemberDrift,
  readSdkMembers,
  readSessionFields,
} from '../../../scripts/check-public-docs'

const ROOT = path.resolve(import.meta.dirname, '../../..')

function collectMarkdown(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.vitepress', 'public'].includes(entry.name))
      continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory())
      out.push(...collectMarkdown(full))
    else if (entry.name.endsWith('.md'))
      out.push(full)
  }
  return out
}

function relative(file: string): string {
  return path.relative(ROOT, file).replaceAll('\\', '/')
}

const sessionFields = ['authMode', 'uid', 'profile', 'checkedAt', 'guestTokenIssuedAt']
const sdkMembers = ['tweets', 'archive', 'getSession', 'authMode']

describe('extractCodeSegments', () => {
  it('keeps fenced blocks and inline spans, drops prose', () => {
    const text = [
      '散文里写 session.details 不算引用',
      '`sdk.getSession()` 是行内代码',
      '```ts',
      'const session = await sdk.getSession()',
      '```',
    ].join('\n')

    const segments = extractCodeSegments(text)
    expect(segments.map(segment => segment.code)).toEqual([
      'const session = await sdk.getSession()',
      'sdk.getSession()',
    ])
    expect(segments.map(segment => segment.line)).toEqual([4, 2])
  })

  it('ignores unterminated prose lines without backticks', () => {
    expect(extractCodeSegments('只有散文，没有代码')).toEqual([])
  })
})

describe('findDocMemberDrift', () => {
  it('accepts documented members, optional chaining and computed access', () => {
    const failures = findDocMemberDrift({
      files: [{
        path: 'docs.md',
        text: [
          '```ts',
          'session.profile',
          'sdk?.tweets.listByUserId(uid)',
          'const service = sdk[serviceName]',
          '```',
        ].join('\n'),
      }],
      sessionFields,
      sdkMembers,
    })
    expect(failures).toEqual([])
  })

  it('flags a renamed session field (regression: details → profile)', () => {
    const failures = findDocMemberDrift({
      files: [{ path: 'README.md', text: '```ts\nsession.details // raw\n```\n' }],
      sessionFields,
      sdkMembers,
    })
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('README.md:2')
    expect(failures[0]).toContain('session.details')
    expect(failures[0]).toContain('WeiboSessionContext')
    expect(failures[0]).toContain('profile')
  })

  it('flags an unknown sdk member in inline code', () => {
    const failures = findDocMemberDrift({
      files: [{ path: 'website/api/foo.md', text: '用 `sdk?.nope()` 拿不到东西\n' }],
      sessionFields,
      sdkMembers,
    })
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('website/api/foo.md:1')
    expect(failures[0]).toContain('sdk?.nope')
    expect(failures[0]).toContain('WeiboSDK')
  })
})

describe('extracted contract sets', () => {
  it('reads WeiboSessionContext fields from src/types/session.ts', () => {
    expect(readSessionFields().sort()).toEqual([...sessionFields].sort())
  })

  it('reads public WeiboSDK members and skips private state', () => {
    const members = readSdkMembers()
    expect(members).toEqual(expect.arrayContaining(['users', 'tweets', 'archive', 'getSession', 'checkSession']))
    expect(members).not.toEqual(expect.arrayContaining(['authContext', 'session', 'ensureReady', 'validateConfig']))
  })
})

describe('real public docs', () => {
  it('readme.md and website/** never reference a non-existent session field or sdk member', () => {
    const files = [
      ...collectMarkdown(path.join(ROOT, 'website')),
      path.join(ROOT, 'README.md'),
    ].map(file => ({ path: relative(file), text: readFileSync(file, 'utf8') }))

    expect(findDocMemberDrift({ files, sessionFields: readSessionFields(), sdkMembers: readSdkMembers() })).toEqual([])
  })
})
