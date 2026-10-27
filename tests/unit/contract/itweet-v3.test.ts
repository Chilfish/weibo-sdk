import type { RawTweet } from '~/models/data/Tweet'
import type { ITweet, ITweetComment, TweetContractVersion } from '~/types/domain/ITweet'
import { readFileSync } from 'node:fs'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { migrateTweetV1toV2, migrateTweetV2toV3 } from '~/models/data/migrateTweet'
import { isRawTweet, normalizeComment, normalizeTweet } from '~/models/data/Tweet'
import { TWEET_CONTRACT_VERSION } from '~/types/domain/ITweet'

/**
 * ITweet v3 契约冻结测试。
 *
 * ITweet 是 SDK 的磁盘存档契约：改字段 = 让已经写出的 JSON 失效。
 * 本文件用两层锁定形状：
 * - 类型层：`keyof ITweet` 精确等于冻结键集（rename / remove / 新增必改此处，编译期即失败）
 * - 运行时层：真实 fixture 归一化产物的键集与新增字段快照
 *
 * 冻结规则与迁移策略见 website/reference/tweet-contract.md。
 */
describe('iTweet v3 contract freeze', () => {
  it('exports TWEET_CONTRACT_VERSION = 3', () => {
    expect(TWEET_CONTRACT_VERSION).toBe(3)
    expectTypeOf<TweetContractVersion>().toEqualTypeOf<3>()
  })

  it('freezes top-level field names at the type level', () => {
    expectTypeOf<keyof ITweet>().toEqualTypeOf<
      | 'id' | 'mblogId' | 'createdAt' | 'text' | 'regionName' | 'source'
      | 'user' | 'stats' | 'visible' | 'flags'
      | 'retweetedStatus' | 'repostChain' | 'pageInfo' | 'attachments' | 'media' | 'geo'
      | 'topics' | 'linkCards' | 'title' | 'permanentVideoUrl' | 'sourceUrl' | 'atUsers' | 'audio'
      | 'editedAt' | 'tags' | 'superTopic' | 'contentNotices'
      | 'comments'
    >()
  })

  it('normalizing a real fixture yields exactly the frozen key set', () => {
    const tweet = loadFirstTweet('mymblog_page1.json')

    expect(Object.keys(tweet).sort()).toEqual([
      'atUsers',
      'audio',
      'contentNotices',
      'createdAt',
      'editedAt',
      'flags',
      'geo',
      'id',
      'linkCards',
      'mblogId',
      'media',
      'pageInfo',
      'permanentVideoUrl',
      'regionName',
      'repostChain',
      'retweetedStatus',
      'source',
      'sourceUrl',
      'stats',
      'superTopic',
      'tags',
      'text',
      'title',
      'topics',
      'user',
      'visible',
    ])
    expect(Object.keys(tweet.stats).sort()).toEqual(['comments', 'likes', 'reads', 'reposts'])
    expect(Object.keys(tweet.flags ?? {}).sort()).toEqual(['editable', 'original'])
    expect(Object.keys(tweet.user).sort()).toEqual(['avatar', 'id', 'name', 'verified', 'verifiedType'])
    expect(tweet.media.length).toBeGreaterThan(0)
    expect(Object.keys(tweet.media[0]).sort()).toEqual([
      'focusPoint',
      'height',
      'id',
      'imageUrl',
      'type',
      'videoUrl',
      'width',
    ])
  })

  it('extracts tags, super topic, notices and edit time from real fixtures', () => {
    const favorite = findByPredicate('favorites_p1.json', item => item.tag_struct !== undefined)
    expect(normalizeTweet(favorite).tags).toEqual([{
      name: '热文指数30000+',
      hidden: false,
      type: 2,
      oid: '1022:2329905280229075452417',
      url: expect.any(String),
      iconUrl: expect.any(String),
    }])

    const topicSource = findByPredicate('at_status.json', item => item.title_source !== undefined)
    expect(normalizeTweet(topicSource).superTopic).toEqual({
      name: 'bangdream超话',
      url: expect.any(String),
      imageUrl: expect.any(String),
    })

    const notice = findByPredicate('feed_latest_p1.json', item => item.ai_tag_info !== undefined)
    expect(normalizeTweet(notice).contentNotices).toEqual(['该内容使用AI技术辅助创作'])

    const edited = findByPredicate('message_cmt_p1.json', item => typeof item.edit_at === 'string')
    expect(normalizeTweet(edited).editedAt).toBe(edited.edit_at)
  })

  it('reads counters and boolean flags from real fields', () => {
    const tweet = loadFirstTweet('mymblog_page1.json')
    expect(tweet.stats.reads).toBe(117)
    expect(tweet.flags?.editable).toBe(true)

    const pinned = findByPredicate('mymblog_pinned.json', item => item.isTop === 1)
    expect(normalizeTweet(pinned).flags?.pinned).toBe(true)

    const retweet = findByPredicate('searchProfile_p1.json', item => item.retweeted_status !== undefined)
    expect(normalizeTweet(retweet).flags?.original).toBe(false)
  })

  it('maps focus points onto the matching media item', () => {
    const item = loadFirstTweet('mymblog_page1.json')
    const withFocus = item.media.find(media => media.focusPoint !== undefined)
    expect(withFocus?.focusPoint).toEqual(expect.objectContaining({
      left: expect.any(Number),
      top: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
    }))
  })

  it('freezes ITweetComment field names at the type level', () => {
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

  it('migrates v2 counters and flags into stats and flags recursively', () => {
    const v3 = migrateTweetV2toV3({
      id: '1',
      stats: { likes: 1, comments: 2, reposts: 3 },
      readCount: 10,
      playCount: 20,
      editCount: 4,
      isTop: true,
      isOriginal: false,
      retweetedStatus: {
        id: '2',
        stats: { likes: 0, comments: 0, reposts: 0 },
        readCount: 5,
        isOriginal: true,
      },
    })

    expect(v3.stats).toEqual({ likes: 1, comments: 2, reposts: 3, reads: 10, plays: 20, edits: 4 })
    expect(v3.flags).toEqual({ pinned: true, original: false })
    expect(v3).not.toHaveProperty('readCount')
    expect(v3).not.toHaveProperty('isTop')
    expect(v3.retweetedStatus?.stats).toEqual({ likes: 0, comments: 0, reposts: 0, reads: 5 })
    expect(v3.retweetedStatus?.flags).toEqual({ original: true })
  })
})

function loadJson(file: string): unknown {
  return JSON.parse(readFileSync(`tests/fixtures/raw/${file}`, 'utf8'))
}

function loadFirstTweet(file: string): ITweet {
  const raw = loadJson(file) as { data: { list: unknown[] } }
  const item = raw.data.list[0]
  if (!isRawTweet(item))
    throw new Error(`${file} first item is not a raw tweet (fixture drift?)`)
  return normalizeTweet(item)
}

type RawRecord = Record<string, any>

/** 在 fixture 里递归找出第一条命中的 raw 微博（rss / statuses / data 结构各不相同）。 */
function findByPredicate(file: string, predicate: (item: RawRecord) => boolean): RawTweet {
  const out: RawTweet[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (!node || typeof node !== 'object')
      return
    const record = node as RawRecord
    if (isRawTweet(record) && predicate(record))
      out.push(record)
    for (const value of Object.values(record))
      walk(value)
  }
  walk(loadJson(file))
  if (out.length === 0)
    throw new Error(`${file} has no matching raw tweet (fixture drift?)`)
  return out[0]
}
