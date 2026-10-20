import type { VerificationType } from '~/types/domain/IUser'
import { describe, expect, it } from 'vitest'
import { normalizeTweet } from '~/models/data/Tweet'
import {
  attachMediaDownloads,
  buildTweetContext,
  collectMediaOwners,
  normalizeTweetDate,
  renderTweetContextMarkdown,
} from '~/models/view/TweetContext'

type RawTweet = Parameters<typeof normalizeTweet>[0]
type NormalizedTweet = ReturnType<typeof normalizeTweet>

const BASE_USER = {
  id: '10001',
  idstr: '10001',
  screen_name: '作者',
  avatar_hd: 'https://wx1.sinaimg.cn/avatar.jpg',
  verified: true,
  verified_type: 0,
}

/** 最小微博骨架；字段名与真实 `statuses/show` fixture 对齐。 */
function makeTweet(overrides: Record<string, unknown> = {}): NormalizedTweet {
  return normalizeTweet({
    id: '5263078581796878',
    idstr: '5263078581796878',
    mblogid: 'QqsYymYOS',
    created_at: 'Tue Oct 20 15:40:07 +0800 2026',
    text: '正文',
    text_raw: '正文',
    source: '微博网页版',
    isAd: false,
    isLongText: false,
    visible: { type: 0 },
    user: BASE_USER,
    attitudes_count: 6,
    comments_count: 5,
    reposts_count: 0,
    ...overrides,
  } as unknown as RawTweet)
}

function picInfo(id: string, width = 690, height = 900) {
  return {
    [id]: {
      pic_id: id,
      largest: {
        url: `https://wx3.sinaimg.cn/large/${id}.jpg`,
        width,
        height,
      },
    },
  }
}

describe('normalizeTweetDate', () => {
  it('parses the Weibo space-separated format into UTC ISO + local offset', () => {
    expect(normalizeTweetDate('Tue Oct 20 15:40:07 +0800 2026')).toEqual({
      publishedAt: '2026-10-20T07:40:07.000Z',
      publishedAtLocal: '2026-10-20T15:40:07+08:00',
    })
  })

  it('keeps ISO inputs and preserves the offset', () => {
    expect(normalizeTweetDate('2026-10-20T15:40:07+08:00')).toEqual({
      publishedAt: '2026-10-20T07:40:07.000Z',
      publishedAtLocal: '2026-10-20T15:40:07+08:00',
    })
  })

  it('returns the input unchanged when it cannot be parsed', () => {
    expect(normalizeTweetDate('not-a-date')).toEqual({ publishedAt: 'not-a-date' })
  })
})

