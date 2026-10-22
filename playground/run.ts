import type { IWeiboConfig } from '@chilfish/weibo-sdk'
import type { CliScenario, ParsedArgs, PlaygroundEnv, PlaygroundLog, PlaygroundPaths, Scenario, SdkScenario } from './lib/types'
import { WeiboSDK } from '@chilfish/weibo-sdk'
import { cliScenarios } from './cli/scenarios'
import { parseScenarioArgs } from './lib/args'
import { runCli } from './lib/cli'
import { loadEnv, OUTPUT, PLAYGROUND, requireCookie, ROOT } from './lib/env'
import { createLogger, describeError } from './lib/log'
import { scenario as archive } from './sdk/archive'
import { scenario as archiveBatch } from './sdk/archive-batch'
import { scenario as archiveMerge } from './sdk/archive-merge'
import { scenario as diagnose } from './sdk/diagnose'
import { scenario as downloadMedia } from './sdk/download-media'
import { scenario as favoritesLikes } from './sdk/favorites-likes'
import { scenario as homeFeed } from './sdk/home-feed'
import { scenario as mediaGallery } from './sdk/media-gallery'
import { scenario as notifications } from './sdk/notifications'
import { scenario as plugins } from './sdk/plugins'
import { scenario as rawEnrich } from './sdk/raw-enrich'
import { scenario as socialGraph } from './sdk/social-graph'
import { scenario as telemetry } from './sdk/telemetry'
import { scenario as topicsTrends } from './sdk/topics-trends'
import { scenario as tweetAttachments } from './sdk/tweet-attachments'
import { scenario as tweetComments } from './sdk/tweet-comments'
import { scenario as userArchive } from './sdk/user-archive'
import { scenario as userTimeline } from './sdk/user-timeline'
import { scenario as whoami } from './sdk/whoami'

const SDK_SCENARIOS: SdkScenario[] = [
  whoami,
  userTimeline,
  homeFeed,
  tweetComments,
  tweetAttachments,
  mediaGallery,
  downloadMedia,
  favoritesLikes,
  socialGraph,
  notifications,
  topicsTrends,
  archive,
  archiveBatch,
  archiveMerge,
  userArchive,
  telemetry,
  diagnose,
  plugins,
  rawEnrich,
]

interface Globals {
  rest: string[]
  envFile?: string
  cookie?: string
}

/** 先摘出 playground 自己的全局参数，剩下的原样交给具体场景。 */
function extractGlobals(argv: string[]): Globals {
  const rest: string[] = []
  let envFile: string | undefined
  let cookie: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') {
      rest.push(...argv.slice(index + 1))
      break
    }
    if (arg === '--env-file') {
      envFile = argv[index + 1]
      index += 1
      continue
    }
    if (arg.startsWith('--env-file=')) {
      envFile = arg.slice('--env-file='.length)
      continue
    }
    if (arg === '--cookie') {
      cookie = argv[index + 1]
      index += 1
      continue
    }
    if (arg.startsWith('--cookie=')) {
      cookie = arg.slice('--cookie='.length)
      continue
    }
    rest.push(arg)
  }

  return { rest, envFile, cookie }
}

function printList(env: PlaygroundEnv): void {
  console.log('Weibo SDK Playground')
  console.log(`  repo: ${ROOT}`)
  console.log(`  env : ${env.envFile ?? '未找到 .env（复制 playground/.env.example 为 playground/.env）'}`)

  console.log('\nSDK 场景（import @chilfish/weibo-sdk）')
  for (const scenario of SDK_SCENARIOS) {
    const auth = scenario.requiresCookie === false ? 'offline' : 'cookie'
    console.log(`  ${scenario.id}  [${auth}]`)
    console.log(`    ${scenario.title} — ${scenario.summary}`)
    console.log(`    用法: ${scenario.usage}`)
  }

  console.log('\nCLI 场景（运行真实 weibo-cli）')
  for (const scenario of cliScenarios) {
    const auth = scenario.requiresCookie === false ? 'offline' : 'cookie'
    console.log(`  cli:${scenario.id}  [${auth}]`)
    console.log(`    ${scenario.title} — ${scenario.summary}`)
  }

  console.log('\n全局参数: --env-file <path>  --cookie <value>')
  console.log('示例: pnpm play whoami')
  console.log('      pnpm play tweet-comments QqsYymYOS --max-pages 1')
  console.log('      pnpm play cli:home')
}

