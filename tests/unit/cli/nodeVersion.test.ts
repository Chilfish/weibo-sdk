import { describe, expect, it } from 'vitest'
import { isSupportedNodeVersion, MIN_NODE_VERSION, nodeVersionError } from '~/cli/nodeVersion'

describe('isSupportedNodeVersion', () => {
  it('accepts the floor and anything above it', () => {
    expect(MIN_NODE_VERSION).toEqual([20, 16])
    expect(isSupportedNodeVersion('20.16.0')).toBe(true)
    expect(isSupportedNodeVersion('20.16.1')).toBe(true)
    expect(isSupportedNodeVersion('20.17.0')).toBe(true)
    expect(isSupportedNodeVersion('22.23.4')).toBe(true)
    expect(isSupportedNodeVersion('24.0.0')).toBe(true)
  })

  it('rejects older minors and older majors', () => {
    expect(isSupportedNodeVersion('20.15.1')).toBe(false)
    expect(isSupportedNodeVersion('18.19.1')).toBe(false)
    expect(isSupportedNodeVersion('16.20.2')).toBe(false)
  })
})

describe('nodeVersionError', () => {
  it('states the requirement, the current version and where to upgrade', () => {
    const message = nodeVersionError('18.19.1')
    expect(message).toContain('requires Node >= 20.16')
    expect(message).toContain('current: v18.19.1')
    expect(message).toContain('https://nodejs.org/')
  })
})
