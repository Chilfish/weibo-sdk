import { describe, expect, it, vi } from 'vitest'
import { createPrinter, parseOutputFormat, renderOutput } from '~/cli/output'
import { WeiboSDKError } from '~/models/errors/WeiboSDKError'

function catchError(fn: () => unknown): unknown {
  try {
    fn()
  }
  catch (error) {
    return error
  }
  throw new Error('expected function to throw')
}

describe('parseOutputFormat', () => {
  it('defaults to json when the flag is omitted or empty', () => {
    expect(parseOutputFormat(undefined)).toBe('json')
    expect(parseOutputFormat('')).toBe('json')
  })

  it('accepts json, markdown and the md alias', () => {
    expect(parseOutputFormat('json')).toBe('json')
    expect(parseOutputFormat('markdown')).toBe('markdown')
    expect(parseOutputFormat('md')).toBe('markdown')
  })

  it('tolerates case and surrounding whitespace', () => {
    expect(parseOutputFormat(' Markdown ')).toBe('markdown')
  })

  it('rejects unknown formats with CONFIG_INVALID instead of falling back', () => {
    const error = catchError(() => parseOutputFormat('yaml'))

    expect(error).toBeInstanceOf(WeiboSDKError)
    expect((error as WeiboSDKError).code).toBe('CONFIG_INVALID')
    expect((error as WeiboSDKError).context).toMatchObject({ field: 'format', value: 'yaml' })
  })
})

const value = { name: '甲', stats: { followers: 1 } }
const renderers = { markdown: (user: typeof value) => `# ${user.name}` }

describe('renderOutput', () => {
  it('pretty prints JSON with two-space indentation', () => {
    expect(renderOutput(value, 'json', renderers)).toBe(JSON.stringify(value, null, 2))
  })

  it('delegates other formats to the command renderer', () => {
    expect(renderOutput(value, 'markdown', renderers)).toBe('# 甲')
  })
})

describe('createPrinter', () => {
  it('parses the format once and prints through the given renderer', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    createPrinter({ format: 'markdown' })(value, renderers)

    expect(log).toHaveBeenCalledWith('# 甲')
    log.mockRestore()
  })

  it('fails before any work when the format is unknown', () => {
    expect(() => createPrinter({ format: 'yaml' })).toThrow(WeiboSDKError)
  })
})