function findScenario(id: string): Scenario | undefined {
  if (id.startsWith('sdk:'))
    return SDK_SCENARIOS.find(item => item.id === id.slice('sdk:'.length))
  if (id.startsWith('cli:'))
    return cliScenarios.find(item => item.id === id.slice('cli:'.length))
  return SDK_SCENARIOS.find(item => item.id === id)
    ?? cliScenarios.find(item => item.id === id)
}

function buildSdk(cookie: string, offline: boolean): {
  sdk: WeiboSDK
  createSDK: (overrides?: Partial<IWeiboConfig>) => WeiboSDK
} {
  const base: IWeiboConfig = {
    cookie,
    selfCheck: { mode: offline ? 'none' : 'lazy' },
  }
  const createSDK = (overrides: Partial<IWeiboConfig> = {}): WeiboSDK => new WeiboSDK({
    ...base,
    ...overrides,
    selfCheck: overrides.selfCheck ?? base.selfCheck,
  })
  return { sdk: createSDK(), createSDK }
}

async function runCliScenario(
  scenario: CliScenario,
  args: ParsedArgs,
  env: PlaygroundEnv,
  paths: PlaygroundPaths,
  cookie: string | undefined,
  log: PlaygroundLog,
): Promise<void> {
  if (scenario.requiresCookie !== false && !cookie)
    requireCookie(env)

  const steps = scenario.steps({ args, env, paths, log })
  for (const step of steps) {
    const auth = step.auth ?? scenario.requiresCookie !== false
    const injected: string[] = []
    if (auth) {
      if (cookie)
        injected.push('--cookie', cookie)
      else if (env.envFile)
        injected.push('--env-file', env.envFile)
    }

    const argv = [...step.argv, ...injected]
    const displayed = argv.map((value, index) => (argv[index - 1] === '--cookie' ? '<redacted>' : value))
    log.step(`weibo-cli ${displayed.join(' ')}`)
    if (step.note)
      log.info(step.note)

    const code = await runCli(argv, { cwd: paths.root })
    if (code !== 0 && !step.allowFailure) {
      log.error(`退出码 ${code}；后续步骤已停止。`)
      process.exitCode = code
      return
    }
  }
}

async function main(): Promise<void> {
  const globals = extractGlobals(process.argv.slice(2))
  const env = loadEnv({ envFile: globals.envFile })
  const paths: PlaygroundPaths = { root: ROOT, playground: PLAYGROUND, output: OUTPUT }

  if (
    globals.rest.length === 0
    || globals.rest.includes('--list')
    || globals.rest.includes('--help')
    || globals.rest.includes('-h')
  ) {
    printList(env)
    return
  }

  const [id, ...scenarioArgv] = globals.rest
  const scenario = findScenario(id)
  if (!scenario) {
    console.error(`未知场景：${id}\n`)
    printList(env)
    process.exitCode = 1
    return
  }

  const args = parseScenarioArgs(scenarioArgv)
  const log = createLogger(scenario.kind === 'cli' ? `cli:${scenario.id}` : scenario.id)
  log.heading(scenario.title)
  log.info(scenario.summary)
  log.info(`用法: ${scenario.kind === 'sdk' ? scenario.usage : `pnpm play cli:${scenario.id} ...`}`)

  if (scenario.kind === 'sdk') {
    const offline = scenario.requiresCookie === false
    const cookie = offline
      ? 'SUB=playground-offline; XSRF-TOKEN=playground-offline'
      : requireCookie(env, globals.cookie)
    const { sdk, createSDK } = buildSdk(cookie, offline)
    await scenario.run({ sdk, createSDK, args, env, paths, log })
    return
  }

  await runCliScenario(scenario, args, env, paths, globals.cookie, log)
}

main().catch((error) => {
  console.error(JSON.stringify(describeError(error), null, 2))
  process.exitCode = 1
})
