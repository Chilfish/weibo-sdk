// tests/capture/cookie.test.ts — parseCookies 纯函数
import { describe, expect, it } from 'vitest'
import { parseCookies } from '../../capture/src/cookie'

describe('parseCookies', () => {
  it('拆分多 cookie 并注入 domain/path', () => {
    const r = parseCookies('SUB=abc123; SCF=x', '.weibo.com')
    expect(r).toHaveLength(2)
    expect(r[0]).toEqual({ name: 'SUB', value: 'abc123', domain: '.weibo.com', path: '/' })
    expect(r[1]).toEqual({ name: 'SCF', value: 'x', domain: '.weibo.com', path: '/' })
  })

  it('忽略空段与前后空白', () => {
    const r = parseCookies('  a=1 ; ; b=2  ', '.weibo.cn')
    expect(r).toHaveLength(2)
    expect(r.map(x => x.name)).toEqual(['a', 'b'])
  })

  it('值内含 = 时只切第一个分隔符', () => {
    const r = parseCookies('SUB=a=b=c', '.weibo.com')
    expect(r[0]).toEqual({ name: 'SUB', value: 'a=b=c', domain: '.weibo.com', path: '/' })
  })
})
