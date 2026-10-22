import type { TweetAttachment } from '~/types/domain/ITweet'
import { describe, expect, it } from 'vitest'
import { normalizeTweet } from '~/models/data/Tweet'
import { extractAttachments } from '~/models/data/TweetAttachments'
import { MediaType } from '~/types/domain/ITweet'

/**
 * 附件归一化的离线单测（2026-10-22 特殊格式适配）。
 *
 * 全部 raw 都是内联对象，取自 `docs/planning/research-tweet-special-formats-2026-10-22.md`
 * 第 2-4 节记录的 PC / m 站真实字段布局（值已替换）；不发任何网络请求。
 */

type RawTweet = Parameters<typeof normalizeTweet>[0]
type AttachmentOf<K extends TweetAttachment['kind']> = Extract<TweetAttachment, { kind: K }>

/** 断言「恰好一个指定 kind 的附件」并返回强类型视图（同时证明其它条目被忽略）。 */
function onlyAttachment<K extends TweetAttachment['kind']>(raw: unknown, kind: K): AttachmentOf<K> {
  const list = extractAttachments(raw)
  expect(list).toHaveLength(1)
  const item = list[0] as TweetAttachment
  expect(item.kind).toBe(kind)
  return item as AttachmentOf<K>
}

/** 单条微博的最小骨架（字段名 / 取值风格取自真实抓包）；供 `normalizeTweet` 回归用例。 */
function makeRawTweet(overrides: Record<string, unknown>): RawTweet {
  return {
    ok: 1,
    id: '5263078581796878',
    idstr: '5263078581796878',
    mid: '5263078581796878',
    mblogid: 'QqsYymYOS',
    created_at: 'Mon Oct 20 10:00:00 +0800 2025',
    text: '分享一个视频',
    text_raw: '分享一个视频',
    region_name: '发布于 广东',
    source: '微博视频',
    isLongText: false,
    visible: { type: 0, list_id: 0 },
    user: {
      id: '1740358225',
      idstr: '1740358225',
      screen_name: '测试用户',
      avatar_hd: 'https://wx1.sinaimg.cn/orj960/avatar.jpg',
      verified: false,
      verified_type: -1,
    },
    attitudes_count: 0,
    comments_count: 0,
    reposts_count: 0,
    ...overrides,
  } as unknown as RawTweet
}

