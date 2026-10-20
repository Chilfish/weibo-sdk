import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env'

interface CliCommand {
  command: string
  args: string[]
}

/** 优先用仓库构建产物；也允许通过 `WEIBO_CLI_BIN` 指向自定义二进制。 */
function resolveCliCommand(): CliCommand | undefined {
  if (process.env.WEIBO_CLI_BIN)
    return { command: process.env.WEIBO_CLI_BIN, args: [] }

  const dist = join(ROOT, 'dist', 'cli.mjs')
  if (existsSync(dist))
    return { command: process.execPath, args: [dist] }

  return undefined
}

/**
 * 运行真实的 `weibo-cli`，直接复用其 stdout/stderr（JSON / NDJSON 原样输出）。
 *
 * @returns 子进程退出码；找不到 CLI 时返回 `127`
 */
export async function runCli(argv: string[], options: { cwd: string }): Promise<number> {
  const resolved = resolveCliCommand()
  if (!resolved) {
    console.error('未找到 dist/cli.mjs。先运行 `pnpm build`，或设置 WEIBO_CLI_BIN 指向已安装的 weibo-cli。')
    return 127
  }

  return await new Promise<number>((resolve) => {
    const child = spawn(resolved.command, [...resolved.args, ...argv], {
      cwd: options.cwd,
      env: process.env,
      stdio: 'inherit',
    })
    child.on('error', (error) => {
      console.error(`启动 weibo-cli 失败：${error.message}`)
      resolve(1)
    })
    child.on('close', code => resolve(code ?? 1))
  })
}
