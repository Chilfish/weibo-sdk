// tests/capture/cdp.test.ts — CDP 客户端（注入式传输层，离线可测）
import { describe, expect, it, vi } from 'vitest'
import { CDP } from '../../capture/src/cdp'

function makeCDP() {
  const sent: Array<{ id: number, method: string, params: Record<string, unknown> }> = []
  const cdp = new CDP(text => sent.push(JSON.parse(text)))
  return { cdp, sent }
}

describe('cDP', () => {
  it('send 递增 id 并序列化方法/参数', () => {
    const { cdp, sent } = makeCDP()
    cdp.send('Page.enable')
    cdp.send('Network.setCookies', { cookies: [{ name: 'a' }] })
    expect(sent[0]).toEqual({ id: 1, method: 'Page.enable', params: {} })
    expect(sent[1]).toEqual({ id: 2, method: 'Network.setCookies', params: { cookies: [{ name: 'a' }] } })
  })

  it('dispatch 按 id 解决 pending', async () => {
    const { cdp } = makeCDP()
    const p = cdp.send('Network.enable')
    cdp.dispatch({ id: 1, result: { ok: true } })
    await expect(p).resolves.toEqual({ ok: true })
  })

  it('dispatch error 拒绝 pending', async () => {
    const { cdp } = makeCDP()
    const p = cdp.send('Page.navigate')
    cdp.dispatch({ id: 1, error: { message: 'boom' } })
    await expect(p).rejects.toThrow('boom')
  })

  it('on 只触发匹配方法的事件', () => {
    const { cdp } = makeCDP()
    const fn = vi.fn()
    cdp.on('Network.responseReceived', fn)
    cdp.dispatch({ method: 'Network.responseReceived', params: { a: 1 } })
    cdp.dispatch({ method: 'Other', params: { b: 2 } })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('Network.responseReceived', { a: 1 })
  })
})