describe('extractAttachments – PC page_info', () => {
  it('normalizes a PC article card (content1 title / content3 author / page_url url= scheme)', () => {
    const article = onlyAttachment({
      idstr: '5263078581796879',
      page_info: {
        type: 24,
        object_type: 'article',
        page_id: '2309404901234567890123',
        object_id: '1022:2309404901234567890123',
        page_title: '@ 测试作者 ',
        page_pic: 'http://wx1.sinaimg.cn/large/article_cover.jpg',
        page_desc: '文章摘要',
        content1: '文章标题',
        content2: '',
        content3: '测试作者',
        content4: '',
        source_type: 'article',
        page_url: 'sinaweibo://articlebrowser?object_id=1022%3A2309404901234567890123&url=https%3A%2F%2Fweibo.com%2Fttarticle%2Fp%2Fshow%3Fid%3D2309404901234567890123',
        user: { id: '1740358225', screen_name: '测试作者' },
        transition_pics: [{ pic_big: { url: 'http://wx1.sinaimg.cn/large/transition.jpg' } }],
      },
    }, 'article')

    expect(article.id).toBe('2309404901234567890123')
    expect(article.objectType).toBe('article')
    expect(article.source).toBe('page_info')
    expect(article.title).toBe('文章标题')
    expect(article.summary).toBe('文章摘要')
    expect(article.author).toBe('测试作者')
    // page_pic 的 http 统一升级为 https
    expect(article.coverUrl).toBe('https://wx1.sinaimg.cn/large/article_cover.jpg')
    // page_url scheme 里的 url= 参数（URLSearchParams 已解码）优先于兜底拼接
    expect(article.url).toBe('https://weibo.com/ttarticle/p/show?id=2309404901234567890123')
    expect(article.isPaid).toBeUndefined()
  })

  it('normalizes a PC vote card (card_info.vote_object, numbers delivered as strings)', () => {
    const vote = onlyAttachment({
      page_info: {
        type: 23,
        object_type: 'hudongvote',
        page_id: '2317162026_4890123456',
        page_pic: 'http://wx2.sinaimg.cn/large/vote_cover.jpg',
        page_url: 'https://vote.weibo.com/h5/index/index?vote_id=2026_4890123456',
        card_info: {
          card_type: 122,
          page_id: '2317162026_4890123456',
          vote_object: {
            id: '2026_4890123456',
            object_id: '1022:2317162026_4890123456',
            content: '你更喜欢哪一个？',
            choice_count: 2,
            is_multi_select: 1,
            minimum: 1,
            maximum: 2,
            expire_date: 1794724203,
            part_info: 313,
            part_num_unitname: '票',
            parted: 0,
            state: 1,
            vote_type: 1,
            target_url: 'https://vote.weibo.com/h5/index/index?vote_id=2026_4890123456',
            vote_list: [
              {
                id: '26253083',
                content: '选项 A',
                part_num: '34',
                part_ratio: '0.11',
                selected: 1,
                is_answer: 0,
                pic: 'http://wx3.sinaimg.cn/large/option_a.jpg',
                pid: 'option_a',
              },
              {
                id: '26253084',
                content: '选项 B',
                part_num: '279',
                part_ratio: '0.89',
                selected: 0,
              },
            ],
          },
        },
      },
    }, 'vote')

    expect(vote.id).toBe('2317162026_4890123456')
    expect(vote.objectType).toBe('hudongvote')
    expect(vote.source).toBe('page_info')
    expect(vote.title).toBe('你更喜欢哪一个？')
    expect(vote.url).toBe('https://vote.weibo.com/h5/index/index?vote_id=2026_4890123456')
    expect(vote.coverUrl).toBe('https://wx2.sinaimg.cn/large/vote_cover.jpg')
    expect(vote.multiSelect).toBe(true)
    expect(vote.minChoices).toBe(1)
    expect(vote.maxChoices).toBe(2)
    expect(vote.expiresAt).toBe(1794724203)
    expect(vote.totalVotes).toBe(313)
    expect(vote.state).toBe(1)
    expect(vote.options).toHaveLength(2)
    // 票数 / 占比是字符串，统一转 number；selected 0/1 → boolean；配图不并入 media[]
    expect(vote.options[0]).toEqual({
      id: '26253083',
      text: '选项 A',
      votes: 34,
      ratio: 0.11,
      selected: true,
      imageUrl: 'https://wx3.sinaimg.cn/large/option_a.jpg',
    })
    expect(vote.options[1]).toMatchObject({
      id: '26253084',
      text: '选项 B',
      votes: 279,
      ratio: 0.89,
      selected: false,
    })
    expect(vote.options[1]?.imageUrl).toBeUndefined()
  })

  it('normalizes a PC live card (media_info live_id / real_status / counts / stream urls)', () => {
    const live = onlyAttachment({
      page_info: {
        type: 26,
        object_type: 'live',
        page_id: '2321325111223344',
        page_title: '测试作者的微博直播',
        page_pic: 'http://wx1.sinaimg.cn/large/live_cover.jpg',
        page_url: 'sinaweibo://chatroom?container_id=2321325111223344&live_id=1022:2321325111223344',
        status: '3',
        watch_limit: 0,
        live: { width: '720', height: '1280', bitrate: '' },
        author: { screen_name: '测试作者', vip: '' },
        media_info: {
          live_id: '1022:2321325111223344',
          live_status: 3,
          real_status: 3,
          live_start_time: 1792634590,
          real_chatroom_users: 29733,
          live_replay_counts: 29000,
          stream_url: 'https://wblive-out.api.weibo.com/2/wblive/room/play?id=1022:2321325111223344',
          live_ld: 'https://live.example.com/live_ld.m3u8',
          replay_ld: 'https://live.example.com/replay_ld.m3u8',
          replay_hd: 'https://live.example.com/replay_hd.m3u8',
          watch_limit: 0,
          subscribe: { cover: 'http://wx1.sinaimg.cn/large/live_sub_cover.jpg', is_expired: true },
        },
      },
    }, 'live')

    expect(live.id).toBe('2321325111223344')
    // liveId 保留上游 `1022:` 前缀，id 去掉
    expect(live.liveId).toBe('1022:2321325111223344')
    expect(live.objectType).toBe('live')
    expect(live.source).toBe('page_info')
    expect(live.title).toBe('测试作者的微博直播')
    expect(live.url).toBe('https://weibo.com/l/wblive/p/show/1022:2321325111223344')
    expect(live.coverUrl).toBe('https://wx1.sinaimg.cn/large/live_cover.jpg')
    expect(live.status).toBe(3)
    expect(live.startedAt).toBe(1792634590)
    expect(live.viewerCount).toBe(29733)
    expect(live.replayCount).toBe(29000)
    expect(live.streamUrl).toBe('https://live.example.com/live_ld.m3u8')
    expect(live.replayUrl).toBe('https://live.example.com/replay_ld.m3u8')
    expect(live.watchLimit).toBe(0)
  })
})

