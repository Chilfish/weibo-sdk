import type { SdkScenario } from '../lib/types'

/** 登录态 + 当前账号：最常见的第一次调用。 */
export const scenario: SdkScenario = {
  kind: 'sdk',
  id: 'whoami',
  title: '登录态与当前账号',
  summary: 'checkSession → myDetails → 解析 verified_url 里的 uid → getById',
  usage: 'pnpm play whoami',
  async run({ sdk, log }) {
    const alive = await sdk.checkSession()
    log.kv('checkSession', alive)
    if (!alive)
      throw new Error('Cookie 不可用：请重新从已登录浏览器导出 WEIBO_COOKIE（见 playground/README.md）')

    const details = await sdk.users.myDetails()
    log.kv('myDetails.ok', details.ok)

    const uid = details.data.verified_url?.match(/uid=(\d+)/)?.[1]
    if (!uid) {
      log.warn('myDetails 未返回 verified_url，无法解析当前 uid；直接打印原始详情')
      log.json(details)
      return
    }

    const me = await sdk.users.getById(uid)
    log.kv('uid', me.id)
    log.kv('name', me.name)
    log.kv('location', me.location)
    log.kv('followers', me.stats.followers)
    log.kv('friends', me.stats.friends)
    log.kv('statuses', me.stats.statuses)
    log.kv('verified', me.verification.isVerified)
    log.kv('capabilities', `${sdk.capabilities().length} 项（stable=${sdk.capabilities({ status: 'stable' }).length}）`)

    log.json({
      id: me.id,
      name: me.name,
      url: me.url,
      description: me.description,
      stats: me.stats,
    })
  },
}
