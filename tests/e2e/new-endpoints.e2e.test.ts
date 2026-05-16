import { describe, expect, it } from 'vitest'
import { WeiboSDK } from '~/WeiboSDK'
import 'dotenv'

const cookie = process.env.WEIBO_COOKIE

const describeE2E = cookie ? describe : describe.skip

const IMG_DOMAINS = ['Expires=', '&ssig=', '?KID=', 'imgbed', 'sinaimg', 'sinajs']

const NUMERIC_KEYS = [
  'followers_count',
  'friends_count',
  'statuses_count',
  'attitudes_count',
  'comments_count',
  'reposts_count',
  'reads_count',
  'total_number',
  'total_cnt',
  'pic_num',
  'mbrank',
  'mbtype',
  'svip',
  'vvip',
  'v_plus',
  'user_ability',
  'mlevel',
  'mblog_vip_type',
  'content_auth',
  'is_show_bulletin',
  'verified_type',
  'verified_type_ext',
  'user_type',
  'planet_video',
  'follow_me',
  'following',
  'special_follow',
  'number_display_strategy',
  'pagefriends_count',
  'video_status_count',
  'favourites_count',
  'bi_followers_count',
  'credit_score',
  'urank',
  'story_read_state',
  'live_status',
  'block',
  'block_me',
  'like',
  'like_me',
  'has_filtered_attentions',
  'has_filtered_fans',
  'next_cursor',
  'previous_cursor',
  'sort_type',
  'type',
  'show_unread',
  'fill_material',
  'use_sink_stragety',
  'use_status_strategy',
  'show_related_topic',
]

const ID_KEYS = [
  'id',
  'idstr',
  'mid',
  'mblogid',
  'rid',
  'fid',
  'oid',
  'object_id',
  'pic_id',
  'page_id',
  'media_id',
  'video_object_id',
  'containerid',
  'cardid',
  'lcardid',
  'luicode',
  'lfid',
  'uicode',
]

const VAR_KEYS = ['total', 'pc_new', 'edit_count', 'textLength', 'since_id', 'status_visible']

const DATE_KEYS = ['created_at', 'birthday', 'video_publish_time']

const STR_KEYS = [
  'text',
  'text_raw',
  'region_name',
  'source',
  'screen_name',
  'name',
  'description',
  'location',
  'profile_url',
  'cover_image_phone',
  'desc_text',
  'ip_location',
  'verified_url',
  'friend_info',
  'display_text',
  'blockText',
  'url',
  'scheme',
  'long_url',
  'short_url',
  'ori_url',
  'h5_target_url',
  'topic_url',
  'topic_title',
  'url_title',
  'page_title',
  'page_url',
  'page_pic',
  'tag_name',
  'tag_scheme',
  'object_type',
  'analysis_extra',
  'mark',
  'ext',
  'code',
  'act_code',
  'act_type',
  'source_text',
  'readtimetype',
  'mblog_feed_back_menus_format',
  'longTextContent',
  'longTextContent_raw',
  'absstr',
  'province',
  'city',
  'domain',
  'weihao',
  'verified_reason',
  'remark',
]

function stripVolatileKeys(obj: unknown, depth = 0): unknown {
  if (obj === null || obj === undefined)
    return obj
  if (Array.isArray(obj))
    return obj.length > 0 ? [stripVolatileKeys(obj[0], depth + 1)] : []
  if (typeof obj !== 'object')
    return obj

  const record = obj as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(record)) {
    if (typeof v === 'string' && IMG_DOMAINS.some(d => v.includes(d))) {
      out[k] = '<IMG_URL>'
      continue
    }
    if (NUMERIC_KEYS.includes(k) && typeof v === 'number') {
      out[k] = '<NUM>'
      continue
    }
    if (ID_KEYS.includes(k) && (typeof v === 'number' || typeof v === 'string')) {
      out[k] = '<ID>'
      continue
    }
    if (VAR_KEYS.includes(k) && (typeof v === 'number' || typeof v === 'string')) {
      out[k] = '<VAR>'
      continue
    }
    if (DATE_KEYS.includes(k) && typeof v === 'string') {
      out[k] = '<DATE>'
      continue
    }
    if (k === 'coordinates' && Array.isArray(v)) {
      out[k] = '<COORDS>'
      continue
    }
    if (STR_KEYS.includes(k) && typeof v === 'string') {
      out[k] = '<STR>'
      continue
    }
    if (typeof v === 'object' && v !== null) {
      out[k] = stripVolatileKeys(v, depth + 1)
      continue
    }
    out[k] = v
  }
  return out
}

describeE2E('snapshot: /ajax/statuses/longtext', () => {
  it('longtext structure snapshot', async () => {
    const { userId } = await import('tests/utils')
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })
    const page = await weibo.tweets.myMblog(userId)
    const longTweet = page.data.list.find((t: any) => t.isLongText)
    if (!longTweet)
      return
    const raw = await weibo.tweets.longText(longTweet.mblogid)
    expect(raw.ok).toBe(1)
    expect(raw.data.longTextContent).toBeTruthy()
    expect(stripVolatileKeys(raw)).toMatchSnapshot()
  })
})

describeE2E('snapshot: /ajax/friendships/friends', () => {
  it('friendships structure snapshot', async () => {
    const { userId } = await import('tests/utils')
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })
    const raw = await weibo.followings.getFollowings(userId)
    expect(raw.ok).toBe(1)
    expect(Array.isArray(raw.users)).toBe(true)
    expect(raw.users.length).toBeGreaterThan(0)
    expect(stripVolatileKeys(raw)).toMatchSnapshot()
  })
})

describeE2E('snapshot: /ajax/profile/followContent', () => {
  it('followContent structure snapshot', async () => {
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })
    const raw = await weibo.followings.getMyFollowings()
    expect(raw.ok).toBe(1)
    expect(raw.data.follows.users.length).toBeGreaterThan(0)
    expect(stripVolatileKeys(raw)).toMatchSnapshot()
  })
})

describeE2E('snapshot: /ajax/statuses/searchProfile', () => {
  it('searchProfile structure snapshot', async () => {
    const { userId } = await import('tests/utils')
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })
    const raw = await weibo.tweets.searchByDate(userId, { page: 1 })
    expect(raw.ok).toBe(1)
    expect(Array.isArray(raw.data.list)).toBe(true)
    expect(raw.data.list.length).toBeGreaterThan(0)
    expect(stripVolatileKeys(raw)).toMatchSnapshot()
  })
})

describeE2E('snapshot: /ajax/favorites/all_fav', () => {
  it('favorites structure snapshot', async () => {
    const { userId } = await import('tests/utils')
    const weibo = new WeiboSDK({ cookie: cookie!, selfCheck: { mode: 'lazy' } })
    const raw = await weibo.favorites.getFavorites(userId)
    expect(raw.ok).toBe(1)
    expect(Array.isArray(raw.data.status)).toBe(true)
    expect(raw.data.status.length).toBeGreaterThan(0)
    expect(stripVolatileKeys(raw)).toMatchSnapshot()
  })
})
