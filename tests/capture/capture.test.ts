import type { CaptureDeps } from '../../capture/src/capture'
// tests/capture/capture.test.ts — capture 编排（注入 fake chrome/cdp，全离线）
import { afterEach, describe, expect, it, vi } from 'vitest'
import { capture } from '../../capture/src/capture'
import { CDP } from '../../capture/src/cdp'

/** 自动响应传输层：sendRaw 收集命令，按 method 返回预设响应（微任务 dispatch，避开循环引用） */
function makeTransport() {
  const responses: Record<string, unknown> = {}
  const sent: Array<{ id: number, method: string, params: Record<string, unknown> }> = []
  const cdp = new CDP((text) => {
    const msg = JSON.parse(text) as { id: number, method: string, params: Record<string, unknown> }
    sent.push(msg)
    const res = responses[msg.method] ?? {}
    Promise.resolve().then(() => cdp.dispatch({ id: msg.id, result: res }))
  })
  return {
    cdp,
    sent,
    setResponse: (method: string, res: unknown) => { responses[method] = res },
  }
}

function makeDeps(t: ReturnType<typeof makeTransport>) {
  const deps = {
    findFreePort: async () => 9222,
    spawnChrome: vi.fn<(path: string, args: string[]) => ReturnType<typeof import('../../capture/src/chrome').spawnChrome>>(
      () => ({ kill: () => {} }) as unknown as ReturnType<typeof import('../../capture/src/chrome').spawnChrome>,
    ),
    waitForEndpoint: async () => {},
    getPageWsUrl: async () => 'ws://fake',
    connect: async () => ({ cdp: t.cdp, close: () => {} }),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  } satisfies CaptureDeps
  return deps as Required<CaptureDeps>
}

/** 刷新微任务队列，让 capture 推进到 sleep 挂起点 */
async function flush() {
  for (let i = 0; i < 30; i++)
    await Promise.resolve()
}

afterEach(() => {
  vi.useRealTimers()
})

describe('capture', () => {
  it('收集 ok:1 响应并落盘 + 写 _index', async () => {
    vi.useFakeTimers()
    const t = makeTransport()
    const deps = makeDeps(t)
    t.setResponse('Network.getResponseBody', { body: '{"ok":1,"data":{"list":[1]}}' })

    const p = capture({ uid: '123', cookie: 'SUB=abc', seconds: 3, outDir: 'out' }, deps)
    await flush() // 推进到 sleep 挂起
    t.cdp.dispatch({
      method: 'Network.responseReceived',
      params: { requestId: 'r1', response: { url: 'https://weibo.com/ajax/profile/info?uid=123', status: 200, mimeType: 'application/json' } },
    })
    await vi.advanceTimersByTimeAsync(3000)
    await flush()
    const items = await p

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ url: expect.stringContaining('profile/info'), status: 200, ok: 1 })
    expect(items[0].json).toEqual({ ok: 1, data: { list: [1] } })
    expect(deps.writeFile).toHaveBeenCalledWith(expect.stringContaining('001_ajax_profile_info_u123.json'), expect.stringContaining('"ok":1'))
    expect(deps.writeFile).toHaveBeenCalledWith(expect.stringContaining('_index.json'), expect.stringContaining('profile/info'))
    expect(deps.spawnChrome).toHaveBeenCalledOnce()
  })

  it('跳过业务失败（ok:-100）', async () => {
    vi.useFakeTimers()
    const t = makeTransport()
    const deps = makeDeps(t)
    t.setResponse('Network.getResponseBody', { body: '{"ok":-100,"msg":"风控"}' })

    const p = capture({ uid: '1', cookie: 'SUB=abc', seconds: 2, outDir: 'out' }, deps)
    await flush()
    t.cdp.dispatch({ method: 'Network.responseReceived', params: { requestId: 'r1', response: { url: 'https://weibo.com/ajax/band', status: 200 } } })
    await vi.advanceTimersByTimeAsync(2000)
    await flush()
    const items = await p

    expect(items).toHaveLength(0)
    expect(deps.writeFile).not.toHaveBeenCalledWith(expect.stringContaining('_index'), expect.anything())
  })

  it('跳过非 JSON 响应体', async () => {
    vi.useFakeTimers()
    const t = makeTransport()
    const deps = makeDeps(t)
    t.setResponse('Network.getResponseBody', { body: '<!DOCTYPE html><html>' })

    const p = capture({ uid: '1', cookie: 'SUB=abc', seconds: 1 }, deps)
    await flush()
    t.cdp.dispatch({ method: 'Network.responseReceived', params: { requestId: 'r1', response: { url: 'https://weibo.com/ajax/x', status: 200 } } })
    await vi.advanceTimersByTimeAsync(1000)
    await flush()
    const items = await p

    expect(items).toHaveLength(0)
  })

  it('缺 cookie 抛错（不启动 Chrome）', async () => {
    await expect(capture({ uid: '1', cookie: '' })).rejects.toThrow('WEIBO_COOKIE')
  })
})