describe('extractAttachments – m-site url_objects', () => {
  it('normalizes an m-site article object (display_name / summary / author / ispay / url)', () => {
    const article = onlyAttachment({
      url_objects: [{
        info: { type: 39, url_long: 'https://weibo.com/ttarticle/p/show?id=2309404901234567890124' },
        object: {
          object_type: 'article',
          object: {
            id: '1022:2309404901234567890124',
            object_type: 'article',
            display_name: 'm 站文章标题',
            article_summary: 'm 站文章摘要',
            summary: '',
            ispay: true,
            is_article_free: false,
            author: { id: '1740358225', display_name: '测试作者' },
            url: 'https://weibo.com/ttarticle/p/show?id=2309404901234567890124',
            target_url: 'https://media.weibo.cn/article?id=2309404901234567890124',
            image: { url: 'http://wx1.sinaimg.cn/large/m_article.jpg', width: 120, height: 120 },
          },
        },
      }],
    }, 'article')

    expect(article.id).toBe('2309404901234567890124')
    expect(article.objectType).toBe('article')
    expect(article.source).toBe('url_objects')
    expect(article.title).toBe('m 站文章标题')
    expect(article.summary).toBe('m 站文章摘要')
    expect(article.author).toBe('测试作者')
    expect(article.coverUrl).toBe('https://wx1.sinaimg.cn/large/m_article.jpg')
    expect(article.url).toBe('https://weibo.com/ttarticle/p/show?id=2309404901234567890124')
    expect(article.isPaid).toBe(true)
  })

  it('prefers vote_dynamic over stale vote_object counters on m-site votes', () => {
    const vote = onlyAttachment({
      url_objects: [{
        isActionType: true,
        object: {
          object_type: 'hudongvote',
          object: {
            object_type: 'hudongvote',
            vote_object: {
              // 真实 m 站载荷带 id / object_id（fixtures/raw/mobile_status_vote.json 同形）
              id: '2026_5120123456',
              object_id: '1022:2317162026_5120123456',
              content: 'm 站投票问题',
              expire_date: 1794724203,
              is_multi_select: 0,
              minimum: 1,
              maximum: 1,
              state: 1,
              // 上游 stale 快照：总票数与每个选项都是 0
              part_info: 0,
              target_url: 'https://vote.weibo.com/h5/index/index?vote_id=2026_5120123456',
              vote_list: [
                { id: '26253083', content: '选项 A', part_num: 0, part_ratio: 0 },
                { id: '26253084', content: '选项 B', part_num: 0, part_ratio: 0 },
              ],
            },
          },
        },
        // JSON 字符串：当前票数都在这里
        vote_dynamic: JSON.stringify({
          object_id: '1022:2317162026_5120123456',
          part_info: 313,
          vote_list: [
            { id: '26253083', part_num: 34, part_ratio: '0.11', selected: 1 },
            { id: '26253084', part_num: 279, part_ratio: '0.89', selected: 0 },
          ],
        }),
      }],
    }, 'vote')

    // id 取 vote.object_id 去掉 `1022:` 前缀（与真实 m 站载荷一致）
    expect(vote.id).toBe('2317162026_5120123456')
    expect(vote.source).toBe('url_objects')
    expect(vote.title).toBe('m 站投票问题')
    expect(vote.url).toBe('https://vote.weibo.com/h5/index/index?vote_id=2026_5120123456')
    expect(vote.multiSelect).toBe(false)
    expect(vote.minChoices).toBe(1)
    expect(vote.maxChoices).toBe(1)
    expect(vote.expiresAt).toBe(1794724203)
    // 动态值覆盖 vote_object 的 0
    expect(vote.totalVotes).toBe(313)
    expect(vote.options).toHaveLength(2)
    expect(vote.options[0]).toMatchObject({ id: '26253083', text: '选项 A', votes: 34, ratio: 0.11, selected: true })
    expect(vote.options[1]).toMatchObject({ id: '26253084', text: '选项 B', votes: 279, ratio: 0.89, selected: false })
  })

  it('normalizes an m-site live object (stime parsed as +0800 unix seconds)', () => {
    const live = onlyAttachment({
      url_objects: [{
        object: {
          object_type: 'live',
          object: {
            object_type: 'live',
            id: '1022:2321325211334455',
            display_name: '测试作者的微博直播',
            status: 3,
            real_status: 3,
            stime: '2026-10-22 10:03:10',
            etime: '2026-10-22 11:21:24',
            duration: 4543,
            watch_limit: 0,
            author: { id: '1740358225', display_name: '测试作者', avatar: 'http://wx1.sinaimg.cn/large/avatar.jpg' },
            image: { url: 'http://wx1.sinaimg.cn/large/m_live.jpg', width: 996, height: 996 },
            stream: { format: 'm3u8', url: 'https://live.example.com/stream.flv', hd_url: 'https://live.example.com/stream_hd.flv' },
            urls: {
              live_hd: 'https://live.example.com/live_hd.m3u8',
              live_ld: 'https://live.example.com/live_ld.m3u8',
              replay_hd: 'https://live.example.com/replay_hd.m3u8',
              replay_ld: 'https://live.example.com/replay_ld.m3u8',
            },
            url: 'https://weibo.com/l/wblive/p/show/1022:2321325211334455',
          },
        },
      }],
    }, 'live')

    expect(live.id).toBe('2321325211334455')
    expect(live.liveId).toBe('1022:2321325211334455')
    expect(live.source).toBe('url_objects')
    expect(live.title).toBe('测试作者的微博直播')
    expect(live.url).toBe('https://weibo.com/l/wblive/p/show/1022:2321325211334455')
    expect(live.coverUrl).toBe('https://wx1.sinaimg.cn/large/m_live.jpg')
    expect(live.status).toBe(3)
    // `2026-10-22 10:03:10` 是 +0800，即 2026-10-22T02:03:10Z
    expect(live.startedAt).toBe(Date.UTC(2026, 9, 22, 2, 3, 10) / 1000)
    expect(live.durationSeconds).toBe(4543)
    expect(live.streamUrl).toBe('https://live.example.com/live_ld.m3u8')
    expect(live.replayUrl).toBe('https://live.example.com/replay_ld.m3u8')
    expect(live.watchLimit).toBe(0)
    expect(live.authorName).toBe('测试作者')
  })
})

