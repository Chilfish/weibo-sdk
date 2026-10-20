import { describe, expect, it } from 'vitest'
import { resolveArchiveIncludeFlags } from '~/cli/shared'

describe('resolveArchiveIncludeFlags', () => {
  it('enables all archive phases by default', () => {
    expect(resolveArchiveIncludeFlags({})).toEqual({
      includeReposts: true,
      includeFavorites: true,
      includeDateSlices: true,
    })
  })

  it('honors citty --no-* negation (flag set to false)', () => {
    expect(resolveArchiveIncludeFlags({
      'reposts': false,
      'favorites': false,
      'date-slices': false,
    })).toEqual({
      includeReposts: false,
      includeFavorites: false,
      includeDateSlices: false,
    })
  })

  it('keeps untouched phases enabled when only one negative flag is passed', () => {
    expect(resolveArchiveIncludeFlags({ reposts: false })).toEqual({
      includeReposts: false,
      includeFavorites: true,
      includeDateSlices: true,
    })
  })

  it('disables favorites by default in batch mode', () => {
    expect(resolveArchiveIncludeFlags({}, { batch: true })).toEqual({
      includeReposts: true,
      includeFavorites: false,
      includeDateSlices: true,
    })
  })

  it('honors an explicit favorites flag in batch mode', () => {
    expect(resolveArchiveIncludeFlags({ favorites: true }, { batch: true })).toEqual({
      includeReposts: true,
      includeFavorites: true,
      includeDateSlices: true,
    })
  })
})
