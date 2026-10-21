#!/usr/bin/env node
/**
 * 下游打包门禁（PF5 / R7 / R9）。
 *
 * 用已安装的 Vite 程序化打包一个「只 import WeiboSDK」的消费者入口，断言：
 * 1. 产物 chunk 的 modules 里不含 `src/cli.ts` / `src/cli-bin.ts`（命令树不进库产物）。
 * 2. 产物里没有 `node:fs` / `node:path` 的静态 import（浏览器/Edge 可用）。
 * 3. Worker 里能 import 构建后的 `dist/index.mjs` 并构造 SDK（无 window/document 也能跑）。
 *
 * 用法：pnpm run test:bundle（需先 pnpm build；Worker 步骤在 dist 缺失时跳过并提示）
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { build } from 'vite'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP_DIR = path.join(ROOT, '.tmp-bundle')
const OUT_DIR = path.join(TMP_DIR, 'out')
const ENTRY_FILE = path.join(TMP_DIR, 'entry.ts')
const DIST_ENTRY = path.join(ROOT, 'dist', 'index.mjs')
const CLI_MODULES = ['src/cli.ts', 'src/cli-bin.ts']
const NODE_BUILTIN_RE = /from\s+["']node:(?:fs|path)["']/

const failures = []

function log(message) {
  process.stdout.write(`${message}\n`)
}

function check(ok, message) {
  if (ok) {
    log(`✔ ${message}`)
    return true
  }
  failures.push(message)
  process.stderr.write(`✖ ${message}\n`)
  return false
}

function toPosix(filePath) {
  return filePath.replaceAll('\\', '/')
}

/** 收集一次 build 的所有输出（`write: false` 时返回 RollupOutput 或数组）。 */
function collectOutputs(result) {
  const outputs = Array.isArray(result) ? result : [result]
  return outputs.flatMap(output => output.output ?? [])
}

function writeOutputs(items) {
  mkdirSync(OUT_DIR, { recursive: true })
  for (const item of items) {
    const content = item.type === 'chunk' ? item.code : item.source
    writeFileSync(path.join(OUT_DIR, item.fileName), content)
  }
}

async function bundle() {
  mkdirSync(TMP_DIR, { recursive: true })
  writeFileSync(
    ENTRY_FILE,
    `// 消费者入口：只 import 库入口，用来检查 tree-shaking 是否把 CLI 带进产物。\nimport { WeiboSDK } from '../src/index.ts'\n\nconsole.log(typeof WeiboSDK)\n`,
  )

  log('▸ vite build（configFile: false, write: false）')
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      target: 'esnext',
      emptyOutDir: false,
      rollupOptions: {
        input: ENTRY_FILE,
        output: {
          entryFileNames: 'entry.mjs',
          chunkFileNames: '[name].mjs',
          assetFileNames: '[name][extname]',
        },
      },
    },
  })

  const items = collectOutputs(result)
  const chunks = items.filter(item => item.type === 'chunk')
  check(chunks.length > 0, `Vite 产出 ${chunks.length} 个 chunk`)

  const moduleIds = chunks.flatMap(chunk => Object.keys(chunk.modules ?? {})).map(toPosix)
  const cliModules = moduleIds.filter(id => CLI_MODULES.some(name => id.includes(name)))
  check(
    cliModules.length === 0,
    `产物模块不含 CLI（${CLI_MODULES.join(' / ')}）${cliModules.length > 0 ? `；命中：${cliModules.join(', ')}` : ''}`,
  )
  check(
    moduleIds.some(id => id.includes('src/WeiboSDK.ts')),
    '产物模块包含 WeiboSDK（断言不是空构建）',
  )

  writeOutputs(items)
  log(`▸ 产物已写入 ${toPosix(path.relative(ROOT, OUT_DIR))}`)

  const outputs = readdirSync(OUT_DIR)
  const builtinHits = outputs.filter((file) => {
    const text = readFileSync(path.join(OUT_DIR, file), 'utf8')
    return NODE_BUILTIN_RE.test(text)
  })
  check(
    builtinHits.length === 0,
    `产物无 node:fs / node:path 静态 import${builtinHits.length > 0 ? `；命中：${builtinHits.join(', ')}` : ''}`,
  )
}

/** Worker smoke：无 window/document 的最小运行时。 */
async function workerSmoke() {
  if (!existsSync(DIST_ENTRY)) {
    log(`▸ 跳过 Worker smoke：${toPosix(path.relative(ROOT, DIST_ENTRY))} 不存在（先执行 \`pnpm build\`）`)
    return
  }

  const distUrl = pathToFileURL(DIST_ENTRY).href
  const workerCode = `
const { parentPort } = require('node:worker_threads')
import(${JSON.stringify(distUrl)}).then((mod) => {
  const sdk = new mod.WeiboSDK({ auth: 'guest', selfCheck: { mode: 'none' } })
  if (!(sdk instanceof mod.WeiboSDK)) throw new Error('构造未返回 WeiboSDK 实例')
  if (!sdk.tweets || typeof sdk.tweets.getByMblogId !== 'function') throw new Error('services 未装配')
  parentPort.postMessage({ ok: true })
}, (error) => {
  parentPort.postMessage({ ok: false, message: String((error && error.message) || error) })
})
`
  const worker = new Worker(workerCode, { eval: true, stdout: true, stderr: true })

  const outcome = await new Promise((resolve) => {
    const timer = setTimeout(resolve, 15_000, { ok: false, message: 'Worker 15s 内没有回消息' })
    worker.once('message', (message) => {
      clearTimeout(timer)
      resolve(message)
    })
    worker.once('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, message: error.message })
    })
    worker.once('exit', (code) => {
      clearTimeout(timer)
      resolve({ ok: false, message: `Worker 提前退出（exit ${code}）` })
    })
  })

  await worker.terminate()
  check(outcome.ok === true, `Worker 中 import dist/index.mjs 并构造 SDK${outcome.ok ? '' : `（${outcome.message}）`}`)
}

async function main() {
  rmSync(TMP_DIR, { recursive: true, force: true })
  try {
    await bundle()
    await workerSmoke()
  }
  catch (error) {
    check(false, `test:bundle 执行异常：${error instanceof Error ? error.message : String(error)}`)
  }
  finally {
    rmSync(TMP_DIR, { recursive: true, force: true })
  }

  if (failures.length > 0) {
    process.stderr.write(`\n✖ test:bundle 失败（${failures.length} 项）\n`)
    process.exitCode = 1
    return
  }
  log('\n✔ test:bundle 全部通过')
}

main().catch((error) => {
  process.stderr.write(`✖ test:bundle crashed: ${String((error && error.stack) || error)}\n`)
  process.exitCode = 1
})
