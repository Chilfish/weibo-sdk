import type { MobileContainerResponse } from '~/services/endpoints/mobile'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  extractMobileMblogs,
  extractMobileUsers,
  mobileContainerSpec,
} from '~/services/endpoints/mobile'
import { MOBILE_USER_AGENT } from '~/services/internal/GuestTokenService'
import { midToMblogId } from '~/utils/tweetId'

const RAW_FIXTURE_DIR = new URL('../../fixtures/raw/', import.meta.url)

/** 真实样本由 G7 抓取；尚未落盘时相关 describe 自动跳过，落盘后即生效。 */
const TIMELINE_FIXTURE = fileURLToPath(new URL('mobile_timeline_p1.json', RAW_FIXTURE_DIR))
const LIKES_FIXTURE = fileURLToPath(new URL('mobile_likes_p1.json', RAW_FIXTURE_DIR))
const FOLLOWINGS_FIXTURE = fileURLToPath(new URL('mobile_followings_p1.json', RAW_FIXTURE_DIR))
const FANS_FIXTURE = fileURLToPath(new URL('mobile_fans_p1.json', RAW_FIXTURE_DIR))

const HAS_MBLOG_FIXTURES = existsSync(TIMELINE_FIXTURE) && existsSync(LIKES_FIXTURE)
const HAS_USER_FIXTURES = existsSync(FOLLOWINGS_FIXTURE) && existsSync(FANS_FIXTURE)

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

/** fixture 与 schema 不匹配时要显式失败，而不是静默跳过。 */
function parseContainer(raw: unknown): MobileContainerResponse {
  const parsed = mobileContainerSpec.schema.safeParse(raw)
  if (!parsed.success)
    throw new Error(`mobile container schema mismatch: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`)
  return parsed.data
}

const MBLOGID_PATTERN = /^[0-9A-Z]+$/i

function readIdOf(value: Record<string, unknown>): string | undefined {
  const idstr = value.idstr
  if (typeof idstr === 'string' && idstr !== '')
    return idstr
  const id = value.id
  return typeof id === 'number' || typeof id === 'string' ? String(id) : undefined
}

describe('mobileContainerSpec', () => {
  it('declares guest auth and require_ok_1', () => {
    expect(mobileContainerSpec.auth).toBe('guest')
    expect(mobileContainerSpec.resourceType).toBe('MOBILE_CONTAINER')
    expect(mobileContainerSpec.endpoint).toBe('api/container/getIndex')
    expect(mobileContainerSpec.okPolicy).toEqual({ mode: 'require_ok_1' })
  })

  it('builds the m.weibo.cn container URL without page', () => {
    const req = mobileContainerSpec.buildResource({ containerid: '1076032365795232' })
    expect(req.method).toBe('GET')
    expect(req.url).toBe('https://m.weibo.cn/api/container/getIndex?containerid=1076032365795232')
    expect(req.headers).toEqual({
      'referer': 'https://m.weibo.cn/',
      'user-agent': MOBILE_USER_AGENT,
    })
  })

  it('appends the optional page argument', () => {
    const req = mobileContainerSpec.buildResource({ containerid: '2308692365795232', page: 2 })
    expect(req.url).toBe('https://m.weibo.cn/api/container/getIndex?containerid=2308692365795232&page=2')
  })

  it('encodes the containerid (搜索型 containerid 含 & 与中文)', () => {
    const containerid = '100103type=1&q=新闻&t='
    const req = mobileContainerSpec.buildResource({ containerid })
    expect(req.url).toContain(`containerid=${encodeURIComponent(containerid)}`)
    expect(req.url).not.toContain('&q=新闻')
  })

  it('rejects unknown arguments', () => {
    const { argsSchema } = mobileContainerSpec
    expect(argsSchema?.safeParse({ containerid: '1076032365795232', since_id: '1' }).success).toBe(false)
    expect(argsSchema?.safeParse({}).success).toBe(false)
    expect(argsSchema?.safeParse({ containerid: '1076032365795232', page: 1 }).success).toBe(true)
  })

  it('validates the canonical response shape (nested card_group, pics)', () => {
    const parsed = parseContainer({
      ok: 1,
      data: {
        cardlistInfo: { total: 13718, page: 2, since_id: 'abc', containerid: '1076032365795232', v_p: '42' },
        cards: [
          {
            card_type: 11,
            itemid: 'group',
            card_group: [
              { card_type: 9, mblog: { mid: '5039815108333719', text: 'nested' } },
              { card_type: 10, user: { id: 2365795232, idstr: '2365795232', screen_name: 'target' } },
            ],
          },
          {
            card_type: 10,
            title: '相册',
            pics: [
              { pic_small: '<URL>', pic_middle: '<URL>', pic_big: '<URL>', pic_mw2000: '<URL>', mblog: { mid: '5039815108333719' } },
            ],
          },
        ],
      },
    })
    expect(parsed.ok).toBe(1)
    expect(parsed.data.cardlistInfo?.total).toBe(13718)
    expect(parsed.data.cards[0].card_group?.[0].mblog?.text).toBe('nested')
    expect(parsed.data.cards[1].pics?.[0].pic_big).toBe('<URL>')
  })

  it('keeps unknown top-level and card fields (passthrough)', () => {
    const parsed = parseContainer({
      ok: 1,
      ext_trans: { foo: 1 },
      data: { cards: [{ card_type: 9, mblog: { mid: '1' }, scheme: 'sinaweibo://detail' }] },
    })
    expect(parsed.ext_trans).toEqual({ foo: 1 })
    expect(parsed.data.cards[0].scheme).toBe('sinaweibo://detail')
  })
})

