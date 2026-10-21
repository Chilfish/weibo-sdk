import type { ITweet, ITweetComment, TweetContractVersion } from '~/types/domain/ITweet'
import { readFileSync } from 'node:fs'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { migrateTweetV1toV2 } from '~/models/data/migrateTweet'
import { isRawTweet, normalizeComment, normalizeTweet } from '~/models/data/Tweet'
import { TWEET_CONTRACT_VERSION } from '~/types/domain/ITweet'

/**
 * ITweet v2 契约冻结测试。
 *
 * ITweet 是下游的磁盘存档终局契约：改字段 = 破坏下游已归档数据。
 * 本文件用两层锁定形状：
 * - 类型层：`keyof ITweet` 精确等于冻结键集（rename / remove / 新增必改此处，编译期即失败）
 * - 运行时层：真实 fixture（mymblog_page1.json，含 pic_infos 样本）归一化产物的键集快照
 *
 * 冻结规则与迁移策略见 docs/engineering/contract-itweet-v2.md。
 */
describe('iTweet v2 contract freeze', () => {
  it('exports TWEET_CONTRACT_VERSION = 2', () => {
    expect(TWEET_CONTRACT_VERSION).toBe(2)
    expectTypeOf<TweetContractVersion>().toEqualTypeOf<2>()
  })

  it('freezes top-level field names at the type level', () => {
    expectTypeOf<keyof ITweet>().toEqualTypeOf<
      | 'id' | 'mblogId' | 'createdAt' | 'text' | 'regionName' | 'source'
      | 'user' | 'stats' | 'visible' | 'retweetedStatus' | 'repostChain' | 'pageInfo' | 'media' | 'geo'
      | 'topics' | 'linkCards' | 'readCount' | 'editCount' | 'title' | 'permanentVideoUrl' | 'isOriginal' | 'sourceUrl'
      | 'atUsers' | 'playCount' | 'isTop' | 'audio'
      | 'comments'
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
      'atUsers',
      'audio',
      'createdAt',
      'editCount',
      'geo',
      'id',
      'isOriginal',
      'isTop',
      'linkCards',
      'mblogId',
      'media',
      'pageInfo',
      'permanentVideoUrl',
      'playCount',
      'readCount',
      'regionName',
      'repostChain',
      'retweetedStatus',
      'source',
      'sourceUrl',
      'stats',
      'text',
      'title',
      'topics',
      'user',
      'visible',
    ])
    expect(Object.keys(tweet.stats).sort()).toEqual(['comments', 'likes', 'reposts'])
    expect(Object.keys(tweet.user).sort()).toEqual(['avatar', 'id', 'name', 'verified', 'verifiedType'])
    expect(tweet.media.length).toBeGreaterThan(0)
    // pic_infos 路径的 media 键集（videoUrl 键恒在，无实况视频时值为 undefined）
    expect(Object.keys(tweet.media[0]).sort()).toEqual(['height', 'id', 'imageUrl', 'type', 'videoUrl', 'width'])
  })

  it('freezes ITweetComment v2 field names at the type level', () => {
    expectTypeOf<keyof ITweetComment>().toEqualTypeOf<
      | 'id' | 'createdAt' | 'text' | 'source' | 'likes' | 'user' | 'replies' | 'pics'
      | 'rootId' | 'replyTo' | 'floorNumber' | 'totalReplies' | 'liked' | 'parentMblogId'
    >()
  })

  it('normalizes real image comments into a frozen pics shape', () => {
    const raw: unknown = JSON.parse(readFileSync('tests/fixtures/raw/comments_pic_multi.json', 'utf8'))
    const comment = normalizeComment((raw as { data: unknown[] }).data[0])

    expect(comment.pics).toHaveLength(2)
    expect(Object.keys(comment.pics![0]).sort()).toEqual(['height', 'id', 'imageUrl', 'width'])
  })

  it('migrates v1 records by stripping textHtml recursively', () => {
    const v2 = migrateTweetV1toV2({
      id: '1',
      text: 'hello',
      textHtml: '<b>hello</b>',
      retweetedStatus: { id: '2', text: 'quote', textHtml: '<i>quote</i>' },
      comments: [{
        id: 'c',
        text: 'comment',
        textHtml: 'comment',
        replies: [{
          id: 'r',
          text: 'reply',
          textHtml: 'reply',
          replyTo: { id: 'p', text: 'parent', textHtml: 'parent' },
        }],
      }],
    })

    expect(v2.text).toBe('hello')
    expect(v2).not.toHaveProperty('textHtml')
    expect(v2.retweetedStatus).not.toHaveProperty('textHtml')
    expect(v2.comments?.[0]).not.toHaveProperty('textHtml')
    expect(v2.comments?.[0].replies?.[0]).not.toHaveProperty('textHtml')
    expect(v2.comments?.[0].replies?.[0].replyTo).not.toHaveProperty('textHtml')
  })
})
