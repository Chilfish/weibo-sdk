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
      expect(page.ok).toBe(1)
      expect(Array.isArray(page.data)).toBe(true)
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
      expect(trends.ok).toBe(1)
      expect(Array.isArray(trends.data.realtime)).toBe(true)
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
