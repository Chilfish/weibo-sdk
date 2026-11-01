import { describe, expect, it } from 'vitest'
import { main } from '~/cli'
import { assertKnownFlags } from '~/cli/validateArgs'

/** 断言抛出的 `CONFIG_INVALID`（未知参数检查的唯一出口）。 */
async function expectInvalid(argv: string[]): Promise<Record<string, unknown>> {
  try {
    await assertKnownFlags(main, argv)
  }
  catch (error) {
    expect(error).toMatchObject({ code: 'CONFIG_INVALID', retryable: false })
    return (error as { context?: Record<string, unknown> }).context ?? {}
  }
  throw new Error(`expected ${argv.join(' ')} to be rejected`)
}

describe('assertKnownFlags', () => {
  it('accepts every flag a leaf command declares, including aliases and values', async () => {
    await expect(assertKnownFlags(main, [
      'tweet',
      'comments-stream',
      'MB001',
      '--guest',
      '--max-items',
      '2',
      '--max-pages=3',
    ])).resolves.toBeUndefined()

    // `-f` 是 `--format` 的别名（只有声明了 outputFormatArg 的命令才有）
    await expect(assertKnownFlags(main, ['tweet', 'comments', 'MB001', '-f', 'json']))
      .resolves
      .toBeUndefined()
  })

  it('accepts --no-* variants of boolean flags', async () => {
    await expect(assertKnownFlags(main, ['archive', 'user', '123', '--no-comments', '--no-replies']))
      .resolves
      .toBeUndefined()
  })

  it('rejects a misspelled flag and suggests the declared one', async () => {
    const context = await expectInvalid(['tweet', 'comments-stream', 'MB001', '--max-item', '2'])
    expect(context.suggestion).toBe('max-items')
    expect(context.command).toBe('weibo-cli tweet comments-stream')
  })

  it('rejects an unknown flag instead of letting it fall back to auto', async () => {
    // `--gust` 以前会被静默忽略，然后退回 auto 读取 .env 里的 Cookie。
    const context = await expectInvalid(['whoami', '--gust'])
    expect(context.suggestion).toBe('guest')
  })

  it('rejects a flag placed before its subcommand', async () => {
    const context = await expectInvalid(['--guest', 'whoami'])
    expect(context.next).toContain('子命令')
  })

  it('keeps builtin help / version flags', async () => {
    await expect(assertKnownFlags(main, ['--help'])).resolves.toBeUndefined()
    await expect(assertKnownFlags(main, ['tweet', 'detail', '-h'])).resolves.toBeUndefined()
    await expect(assertKnownFlags(main, ['--version'])).resolves.toBeUndefined()
  })

  it('does not treat the value of a string flag as a flag', async () => {
    await expect(assertKnownFlags(main, ['tweet', 'reposts', 'MB001', '--page', '-1']))
      .resolves
      .toBeUndefined()
  })

  it('ignores everything after a literal --', async () => {
    await expect(assertKnownFlags(main, ['tweet', 'detail', 'MB001', '--', '--not-a-flag']))
      .resolves
      .toBeUndefined()
  })
})
