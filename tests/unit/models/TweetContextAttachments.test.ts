import { describe, expect, it } from 'vitest'
import { normalizeTweet } from '~/models/data/Tweet'
import { buildTweetContext, renderTweetContextMarkdown } from '~/models/view/TweetContext'

type RawTweet = Parameters<typeof normalizeTweet>[0]
type NormalizedTweet = ReturnType<typeof normalizeTweet>

/**
 * `ITweetContext.post.attachments` 投影测试（离线）。
 *
 * 数据链路与生产一致：内联 raw → `normalizeTweet()` → `buildTweetContext()`；
 * 不发任何网络请求，也不依赖 fixture 文件。
 */

const BASE_USER = {
  id: '10001',
  idstr: '10001',
  screen_name: '作者',
  avatar_hd: 'https://wx1.sinaimg.cn/avatar.jpg',
  verified: true,
  verified_type: 0,
}

/** 最小微博骨架；字段名与真实 `statuses/show` raw 对齐。 */
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

const ARTICLE_ID = '2309404901234567890'
const ARTICLE_URL = `https://weibo.com/ttarticle/p/show?id=${ARTICLE_ID}`

/** PC `page_info.object_type: 'article'`。 */
const ARTICLE_PAGE_INFO = {
  type: 24,
  object_type: 'article',
  page_id: ARTICLE_ID,
  object_id: `1022:${ARTICLE_ID}`,
  page_title: '@ 作者 ',
  page_pic: 'https://wx1.sinaimg.cn/page_article.jpg',
  page_desc: '文章摘要',
  content1: '文章标题',
  content2: '',
  content3: '专栏作者',
  page_url: `sinaweibo://articlebrowser?object_id=1022%3A${ARTICLE_ID}&url=https%3A%2F%2Fweibo.com%2Fttarticle%2Fp%2Fshow%3Fid%3D${ARTICLE_ID}`,
}

/** m 站 `url_objects[].object.object`（付费文章）。 */
const ARTICLE_URL_OBJECT = {
  object: {
    object_type: 'article',
    object: {
      id: `1022:${ARTICLE_ID}`,
      object_type: 'article',
      display_name: '付费文章',
      article_summary: '仅试读',
      ispay: true,
      author: { id: '10002', display_name: '专栏作者' },
      url: ARTICLE_URL,
      image: { url: 'https://wx1.sinaimg.cn/article.jpg' },
    },
  },
}

describe('buildTweetContext — 文章附件', () => {
  it('projects PC page_info metadata and records the missing article body', () => {
    const context = buildTweetContext(makeTweet({ page_info: ARTICLE_PAGE_INFO }))

    expect(context.post.attachments).toHaveLength(1)
    expect(context.post.attachments[0]).toEqual({
      kind: 'article',
      title: '文章标题',
      url: ARTICLE_URL,
      summary: '文章摘要',
      author: '专栏作者',
    })
    expect(context.unknowns).toContain('文章正文未抓取（只有元数据）')
    expect(context.unknowns).not.toContain('付费文章，正文可能不完整')
    // 正文缺失是「未抓取」，不是「没有内容」：不能伪造 content 字段
    expect(context.post.attachments[0]).not.toHaveProperty('content')
  })

  it('marks paid articles from the m-site url_objects entry', () => {
    const context = buildTweetContext(makeTweet({ url_objects: [ARTICLE_URL_OBJECT] }))

    expect(context.post.attachments[0]).toMatchObject({
      kind: 'article',
      title: '付费文章',
      url: ARTICLE_URL,
      summary: '仅试读',
      author: '专栏作者',
      isPaid: true,
    })
    expect(context.unknowns).toContain('文章正文未抓取（只有元数据）')
    expect(context.unknowns).toContain('付费文章，正文可能不完整')
  })

  it('dedupes repeated unknown messages when the same kind appears twice', () => {
    // m 站同一份数据可能同时出现在 page_info 与 url_objects（不同 id 时两条都保留）
    const secondId = '2309404901234567891'
    const context = buildTweetContext(makeTweet({
      page_info: ARTICLE_PAGE_INFO,
      url_objects: [{
        object: {
          object_type: 'article',
          object: {
            id: `1022:${secondId}`,
            object_type: 'article',
            display_name: '另一篇文章',
            url: `https://weibo.com/ttarticle/p/show?id=${secondId}`,
          },
        },
      }],
    }))

    expect(context.post.attachments).toHaveLength(2)
    expect(context.unknowns.filter(item => item === '文章正文未抓取（只有元数据）')).toHaveLength(1)
  })
})