describe('extractMobileMblogs', () => {
  it('injects mblogid from mid and recurses into card_group', () => {
    const raw = parseContainer({
      ok: 1,
      data: {
        cards: [
          {
            card_type: 9,
            itemid: 'M_1',
            mblog: { mid: '5039815108333719', id: 5039815108333719, text: 'top-level' },
          },
          {
            card_type: 10,
            card_group: [
              { card_type: 9, mblog: { mblogid: 'QqsYymYOS', id: 5263079145477010 } },
              { card_type: 9, mblog: { mid: 'abc', text: 'not a numeric mid' } },
              { card_type: 9, mblog: { text: 'no id at all' } },
              { card_type: 9, mblog: { id: 5115617398491601, text: 'numeric id only' } },
            ],
          },
          { card_type: 4, itemid: 'filter', title: '筛选' },
        ],
      },
    })

    const mblogs = extractMobileMblogs(raw)
    expect(mblogs).toHaveLength(3)
    expect(mblogs[0]).toMatchObject({ text: 'top-level', mblogid: 'OgHLUyXYP' })
    // 已有 mblogid 的条目原样保留（不重复注入）
    expect(mblogs[1].mblogid).toBe('QqsYymYOS')
    // 只有数字 id 时同样能换算
    expect(mblogs[2]).toMatchObject({ text: 'numeric id only', mblogid: 'P6yhlzD3j' })
  })

  it('returns an empty list when there is nothing to extract', () => {
    expect(extractMobileMblogs(parseContainer({ ok: 1, data: { cards: [] } }))).toEqual([])
    expect(extractMobileMblogs(parseContainer({
      ok: 1,
      data: { cards: [{ card_type: 4, itemid: 'filter' }, { card_type: 9, mblog: {} }] },
    }))).toEqual([])
  })
})

describe('extractMobileUsers', () => {
  it('collects card.user objects, recurses and de-duplicates by id/idstr', () => {
    const raw = parseContainer({
      ok: 1,
      data: {
        cards: [
          { card_type: 10, user: { id: 2, idstr: '2', screen_name: 'b' } },
          {
            card_type: 11,
            card_group: [
              { card_type: 10, user: { id: 2, idstr: '2', screen_name: 'b-duplicate' } },
              { card_type: 10, user: { idstr: '3', screen_name: 'c' } },
              { card_type: 10, user: { screen_name: 'no-id' } },
              { card_type: 9, mblog: { mid: '5039815108333719' } },
            ],
          },
        ],
      },
    })

    const users = extractMobileUsers(raw)
    expect(users.map(user => user.screen_name)).toEqual(['b', 'c', 'no-id'])
  })

  it('returns an empty list when no card carries a user', () => {
    expect(extractMobileUsers(parseContainer({
      ok: 1,
      data: { cards: [{ card_type: 9, mblog: { mid: '5039815108333719' } }] },
    }))).toEqual([])
  })
})

const describeMblogFixtures = HAS_MBLOG_FIXTURES ? describe : describe.skip
const describeUserFixtures = HAS_USER_FIXTURES ? describe : describe.skip

describeMblogFixtures('mobile mblog fixtures (real samples)', () => {
  it.each([
    ['mobile_timeline_p1.json', TIMELINE_FIXTURE],
    ['mobile_likes_p1.json', LIKES_FIXTURE],
  ] as const)('extracts mblogs from %s', async (name, path) => {
    const raw = parseContainer(await readJson(path))
    const mblogs = extractMobileMblogs(raw)

    expect(mblogs.length, `${name} 应至少解析出一条微博`).toBeGreaterThan(0)
    for (const mblog of mblogs) {
      expect(typeof mblog.mblogid, `${name} 的每条微博都应有 mblogid`).toBe('string')
      expect(String(mblog.mblogid)).toMatch(MBLOGID_PATTERN)
      // m 站只下发数字 mid，mblogid 必须与 mid 换算一致
      const mid = mblog.mid
      if (typeof mid === 'string' && mid !== '')
        expect(mblog.mblogid).toBe(midToMblogId(mid))
    }

    const ids = new Set(mblogs.map(mblog => String(mblog.mblogid)))
    expect(ids.size, `${name} 同一页不应重复下发同一条微博`).toBe(mblogs.length)
  })
})

describeUserFixtures('mobile user fixtures (real samples)', () => {
  it.each([
    ['mobile_followings_p1.json', FOLLOWINGS_FIXTURE],
    ['mobile_fans_p1.json', FANS_FIXTURE],
  ] as const)('extracts users from %s', async (name, path) => {
    const raw = parseContainer(await readJson(path))
    const users = extractMobileUsers(raw)

    expect(users.length, `${name} 应至少解析出一个用户`).toBeGreaterThan(0)
    const keys = new Set<string>()
    for (const user of users) {
      const key = readIdOf(user)
      expect(key, `${name} 的每个用户都应有 id/idstr`).toBeDefined()
      keys.add(String(key))
    }
    expect(keys.size, `${name} 的用户应按 id 去重`).toBe(users.length)
  })
})
