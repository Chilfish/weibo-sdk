import { describe, expect, it } from 'vitest'
import { FIXTURE_RULES, isValidationPass, listFixtureFiles, validateFixtures } from '../../../scripts/validate-fixtures'

describe('offline fixture contract regression (E5 / P0-5)', () => {
  it('every fixture file on disk is registered in FIXTURE_RULES', () => {
    const files = listFixtureFiles()
    const unregistered = files.filter(f => !FIXTURE_RULES[f])
    expect(unregistered).toEqual([])
  })

  it('every FIXTURE_RULES entry matches a file on disk', () => {
    const files = listFixtureFiles()
    const stale = Object.keys(FIXTURE_RULES).filter(f => !files.includes(f))
    expect(stale).toEqual([])
  })

  it('all mapped fixtures pass safeParse against their endpoint schema', () => {
    const results = validateFixtures()
    const failures = results.filter(r => r.status === 'fail')
    expect(failures.map(f => `${f.file} (${f.endpoint}): ${f.issues}`)).toEqual([])
    expect(isValidationPass(results)).toBe(true)
  })
})
