import { describe, expect, it } from 'vitest'
import { DAY_SECONDS } from '../../../../scripts/archive-user/constants'
import { planSlices } from '../../../../scripts/archive-user/slices'

describe('planSlices', () => {
  it('sliceDaysZero_returnsSingleFullRange', () => {
    const slices = planSlices(0, DAY_SECONDS * 10, 0)
    expect(slices).toEqual([
      { index: 0, key: `s000-0-${DAY_SECONDS * 10}`, since: 0, until: DAY_SECONDS * 10 },
    ])
  })

  it('rangeShorterThanChunk_returnsSingleSlice', () => {
    const slices = planSlices(0, DAY_SECONDS - 1, 30)
    expect(slices).toHaveLength(1)
  })

  it('multiChunk_coversRangeWithoutGapsOrOverlap', () => {
    const since = 1000
    const until = since + DAY_SECONDS * 70 + 123
    const slices = planSlices(since, until, 30)

    expect(slices[0].since).toBe(since)
    expect(slices.at(-1)!.until).toBe(until)
    for (let i = 1; i < slices.length; i++) {
      expect(slices[i].since).toBe(slices[i - 1].until + 1)
    }
  })

  it('exactMultiple_keepsLastSlicesBoundaries', () => {
    const since = 0
    const until = DAY_SECONDS * 60 - 1
    const slices = planSlices(since, until, 30)

    expect(slices).toHaveLength(2)
    expect(slices[1]).toMatchObject({ index: 1, since: DAY_SECONDS * 30, until })
  })

  it('keysAreStableAndZeroPadded', () => {
    const slices = planSlices(0, DAY_SECONDS * 90 - 1, 30)
    expect(slices.map(slice => slice.key)).toEqual([
      `s000-0-${DAY_SECONDS * 30 - 1}`,
      `s001-${DAY_SECONDS * 30}-${DAY_SECONDS * 60 - 1}`,
      `s002-${DAY_SECONDS * 60}-${DAY_SECONDS * 90 - 1}`,
    ])
  })
})