describe('extractAttachments – lottery url_struct', () => {
  it('detects a lottery link card and ignores non-lottery cards', () => {
    const lottery = onlyAttachment({
      url_struct: [
        {
          url_title: '抽奖详情',
          url_type: 39,
          url_type_pic: 'https://h5.sinaimg.cn/upload/2015/09/25/3/icon_lottery.png',
          h5_target_url: 'https://lottery.media.weibo.com/lottery/h5/history/list?mid=123',
          long_url: 'https://lottery.media.weibo.com/lottery/h5/history/list?mid=123&mark_id=abc',
          short_url: 'http://t.cn/A6xyz123',
          page_id: '2304230001234567890',
        },
        {
          url_title: '普通网页',
          url_type: 39,
          h5_target_url: 'https://weibo.com/ttarticle/p/show?id=2309404901234567890123',
          short_url: 'http://t.cn/A6xyz456',
          page_id: '2304230001234567891',
        },
      ],
    }, 'lottery')

    expect(lottery.id).toBe('2304230001234567890')
    expect(lottery.objectType).toBe('lottery')
    expect(lottery.source).toBe('url_struct')
    expect(lottery.mid).toBe('123')
    expect(lottery.title).toBe('抽奖详情')
    expect(lottery.url).toBe('https://lottery.media.weibo.com/lottery/h5/history/list?mid=123')
    expect(lottery.detailUrl).toBe(lottery.url)
  })

  it('falls back to the URL mid (and default title) when the card has no page_id', () => {
    const lottery = onlyAttachment({
      url_struct: [{ h5_target_url: 'https://lottery.media.weibo.com/lottery/h5/history/list?mid=456' }],
    }, 'lottery')

    expect(lottery.id).toBe('456')
    expect(lottery.mid).toBe('456')
    expect(lottery.title).toBe('抽奖详情')
  })
})

