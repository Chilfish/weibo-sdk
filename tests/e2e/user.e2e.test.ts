import { describe, expect, it } from 'vitest'
import { WeiboSessionExpiredError } from '~/models/errors/BusinessError'
import { WeiboSDK } from '~/WeiboSDK'

const cookie = process.env.WEIBO_COOKIE
const expiredCookie = 'SUB=123; SUBP=123'

const isE2E = process.env.WEIBO_E2E === '1' && Boolean(cookie)
const describeE2E = isE2E ? describe : describe.skip
const describeExpired = process.env.WEIBO_E2E === '1' ? describe : describe.skip

describeE2E('e2e:user', () => {
  it('fetches and normalizes a user by id', async () => {
    const { dataPath, rawPath, userId, writeJson } = await import('tests/utils')

    const weibo = new WeiboSDK({
      cookie: cookie!,
      selfCheck: { mode: 'lazy' },
      hooks: {
        onRaw: async (raw, meta) => {
          if (meta.resourceType === 'USER_DETAILS' && !meta.args?.uid)
            return
          await writeJson(raw, `${rawPath}/${meta.resourceType}.json`)
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
