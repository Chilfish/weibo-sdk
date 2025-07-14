import { writeFile } from 'node:fs/promises'
import process from 'node:process'
import { Crawler, defineConfig } from '@weibo-sdk/core'

async function main(): Promise<void> {
  // Define configuration
  const config = defineConfig({
    logger: {
      level: 'info',
    },

    fetcher: {
      cookies: process.env.WEIBO_COOKIE || '',
    },
  })

  // Create crawler instance
  const crawler = new Crawler(config)

  // Add data handlers
  crawler.context.hooks.on('onData', async (payload) => {
    if (payload.type === 'user') {
      const user = payload.data

      console.log('\n👤 User Profile Retrieved:')
      console.log('─'.repeat(50))
      console.log(`Name: ${user.name}`)
      console.log(`Screen Name: @${user.screen_name}`)
      console.log(`ID: ${user.id}`)
      console.log(`Description: ${user.description || 'No description'}`)
      console.log(`Followers: ${user.followers_count.toLocaleString()}`)
      console.log(`Following: ${user.friends_count.toLocaleString()}`)
      console.log(`Posts: ${user.statuses_count.toLocaleString()}`)
      console.log(`Verified: ${user.verified ? '✅ Yes' : '❌ No'}`)
      console.log(`Location: ${user.location || 'Not specified'}`)
      console.log(
        `Gender: ${user.gender === 'm' ? 'Male' : user.gender === 'f' ? 'Female' : 'Not specified'}`,
      )

      if (user.displayName) {
        console.log(`Display Name: ${user.displayName}`)
      }

      console.log('─'.repeat(50))
    }
  })

  // Add error handlers
  crawler.context.hooks.on('onError', async (error) => {
    console.error('❌ Error occurred:', error.error?.message || error.message)
  })

  // Add progress handlers
  crawler.context.hooks.on('transform:user', async (user) => {
    console.log(`🔄 Processing user data: ${user.name}`)
    return user
  })

  crawler.context.hooks.on('core:fetch-raw', async (data) => {
    await writeFile(
      `data/raw/${Date.now()}.json`,
      JSON.stringify(data.data, null, 2),
      'utf8',
    )
  })

  try {
    // Setup crawler
    console.log('🚀 Setting up crawler...')
    await crawler.setup()

    // Get target user ID from environment or command line
    const targetUserId = process.argv[2]

    if (!targetUserId) {
      console.error('❌ Please provide a user ID:')
      process.exit(1)
    }

    // Run crawling task
    console.log(`📡 Fetching user information for ID: ${targetUserId}`)
    await crawler.run({ userId: targetUserId })

    console.log('✨ User information retrieved successfully!')
  }
  catch (error: any) {
    console.error('💥 Failed to retrieve user information:', error.message)

    process.exit(1)
  }
  finally {
    // Cleanup
    await crawler.stop()
  }
}

// Handle process signals for graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...')
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...')
  process.exit(0)
})

main()
