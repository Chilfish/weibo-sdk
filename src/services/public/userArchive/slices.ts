import type { UserArchiveSlice } from '~/types/archive/IUserArchive'

const DAY_SECONDS = 24 * 60 * 60

/** 把 [since, until] 切成连续、无重叠、无空洞的固定窗口；0 表示不拆分。 */
export function planUserArchiveSlices(since: number, until: number, sliceDays: number): UserArchiveSlice[] {
  const chunk = sliceDays * DAY_SECONDS
  if (sliceDays <= 0 || until - since + 1 <= chunk)
    return [{ index: 0, key: `s000-${since}-${until}`, since, until }]

  const slices: UserArchiveSlice[] = []
  for (let start = since; start <= until; start += chunk) {
    const end = Math.min(until, start + chunk - 1)
    const index = slices.length
    slices.push({
      index,
      key: `s${String(index).padStart(3, '0')}-${start}-${end}`,
      since: start,
      until: end,
    })
  }
  return slices
}
