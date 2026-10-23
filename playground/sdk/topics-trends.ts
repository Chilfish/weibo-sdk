import type { SdkScenario } from '../lib/types'
import { flagString } from '../lib/args'
import { describeError } from '../lib/log'

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
    log.kv('realtime', trends.length)
    for (const item of trends.slice(0, 5))
      log.info(`- ${item.word}${item.heat === undefined ? '' : ` (${item.heat})`}`)

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

    log.heading('超话列表（单页）')
    const topicPage = await sdk.topics.list({ keyword, page: 1 })
    log.kv('list', `topics=${topicPage.topics.length} page=${topicPage.page} hasMore=${topicPage.hasMore}`)

    log.heading('热搜 raw')
    const rawBand = await sdk.trends.fetchRawBand('hot')
    log.kv('fetchRawBand', rawBand && typeof rawBand === 'object' ? Object.keys(rawBand).join(',') : typeof rawBand)

    log.heading(`公开关键词搜索（上游已失效）：${keyword}`)
    try {
      const users = await sdk.search.searchUsers(keyword)
      log.kv('searchUsers', `users=${users.users.length}`)
    }
    catch (error) {
      log.warn(`searchUsers: ${describeError(error).code ?? 'UNKNOWN'}（预期失败）`)
    }
    try {
      const tweets = await sdk.search.searchTweets(keyword)
      log.kv('searchTweets', `tweets=${tweets.tweets.length}`)
    }
    catch (error) {
      log.warn(`searchTweets: ${describeError(error).code ?? 'UNKNOWN'}（预期失败）`)
    }

    const searchCaps = sdk.capabilities({ service: 'search' })
    log.warn(`公开关键词搜索：${searchCaps.map(item => `${item.id}=${item.status}`).join(', ')}（产品暂缓）`)
    log.info('个人主页内的日期 / 关键词搜索请用 tweets.searchByDate（CLI: tweet search-profile）。')
  },
}
