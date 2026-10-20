import { describe, expect, it } from 'vitest'
import { mediaImages } from '~/cli/commands/media'
import { tweetCommentsStream, tweetHomeStream, tweetLikersStream } from '~/cli/commands/tweet'
import { userTimelineStream } from '~/cli/commands/user'
import { streamRangeFromArgs } from '~/cli/shared'

describe('stream range CLI args', () => {
  it('parses --max-items / --since / --until', () => {
    expect(streamRangeFromArgs({
      'max-items': '3',
      'since': '2026-10-01',
      'until': '2026-10-20',
    })).toEqual({ maxItems: 3, since: '2026-10-01', until: '2026-10-20' })
  })

  it('leaves absent or blank flags undefined', () => {
    expect(streamRangeFromArgs({})).toEqual({
      maxItems: undefined,
      since: undefined,
      until: undefined,
    })
    expect(streamRangeFromArgs({ 'max-items': '', 'since': '  ', 'until': '' })).toEqual({
      maxItems: undefined,
      since: undefined,
      until: undefined,
    })
  })

  it('exposes the flags on time-ordered stream commands', () => {
    expect((tweetHomeStream as any).args['max-items']).toBeDefined()
    expect((tweetHomeStream as any).args.since).toBeDefined()
    expect((tweetHomeStream as any).args.until).toBeDefined()
    expect((userTimelineStream as any).args.since).toBeDefined()
  })

  it('exposes only --max-items on streams without a reliable timestamp', () => {
    expect((tweetCommentsStream as any).args['max-items']).toBeDefined()
    expect((tweetCommentsStream as any).args.since).toBeUndefined()
    expect((tweetLikersStream as any).args['max-items']).toBeDefined()
    expect((mediaImages as any).args['max-items']).toBeDefined()
    expect((mediaImages as any).args.since).toBeUndefined()
  })
})