const VOTE_URL = 'https://vote.weibo.com/h5/index/index?vote_id=2026_1234567890'

describe('buildTweetContext — 投票附件', () => {
  it('projects PC card_info.vote_object options with a snapshot hint', () => {
    const context = buildTweetContext(makeTweet({
      page_info: {
        type: 23,
        object_type: 'hudongvote',
        page_id: '2317162026_1234567890',
        page_url: VOTE_URL,
        page_pic: 'https://wx1.sinaimg.cn/vote.jpg',
        card_info: {
          card_type: 122,
          vote_object: {
            id: '2026_1234567890',
            object_id: '1022:2317162026_1234567890',
            content: '你更喜欢哪一个？',
            is_multi_select: 0,
            minimum: 1,
            maximum: 1,
            expire_date: 1794724203,
            part_info: 313,
            state: 1,
            target_url: VOTE_URL,
            vote_list: [
              { id: '26253083', content: '选项A', part_num: '34', part_ratio: '0.11', selected: 0 },
              { id: '26253084', content: '选项B', part_num: 279, part_ratio: 0.89, selected: 1 },
            ],
          },
        },
      },
    }))

    expect(context.post.attachments).toHaveLength(1)
    expect(context.post.attachments[0]).toEqual({
      kind: 'vote',
      title: '你更喜欢哪一个？',
      url: VOTE_URL,
      multiSelect: false,
      totalVotes: 313,
      expiresAt: 1794724203,
      options: [
        { text: '选项A', votes: 34, ratio: 0.11, selected: false },
        { text: '选项B', votes: 279, ratio: 0.89, selected: true },
      ],
    })
    expect(context.hints).toContain('投票票数是抓取时快照，不代表实时')
    // 选项已完整，不为投票写 unknowns
    expect(context.unknowns.join('\n')).not.toContain('投票')
  })

  it('uses m-site vote_dynamic numbers instead of the stale zeros', () => {
    const context = buildTweetContext(makeTweet({
      url_objects: [{
        object: {
          object_type: 'hudongvote',
          object: {
            object_type: 'hudongvote',
            vote_object: {
              object_id: '1022:2317162026_1234567890',
              content: '多选：哪几个？',
              expire_date: 1794724203,
              is_multi_select: 1,
              minimum: 1,
              maximum: 2,
              state: 1,
              part_info: 0,
              vote_list: [{ id: 'o1', content: '选项A', part_num: 0, part_ratio: 0 }],
            },
          },
        },
        vote_dynamic: JSON.stringify({
          object_id: '1022:2317162026_1234567890',
          part_info: 42,
          vote_list: [{ id: 'o1', part_num: 42, part_ratio: '1', selected: 1 }],
        }),
      }],
    }))

    expect(context.post.attachments[0]).toMatchObject({
      kind: 'vote',
      title: '多选：哪几个？',
      multiSelect: true,
      totalVotes: 42,
      options: [{ text: '选项A', votes: 42, ratio: 1, selected: true }],
    })
  })
})

describe('buildTweetContext — 直播附件', () => {
  it('projects live status / times / temporary stream urls with explicit caveats', () => {
    const context = buildTweetContext(makeTweet({
      page_info: {
        type: 26,
        object_type: 'live',
        page_id: '2321324901234567890',
        page_title: '作者的微博直播',
        page_pic: 'https://wx1.sinaimg.cn/live.jpg',
        status: '3',
        watch_limit: 0,
        media_info: {
          live_id: '1022:2321324901234567890',
          real_status: 3,
          live_start_time: 1792634590,
          real_chatroom_users: 29733,
          live_replay_counts: 29733,
          live_ld: 'https://live.example.com/ld.m3u8',
          replay_ld: 'https://live.example.com/replay_ld.m3u8',
          replay_hd: 'https://live.example.com/replay_hd.m3u8',
        },
      },
    }))

    expect(context.post.attachments).toHaveLength(1)
    expect(context.post.attachments[0]).toEqual({
      kind: 'live',
      title: '作者的微博直播',
      url: 'https://weibo.com/l/wblive/p/show/1022:2321324901234567890',
      liveStatus: 3,
      startedAt: 1792634590,
      viewerCount: 29733,
      streamUrl: 'https://live.example.com/ld.m3u8',
      replayUrl: 'https://live.example.com/replay_ld.m3u8',
    })
    expect(context.hints).toContain('直播流/回放地址是临时地址，需要及时处理')
    expect(context.unknowns).toContain('直播状态码语义未确认')
  })

  it('omits liveStatus when upstream does not send one', () => {
    const context = buildTweetContext(makeTweet({
      url_objects: [{
        object: {
          object_type: 'live',
          object: {
            id: '1022:2321324901234567890',
            object_type: 'live',
            display_name: '作者的微博直播',
            stime: '2026-10-22 10:03:10',
            urls: { live_ld: 'https://live.example.com/ld.m3u8' },
          },
        },
      }],
    }))

    expect(context.post.attachments[0]).toMatchObject({
      kind: 'live',
      startedAt: Math.floor(Date.parse('2026-10-22T10:03:10+08:00') / 1000),
      streamUrl: 'https://live.example.com/ld.m3u8',
    })
    expect(context.post.attachments[0]).not.toHaveProperty('liveStatus')
    expect(context.unknowns).not.toContain('直播状态码语义未确认')
    expect(context.hints).toContain('直播流/回放地址是临时地址，需要及时处理')
  })
})

