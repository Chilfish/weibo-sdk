import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

/**
 * 读取 .env 文件内容，不写入 `process.env`。
 *
 * 设计原因：`process.loadEnvFile()` 不会覆盖已存在的环境变量；本机残留的旧
 * `WEIBO_COOKIE` 会静默遮蔽 .env 中的新值。Cookie 只认显式指定的 .env 文件。
 */
export function readEnvFile(filePath: string): Record<string, string | undefined> {
  let content: string
  try {
    content = readFileSync(filePath, 'utf8')
  }
  catch {
    return {}
  }

  if (content.charCodeAt(0) === 0xFEFF)
    content = content.slice(1)

  try {
    return parseEnv(content)
  }
  catch {
    return {}
  }
}

export function readEnvValue(filePath: string, key: string): string | undefined {
  return readEnvFile(filePath)[key]
}
