import type { ITweet, TweetContractVersion } from '~/types/domain/ITweet'
import { readFileSync } from 'node:fs'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { isRawTweet, normalizeTweet } from '~/models/data/Tweet'
import { TWEET_CONTRACT_VERSION } from '~/types/domain/ITweet'

/**
 * ITweet v1 契约冻结测试（K1 / P0-1）。
 *
 * ITweet 是下游的磁盘存档终局契约：改字段 = 破坏下游已归档数据。
 * 本文件用两层锁定形状：
 * - 类型层：`keyof ITweet` 精确等于冻结键集（rename / remove / 新增必改此处，编译期即失败）
 * - 运行时层：真实 fixture（mymblog_page1.json，含 pic_infos 样本）归一化产物的键集快照
 *
 * 冻结规则与迁移策略见 docs/engineering/contract-itweet-v1.md。
 */
describe('iTweet v1 contract freeze', () => {
  it('exports TWEET_CONTRACT_VERSION = 1 (frozen 2026-09-04)', () => {
    expect(TWEET_CONTRACT_VERSION).toBe(1)
    expectTypeOf<TweetContractVersion>().toEqualTypeOf<1>()
  })

  it('freezes top-level field names at the type level', () => {
    expectTypeOf<keyof ITweet>().toEqualTypeOf<
      | 'id' | 'mblogId' | 'createdAt' | 'text' | 'textHtml' | 'regionName' | 'source'
      | 'user' | 'stats' | 'visible' | 'retweetedStatus' | 'pageInfo' | 'media' | 'geo'
    >()
  })

  it('normalizing a real fixture yields exactly the frozen key set', () => {
    // 真实样本：mymblog_page1.json 第一条（含 pic_infos，走 extractMediaFromPicInfos 路径）
    const raw: unknown = JSON.parse(readFileSync('tests/fixtures/raw/mymblog_page1.json', 'utf8'))
    const item = (raw as { data: { list: unknown[] } }).data.list[0]
    // 经 isRawTweet guard 收窄（与 filterTweets 同一收窄路径）
    if (!isRawTweet(item))
      throw new Error('fixture first item is not a raw tweet (fixture drift?)')
    const tweet = normalizeTweet(item)

    expect(Object.keys(tweet).sort()).toEqual([
      'createdAt',
      'geo',
      'id',
      'mblogId',
      'media',
      'pageInfo',
      'regionName',
      'retweetedStatus',
      'source',
      'stats',
      'text',
      'textHtml',
      'user',
      'visible',
    ])
    expect(Object.keys(tweet.stats).sort()).toEqual(['comments', 'likes', 'reposts'])
    expect(Object.keys(tweet.user).sort()).toEqual(['avatar', 'id', 'name', 'verified', 'verifiedType'])
    expect(tweet.media.length).toBeGreaterThan(0)
    // pic_infos 路径的 media 键集（videoUrl 键恒在，无实况视频时值为 undefined）
    expect(Object.keys(tweet.media[0]).sort()).toEqual(['height', 'id', 'imageUrl', 'type', 'videoUrl', 'width'])
  })
})
