import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getCookie, getEnvFilePath } from '~/cli/shared'
import { readEnvFile, readEnvValue } from '~/utils/envFile'

const dirs: string[] = []
const originalCookie = process.env.WEIBO_COOKIE

function createEnvFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'weibo-sdk-env-'))
  dirs.push(dir)
  const file = join(dir, '.env')
  writeFileSync(file, content, 'utf8')
  return file
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
  if (originalCookie === undefined)
    delete process.env.WEIBO_COOKIE
  else
    process.env.WEIBO_COOKIE = originalCookie
})

describe('envFile', () => {
  it('parses quoted values and ignores comments', () => {
    const file = createEnvFile('WEIBO_COOKIE="SUB=abc; XSRF-TOKEN=xyz"\n# comment\nOTHER=1\n')
    expect(readEnvValue(file, 'WEIBO_COOKIE')).toBe('SUB=abc; XSRF-TOKEN=xyz')
    expect(readEnvFile(file).OTHER).toBe('1')
  })

  it('missing file returns empty values', () => {
    expect(readEnvFile(join(tmpdir(), 'weibo-sdk-no-such-file.env'))).toEqual({})
    expect(readEnvValue(join(tmpdir(), 'weibo-sdk-no-such-file.env'), 'WEIBO_COOKIE')).toBeUndefined()
  })
})

describe('getCookie', () => {
  it('ignores a stale WEIBO_COOKIE env var and reads the specified .env', () => {
    process.env.WEIBO_COOKIE = 'stale-env-cookie'
    const file = createEnvFile('WEIBO_COOKIE="fresh-dotenv-cookie"\n')
    expect(getCookie({ 'env-file': file })).toBe('fresh-dotenv-cookie')
  })

  it('explicit --cookie wins over .env', () => {
    const file = createEnvFile('WEIBO_COOKIE="dotenv-cookie"\n')
    expect(getCookie({ 'cookie': 'explicit-cookie', 'env-file': file })).toBe('explicit-cookie')
  })

  it('missing .env yields an empty cookie', () => {
    expect(getCookie({ 'env-file': join(tmpdir(), 'weibo-sdk-no-such-file.env') })).toBe('')
  })

  it('defaults to <pwd>/.env', () => {
    expect(getEnvFilePath({})).toBe(join(process.cwd(), '.env'))
  })
})
