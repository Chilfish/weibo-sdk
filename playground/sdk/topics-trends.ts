import type { SdkScenario } from '../lib/types'
import { flagString } from '../lib/args'

/** 热搜 + 超话分类 / 关键词搜索；顺便展示「公开搜索不可用」的能力状态。 */
export const scenario: SdkScenario = {
  kind: 'sdk',
  id: 'topics-trends',
  title: '热搜与超话',
  summary: 'trends.hotBand + topics.cates + topics.stream({ keyword })',
  usage: 'pnpm play topics-trends [--keyword 游戏] [--max-pages 1]',
  async run({ sdk, args, log }) {
    const keyword = flagString(args, 'keyword') ?? '游戏'

    log.heading('热搜')
    const trends = await sdk.trends.hotBand('hot')
    const realtime = trends.data.realtime ?? []
    log.kv('realtime', realtime.length)
    for (const item of realtime.slice(0, 5))
      log.info(`- ${item.word}${item.num === undefined ? '' : ` (${item.num})`}`)

    log.heading('超话分类')
    const cates = await sdk.topics.cates()
    log.kv('cates', cates.length)
    for (const cate of cates.slice(0, 5))
      log.info(`- ${cate.id} ${cate.name}`)

    log.heading(`超话搜索：${keyword}`)
    let topics = 0
    for await (const topic of sdk.topics.stream({ keyword, maxPages: 1 })) {
      if (++topics <= 5)
        log.info(`- ${topic.pageId} ${topic.title}`)
    }
    log.kv('topics', topics)

    const searchCaps = sdk.capabilities({ service: 'search' })
    log.warn(`公开关键词搜索：${searchCaps.map(item => `${item.id}=${item.status}`).join(', ')}（产品暂缓）`)
    log.info('个人主页内的日期 / 关键词搜索请用 tweets.searchByDate（CLI: tweet search-profile）。')
  },
}
