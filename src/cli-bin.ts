#!/usr/bin/env node
// bin 入口：唯一允许顶层副作用的模块，不通过 package.json#exports 暴露。
//
// 这里只用静态 import 引入无依赖的版本检查模块，其余全部动态加载：
// Node 版本过低时依赖（zod / citty）在模块求值阶段就会抛
// `SyntaxError: The requested module 'util' does not provide an export named 'parseEnv'`，
// 用户看到的会是 util 模块的问题，而不是「Node 太旧」。
import process from 'node:process'
import { isSupportedNodeVersion, nodeVersionError } from './cli/nodeVersion'

const current = process.versions.node
if (!isSupportedNodeVersion(current)) {
  console.error(nodeVersionError(current))
  process.exit(1)
}

const [{ runMain }, { main, withErrorEnvelope }, { assertKnownFlags }, { showCliUsage }, { formatCliError }] = await Promise.all([
  import('citty'),
  import('./cli'),
  import('./cli/validateArgs'),
  import('./cli/usage'),
  import('./cli/shared'),
])

try {
  await assertKnownFlags(main, process.argv.slice(2))
}
catch (error) {
  console.error(JSON.stringify(formatCliError(error)))
  process.exit(1)
}

runMain(withErrorEnvelope(main), { showUsage: showCliUsage })
