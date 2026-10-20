import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { parseCookieHeaderContent, parseNetscapeCookies, resolveCookieInput } from '~/utils/cookieInput'

const dirs: string[] = []

function createCookieFile(content: string, name = 'cookies.txt'): string {
  const dir = mkdtempSync(join(tmpdir(), 'weibo-sdk-cookie-'))
  dirs.push(dir)
  const file = join(dir, name)
  writeFileSync(file, content, 'utf8')
  return file
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('resolveCookieInput', () => {
  it('returns an inline header string unchanged', () => {
    expect(resolveCookieInput('SUB=abc; SUBP=def')).toBe('SUB=abc; SUBP=def')
  })

  it('strips the Cookie: prefix and trailing semicolon', () => {
    expect(resolveCookieInput('Cookie: SUB=abc; ')).toBe('SUB=abc')
  })

  it('keeps a single name=value pair as a header', () => {
    expect(resolveCookieInput('SUB=abc')).toBe('SUB=abc')
  })

  it('reads a Netscape cookie file and keeps weibo cookies only', () => {
    const file = createCookieFile([
      '# Netscape HTTP Cookie File',
      '# comment line',
      '.weibo.com\tTRUE\t/\tFALSE\t9999999999\tSUB\t_2A',
      '#HttpOnly_.weibo.com\tTRUE\t/\tTRUE\t9999999999\tSUBP\tabc',
      '.example.com\tTRUE\t/\tFALSE\t9999999999\tsession\tsecret',
      '.weibo.com\tTRUE\t/\tFALSE\t9999999999\tSUB\t_2B',
    ].join('\n'))

    expect(resolveCookieInput(file)).toBe('SUB=_2B; SUBP=abc')
  })

  it('skips expired Netscape cookies', () => {
    const file = createCookieFile([
      '.weibo.com\tTRUE\t/\tFALSE\t1\tOLD\tstale',
      '.weibo.com\tTRUE\t/\tFALSE\t9999999999\tSUB\tfresh',
    ].join('\n'))

    expect(resolveCookieInput(file)).toBe('SUB=fresh')
  })

  it('reads a file whose content is a cookie header string', () => {
    const file = createCookieFile('Cookie: SUB=abc; SUBP=def;\n')

    expect(resolveCookieInput(file)).toBe('SUB=abc; SUBP=def')
  })

  it('joins multi-line header file content', () => {
    const file = createCookieFile('# exported\nSUB=abc;\nXSRF-TOKEN=token;\n')

    expect(resolveCookieInput(file)).toBe('SUB=abc; XSRF-TOKEN=token')
  })

  it('throws InvalidConfigError when the cookie file is missing', () => {
    const missing = join(tmpdir(), 'weibo-sdk-no-such-cookies.txt')

    expect(() => resolveCookieInput(missing)).toThrowError(InvalidConfigError)
    try {
      resolveCookieInput(missing)
    }
    catch (error) {
      expect((error as InvalidConfigError).code).toBe('CONFIG_INVALID')
      expect((error as InvalidConfigError).context).toMatchObject({ field: 'cookie', path: missing })
    }
  })

  it('throws when the Netscape file has no weibo cookies', () => {
    const file = createCookieFile('.example.com\tTRUE\t/\tFALSE\t9999999999\tsession\tsecret')

    expect(() => resolveCookieInput(file)).toThrow(/no cookies for weibo\.com/)
  })

  it('throws when all weibo cookies are expired', () => {
    const file = createCookieFile('.weibo.com\tTRUE\t/\tFALSE\t1\tSUB\tstale')

    expect(() => resolveCookieInput(file)).toThrow(/expired/)
  })

  it('throws when the file has no valid cookie entries', () => {
    const file = createCookieFile('not a cookie file\n')

    expect(() => resolveCookieInput(file)).toThrow(/no valid cookie entries/)
  })

  it('returns the input unchanged when node:fs is unavailable (browser)', () => {
    vi.spyOn(process, 'getBuiltinModule').mockReturnValue(undefined)

    expect(resolveCookieInput('/tmp/cookies.txt')).toBe('/tmp/cookies.txt')
  })
})

describe('parseNetscapeCookies', () => {
  it('parses the 7-column format and keeps = inside values', () => {
    const cookies = parseNetscapeCookies('.weibo.com\tTRUE\t/\tTRUE\t12345\tSUB\ta=b=c')

    expect(cookies).toEqual([{
      domain: '.weibo.com',
      includeSubdomains: true,
      path: '/',
      secure: true,
      expires: 12345,
      name: 'SUB',
      value: 'a=b=c',
    }])
  })

  it('ignores malformed lines', () => {
    expect(parseNetscapeCookies([
      '# comment',
      'short\tline',
      '.weibo.com\tMAYBE\t/\tFALSE\t0\tSUB\tabc',
      '.weibo.com\tTRUE\tnot-a-path\tFALSE\t0\tSUB\tabc',
    ].join('\n'))).toEqual([])
  })
})

describe('parseCookieHeaderContent', () => {
  it('ignores comments and lines without =', () => {
    expect(parseCookieHeaderContent('# c\nSUB=abc\nnot-a-cookie\n')).toBe('SUB=abc')
  })

  it('strips a BOM', () => {
    expect(parseCookieHeaderContent('\uFEFFSUB=abc')).toBe('SUB=abc')
  })
})
