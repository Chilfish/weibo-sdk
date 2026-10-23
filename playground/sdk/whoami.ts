import type { SdkScenario } from '../lib/types'

/** 登录态 + 当前账号：最常见的第一次调用。 */
export const scenario: SdkScenario = {
  kind: 'sdk',
  id: 'whoami',
  title: '登录态与当前账号',
  summary: 'getSession（复用启动自检）→ uid → getById',
  usage: 'pnpm play whoami',
  async run({ sdk, log }) {
    const session = await sdk.getSession()
    log.kv('getSession.authMode', session.authMode)
    log.kv('getSession.uid', session.uid ?? '(未解析)')

    if (session.authMode === 'guest') {
      log.kv('guestTokenIssuedAt', session.guestTokenIssuedAt ?? '(未发放)')
      log.warn('guest 模式没有登录账号 uid；下方示例只展示公开能力')
      return
    }

    const profile = session.profile
    if (!profile) {
      log.warn('会话没有 profile/detail 数据')
      return
    }
    log.kv('profile.gender', profile.gender)

    const uid = session.uid
    if (!uid) {
      log.warn('profile/detail 未返回 verified_url，当前 uid 未知；打印归一化资料')
      log.json(profile)
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
