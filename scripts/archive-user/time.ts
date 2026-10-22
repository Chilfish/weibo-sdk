import type { ITweet } from '../../src/types/domain/ITweet'

export function parseCreatedAt(value: string): number | undefined {
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined
}

export function withinRange(tweet: ITweet, since: number, until: number): boolean {
  const seconds = parseCreatedAt(tweet.createdAt)
  if (seconds === undefined)
    return true
  return seconds >= since && seconds <= until
}
