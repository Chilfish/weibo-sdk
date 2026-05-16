import { describe, expect, it } from 'vitest'
import { WeiboSDK } from '~/WeiboSDK'

const cookie = process.env.WEIBO_COOKIE
const e2eEnabled = process.env.WEIBO_E2E === '1'

const describeE2E = e2eEnabled && cookie ? describe : describe

/**
 * 提取响应结构摘要：保留 key 路径与值类型，剥离所有可变值。
 * 可变值包括：带 token/签名 URL、时间戳、计数、ID、坐标、日期字符串等。
 */
function stripVolatileKeys(obj: unknown, depth = 0): unknown {
  if (obj === null || obj === undefined)
    return obj
  if (Array.isArray(obj)) {
    return obj.length > 0 ? [stripVolatileKeys(obj[0], depth + 1)] : []
  }
  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(record)) {
      // 签名 URL
      if (typeof v === 'string' && (
        v.includes('Expires=') || v.includes('&ssig=') || v.includes('?KID=')
        || v.includes('imgbed') || v.includes('sinaimg')
      )) {
        out[k] = '<IMG_URL>'
        continue
      }
      // 可变数字：计数、ID、坐标、等级
      if (['followers_count', 'friends_count', 'statuses_count', 'attitudes_count', 'comments_count', 'reposts_count', 'reads_count', 'total_number', 'total_cnt', 'pic_num', 'mbrank', 'mbtype', 'svip', 'vvip', 'v_plus', 'user_ability', 'mlevel', 'mblog_vip_type', 'content_auth', 'is_show_bulletin', 'verified_type', 'verified_type_ext', 'user_type', 'planet_video', 'follow_me', 'following', 'special_follow', 'apply_scenario_flag', 'display_text_min_number', 'comment_permission_type', 'approval_comment_type', 'comment_sort_type', 'share_repost_type', 'mblogtype', 'repost_type', 'showFeedRepost', 'showFeedComment', 'pictureViewerSign', 'showPictureViewer', 'is_paid', 'isSinglePayAudio', 'isMarkdown', 'can_edit', 'can_remark', 'is_show_mixed', 'mixed_count', 'favorited', 'attitudes_status', 'number_display_strategy'].includes(k) && typeof v === 'number') {
        out[k] = '<NUM>'
        continue
      }
      // 可变 ID（数字或数字串）
      if (['id', 'idstr', 'mid', 'mblogid', 'rid', 'fid', 'oid', 'object_id', 'pic_id', 'page_id', 'media_id', 'video_object_id', 'containerid', 'cardid', 'lcardid', 'luicode', 'lfid', 'uicode'].includes(k) && (typeof v === 'number' || typeof v === 'string')) {
        out[k] = '<ID>'
        continue
      }
      // 可变数值：total, pc_new, edit_count
      if (['total', 'pc_new', 'edit_count', 'textLength', 'reads_count', 'since_id', 'status_visible'].includes(k) && (typeof v === 'number' || typeof v === 'string')) {
        out[k] = '<VAR>'
        continue
      }
      // 时间字符串
      if (['created_at', 'birthday', 'video_publish_time'].includes(k) && typeof v === 'string') {
        out[k] = '<DATE>'
        continue
      }
      // 坐标
      if (k === 'coordinates' && Array.isArray(v)) {
        out[k] = '<COORDS>'
        continue
      }
      // 可变内容
      if (['text', 'text_raw', 'region_name', 'source', 'screen_name', 'description', 'location', 'profile_url', 'cover_image_phone', 'desc_text', 'ip_location', 'verified_url', 'friend_info', 'display_text', 'blockText', 'url', 'scheme', 'long_url', 'short_url', 'ori_url', 'h5_target_url', 'topic_url', 'topic_title', 'url_title', 'page_title', 'page_url', 'page_pic', 'tag_name', 'tag_scheme', 'object_type', 'analysis_extra', 'mark', 'ext', 'code', 'act_code', 'act_type', 'source_text', 'readtimetype', 'mblog_feed_back_menus_format', 'number_display_strategy'].includes(k) && typeof v === 'string') {
        out[k] = '<STR>'
        continue
      }
      // 嵌套对象递归
      if (typeof v === 'object' && v !== null) {
        out[k] = stripVolatileKeys(v, depth + 1)
        continue
      }
      out[k] = v
    }
    return out
  }
  return obj
}

