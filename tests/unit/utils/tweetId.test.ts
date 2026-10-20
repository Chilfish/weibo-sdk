import type { TweetIdKind } from '~/utils/tweetId'
import { describe, expect, it } from 'vitest'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { midToMblogId, normalizeTweetIdInput, parseTweetIdInput } from '~/utils/tweetId'

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

const BASE62_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** `midToMblogId` 的逆运算（仅测试用）：4 位 base62 → 7 位十进制。 */
function mblogIdToMid(mblogid: string): string {
  const chunks: string[] = []
  for (let end = mblogid.length; end > 0; end -= 4)
    chunks.unshift(mblogid.slice(Math.max(0, end - 4), end))
  return chunks
    .map((chunk, index) => {
      let value = 0
      for (const char of chunk)
        value = value * 62 + BASE62_ALPHABET.indexOf(char)
      const digits = String(value)
      return index === 0 ? digits : digits.padStart(7, '0')
    })
    .join('')
}

describe('midToMblogId', () => {
  it('converts the verified real pair (mid 5039815108333719 ↔ OgHLUyXYP)', () => {
    expect(midToMblogId('5039815108333719')).toBe('OgHLUyXYP')
    expect(midToMblogId(5039815108333719)).toBe('OgHLUyXYP')
  })

  it('trims surrounding whitespace', () => {
    expect(midToMblogId('  5039815108333719  ')).toBe('OgHLUyXYP')
  })

  it('matches regression pairs produced by the standard 7-digit split', () => {
    expect(midToMblogId('5263079145477010')).toBe('QqsYymYOS')
    expect(midToMblogId('5115617398491601')).toBe('P6yhlzD3j')
  })

  it.each([
    '5039815108333719',
    '5263079145477010',
    '5115617398491601',
    '1',
    '9999999',
    '10000000',
    '9999999999999999',
  ])('round-trips %s through the inverse', (mid) => {
    const mblogid = midToMblogId(mid)
    expect(mblogid).not.toBe('')
    expect(mblogIdToMid(mblogid)).toBe(mid)
  })

  it.each([
    '',
    '   ',
    'abc',
    'QqsYymYOS',
    '12a34',
    '0',
    '0123',
    '-1',
    '+1',
    '1.5',
    '1e10',
    ' 5039815108333719x ',
  ])('returns an empty string for invalid string input %j', (input) => {
    expect(midToMblogId(input)).toBe('')
  })

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    2 ** 60,
  ])('returns an empty string for invalid numeric input %s', (value) => {
    expect(midToMblogId(value)).toBe('')
  })
})
