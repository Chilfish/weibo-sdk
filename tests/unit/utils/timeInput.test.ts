import { describe, expect, it } from 'vitest'
import { InvalidConfigError } from '~/models/errors/ConfigError'
import { resolveTimeInput } from '~/utils/timeInput'

/** 期望值用本地时区构造，保持测试与运行环境 TZ 无关 */
function atLocal(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): number {
  return Math.floor(new Date(year, month - 1, day, hour, minute, second, ms).getTime() / 1000)
}

describe('resolveTimeInput', () => {
  it('converts YYYY-MM-DD to the start of that local day by default', () => {
    expect(resolveTimeInput('2026-10-13')).toBe(atLocal(2026, 10, 13))
  })

  it('converts YYYY-MM-DD to the end of that local day for boundary=end', () => {
    expect(resolveTimeInput('2026-10-13', { boundary: 'end' })).toBe(atLocal(2026, 10, 13, 23, 59, 59, 999))
  })

  it('accepts compact YYYYMMDD dates', () => {
    expect(resolveTimeInput('20261013')).toBe(atLocal(2026, 10, 13))
    expect(resolveTimeInput('20261013', { boundary: 'end' })).toBe(atLocal(2026, 10, 13, 23, 59, 59, 999))
  })

  it('passes unix seconds through unchanged', () => {
    expect(resolveTimeInput(1791820800)).toBe(1791820800)
    expect(resolveTimeInput('1791820800')).toBe(1791820800)
    expect(resolveTimeInput(0)).toBe(0)
  })

  it('floors fractional unix seconds', () => {
    expect(resolveTimeInput(1791820800.9)).toBe(1791820800)
  })

  it('rejects invalid calendar dates instead of rolling over', () => {
    expect(() => resolveTimeInput('2026-02-30')).toThrowError(/not a valid calendar date/)
    expect(() => resolveTimeInput('2026-13-01')).toThrowError(/not a valid calendar date/)
  })

  it('rejects empty and unrecognized strings', () => {
    expect(() => resolveTimeInput('')).toThrowError(InvalidConfigError)
    expect(() => resolveTimeInput('   ')).toThrowError(InvalidConfigError)
    expect(() => resolveTimeInput('last week')).toThrowError(InvalidConfigError)
    expect(() => resolveTimeInput('2026/10/13')).toThrowError(InvalidConfigError)
  })

  it('rejects negative or non-finite unix seconds', () => {
    expect(() => resolveTimeInput(-1)).toThrowError(InvalidConfigError)
    expect(() => resolveTimeInput(Number.NaN)).toThrowError(InvalidConfigError)
    expect(() => resolveTimeInput(Number.POSITIVE_INFINITY)).toThrowError(InvalidConfigError)
  })

  it('exposes CONFIG_INVALID with field context', () => {
    try {
      resolveTimeInput('2026-02-30', { field: 'starttime' })
      throw new Error('expected resolveTimeInput to throw')
    }
    catch (error) {
      expect(error).toBeInstanceOf(InvalidConfigError)
      expect((error as InvalidConfigError).code).toBe('CONFIG_INVALID')
      expect((error as InvalidConfigError).context).toMatchObject({ field: 'starttime', value: '2026-02-30' })
    }
  })
})