describe('extractAttachments – unknown formats, dedupe, robustness', () => {
  it('ignores unknown page_info / url_objects object types', () => {
    expect(extractAttachments({
      page_info: { object_type: 'cardlist', page_id: '2317162026_1', page_title: '活动日历' },
      url_objects: [{
        object: { object_type: 'webpage', object: { object_type: 'webpage', display_name: '活动页' } },
      }],
    })).toEqual([])
  })

  it('does not emit an attachment for video page_info', () => {
    expect(extractAttachments({
      page_info: { object_type: 11, type: 'video', page_id: '5123456789012345' },
    })).toEqual([])
  })

  it('returns an empty array for non-object raws and vote cards without vote_object', () => {
    expect(extractAttachments(undefined)).toEqual([])
    expect(extractAttachments(null)).toEqual([])
    expect(extractAttachments([])).toEqual([])
    expect(extractAttachments({ page_info: { object_type: 'hudongvote', page_id: '2317162026_1' } })).toEqual([])
  })

  it('dedupes the same article delivered on page_info and url_objects (kind:id)', () => {
    const list = extractAttachments({
      page_info: {
        type: 24,
        object_type: 'article',
        page_id: '2309404901234567890123',
        object_id: '1022:2309404901234567890123',
        content1: 'PC 标题',
        content3: '测试作者',
      },
      url_objects: [{
        object: {
          object_type: 'article',
          object: {
            id: '1022:2309404901234567890123',
            object_type: 'article',
            display_name: 'm 标题',
          },
        },
      }],
    })

    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      kind: 'article',
      id: '2309404901234567890123',
      title: 'PC 标题',
      source: 'page_info',
    })
  })

  it('dedupes a repeated lottery card', () => {
    const list = extractAttachments({
      url_struct: [
        {
          url_title: '抽奖详情',
          h5_target_url: 'https://lottery.media.weibo.com/lottery/h5/history/list?mid=789',
          page_id: '2304230001234567892',
        },
        {
          url_title: '抽奖详情',
          h5_target_url: 'https://lottery.media.weibo.com/lottery/h5/history/list?mid=789',
          page_id: '2304230001234567892',
        },
      ],
    })

    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ kind: 'lottery', mid: '789' })
  })
})

