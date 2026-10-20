import { describe, expect, it, vi } from 'vitest'

import { tweetComments } from '~/cli/commands/tweet'

const mocks = vi.hoisted(() => {
  const calls: Array<[unknown, unknown]> = []
  return {
    calls,
    comments: async (...args: [unknown, unknown]) => {
      calls.push(args)
      return { ok: 1, data: [] }
    },
  }
})

vi.mock('~/cli/shared', () => ({
  cookieArg: {},
  createSDK: () => ({ tweets: { comments: mocks.comments } }),
}))

describe('tweet comments CLI args', () => {
  it('declares --max-id so raw pagination is not silently ignored', () => {
    expect((tweetComments as any).args['max-id']).toBeDefined()
  })

  it('forwards --max-id as max_id', async () => {
    mocks.calls.length = 0
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await (tweetComments as any).run({ args: { 'id': 'M1', 'max-id': '5356107262329915' } })

    log.mockRestore()
    expect(mocks.calls).toEqual([['M1', { max_id: 5356107262329915, count: undefined, flow: undefined }]])
  })

  it('omits max_id when the flag is absent', async () => {
    mocks.calls.length = 0
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await (tweetComments as any).run({ args: { id: 'M1' } })

    log.mockRestore()
    expect(mocks.calls).toEqual([['M1', { max_id: undefined, count: undefined, flow: undefined }]])
  })
})
