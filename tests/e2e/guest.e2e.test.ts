import type { TestContext } from 'vitest'
import { describe, expect, it } from 'vitest'
import { RateLimitError } from '~/models/errors/TransportError'
import { WeiboSDK } from '~/WeiboSDK'

/**
 * Guest smoke：不依赖登录 Cookie，只验证公开数据读取。
 *
 * 独立开关 `WEIBO_GUEST_E2E=1`，避免与「必须有 WEIBO_COOKIE」的既有 E2E 混在一起。
 * 访客 token 发放 / 上游限流命中 432 时记 skip，不把 CI 卡死。
 */
const isGuestE2E = process.env.WEIBO_GUEST_E2E === '1'
const describeGuest = isGuestE2E ? describe : describe.skip

const UID = '2365795232'
const MBLOG_ID = 'OgHLUyXYP'
const MID = '5039815108333719'

function createGuestSdk(): WeiboSDK {
  return new WeiboSDK({ auth: 'guest', selfCheck: { mode: 'lazy' } })
}

/** 432 / 429 是上游限流，不是功能失败：记为 skip。 */
async function tolerant(ctx: TestContext, run: () => Promise<void>): Promise<void> {
  try {
    await run()
  }
  catch (error) {
    if (error instanceof RateLimitError) {
      ctx.skip()
      return
    }
    throw error
  }
}

describeGuest('e2e:guest', () => {
  it('reads a public tweet without a cookie', async (ctx) => {
    await tolerant(ctx, async () => {
      const tweet = await createGuestSdk().tweets.getByMblogId(MBLOG_ID)
      expect(tweet.mblogId).toBe(MBLOG_ID)
      expect(tweet.user.id).toBeTruthy()
      expect(tweet.text.length).toBeGreaterThan(0)
    })
  })

  it('reads the first page of comments', async (ctx) => {
    await tolerant(ctx, async () => {
      const page = await createGuestSdk().tweets.comments(MID)
      // 新契约：{ comments, cursor, hasMore, total?, notice? }，不再是上游信封（ok / data）
      expect(Array.isArray(page.comments)).toBe(true)
      expect(page.comments.length).toBeGreaterThan(0)
      expect(typeof page.cursor).toBe('number')
      expect(typeof page.hasMore).toBe('boolean')
      // 游标为 0 表示到底
      if (page.cursor === 0)
        expect(page.hasMore).toBe(false)
      if (page.total !== undefined)
        expect(typeof page.total).toBe('number')
      if (page.notice !== undefined)
        expect(typeof page.notice).toBe('string')
      expect(page).not.toHaveProperty('ok')
      expect(page).not.toHaveProperty('data')

      const [comment] = page.comments
      expect(typeof comment.id).toBe('string')
      expect(typeof comment.text).toBe('string')
      expect(typeof comment.createdAt).toBe('string')
      expect(typeof comment.user.id).toBe('string')
      expect(comment).not.toHaveProperty('floor_number')
      expect(comment).not.toHaveProperty('created_at')
    })
  })

  it('reads a public user profile', async (ctx) => {
    await tolerant(ctx, async () => {
      const user = await createGuestSdk().users.getById(UID)
      expect(user.id).toBe(UID)
      expect(user.name).toBeTruthy()
    })
  })

  it('reads hot trends', async (ctx) => {
    await tolerant(ctx, async () => {
      const trends = await createGuestSdk().trends.hotBand('hot')
      // 新契约：直接返回归一化 TrendItem[]，不再是 { ok, data: { realtime } }
      expect(Array.isArray(trends)).toBe(true)
      expect(trends.length).toBeGreaterThan(0)

      const [first] = trends
      expect(typeof first.word).toBe('string')
      expect(first.word.length).toBeGreaterThan(0)
      if (first.heat !== undefined)
        expect(typeof first.heat).toBe('number')
      if (first.label !== undefined)
        expect(typeof first.label).toBe('string')
      if (first.schemeUrl !== undefined)
        expect(typeof first.schemeUrl).toBe('string')
      // 上游字段名不再泄漏
      expect(first).not.toHaveProperty('label_name')
      expect(first).not.toHaveProperty('icon_desc')
      expect(first).not.toHaveProperty('word_scheme')
    })
  })

  it('returns the first timeline page with partial=true', async (ctx) => {
    await tolerant(ctx, async () => {
      const page = await createGuestSdk().tweets.listByUserId(UID)
      expect(page.partial).toBe(true)
      expect(page.hasMore).toBe(false)
      expect(page.tweets.length).toBeGreaterThan(0)
    })
  })
})
