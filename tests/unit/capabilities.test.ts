import type { WeiboCapability } from '~/capabilities'
import { describe, expect, it } from 'vitest'
import { listCapabilities, WEIBO_CAPABILITIES } from '~/capabilities'
import { WeiboSDK } from '~/WeiboSDK'

const VALID_AUTH: readonly WeiboCapability['auth'][] = ['cookie', 'guest', 'none']

const GUEST_CAPABLE_IDS = [
  'users.profile',
  'users.groups',
  'tweets.detail',
  'tweets.context',
  'tweets.enrich',
  'tweets.comments',
  'tweets.reposts',
  'tweets.likers',
  'media.images',
  'media.videos',
  'media.albums',
  'topics.list',
  'trends.hot',
]

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
    expect(timeline?.auth).toBe('cookie')
    expect(timeline?.guestPagination).toBe('first_page')
    expect(timeline?.guestNote).toContain('partial: true')
  })

  it('marks cookie capabilities that expose a guest first page', () => {
    for (const id of ['users.timeline', 'likes.list', 'followings.following', 'followings.fans']) {
      const capability = WEIBO_CAPABILITIES.find(item => item.id === id)
      expect(capability, id).toBeDefined()
      expect(capability?.auth, id).toBe('cookie')
      expect(capability?.guestPagination, id).toBe('first_page')
      expect(capability?.guestNote, id).toBeTruthy()
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
})
