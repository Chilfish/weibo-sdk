import { describe, expect, it } from 'vitest'
import { diffSchemaDigest, formatSchemaDrift } from '~/utils/schemaDrift'

describe('schemaDrift', () => {
  it('reports added, removed, and type-changed fields', () => {
    const before = {
      id: '<NUM>',
      mblogid: '<STR>',
      user: { id: '<NUM>', name: '<STR>', legacy: '<BOOL>' },
      tags: [{ name: '<STR>' }],
    }
    const after = {
      id: '<STR>',
      mblogid: '<STR>',
      user: { id: '<NUM>', name: '<STR>', newField: '<NUM>' },
      tags: [{ name: '<STR>', color: '<STR>' }],
    }

    expect(diffSchemaDigest(before, after)).toEqual([
      { path: '$.id', kind: 'type_changed', before: '<NUM>', after: '<STR>' },
      { path: '$.user.legacy', kind: 'removed', before: '<BOOL>' },
      { path: '$.user.newField', kind: 'added', after: '<NUM>' },
      { path: '$.tags[0].color', kind: 'added', after: '<STR>' },
    ])
  })

  it('detects numeric vs string placeholder changes', () => {
    expect(diffSchemaDigest({ id: '<NUM>' }, { id: '<STR>' })).toEqual([
      { path: '$.id', kind: 'type_changed', before: '<NUM>', after: '<STR>' },
    ])
  })

  it('returns no changes for identical digests', () => {
    const digest = { a: '<STR>', b: [{ c: '<NUM>' }] }
    expect(diffSchemaDigest(digest, structuredClone(digest))).toEqual([])
    expect(formatSchemaDrift([])).toBe('No structural changes.')
  })

  it('formats a readable report', () => {
    const report = formatSchemaDrift([
      { path: '$.a', kind: 'added', after: '<STR>' },
      { path: '$.b', kind: 'removed', before: '<NUM>' },
      { path: '$.c', kind: 'type_changed', before: '<NUM>', after: '<STR>' },
    ])

    expect(report).toContain('Added: 1, Removed: 1, Changed: 1')
    expect(report).toContain('+ $.a (<STR>)')
    expect(report).toContain('- $.b (<NUM>)')
    expect(report).toContain('~ $.c: <NUM> -> <STR>')
  })
})
