import type { IWeiboConfig, WeiboSDK } from '@chilfish/weibo-sdk'

/** `node:util` parseArgs 的轻量包装结果。 */
export interface ParsedArgs {
  positionals: string[]
  flags: Record<string, string | boolean | string[]>
}

/** 与仓库路径相关的只读上下文。 */
export interface PlaygroundPaths {
  /** 仓库根目录 */
  root: string
  /** `playground/` 目录 */
  playground: string
  /** `playground/output/`（示例产物、checkpoint、媒体下载） */
  output: string
}

/** 加载后的 `.env` 与命中文件。 */
export interface PlaygroundEnv {
  values: Record<string, string>
  /** 最终生效的 `.env`（用于 CLI 的 `--env-file`）。 */
  envFile?: string
  /** 检查过的候选路径，用于错误提示。 */
  checkedFiles: string[]
}

/** 控制台输出接口，避免示例直接依赖具体实现。 */
export interface PlaygroundLog {
  heading: (text: string) => void
  step: (text: string) => void
  info: (text: string) => void
  warn: (text: string) => void
  error: (text: string) => void
  kv: (key: string, value: unknown) => void
  json: (value: unknown) => void
  progress: (label: string, processed: number, total?: number) => void
}

export interface SdkScenarioContext {
  /** 默认 SDK（Cookie 来自 `.env` / `--cookie`）。 */
  sdk: WeiboSDK
  /** 需要自定义配置（hooks / telemetry / selfCheck）时再建一个实例。 */
  createSDK: (overrides?: Partial<IWeiboConfig>) => WeiboSDK
  args: ParsedArgs
  env: PlaygroundEnv
  paths: PlaygroundPaths
  log: PlaygroundLog
}

export interface SdkScenario {
  kind: 'sdk'
  id: string
  title: string
  summary: string
  usage: string
  /** 默认 true；纯离线示例设为 false（使用占位 Cookie，且 selfCheck=none）。 */
  requiresCookie?: boolean
  run: (ctx: SdkScenarioContext) => Promise<void>
}

export interface CliStep {
  /** 传给 `weibo-cli` 的参数（不含二进制名与自动注入的 --env-file）。 */
  argv: string[]
  note?: string
  /** 是否注入 Cookie 配置；默认跟随场景的 requiresCookie。 */
  auth?: boolean
  /** 非零退出码是否继续后续步骤。 */
  allowFailure?: boolean
}

export interface CliScenarioContext {
  args: ParsedArgs
  env: PlaygroundEnv
  paths: PlaygroundPaths
  log: PlaygroundLog
}

export interface CliScenario {
  kind: 'cli'
  id: string
  title: string
  summary: string
  requiresCookie?: boolean
  steps: (ctx: CliScenarioContext) => CliStep[]
}

export type Scenario = SdkScenario | CliScenario
