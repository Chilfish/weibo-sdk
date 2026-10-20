import { describe, expect, it } from 'vitest'
import { parsePositiveInt } from '~/cli/parseArgs'

describe('parsePositiveInt', () => {
  it('parses positive integers and floors decimals', () => {
    expect(parsePositiveInt('1')).toBe(1)
    expect(parsePositiveInt('20')).toBe(20)
    expect(parsePositiveInt('2.9')).toBe(2)
  })

  it('returns undefined for values upstream would reject', () => {
    expect(parsePositiveInt('0')).toBeUndefined()
    expect(parsePositiveInt('-1')).toBeUndefined()
    expect(parsePositiveInt('abc')).toBeUndefined()
    expect(parsePositiveInt('')).toBeUndefined()
    expect(parsePositiveInt(undefined)).toBeUndefined()
  })
})
