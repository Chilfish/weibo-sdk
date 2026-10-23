import type { PlaygroundEnv } from './types'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const PLAYGROUND = join(ROOT, 'playground')
export const OUTPUT = join(PLAYGROUND, 'output')

/**
 * 读取 `.env`：根目录 → `playground/.env` → 显式 `--env-file`，后者覆盖前者。
 *
 * 与 CLI 一样只读 `.env`，Cookie 只有一个来源。
 */
export function loadEnv(options: { envFile?: string } = {}): PlaygroundEnv {
  const explicit = options.envFile ? resolve(options.envFile) : undefined
  if (explicit && !existsSync(explicit))
    throw new Error(`--env-file 指定的文件不存在：${explicit}`)

  const checkedFiles = [join(ROOT, '.env'), join(PLAYGROUND, '.env')]
  const files = [...checkedFiles]
  if (explicit)
    files.push(explicit)

  const values: Record<string, string> = {}
  let envFile: string | undefined
  for (const file of files) {
    if (!existsSync(file))
      continue
    Object.assign(values, parseEnv(readFileSync(file, 'utf8')))
    envFile = file
  }

  return { values, envFile, checkedFiles: [...new Set([...checkedFiles, ...(explicit ? [explicit] : [])])] }
}

/** 取 Cookie；缺失时给出可直接照做的下一步。 */
export function requireCookie(env: PlaygroundEnv, explicit?: string): string {
  const cookie = explicit || env.values.WEIBO_COOKIE
  if (cookie)
    return cookie

  throw new Error([
    '未找到 WEIBO_COOKIE。',
    '  1. 复制 playground/.env.example 为 playground/.env（或项目根目录 .env）',
    '  2. 从已登录浏览器导出 Cookie header，填入 WEIBO_COOKIE',
    '  3. 或运行时显式传 --cookie "<cookie header / cookies.txt 路径>"',
    `  已检查：${env.checkedFiles.join(' / ')}`,
  ].join('\n'))
}
