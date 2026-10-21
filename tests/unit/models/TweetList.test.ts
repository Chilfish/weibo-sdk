import type { ITweet } from '~/types/domain/ITweet'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  normalizeComment,
  normalizeCommentNotification,
  normalizeLikeNotification,
  normalizeLiker,
} from '~/models/data'
import { paginationNotes } from '~/models/view/format'
import {
  renderCommentListMarkdown,
  renderCommentNotificationListMarkdown,
  renderLikeNotificationListMarkdown,
  renderLikerListMarkdown,
  renderTweetListMarkdown,
} from '~/models/view/TweetList'
import { TweetVisible } from '~/types/domain/ITweet'
import { VerificationType } from '~/types/domain/IUser'

function loadFixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(join('tests/fixtures/raw', name), 'utf8'))
}

/** 最小微博骨架；字段名与真实 `statuses/show` 响应一致。 */
function makeTweet(overrides: Partial<ITweet> = {}): ITweet {
  return {
    id: '10001',
    mblogId: 'Abc123',
    createdAt: 'Tue Oct 20 15:40:07 +0800 2026',
    text: '正文',
    source: '微博网页版',
    user: {
      id: '10001',
      name: '作者',
      avatar: '',
      verified: false,
      verifiedType: VerificationType.Unverified,
    },
    stats: { likes: 6, comments: 5, reposts: 0 },
    visible: TweetVisible.PUBLIC,
    media: [],
    ...overrides,
  }
}

describe('renderTweetListMarkdown', () => {
  it('renders title, paging notes, counters and permalink', () => {
    const markdown = renderTweetListMarkdown([makeTweet()], {
      title: '用户时间线',
      notes: paginationNotes({ page: 2, hasMore: true, total: 1234 }),
    })

    expect(markdown).toContain('# 用户时间线')
    expect(markdown).toContain('- 下一页页码：2')
    expect(markdown).toContain('- 还有更多：是')
    expect(markdown).toContain('- 总数：1,234')
    expect(markdown).toContain('1. **@作者** · 2026-10-20T15:40:07+08:00')
    expect(markdown).toContain('   正文')
    expect(markdown).toContain('   赞 6 · 评论 5 · 转发 0')
    expect(markdown).toContain('   https://weibo.com/10001/Abc123')
  })

  it('uses the repost chain text instead of the flattened //@ text', () => {
    const tweet = makeTweet({
      text: '转发微博//@某人:原话',
      retweetedStatus: makeTweet({ mblogId: 'Orig456' }),
      repostChain: [{ index: 0, authorName: '作者', text: '自己说的话', media: [] }],
    })

    const markdown = renderTweetListMarkdown([tweet], { title: '时间线' })

    expect(markdown).toContain('自己说的话')
    expect(markdown).not.toContain('//@')
    expect(markdown).toContain('· 转发')
  })

  it('falls back to the quoted post when a repost has no own words', () => {
    const tweet = makeTweet({
      text: '转发微博',
      retweetedStatus: makeTweet({
        text: '原微博正文',
        user: {
          id: '20002',
          name: '原po',
          avatar: '',
          verified: false,
          verifiedType: VerificationType.Unverified,
        },
      }),
      repostChain: [{ index: 0, authorName: '作者', text: '', media: [] }],
    })

    const markdown = renderTweetListMarkdown([tweet], { title: '时间线' })

    expect(markdown).toContain('转发 @原po：原微博正文')
  })

  it('truncates long text and marks the omission', () => {
    const markdown = renderTweetListMarkdown([
      makeTweet({ text: '一二三四五六七八九十' }),
    ], { title: '时间线', maxChars: 4 })

    expect(markdown).toContain('一二三四…')
    expect(markdown).not.toContain('五六七八九十')
  })

  it('renders explicit placeholders for empty text and empty pages', () => {
    const emptyTweet = renderTweetListMarkdown([makeTweet({ text: '' })], { title: '时间线' })
    const emptyPage = renderTweetListMarkdown([], { title: '时间线' })

    expect(emptyTweet).toContain('（无正文）')
    expect(emptyPage).toContain('（本页没有微博）')
  })

  it('keeps partial sampling visible', () => {
    const markdown = renderTweetListMarkdown([], {
      title: '用户时间线',
      notes: paginationNotes({ partial: true }),
    })

    expect(markdown).toContain('访客模式只取到首屏')
  })
})

describe('renderCommentListMarkdown', () => {
  it('renders normalized comments from a real fixture', () => {
    const raw = loadFixture('comments.json')
    const comments = raw.data.slice(0, 2).map(normalizeComment)

    const markdown = renderCommentListMarkdown(comments, {
      title: '微博评论',
      notes: [`总数（含楼中楼）：${raw.total_number}`],
    })

    expect(markdown).toContain('# 微博评论')
    expect(markdown).toContain(`总数（含楼中楼）：${raw.total_number}`)
    expect(markdown).toContain('1. **@')
    expect(markdown).toContain('赞 ')
  })

  it('shows the picture count for image comments', () => {
    const comments = loadFixture('comments_pic_multi.json').data.map(normalizeComment)

    expect(renderCommentListMarkdown(comments, { title: '评论' })).toContain('图片 2')
  })
})

describe('renderLikerListMarkdown', () => {
  it('renders likers from a real fixture', () => {
    const likers = loadFixture('likers_p1.json').data.data.slice(0, 2).map(normalizeLiker)

    const markdown = renderLikerListMarkdown(likers, { title: '点赞者' })

    expect(markdown).toContain('# 点赞者')
    expect(markdown).toContain('1. **@')
    expect(markdown).toContain('iPad客户端')
  })
})

describe('notification renderers', () => {
  it('renders comment notifications together with the original tweet', () => {
    const comments = loadFixture<{ data: { comments: unknown[] } }>('message_cmt_p1.json').data.comments
    const items = comments.map(normalizeCommentNotification).filter(item => item !== undefined).slice(0, 2)

    const markdown = renderCommentNotificationListMarkdown(items, { title: '评论通知' })

    expect(markdown).toContain('# 评论通知')
    expect(markdown).toContain('评论了你的微博')
    expect(markdown).toContain('原微博：')
  })

  it('renders like notifications together with the original tweet', () => {
    const attitudes = loadFixture<{ data: { attitudes: unknown[] } }>('message_attitudes_p1.json').data.attitudes
    const items = attitudes.map(normalizeLikeNotification).filter(item => item !== undefined).slice(0, 2)

    const markdown = renderLikeNotificationListMarkdown(items, { title: '点赞通知' })

    expect(markdown).toContain('# 点赞通知')
    expect(markdown).toContain('赞了你的微博')
    expect(markdown).toContain('原微博：')
  })
})
