import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AuthService } from '~/services/internal/AuthService'

const dirs: string[] = []

function createCookieFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'weibo-sdk-auth-'))
  dirs.push(dir)
  const file = join(dir, 'cookies.txt')
  writeFileSync(file, content, 'utf8')
  return file
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

describe('authService', () => {
  it('extracts XSRF token from cookie when not provided', () => {
    const auth = new AuthService({
      cookie: 'SUB=abc; XSRF-TOKEN=token123; other=x',
    })

    const headers = auth.getAuthHeaders()
    expect(headers.Cookie).toContain('SUB=abc')
    expect(headers['X-XSRF-TOKEN']).toBe('token123')
  })

  it('prefers explicit xsrfToken over cookie extraction', () => {
    const auth = new AuthService({
      cookie: 'SUB=abc; XSRF-TOKEN=token_from_cookie',
      xsrfToken: 'token_explicit',
    })

    const headers = auth.getAuthHeaders()
    expect(headers['X-XSRF-TOKEN']).toBe('token_explicit')
  })

  it('validates cookie contains SUB', () => {
    expect(new AuthService({ cookie: 'SUB=abc' }).validate()).toBe(true)
    expect(new AuthService({ cookie: 'XSRF-TOKEN=1' }).validate()).toBe(false)
  })

  it('accepts a Netscape cookie file path', () => {
    const file = createCookieFile([
      '.weibo.com\tTRUE\t/\tFALSE\t9999999999\tSUB\tabc',
      '.weibo.com\tTRUE\t/\tFALSE\t9999999999\tXSRF-TOKEN\ttoken123',
    ].join('\n'))

    const auth = new AuthService({ cookie: file })

    expect(auth.validate()).toBe(true)
    expect(auth.getAuthHeaders()).toMatchObject({
      'Cookie': 'SUB=abc; XSRF-TOKEN=token123',
      'X-XSRF-TOKEN': 'token123',
    })
  })
})