describe('buildTweetContext — 原创微博', () => {
  it('projects author, text, topics and media ownership', () => {
    const id = '006g4E90ly1ii8uxuog7nj30j60p0aj3'
    const tweet = makeTweet({
      text: '#话题# 正文内容',
      text_raw: '#话题# 正文内容',
      region_name: '发布于 浙江',
      topic_struct: [{ topic_title: '话题' }],
      pic_ids: [id],
      pic_infos: picInfo(id),
    })

    const context = buildTweetContext(tweet, {
      now: Date.UTC(2026, 9, 20, 8, 0, 0),
      author: {
        id: '10001',
        name: '作者',
        verified: true,
        verifiedType: 0,
        description: '简介',
        followers: 2541697,
        following: true,
        followedBy: false,
      },
    })

    expect(context.schema).toBe('weibo.tweet-context/v1')
    expect(context.post.kind).toBe('original')
    expect(context.post.text).toBe('#话题# 正文内容')
    expect(context.post.topics).toEqual(['话题'])
    expect(context.post.location).toBe('浙江')
    expect(context.post.publishedAt).toBe('2026-10-20T07:40:07.000Z')
    expect(context.post.publishedAtLocal).toBe('2026-10-20T15:40:07+08:00')
    expect(context.post.author.followers).toBe(2541697)
    expect(context.post.author.following).toBe(true)
    expect(context.media).toHaveLength(1)
    expect(context.media[0]).toMatchObject({
      index: 1,
      type: 'pic',
      owner: { mblogId: 'QqsYymYOS', relation: 'self' },
      temporary: true,
      aspectRatio: 0.77,
    })
    expect(context.media[0]?.url).toContain('sinaimg.cn')
    expect(context.media[0]?.hints).toEqual([])
    // 媒体没有描述 → 必须显式列为未知，而不是让 AI 以为看过了
    expect(context.unknowns.join('\n')).toContain('没有画面内容描述')
  })

  it('flags image-only posts and long-image hints', () => {
    const id = 'longpic'
    const tweet = makeTweet({
      text: '',
      text_raw: '',
      pic_ids: [id],
      pic_infos: picInfo(id, 1080, 6000),
    })

    const context = buildTweetContext(tweet)

    expect(context.post.text).toBe('')
    expect(context.hints).toContain('no_text:content_is_in_media_only')
    expect(context.media[0]?.hints).toContain('tall_image:likely_long_screenshot')
  })

  it('marks ads and paid / truncated long text from raw flags', () => {
    const tweet = makeTweet({ isAd: true, isLongText: true, is_paid: true })

    const context = buildTweetContext(tweet, { raw: { isAd: true, isLongText: true, is_paid: true } })

    expect(context.post.flags).toMatchObject({ isAd: true, isPaid: true, textTruncated: true })
    expect(context.hints).toContain('advertisement')
    expect(context.unknowns.join('\n')).toContain('isLongText=true')
  })

  it('uses the fetched long text and clears the truncation flag', () => {
    const tweet = makeTweet({ isLongText: true, text: '短', text_raw: '短' })

    const context = buildTweetContext(tweet, {
      longText: '完整的长微博正文',
      longTextFetched: true,
      raw: { isLongText: true },
    })

    expect(context.post.text).toBe('完整的长微博正文')
    expect(context.post.flags.textTruncated).toBeUndefined()
    expect(context.provenance.longTextFetched).toBe(true)
  })

  it('truncates by maxChars / maxMedia and explains what was omitted', () => {
    const ids = ['p1', 'p2']
    const tweet = makeTweet({
      text: '一二三四五六七八九十',
      text_raw: '一二三四五六七八九十',
      pic_ids: ids,
      pic_infos: { ...picInfo('p1'), ...picInfo('p2') },
    })

    const context = buildTweetContext(tweet, { maxChars: 4, maxMedia: 1 })

    expect(context.post.text).toBe('一二三四…')
    expect(context.media).toHaveLength(1)
    expect(context.unknowns.join('\n')).toContain('正文超过 4 字符')
    expect(context.unknowns.join('\n')).toContain('媒体只列出了前 1 个')
  })
})

/** 一条多层转发：当前作者只写了 4 个字，媒体属于原微博。 */
function makeRepost() {
  const ids = ['q1', 'q2']
  const quoted = {
    id: '5355436531253965',
    idstr: '5355436531253965',
    mblogid: 'Rng9L5gdf',
    created_at: 'Sun Oct 18 18:23:51 +0800 2026',
    text: '进度3/3',
    text_raw: '进度3/3',
    source: 'iPhone 15 Pro Max',
    user: {
      id: '5189521189',
      idstr: '5189521189',
      screen_name: '原po',
      verified: false,
      verified_type: -1,
    },
    pic_ids: ids,
    pic_infos: { ...picInfo('q1', 2048, 2730), ...picInfo('q2', 2048, 2048) },
  }

  return makeTweet({
    text: '<a href="/n/咕咕箐箐_er">@咕咕箐箐_er</a> 的转发正文',
    text_raw: '这么好的！！//@咕咕箐箐_er:美游啊啊啊啊！',
    repost_type: 1,
    retweeted_status: quoted,
  })
}

