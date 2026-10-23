import type { WeiboCapability } from '~/capabilities'
import { describe, expect, it } from 'vitest'
import { listCapabilities, WEIBO_CAPABILITIES } from '~/capabilities'
import { myCommentsSpec } from '~/services/endpoints/commentHistory'
import { favoritesSpec, favoritesTagsSpec } from '~/services/endpoints/favorite'
import { followContentSpec, friendshipsSpec } from '~/services/endpoints/follow'
import { feedGroupsSpec, mblogGroupsSpec } from '~/services/endpoints/groups'
import { likeListSpec } from '~/services/endpoints/like'
import { likersSpec } from '~/services/endpoints/likers'
import { albumDetailSpec, imageWallSpec, waterfallSpec } from '~/services/endpoints/media'
import { mentionsSpec } from '~/services/endpoints/mentions'
import { mobileContainerSpec } from '~/services/endpoints/mobile'
import { messageAttitudesSpec, messageCommentsSpec } from '~/services/endpoints/notifications'
import { searchTweetsSpec, searchUsersSpec } from '~/services/endpoints/search'
import { bandUnifiedSpec } from '~/services/endpoints/side'
import { stopicCatesSpec, stopicListSpec } from '~/services/endpoints/topic'
import { buildCommentsSpec, friendstimelineSpec, longtextSpec, myMblogSpec, repostTimelineSpec, searchProfileSpec, statusShowSpec } from '~/services/endpoints/tweet'
import { myDetailsSpec, userDetailsSpec, userInfoSpec } from '~/services/endpoints/user'
import { WeiboSDK } from '~/WeiboSDK'

const VALID_AUTH: readonly WeiboCapability['auth'][] = ['cookie', 'guest', 'none']

const GUEST_CAPABLE_IDS = [
  'users.profile',
  'users.timeline',
  'users.groups',
  'tweets.detail',
  'tweets.context',
  'tweets.enrich',
  'tweets.comments',
  'tweets.replies',
  'tweets.longText',
  'tweets.reposts',
  'tweets.likers',
  'followings.following',
  'followings.fans',
  'likes.list',
  'media.images',
  'media.videos',
  'media.albums',
  'topics.list',
  'trends.hot',
  'sdk.session',
]

interface SpecAuth {
  auth?: 'cookie' | 'guest' | 'none'
  endpoint: string
}

interface CapabilityEndpoints {
  /** Cookie 模式下实际调用的端点 */
  cookie: SpecAuth[]
  /** guest 模式下实际调用的端点（缺省 = 与 cookie 相同） */
  guest?: SpecAuth[]
  /** 由多个能力组合而成（归档编排 / 会话），不绑定单一端点 */
  composite?: true
}

function effectiveAuth(spec: SpecAuth): 'cookie' | 'guest' | 'none' {
  return spec.auth ?? 'cookie'
}

