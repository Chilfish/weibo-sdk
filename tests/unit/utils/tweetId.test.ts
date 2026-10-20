import type { TweetIdKind } from '~/utils/tweetId'
import { describe, expect, it } from 'vitest'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { normalizeTweetIdInput, parseTweetIdInput } from '~/utils/tweetId'

interface Case {
  input: string
  id: string
  kind: TweetIdKind
  source: 'bare' | 'url'
}

const cases: Case[] = [
  { input: 'QqsYymYOS', id: 'QqsYymYOS', kind: 'mblogid', source: 'bare' },
  { input: '  5356120103455672  ', id: '5356120103455672', kind: 'mid', source: 'bare' },
  { input: 'https://m.weibo.cn/status/5356120103455672', id: '5356120103455672', kind: 'mid', source: 'url' },
  { input: 'https://m.weibo.cn/detail/5356120103455672?foo=bar#x', id: '5356120103455672', kind: 'mid', source: 'url' },
  { input: 'm.weibo.cn/status/5356120103455672', id: '5356120103455672', kind: 'mid', source: 'url' },
  { input: '//m.weibo.cn/status/5356120103455672', id: '5356120103455672', kind: 'mid', source: 'url' },
  { input: 'https://weibo.com/7679065628/QqsYymYOS?type=comment', id: 'QqsYymYOS', kind: 'mblogid', source: 'url' },
  { input: 'https://weibo.com/detail/QqsYymYOS', id: 'QqsYymYOS', kind: 'mblogid', source: 'url' },
  { input: 'https://weibo.com/status/QqsYymYOS/', id: 'QqsYymYOS', kind: 'mblogid', source: 'url' },
  { input: 'weibo.com/7679065628/QqsYymYOS', id: 'QqsYymYOS', kind: 'mblogid', source: 'url' },
  { input: '看看这个 https://m.weibo.cn/status/5356120103455672 笑死', id: '5356120103455672', kind: 'mid', source: 'url' },
  { input: 'https://m.weibo.cn/statuses/show?id=5356120103455672', id: '5356120103455672', kind: 'mid', source: 'url' },
  { input: 'https://weibo.com/ajax/statuses/show?id=5356120103455672', id: '5356120103455672', kind: 'mid', source: 'url' },
]

describe('parseTweetIdInput', () => {
  it.each(cases)('parses $input', ({ input, id, kind, source }) => {
    expect(parseTweetIdInput(input)).toEqual({ id, kind, source })
  })

  it('normalizes the extracted id', () => {
    expect(normalizeTweetIdInput('https://m.weibo.cn/status/5356120103455672')).toBe('5356120103455672')
    expect(normalizeTweetIdInput('QqsYymYOS')).toBe('QqsYymYOS')
  })

  it.each([
    '',
    '   ',
    'https://weibo.com/u/7679065628',
    'https://weibo.com/7679065628',
    'https://weibo.com/7679065628/',
    'https://example.com/status/5356120103455672',
    'https://weibo.com/ttarticle/p/show?id=5356120103455672',
    'https://t.cn/A6abc',
    'Qqs-YymYOS',
  ])('rejects %s', (input) => {
    expect(() => parseTweetIdInput(input)).toThrowError(InvalidConfigError)
  })

  it('exposes CONFIG_INVALID with field context', () => {
    try {
      parseTweetIdInput('https://example.com/status/1')
      throw new Error('expected parseTweetIdInput to throw')
    }
    catch (error) {
      expect(error).toBeInstanceOf(InvalidConfigError)
      expect((error as InvalidConfigError).code).toBe('CONFIG_INVALID')
      expect((error as InvalidConfigError).context).toMatchObject({
        field: 'tweetId',
        input: 'https://example.com/status/1',
      })
    }
  })
})