describe('buildTweetContext — 转发与归属', () => {
  it('keeps only the current author words in post.text', () => {
    const tweet = makeRepost()
    const context = buildTweetContext(tweet)

    expect(context.post.kind).toBe('repost')
    expect(context.post.text).toBe('这么好的！！')
    expect(context.post.text).not.toContain('//@')
    // 转发链作者不是当前作者的 @ 提及
    expect(context.post.mentions).toEqual([])
    expect(context.repostChain).toHaveLength(2)
    expect(context.repostChain?.[1]).toMatchObject({
      index: 1,
      author: '咕咕箐箐_er',
      text: '美游啊啊啊啊！',
      role: 'commentary',
    })
  })

  it('puts the original media under quoted with explicit ownership', () => {
    const context = buildTweetContext(makeRepost())

    expect(context.media).toEqual([])
    expect(context.quoted?.post.author.name).toBe('原po')
    expect(context.quoted?.media).toHaveLength(2)
    expect(context.quoted?.media[0]?.owner).toEqual({ mblogId: 'Rng9L5gdf', relation: 'quoted' })
    expect(context.hints).toContain('media_from_quoted_post:not_the_poster_own_media')
    expect(context.hints).toContain('quoted_post:author_is_not_the_poster')
    expect(context.unknowns.join('\n')).toContain('有 2 个媒体')
  })

  it('keeps the current author words when chain display is disabled', () => {
    const context = buildTweetContext(makeRepost(), { includeRepostChain: false })

    expect(context.repostChain).toBeUndefined()
    expect(context.post.text).toBe('这么好的！！')
    expect(context.post.text).not.toContain('//@')
  })

  it('honours --no-quoted and records the omission', () => {
    const context = buildTweetContext(makeRepost(), { includeQuoted: false })

    expect(context.quoted).toBeUndefined()
    expect(context.unknowns).toContain('转发的原微博未展开')
    expect(context.hints).toContain('no_media_in_context:quoted_post_not_expanded')
  })

  it('collects media owners and attaches downloads to the right post', () => {
    const context = buildTweetContext(makeRepost())
    const owners = collectMediaOwners(context)
    // 当前微博本身没有配图，只有原微博有；不要为空的 self 发下载请求
    expect(owners).toEqual([{ mblogId: 'Rng9L5gdf', relation: 'quoted' }])

    attachMediaDownloads(context, 'quoted', [{
      mediaId: 'q1',
      variant: 'image',
      status: 'downloaded',
      path: 'C:/media/q1.jpg',
      bytes: 2048,
      contentType: 'image/jpeg',
    }])

    expect(context.quoted?.media[0]?.download).toEqual({
      path: 'C:/media/q1.jpg',
      status: 'downloaded',
      bytes: 2048,
      contentType: 'image/jpeg',
    })
    expect(context.media).toEqual([])
  })
})

describe('buildTweetContext — 评论与渲染', () => {
  it('renders sampled comments with an explicit sampling disclaimer', () => {
    const tweet = makeTweet()
    const context = buildTweetContext(tweet, {
      comments: [
        {
          id: 'c1',
          createdAt: 'Tue Oct 20 15:41:00 +0800 2026',
          text: '作者本人的评论',
          textHtml: '作者本人的评论',
          source: '微博网页版',
          likes: 3,
          user: { id: '10001', name: '作者', avatar: '', verified: true, verifiedType: 0 as VerificationType },
        },
        {
          id: 'c2',
          createdAt: 'Tue Oct 20 15:42:00 +0800 2026',
          text: '路人的评论',
          textHtml: '路人的评论',
          source: '微博网页版',
          likes: 1,
          user: { id: '20002', name: '路人', avatar: '', verified: false, verifiedType: -1 as VerificationType },
        },
      ],
    })

    expect(context.discussion).toHaveLength(2)
    expect(context.discussion?.[0]).toMatchObject({ author: '作者', likes: 3, isAuthor: true })
    expect(context.discussion?.[1]).toMatchObject({ author: '路人', likes: 1 })
    expect(context.discussion?.[1]?.isAuthor).toBeUndefined()
    expect(context.unknowns.join('\n')).toContain('评论只抽样了 2 条')
  })

  it('renders a deterministic card with explicit sections', () => {
    const context = buildTweetContext(makeRepost())
    const markdown = renderTweetContextMarkdown(context)

    expect(markdown).toContain('# 微博上下文：@作者')
    expect(markdown).toContain('## 谁发的')
    expect(markdown).toContain('## 说了什么')
    expect(markdown).toContain('## 转发的原微博（不是当前作者的正文）')
    expect(markdown).toContain('## 转发链（由近到远，每层都是转发者的话，不是原文）')
    expect(markdown).toContain('归属：转发的原微博')
    expect(markdown).toContain('## 抓取信息与未知项')

    // 「说了什么」章节里不能出现拍平的转发链
    const spoken = markdown.split('## 说了什么')[1]?.split('##')[0] ?? ''
    expect(spoken).toContain('这么好的！！')
    expect(spoken).not.toContain('//@')
  })
})
