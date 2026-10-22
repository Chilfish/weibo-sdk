import { run } from './runner'

run().catch((error) => {
  console.log(`❌ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