describe('normalizeTweet – video page_info regression (B1 / B2)', () => {
  it('extracts an m-site video (object_type 11 + type "video", page_pic object, string width/height)', () => {
    const tweet = normalizeTweet(makeRawTweet({
      page_info: {
        object_type: 11,
        type: 'video',
        object_id: '1034:5123456789012345',
        page_id: '5123456789012345',
        page_title: '测试用户的微博视频',
        page_pic: { url: 'http://wx1.sinaimg.cn/large/mobile_video.jpg', width: '480', height: '893' },
        page_url: 'https://video.weibo.com/show?fid=1034%3A5123456789012345',
        play_count: '34万次播放',
        media_info: { duration: 303.113, stream_url: 'https://f.video.weibocdn.com/mobile_stream.mp4' },
        urls: {
          mp4_720p_mp4: 'https://f.video.weibocdn.com/mobile_720p.mp4',
          mp4_hd_mp4: 'https://f.video.weibocdn.com/mobile_hd.mp4',
        },
      },
    }))

    expect(tweet.media).toHaveLength(1)
    const video = tweet.media[0]
    expect(video.type).toBe(MediaType.VIDEO)
    expect(video.id).toBe('5123456789012345')
    // stream_url 优先于 page_info.urls.mp4_*
    expect(video.videoUrl).toBe('https://f.video.weibocdn.com/mobile_stream.mp4')
    expect(video.imageUrl).toBe('https://wx1.sinaimg.cn/large/mobile_video.jpg')
    expect(video.width).toBe(480)
    expect(video.height).toBe(893)
    expect(video.duration).toBeCloseTo(303.113)
  })

  it('falls back to page_info.urls.mp4_* when media_info has no stream url', () => {
    const tweet = normalizeTweet(makeRawTweet({
      page_info: {
        object_type: 11,
        type: 'video',
        object_id: '1034:5123456789012346',
        page_title: '测试用户的微博视频',
        page_pic: { url: 'http://wx1.sinaimg.cn/large/mobile_video2.jpg', width: '720', height: '1280' },
        media_info: { duration: '125' },
        urls: { mp4_hd_mp4: 'https://f.video.weibocdn.com/mobile_hd.mp4' },
      },
    }))

    expect(tweet.media).toHaveLength(1)
    const video = tweet.media[0]
    expect(video.type).toBe(MediaType.VIDEO)
    expect(video.videoUrl).toBe('https://f.video.weibocdn.com/mobile_hd.mp4')
    expect(video.id).toBe('1034:5123456789012346')
    expect(video.imageUrl).toBe('https://wx1.sinaimg.cn/large/mobile_video2.jpg')
    expect(video.width).toBe(720)
    expect(video.height).toBe(1280)
  })

  it('still extracts a PC video (object_type "video" + media_info.media_type)', () => {
    const tweet = normalizeTweet(makeRawTweet({
      page_info: {
        type: 5,
        object_type: 'video',
        page_id: '5123456789012347',
        page_title: '测试用户的微博视频',
        page_pic: 'http://wx1.sinaimg.cn/large/pc_video.jpg',
        page_url: 'sinaweibo://infopage?containerid=1034%3A5123456789012347',
        play_count: '34万次播放',
        media_info: {
          media_type: 'video',
          duration: 125.5,
          mp4_hd_url: 'https://f.video.weibocdn.com/pc_hd.mp4',
          stream_url: 'https://f.video.weibocdn.com/pc_stream.mp4',
          big_pic_info: {
            pic_big: { url: 'https://wx1.sinaimg.cn/large/pc_video_big.jpg', width: '720', height: '1280' },
          },
          h5_url: 'https://video.weibo.com/show?fid=1034:5123456789012347',
        },
      },
    }))

    expect(tweet.media).toHaveLength(1)
    const video = tweet.media[0]
    expect(video.type).toBe(MediaType.VIDEO)
    // mp4_hd_url 优先
    expect(video.videoUrl).toBe('https://f.video.weibocdn.com/pc_hd.mp4')
    expect(video.imageUrl).toBe('https://wx1.sinaimg.cn/large/pc_video.jpg')
    // page_pic 是字符串 → 宽高退回 big_pic_info.pic_big
    expect(video.width).toBe(720)
    expect(video.height).toBe(1280)
    expect(video.duration).toBeCloseTo(125.5)
    expect(tweet.permanentVideoUrl).toBe('https://video.weibo.com/show?fid=1034:5123456789012347')
    expect(tweet.pageInfo?.objectType).toBe('video')
  })
})