describeE2E('snapshot: user profile structure', () => {
  it('info response structure matches', async () => {
    const { userId } = await import('tests/utils')
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })

    const raw = await weibo.users.info(userId)
    expect(stripVolatileKeys(raw)).toMatchSnapshot()
  })

  it('detail response structure matches', async () => {
    const { userId } = await import('tests/utils')
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })

    const raw = await weibo.users.details(userId)
    expect(stripVolatileKeys(raw)).toMatchSnapshot()
  })

  it('normalized User has valid shape', async () => {
    const { userId } = await import('tests/utils')
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })

    const user = await weibo.users.getById(userId)

    expect(typeof user.id).toBe('string')
    expect(typeof user.name).toBe('string')
    expect(typeof user.url).toBe('string')
    expect(user.url).toMatch(/^https:\/\/weibo\.com/)
    expect(typeof user.avatar).toBe('string')
    expect(typeof user.gender).toBe('string')
    expect(['m', 'f', 'n']).toContain(user.gender)
    expect(typeof user.stats.followers).toBe('number')
    expect(typeof user.stats.friends).toBe('number')
    expect(typeof user.stats.statuses).toBe('number')
    expect(user.stats.followers).toBeGreaterThanOrEqual(0)
    expect(user.verification).toBeDefined()
    expect(typeof user.verification.isVerified).toBe('boolean')
  })
})

describeE2E('snapshot: tweet structure', () => {
  // 缓存第一次 mymblog 的结果，避免重复请求
  let cachedMblogIds: string[] | null = null

  async function getFirstMblogIds(): Promise<string[]> {
    if (cachedMblogIds)
      return cachedMblogIds
    const { userId } = await import('tests/utils')
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })
    const page = await weibo.tweets.listByUserId(userId)
    cachedMblogIds = page.tweets.slice(0, 3).map(t => t.mblogId)
    return cachedMblogIds
  }

  it('mymblog response structure matches', async () => {
    const { userId } = await import('tests/utils')
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })

    const raw = await weibo.tweets.myMblog(userId)
    expect(stripVolatileKeys(raw)).toMatchSnapshot()
  })

  it('normalized Tweet list has valid shape', async () => {
    const { userId } = await import('tests/utils')
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })

    const page = await weibo.tweets.listByUserId(userId)

    expect(page.tweets.length).toBeGreaterThan(0)
    expect(typeof page.sinceId).toBe('number')
    expect(typeof page.hasMore).toBe('boolean')

    for (const tweet of page.tweets) {
      expect(typeof tweet.id).toBe('string')
      expect(typeof tweet.mblogId).toBe('string')
      expect(typeof tweet.createdAt).toBe('string')
      expect(typeof tweet.text).toBe('string')
      expect(tweet.user).toBeDefined()
      expect(typeof tweet.user.id).toBe('string')
      expect(typeof tweet.user.name).toBe('string')
      expect(typeof tweet.user.avatar).toBe('string')
      expect(typeof tweet.user.verifiedType).toBe('number')
      expect(Array.isArray(tweet.media)).toBe(true)
      expect(tweet.stats.likes).toBeGreaterThanOrEqual(0)
      expect(tweet.stats.comments).toBeGreaterThanOrEqual(0)
      expect(tweet.stats.reposts).toBeGreaterThanOrEqual(0)
    }
  })

  it('statuses/show response structure matches (first tweet from timeline)', async () => {
    const mblogIds = await getFirstMblogIds()
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })

    for (const mblogId of mblogIds) {
      const raw = await weibo.tweets.show(mblogId, true)
      expect(raw.ok).toBe(1)
      expect(raw.mblogid).toBe(mblogId)
      expect(raw.user).toBeDefined()
      expect(stripVolatileKeys(raw)).toMatchSnapshot()
    }
  })

  it('normalized single tweet has valid shape', async () => {
    const mblogIds = await getFirstMblogIds()
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })

    for (const mblogId of mblogIds) {
      const tweet = await weibo.tweets.getByMblogId(mblogId)

      expect(typeof tweet.id).toBe('string')
      expect(tweet.mblogId).toBe(mblogId)
      expect(typeof tweet.text).toBe('string')
      expect(tweet.user).toBeDefined()
      expect(Array.isArray(tweet.media)).toBe(true)
      expect(tweet.stats.likes).toBeGreaterThanOrEqual(0)

      if (tweet.retweetedStatus) {
        expect(typeof tweet.retweetedStatus.id).toBe('string')
        expect(typeof tweet.retweetedStatus.mblogId).toBe('string')
        expect(tweet.retweetedStatus.user).toBeDefined()
      }
    }
  })
})

describeE2E('snapshot: SDK lifecycle', () => {
  it('selfCheck succeeds with valid cookie', async () => {
    const weibo = new WeiboSDK({ cookie: cookie! })
    await expect(weibo.selfCheck()).resolves.toBeUndefined()
  })

  it('checkSession returns true', async () => {
    const weibo = new WeiboSDK({ cookie: cookie! })
    expect(await weibo.checkSession()).toBe(true)
  })
})
