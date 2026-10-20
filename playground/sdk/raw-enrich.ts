import type { SdkScenario } from '../lib/types'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { argument, flagBool } from '../lib/args'
import { defaultMblogId } from '../lib/defaults'

/** raw / enrich / hooks.onRaw：需要自己落盘原始 JSON 时怎么接。 */
export const scenario: SdkScenario = {
  kind: 'sdk',
  id: 'raw-enrich',
  title: 'raw、长文与 onRaw',
  summary: 'tweets.enrich（raw + 归一化 + 可选长文）+ hooks.onRaw + 原始 JSON 落盘',
  usage: 'pnpm play raw-enrich [mblogId] [--longtext] [--write]',
  async run({ sdk, createSDK, args, env, paths, log }) {
    const mblogId = argument(args, 0, 'PLAYGROUND_MBLOG_ID', env.values, defaultMblogId(env.values))
    const includeLongText = flagBool(args, 'longtext', false)

    const { tweet, raw, longText } = await sdk.tweets.enrich(mblogId, { includeLongText })
    log.kv('tweet', `${tweet.mblogId} · ${tweet.user.name} · ${tweet.createdAt}`)
    log.kv('raw keys', raw && typeof raw === 'object' ? Object.keys(raw as Record<string, unknown>).join(', ') : typeof raw)
    if (longText)
      log.kv('longText', `${longText.length} chars`)

    if (flagBool(args, 'write', false)) {
      const dir = join(paths.output, 'raw')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, `${mblogId}.json`)
      writeFileSync(file, JSON.stringify(raw, null, 2))
      log.kv('raw file', file)
    }
    else {
      log.info('加 --write 会把原始响应写到 playground/output/raw/<mblogId>.json。')
    }

    log.heading('hooks.onRaw（请求级）')
    const hooked = createSDK({
      hooks: {
        onRaw: (payload, meta) => {
          const keys = payload && typeof payload === 'object' ? Object.keys(payload as Record<string, unknown>).length : 0
          log.info(`- ${meta.endpoint ?? 'unknown'} ${JSON.stringify(meta.args ?? {})} keys=${keys}`)
        },
      },
    })
    await hooked.tweets.getByMblogId(mblogId)
    log.info('onRaw 在 Zod 校验前触发，失败响应也能拿到；ArchiveItem 本身不携带 raw。')
  },
}
