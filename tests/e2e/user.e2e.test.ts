import { describe, expect, it } from 'vitest'
import { WeiboSDK } from '~/WeiboSDK'

const cookie = process.env.WEIBO_COOKIE
const e2eEnabled = process.env.WEIBO_E2E === '1'
const describeE2E = e2eEnabled && cookie ? describe : describe.skip

describeE2E('e2e:user', () => {
  it('fetches and normalizes a user by id', async () => {
    const { dataPath, rawPath, userId, writeJson } = await import('tests/utils')

    const weibo = new WeiboSDK({
      cookie: cookie!,
    })

    weibo.users.onFetched = async (resource, data) => {
      await writeJson(data, `${rawPath}/${resource}.json`)
    }

    const user = await weibo.users.getById(userId)

    expect(user.id).toBeTruthy()
    expect(user.name).toBeTruthy()
    expect(user.url).toMatch(/^https:\/\/weibo\.com/)

    await writeJson(user, `${dataPath}/user.json`)
  })
})
