import type { WeiboProvider } from '~/plugins/weibo/provider'
import { Crawler } from '~/core/crawler'
import { defineConfig } from '~/index'
import { createWeiboPlugin } from '~/plugins/weibo'
import 'dotenv/config'

async function main() {
  console.log('🚀 Starting Integration Test...')

  const cookie = process.env.WEIBO_COOKIE
  if (!cookie) {
    console.warn('⚠️ WARNING: No WEIBO_COOKIE found in .env file.')
    console.warn('   Most Weibo APIs will fail or return guest data without a valid SUB cookie.')
  }

  // 1. 定义配置
  const config = defineConfig({
    logLevel: 'debug',
    credentials: {
      weibo: {
        cookie,
      },
    },

    plugins: [
      createWeiboPlugin(),
    ],
  })

  // 2. 初始化爬虫
  const crawler = new Crawler(config)
  await crawler.setup()

  try {
    // 3. 获取 Weibo Provider 实例
    // 注意：这里需要类型断言或泛型来获得具体的 Provider 类型提示
    const weibo = crawler.getProvider('weibo') as WeiboProvider

    // 4. 测试目标：获取 "来去之间" (微博CEO) 的信息
    // UID: 1111681197
    const targetUid = '1111681197'

    console.log(`\n📡 Fetching profile for UID: ${targetUid}...`)
    const actor = await weibo.getProfile(targetUid)

    // 5. 验证结果
    console.dir(actor, { depth: null })
  }
  catch (error: any) {
    console.error('\n❌ Test Failed!')
    if (error.message.includes('403') || error.message.includes('302')) {
      console.error('👉 This is likely a Cookie/Auth issue. Please update WEIBO_COOKIE in .env')
    }
    console.error(error)
  }
}

main().catch(console.error)
