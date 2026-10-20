import type { SdkScenario } from '../lib/types'
import { listCapabilities } from '@chilfish/weibo-sdk'
import { flagBool } from '../lib/args'
import { requireCookie } from '../lib/env'
import { describeError } from '../lib/log'

/** 能力清单 + 结构化错误：排查 Cookie / 上游失效时先看这两个面。 */
export const scenario: SdkScenario = {
  kind: 'sdk',
  id: 'diagnose',
  title: '能力清单与错误诊断（离线可跑）',
  summary: 'listCapabilities 分组 + 可选 --probe 触发真实自检并打印结构化错误',
  usage: 'pnpm play diagnose [--probe]',
  requiresCookie: false,
  async run({ createSDK, args, env, log }) {
    const all = listCapabilities()
    const counts = new Map<string, number>()
    for (const capability of all)
      counts.set(capability.status, (counts.get(capability.status) ?? 0) + 1)

    log.kv('capabilities', all.length)
    log.kv('byStatus', Object.fromEntries(counts))

    log.heading('非 stable 能力')
    for (const capability of all.filter(item => item.status !== 'stable')) {
      log.info(`- ${capability.status} ${capability.id} · ${capability.note ?? capability.description}`)
      if (capability.cli)
        log.info(`  CLI: ${capability.cli}`)
    }

    const probe = flagBool(args, 'probe', false)
    if (!probe) {
      log.heading('结构化错误预览')
      log.info('加 --probe 会读取 .env 中的 Cookie 做一次真实自检，并故意请求一个非法 mblogId。')
      log.info('错误信封包含 code / level / retryable / hint / next / context，脚本可据此决定重试或重新登录。')
      return
    }

    log.heading('真实探测')
    const cookie = requireCookie(env)
    const real = createSDK({ cookie, selfCheck: { mode: 'lazy' } })

    try {
      await real.selfCheck()
      log.info('selfCheck ok：Cookie 可用')
    }
    catch (error) {
      log.json(describeError(error))
      log.warn('自检失败；上面的 hint / next 就是重新导出 Cookie 的下一步。')
      return
    }

    try {
      await real.tweets.getByMblogId('__playground_invalid_mblogid__')
      log.warn('非法 mblogId 竟然成功了；请检查上游行为是否变化。')
    }
    catch (error) {
      log.heading('业务错误形状')
      log.json(describeError(error))
      log.info('这是预期内的失败：用非法 mblogId 演示 code / retryable / hint / next / context。')
    }
  },
}
