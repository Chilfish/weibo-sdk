import { describe, expect, it } from 'vitest'
import { WeiboSDK } from '~/WeiboSDK'

const cookie = process.env.WEIBO_COOKIE
const e2eEnabled = process.env.WEIBO_E2E === '1'
const mblogId = process.env.WEIBO_MBLOG_ID

const describeE2E = e2eEnabled && cookie ? describe : describe
const describeShow = e2eEnabled && cookie && mblogId ? describe : describe

describeE2E('e2e:tweet', () => {
  it('lists tweets by user id (shape only)', async () => {
    const { rawPath, userId, writeJson } = await import('tests/utils')

    const weibo = new WeiboSDK({
      cookie: cookie!,
      selfCheck: { mode: 'lazy' },
      hooks: {
        onFetched: async (resource, data, meta) => {
          if (resource === 'USER_DETAILS' && !meta.args?.uid)
            return
          await writeJson(data, `${rawPath}/${resource}.json`)
        },
      },
    })

    const page = await weibo.tweets.listByUserId(userId)
    expect(typeof page.sinceId).toBe('number')
    expect(Array.isArray(page.tweets)).toBe(true)
  })
})

describeShow('e2e:tweet:show', () => {
  it('fetches and normalizes a tweet by mblog id', async () => {
    const { dataPath, rawPath, writeJson } = await import('tests/utils')

    const weibo = new WeiboSDK({
      cookie: cookie!,
      selfCheck: { mode: 'lazy' },
      hooks: {
        onFetched: async (resource, data, meta) => {
          if (resource === 'USER_DETAILS' && !meta.args?.uid)
            return
          await writeJson(data, `${rawPath}/${resource}.json`)
        },
      },
    })

    const tweet = await weibo.tweets.getByMblogId(mblogId!)

    expect(tweet.id).toBeTruthy()
    expect(tweet.mblogId).toBe(mblogId)
    expect(tweet.user.id).toBeTruthy()

    await writeJson(tweet, `${dataPath}/tweet.json`)
  })
})
