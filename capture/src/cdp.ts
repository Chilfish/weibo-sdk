// capture/src/cdp.ts — 极简 CDP 客户端（Node 原生 WebSocket）
//
// 可测性设计：构造注入 `sendRaw(text)` 作为出站通道，测试用 `dispatch(msg)` 喂入站消息，
// 因此 id 匹配 / 事件分发 / 错误 reject 均可离线断言。

export interface CDPMessage {
  id?: number
  result?: any
  error?: { message: string }
  method?: string
  params?: Record<string, any>
}

export type CDPHandler = (method: string, params: Record<string, any>) => void

export class CDP {
  private readonly pending = new Map<number, { resolve: (v: any) => void, reject: (e: Error) => void }>()
  private readonly handlers: CDPHandler[] = []
  private id = 0

  constructor(private readonly sendRaw: (text: string) => void) {}

  /** 发送 CDP 命令并等待对应 id 的响应 */
  send<T = any>(method: string, params: Record<string, any> = {}): Promise<T> {
    const id = ++this.id
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.sendRaw(JSON.stringify({ id, method, params }))
    })
  }

  /** 分发一条收到的消息：id 命中 → 解决/拒绝 pending；有 method → 派发事件 */
  dispatch(msg: CDPMessage): void {
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id)
      if (p) {
        this.pending.delete(msg.id)
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
      }
    }
    else if (msg.method) {
      for (const h of this.handlers)
        h(msg.method, msg.params ?? {})
    }
  }

  on(method: string, handler: CDPHandler): void {
    this.handlers.push((m, p) => {
      if (m === method)
        handler(m, p)
    })
  }
}

export interface CDPConnection {
  cdp: CDP
  close: () => void
}

/** 通过原生 WebSocket 连接 CDP endpoint */
export function connect(wsUrl: string): Promise<CDPConnection> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const cdp = new CDP(text => ws.send(text))
    ws.onopen = () => resolve({ cdp, close: () => {
      try {
        ws.close()
      }
      catch { /* ignore */ }
    } })
    ws.onerror = e => reject(new Error(`CDP WebSocket error: ${e.message || ''}`))
    ws.onmessage = (ev) => {
      try {
        cdp.dispatch(JSON.parse(ev.data as string))
      }
      catch { /* 忽略无法解析的帧 */ }
    }
  })
}