const CAPABILITY_ENDPOINTS: Record<string, CapabilityEndpoints> = {
  'users.me': { cookie: [myDetailsSpec] },
  'users.profile': { cookie: [userInfoSpec, userDetailsSpec] },
  'users.timeline': { cookie: [myMblogSpec], guest: [mobileContainerSpec] },
  'users.mentions': { cookie: [mentionsSpec] },
  // 分组定义公开可读；微博分组是账号数据（guest 下会返回访客自己的分组）。
  'users.groups': { cookie: [mblogGroupsSpec], guest: [feedGroupsSpec] },
  'tweets.detail': { cookie: [statusShowSpec] },
  'tweets.context': { cookie: [statusShowSpec, buildCommentsSpec] },
  'tweets.enrich': { cookie: [statusShowSpec] },
  'tweets.comments': { cookie: [buildCommentsSpec] },
  'tweets.replies': { cookie: [buildCommentsSpec] },
  'tweets.longText': { cookie: [longtextSpec] },
  'tweets.reposts': { cookie: [repostTimelineSpec] },
  'tweets.likers': { cookie: [likersSpec] },
  'tweets.friendTimeline': { cookie: [friendstimelineSpec] },
  'tweets.searchProfile': { cookie: [searchProfileSpec] },
  'followings.following': { cookie: [friendshipsSpec], guest: [mobileContainerSpec] },
  'followings.fans': { cookie: [friendshipsSpec], guest: [mobileContainerSpec] },
  'followings.my': { cookie: [followContentSpec] },
  'favorites.list': { cookie: [favoritesSpec] },
  'favorites.tags': { cookie: [favoritesTagsSpec] },
  'likes.list': { cookie: [likeListSpec], guest: [mobileContainerSpec] },
  'commentHistory.mine': { cookie: [myCommentsSpec] },
  'media.images': { cookie: [imageWallSpec] },
  'media.videos': { cookie: [waterfallSpec] },
  'media.albums': { cookie: [imageWallSpec, albumDetailSpec] },
  // 媒体直链下载不经过 defineEndpoint（走 MediaHttpClient）。
  'media.download': { cookie: [] },
  'topics.list': { cookie: [stopicCatesSpec, stopicListSpec] },
  'notifications.comments': { cookie: [messageCommentsSpec] },
  'notifications.likes': { cookie: [messageAttitudesSpec] },
  'trends.hot': { cookie: [bandUnifiedSpec] },
  'search.users': { cookie: [searchUsersSpec] },
  'search.tweets': { cookie: [searchTweetsSpec] },
  'archive.stream': { cookie: [], composite: true },
  'archive.batch': { cookie: [], composite: true },
  'archive.user': { cookie: [], composite: true },
  // 会话自检在 guest 下只校验访客 token，不读 profile/detail。
  'sdk.session': { cookie: [], composite: true },
}

