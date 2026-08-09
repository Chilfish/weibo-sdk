import type { ChildProcess } from 'node:child_process'
// capture/src/chrome.ts — Chrome 启动 / 端口探测 / endpoint 就绪等待
import { spawn } from 'node:child_process'

export interface ChromeOptions {
  port: number
  profileDir: string
  headless: boolean
}

/** 构建 Chrome 启动参数（纯函数，便于测试） */
export function buildChromeArgs(opts: ChromeOptions): string[] {
  const args = [
    `--remote-debugging-port=${opts.port}`,
    `--user-data-dir=${opts.profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    'about:blank',
  ]
  if (opts.headless)
    args.unshift('--headless=new')
  return args
}

/** 启动 Chrome，stdio 忽略（不污染 stdout），隐藏窗口 */
export function spawnChrome(chromePath: string, args: string[]): ChildProcess {
  return spawn(chromePath, args, { stdio: 'ignore', windowsHide: true })
}

export type IsFree = (port: number) => Promise<boolean>

async function defaultIsFree(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/json/version`)
    return false // 有响应 = 端口被占用
  }
  catch {
    return true // 连接拒绝 = 端口空闲
  }
}

/** 从起点起找第一个空闲端口（默认探 10 个） */
export async function findFreePort(from: number, isFree: IsFree = defaultIsFree): Promise<number> {
  for (let p = from; p < from + 10; p++) {
    if (await isFree(p))
      return p
  }
  return from
}

/** 轮询等待 CDP endpoint 就绪（端口从空闲变为可连接） */
export async function waitForEndpoint(port: number, isFree: IsFree = defaultIsFree, tries = 60, delay = 250): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (!(await isFree(port)))
      return
    await new Promise(r => setTimeout(r, delay))
  }
  throw new Error(`CDP endpoint 未就绪 (:${port})，Chrome 可能启动失败或端口被占`)
}