describe('buildTweetContext — 抽奖附件', () => {
  it('projects the lottery link card and records that details are not fetched', () => {
    const url = 'https://lottery.media.weibo.com/lottery/h5/history/list?mid=5263078581796878&from=feed'
    const context = buildTweetContext(makeTweet({
      url_struct: [{
        url_title: '抽奖详情',
        url_type: 39,
        h5_target_url: url,
        long_url: `${url}&mark_id=abc`,
        page_id: '2304234901234567890',
      }],
    }))

    expect(context.post.attachments).toEqual([{
      kind: 'lottery',
      title: '抽奖详情',
      url,
    }])
    expect(context.unknowns).toContain('抽奖详情未抓取（只有链接）')
  })
})

describe('buildTweetContext — 原微博附件与空数组', () => {
  it('returns an empty attachments array when the tweet has none', () => {
    const context = buildTweetContext(makeTweet())

    expect(context.post.attachments).toEqual([])
    expect(context.unknowns.join('\n')).not.toContain('文章正文未抓取')
  })

  it('projects the quoted post attachments under quoted, not under the poster', () => {
    const quoted = {
      id: '5355436531253965',
      idstr: '5355436531253965',
      mblogid: 'Rng9L5gdf',
      created_at: 'Sun Oct 18 18:23:51 +0800 2026',
      text: '投票：你更喜欢哪一个？',
      text_raw: '投票：你更喜欢哪一个？',
      source: '微博网页版',
      user: {
        id: '5189521189',
        idstr: '5189521189',
        screen_name: '原po',
        verified: false,
        verified_type: -1,
      },
      page_info: {
        type: 23,
        object_type: 'hudongvote',
        page_id: '2317162026_1234567890',
        page_url: VOTE_URL,
        card_info: {
          card_type: 122,
          vote_object: {
            id: '2026_1234567890',
            object_id: '1022:2317162026_1234567890',
            content: '你更喜欢哪一个？',
            is_multi_select: 0,
            part_info: 313,
            state: 1,
            target_url: VOTE_URL,
            vote_list: [{ id: '26253083', content: '选项A', part_num: '34', part_ratio: '0.11' }],
          },
        },
      },
    }

    const context = buildTweetContext(makeTweet({
      text: '这个投票有意思 //@原po:投票：你更喜欢哪一个？',
      text_raw: '这个投票有意思 //@原po:投票：你更喜欢哪一个？',
      repost_type: 1,
      retweeted_status: quoted,
    }))

    // 当前作者没有附件；附件属于转发的原微博
    expect(context.post.attachments).toEqual([])
    expect(context.quoted?.post.attachments).toHaveLength(1)
    expect(context.quoted?.post.attachments[0]).toMatchObject({
      kind: 'vote',
      title: '你更喜欢哪一个？',
      url: VOTE_URL,
      multiSelect: false,
      totalVotes: 313,
    })
    expect(context.hints).not.toContain('投票票数是抓取时快照，不代表实时')
    // hints 属于各自的 context：原微博的投票快照提示在 quoted 上
    expect(context.quoted?.hints).toContain('投票票数是抓取时快照，不代表实时')
    // 两个上下文各自记录自己的 unknowns / hints，不串味
    expect(context.unknowns.join('\n')).not.toContain('文章正文未抓取')
    expect(context.quoted?.unknowns.join('\n')).not.toContain('转发的原微博未展开')
  })

  it('keeps the markdown card free of attachment fabrication', () => {
    const context = buildTweetContext(makeTweet({ page_info: ARTICLE_PAGE_INFO }))
    const markdown = renderTweetContextMarkdown(context)

    // 投影只是数据层变化：文章正文不能被渲染成「读过」的正文
    expect(markdown).toContain('## 说了什么')
    expect(markdown).toContain('未知：文章正文未抓取（只有元数据）')
  })
})