describe('capabilities', () => {
  it('registers core capabilities with stable ids', () => {
    const ids = WEIBO_CAPABILITIES.map(capability => capability.id)
    expect(ids).toContain('tweets.detail')
    expect(ids).toContain('archive.stream')
    expect(ids).toContain('archive.batch')
    expect(ids).toContain('media.download')
    expect(ids).toContain('media.albums')
    expect(ids).toContain('topics.list')
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('filters by service and status', () => {
    const tweets = listCapabilities({ service: 'tweets' })
    expect(tweets.length).toBeGreaterThan(0)
    expect(tweets.every(capability => capability.service === 'tweets')).toBe(true)

    const unavailable = listCapabilities({ status: 'unavailable' })
    expect(unavailable.map(capability => capability.id)).toEqual(['search.users', 'search.tweets'])
  })

  it('is exposed without network access on the SDK facade', () => {
    const sdk = new WeiboSDK({ cookie: 'SUB=abc' })
    const archive = sdk.capabilities({ service: 'archive' })
    expect(archive.map(capability => capability.id)).toEqual(['archive.stream', 'archive.batch'])
  })

  it('marks account-scoped capabilities', () => {
    expect(listCapabilities({ service: 'favorites' }).map(capability => capability.accountScoped))
      .toEqual([true, true])
    expect(listCapabilities({ service: 'commentHistory' })[0].accountScoped).toBe(true)
    expect(listCapabilities({ service: 'notifications' }).every(capability => capability.accountScoped)).toBe(true)
    // 点赞按目标 uid 读取，不属于账号级能力
    expect(listCapabilities({ service: 'likes' })[0].accountScoped).toBeUndefined()
  })

  it('declares a valid auth requirement for every entry', () => {
    for (const capability of WEIBO_CAPABILITIES)
      expect(VALID_AUTH, capability.id).toContain(capability.auth)
  })

  it('marks guest-capable entries with auth guest', () => {
    expect(WEIBO_CAPABILITIES.filter(capability => capability.auth === 'guest').map(capability => capability.id))
      .toEqual(GUEST_CAPABLE_IDS)

    for (const id of GUEST_CAPABLE_IDS) {
      const capability = WEIBO_CAPABILITIES.find(item => item.id === id)
      expect(capability, id).toBeDefined()
      // 每个 guest 能力都要声明 guest 模式下的分页行为
      expect(['none', 'first_page', 'full'], id).toContain(capability?.guestPagination)
    }
  })

  it('degrades guest timeline to the first page only', () => {
    const timeline = WEIBO_CAPABILITIES.find(capability => capability.id === 'users.timeline')
    expect(timeline?.auth).toBe('guest')
    expect(timeline?.guestPagination).toBe('first_page')
    expect(timeline?.guestNote).toContain('partial: true')
  })

  it('marks every guest-first-page capability as guest auth', () => {
    for (const id of ['users.timeline', 'likes.list', 'followings.following', 'followings.fans']) {
      const capability = WEIBO_CAPABILITIES.find(item => item.id === id)
      expect(capability, id).toBeDefined()
      expect(capability?.auth, id).toBe('guest')
      expect(capability?.guestPagination, id).toBe('first_page')
      expect(capability?.guestNote, id).toBeTruthy()
    }
  })

  it('only references methods that exist on the referenced service', () => {
    const sdk = new WeiboSDK({ cookie: 'SUB=abc' })

    for (const capability of WEIBO_CAPABILITIES) {
      const target = capability.service === 'sdk'
        ? sdk
        : (sdk as unknown as Record<string, Record<string, unknown>>)[capability.service]
      expect(target, `${capability.id}: service ${capability.service}`).toBeDefined()

      for (const method of capability.methods)
        expect(typeof (target as Record<string, unknown>)[method], `${capability.id}: ${method}`).toBe('function')
    }
  })

  it('keeps archive cookie-only', () => {
    const archive = listCapabilities({ service: 'archive' })
    expect(archive.length).toBe(2)
    expect(archive.every(capability => capability.auth === 'cookie')).toBe(true)
    expect(archive.every(capability => capability.guestNote !== undefined)).toBe(true)
  })

  it('keeps media.download login-free', () => {
    const download = WEIBO_CAPABILITIES.find(capability => capability.id === 'media.download')
    expect(download?.auth).toBe('none')
  })

  /**
   * 能力清单与 endpoint 的 `defineEndpoint({ auth })` 是两套声明，必须交叉校验：
   * 之前只断言「方法存在」，registry 写 guest、endpoint 写 cookie 也会全绿。
   *
   * guest 能力不是简单复用 cookie 端点：`users.timeline` / `followings.*` / `likes.list`
   * 在 guest 下改走 m 站容器，所以映射显式区分两条路由。
   */
  it('keeps capability auth in sync with endpoint specs', () => {
    const mapped = new Set(Object.keys(CAPABILITY_ENDPOINTS))
    const declared = new Set(WEIBO_CAPABILITIES.map(capability => capability.id))
    expect([...declared].filter(id => !mapped.has(id)), '新增能力未登记 endpoint 映射').toEqual([])
    expect([...mapped].filter(id => !declared.has(id)), 'endpoint 映射指向不存在的能力').toEqual([])

    for (const capability of WEIBO_CAPABILITIES) {
      const mapping = CAPABILITY_ENDPOINTS[capability.id]
      expect(mapping, `${capability.id}: 缺少 endpoint 映射`).toBeDefined()
      if (mapping.composite)
        continue

      if (capability.auth === 'cookie') {
        expect(mapping.cookie.length, `${capability.id}: cookie 能力必须声明端点`).toBeGreaterThan(0)
        for (const spec of mapping.cookie)
          expect(effectiveAuth(spec), `${capability.id}: ${spec.endpoint} 需要 Cookie`).toBe('cookie')
      }
      else if (capability.auth === 'guest') {
        const guestRoute = mapping.guest ?? mapping.cookie
        expect(guestRoute.length, `${capability.id}: guest 能力必须声明端点`).toBeGreaterThan(0)
        expect(
          guestRoute.some(spec => effectiveAuth(spec) !== 'cookie'),
          `${capability.id}: capability 声明 guest，但端点全部要求 Cookie`,
        ).toBe(true)
      }
      else {
        for (const spec of mapping.cookie)
          expect(effectiveAuth(spec), `${capability.id}: ${spec.endpoint} 不应要求 Cookie`).not.toBe('cookie')
      }
    }
  })
})
