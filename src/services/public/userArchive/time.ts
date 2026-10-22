import type { ITweet } from '~/types/domain/ITweet'

/** 解析上游 `created_at`（如 `Mon Oct 19 13:56:50 +0800 2026`）为 unix 秒。 */
export function parseArchiveCreatedAt(value: string): number | undefined {
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined
}

export function withinUserArchiveRange(tweet: ITweet, since: number, until: number): boolean {
  const seconds = parseArchiveCreatedAt(tweet.createdAt)
  if (seconds === undefined)
    return true
  return seconds >= since && seconds <= until
}
