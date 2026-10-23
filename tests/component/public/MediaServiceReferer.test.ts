import type { ITweet } from '~/types/domain/ITweet'
import { describe, expect, it } from 'vitest'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { MediaService } from '~/services/public/MediaService'
import { TweetVisible } from '~/types/domain/ITweet'
import { VerificationType } from '~/types/domain/IUser'

/** 空媒体微博：只校验下载选项解析，不会发出请求。 */
function makeTweet(): ITweet {
  return {
    id: '1',
    mblogId: 'M1',
    createdAt: '2025-10-20 09:14:17',
    text: '',
    source: '',
    user: {
      id: '1',
      name: 'tester',
      avatar: '',
      verified: false,
      verifiedType: VerificationType.Personal,
    },
    stats: { likes: 0, comments: 0, reposts: 0 },
    visible: TweetVisible.PUBLIC,
    media: [],
  }
}

describe('mediaService referer 校验（结构化错误）', () => {
  const service = new MediaService({})

  it.each([
    ['ftp://cdn.example.com/x.jpg', '非 http(s) 协议'],
    ['not a url', '无法用 new URL 解析'],
    ['javascript:alert(1)', '非网络协议'],
  ])('rejects %j (%s) as CONFIG_INVALID', async (referer) => {
    await expect(service.downloadTweetMedia(makeTweet(), { dir: 'out', referer }))
      .rejects
      .toMatchObject({
        code: 'CONFIG_INVALID',
        level: 'business',
        retryable: false,
        context: { field: 'referer', value: referer },
      })
  })

  it('produces InvalidConfigError, not a raw Error', async () => {
    const error = await service
      .downloadTweetMedia(makeTweet(), { dir: 'out', referer: 'ftp://cdn.example.com/x.jpg' })
      .catch(caught => caught)

    expect(error).toBeInstanceOf(InvalidConfigError)
    expect(String((error as Error).message)).toContain('Media download referer must be an http(s) URL')
  })

  it('accepts http(s) referers', async () => {
    const result = await service.downloadTweetMedia(makeTweet(), {
      dir: 'out',
      referer: ' https://m.weibo.cn/u/1 ',
      dryRun: true,
    })

    expect(result.totals.total).toBe(0)
  })
})
