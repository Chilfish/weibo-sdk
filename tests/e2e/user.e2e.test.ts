import { describe, expect, it } from 'vitest'
import { WeiboSessionExpiredError } from '~/models/errors/BusinessError'
import { WeiboSDK } from '~/WeiboSDK'

const cookie = process.env.WEIBO_COOKIE
const expiredCookie = 'SUB=123; SUBP=123'

const describeE2E = cookie ? describe : describe.skip
const describeExpired = describe

describeE2E('e2e:user', () => {
  it('fetches and normalizes a user by id', async () => {
    const { dataPath, rawPath, userId, writeJson } = await import('tests/utils')

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

    const user = await weibo.users.getById(userId)

    expect(user.id).toBeTruthy()
    expect(user.name).toBeTruthy()
    expect(user.url).toMatch(/^https:\/\/weibo\.com/)

    await writeJson(user, `${dataPath}/user.json`)
  })
})

describeExpired('e2e:session', () => {
  it('selfCheck throws WeiboSessionExpiredError for expired cookie', async () => {
    const weibo = new WeiboSDK({
      cookie: expiredCookie!,
    })

    await expect(weibo.selfCheck()).rejects.toBeInstanceOf(WeiboSessionExpiredError)
  })
})
