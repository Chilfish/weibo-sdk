import { describe, expect, it } from 'vitest'
import {
  createEmptyArchiveState,
  incrementalOptionsFromState,
  parseArchiveState,
  updateArchiveState,
} from '~/utils/archiveState'

describe('archiveState', () => {
  it('parses valid state and ignores malformed entries', () => {
    const state = parseArchiveState({
      version: 1,
      updatedAt: '2026-10-20T00:00:00.000Z',
      users: {
        111: { lastMblogId: 'A', lastCreatedAt: 'Mon Oct 19 12:00:00 +0800 2026', lastRunAt: '2026-10-20T00:00:00.000Z' },
        222: { lastMblogId: 123 },
        333: 'bad',
      },
    })

    expect(state.version).toBe(1)
    expect(state.users['111'].lastMblogId).toBe('A')
    expect(state.users['222']).toEqual({})
    expect(state.users['333']).toBeUndefined()
  })

  it('falls back to empty state for non-object input', () => {
    expect(parseArchiveState(null)).toEqual(createEmptyArchiveState())
    expect(parseArchiveState('bad')).toEqual(createEmptyArchiveState())
  })

  it('updates state immutably and skips mblogId for media items', () => {
    const base = createEmptyArchiveState()
    const now = new Date('2026-10-20T08:00:00.000Z')

    const next = updateArchiveState(base, '111', {
      mblogId: 'A',
      tweet: { createdAt: 'Mon Oct 19 12:00:00 +0800 2026' } as any,
    }, now)

    expect(base.users['111']).toBeUndefined()
    expect(next.users['111']).toMatchObject({
      lastMblogId: 'A',
      lastCreatedAt: 'Mon Oct 19 12:00:00 +0800 2026',
      lastRunAt: now.toISOString(),
    })
    expect(next.updatedAt).toBe(now.toISOString())

    const media = updateArchiveState(next, '111', { mblogId: undefined, tweet: undefined }, now)
    expect(media.users['111'].lastMblogId).toBe('A')
  })

  it('derives incremental options from last mblogId and createdAt', () => {
    const state = parseArchiveState({
      users: {
        111: { lastMblogId: 'A', lastCreatedAt: 'Mon Oct 19 12:00:00 +0800 2026' },
        222: { lastCreatedAt: 'Mon Oct 19 12:00:00 +0800 2026' },
        333: {},
      },
    })

    expect(incrementalOptionsFromState(state, '111')).toEqual({
      stopAtMblogId: 'A',
      since: Math.floor(Date.parse('Mon Oct 19 12:00:00 +0800 2026') / 1000),
    })
    expect(incrementalOptionsFromState(state, '222')).toEqual({
      since: Math.floor(Date.parse('Mon Oct 19 12:00:00 +0800 2026') / 1000),
    })
    expect(incrementalOptionsFromState(state, '333')).toBeUndefined()
    expect(incrementalOptionsFromState(state, '999')).toBeUndefined()
  })
})
