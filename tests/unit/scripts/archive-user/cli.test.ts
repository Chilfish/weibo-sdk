import { describe, expect, it } from 'vitest'
import { isHelpRequested, parseCli } from '../../../../scripts/archive-user/cli'

describe('parseCli', () => {
  it('uidPositional_defaultsCommentOrderAndBooleanFlags', () => {
    const { values, positionals, provided } = parseCli(['1234567890'])

    expect(positionals).toEqual(['1234567890'])
    expect(values['comment-order']).toBe('time')
    expect(values.force).toBe(false)
    expect(values.fresh).toBe(false)
    expect(values['no-comments']).toBe(false)
    expect(provided.size).toBe(0)
  })

  it('explicitOptions_areRecordedInProvided', () => {
    const { values, provided } = parseCli([
      '1234567890',
      '--since',
      '2025-01-01',
      '--no-comments',
      '-o',
      'out.json',
    ])

    expect(values.since).toBe('2025-01-01')
    expect(values['no-comments']).toBe(true)
    expect(values.out).toBe('out.json')
    expect(provided).toEqual(new Set(['since', 'no-comments', 'out']))
  })

  it('unknownOption_throws', () => {
    expect(() => parseCli(['123', '--nope'])).toThrow()
  })

  it('helpDetection_acceptsLongAndShortForm', () => {
    expect(isHelpRequested(['--help'])).toBe(true)
    expect(isHelpRequested(['-h'])).toBe(true)
    expect(isHelpRequested(['--since', '2025-01-01'])).toBe(false)
  })
})
