import { describe, expect, it } from 'vitest'
import { stripVolatileKeys } from '~/utils/structure'

describe('stripVolatileKeys', () => {
  it('keeps key paths and replaces values with type placeholders', () => {
    const input = {
      id: '123',
      count: 42,
      visible: true,
      nested: { name: 'x', values: [1, 2, 3] },
      empty: [],
      nothing: null,
    }

    expect(stripVolatileKeys(input)).toEqual({
      id: '<STR>',
      count: '<NUM>',
      visible: '<BOOL>',
      nested: { name: '<STR>', values: ['<NUM>'] },
      empty: [],
      nothing: null,
    })
  })

  it('ignores value changes but detects field or type changes', () => {
    const before = stripVolatileKeys({ id: 'a', text: 'hello', count: 1 })
    const sameShape = stripVolatileKeys({ id: 'b', text: 'world', count: 999 })
    const renamed = stripVolatileKeys({ id: 'a', content: 'hello', count: 1 })
    const retyped = stripVolatileKeys({ id: 'a', text: 'hello', count: '1' })

    expect(sameShape).toEqual(before)
    expect(renamed).not.toEqual(before)
    expect(retyped).not.toEqual(before)
  })
})
