import type { WeiboTransport } from '../transport'
import type {
  BeforeRetryResult,
  ErrorContext,
  RequestContext,
  ResponseContext,
  RetryContext,
  WeiboEvent,
  WeiboPlugin,
} from './types'
import { InvalidConfigError } from '~/models/errors/ConfigError'

const ENFORCE_RANK: Record<NonNullable<WeiboPlugin['enforce']>, number> = {
  pre: 0,
  normal: 1,
  post: 2,
}

/** 插件管线：构造期编译为按 `pre → normal → post` 排序的钩子数组。 */
export interface PluginPipeline {
  readonly plugins: readonly WeiboPlugin[]
  /** 是否注册了任何行为钩子 / transport 中间件（observer 不计入）。 */
  readonly hasHooks: boolean
  /** 按顺序包装 transport；无中间件时返回原实现（identity）。 */
  wrapTransport: (base: WeiboTransport) => WeiboTransport
  beforeRequest: (context: RequestContext) => Promise<void>
  afterResponse: (context: ResponseContext) => Promise<void>
  beforeRetry: (context: RetryContext) => Promise<Required<BeforeRetryResult>>
  /** 返回可能被替换后的错误。 */
  onError: (context: ErrorContext) => Promise<unknown>
  /** 广播事件：同步调用、不 await、吞掉异常。 */
  observe: (event: WeiboEvent) => void
}

function noop(): void {}

function ignoreRejection(result: void | Promise<void>): void {
  if (result && typeof (result as Promise<void>).then === 'function')
    void (result as Promise<void>).catch(noop)
}

function assertPlugin(plugin: WeiboPlugin, index: number): void {
  if (!plugin || typeof plugin !== 'object') {
    throw new InvalidConfigError(`plugins[${index}] must be an object.`, {
      field: 'plugins',
      index,
    })
  }
  if (typeof plugin.name !== 'string' || plugin.name.trim() === '') {
    throw new InvalidConfigError(`plugins[${index}] must have a non-empty name.`, {
      field: 'plugins',
      index,
    })
  }
  if (plugin.apiVersion !== 1) {
    throw new InvalidConfigError(
      `Plugin "${plugin.name}" has unsupported apiVersion ${String(plugin.apiVersion)}; expected 1.`,
      { field: 'plugins', plugin: plugin.name, apiVersion: plugin.apiVersion },
    )
  }
}

function sortPlugins(plugins: readonly WeiboPlugin[]): WeiboPlugin[] {
  return [...plugins].sort((a, b) => {
    const rankA = ENFORCE_RANK[a.enforce ?? 'normal']
    const rankB = ENFORCE_RANK[b.enforce ?? 'normal']
    return rankA - rankB
  })
}

function validatePlugins(plugins: readonly WeiboPlugin[]): WeiboPlugin[] {
  const names = new Set<string>()
  plugins.forEach((plugin, index) => {
    assertPlugin(plugin, index)
    if (names.has(plugin.name)) {
      throw new InvalidConfigError(`Duplicate plugin name: "${plugin.name}".`, {
        field: 'plugins',
        plugin: plugin.name,
      })
    }
    names.add(plugin.name)
  })
  return sortPlugins(plugins)
}

const EMPTY_PIPELINE: PluginPipeline = {
  plugins: [],
  hasHooks: false,
  wrapTransport: base => base,
  async beforeRequest() {},
  async afterResponse() {},
  async beforeRetry(context) {
    return { retry: true, delayMs: context.delayMs }
  },
  async onError(context) {
    return context.error
  },
  observe() {},
}

/**
 * 编译插件管线。
 *
 * 空数组 / `undefined` 直接返回共享的 identity 管线，避免热路径额外分配。
 *
 * @throws `InvalidConfigError`（`CONFIG_INVALID`）重名、缺少 name 或 `apiVersion !== 1`
 */
export function createPluginPipeline(plugins?: readonly WeiboPlugin[]): PluginPipeline {
  if (!plugins || plugins.length === 0)
    return EMPTY_PIPELINE

  const ordered = validatePlugins(plugins)
  const beforeRequestHooks = ordered
    .map(plugin => plugin.hooks?.beforeRequest)
    .filter((hook): hook is NonNullable<typeof hook> => hook !== undefined)
  const afterResponseHooks = ordered
    .map(plugin => plugin.hooks?.afterResponse)
    .filter((hook): hook is NonNullable<typeof hook> => hook !== undefined)
  const beforeRetryHooks = ordered
    .map(plugin => plugin.hooks?.beforeRetry)
    .filter((hook): hook is NonNullable<typeof hook> => hook !== undefined)
  const onErrorHooks = ordered
    .map(plugin => plugin.hooks?.onError)
    .filter((hook): hook is NonNullable<typeof hook> => hook !== undefined)
  const transportMiddlewares = ordered
    .map(plugin => plugin.transport)
    .filter((middleware): middleware is NonNullable<typeof middleware> => middleware !== undefined)
  const observers = ordered
    .map(plugin => plugin.observe)
    .filter((observer): observer is NonNullable<typeof observer> => observer !== undefined)

  return {
    plugins: ordered,
    hasHooks: beforeRequestHooks.length > 0
      || afterResponseHooks.length > 0
      || beforeRetryHooks.length > 0
      || onErrorHooks.length > 0
      || transportMiddlewares.length > 0,
    wrapTransport(base) {
      if (transportMiddlewares.length === 0)
        return base
      // reduceRight：排序靠前的插件位于最外层，请求进入顺序与 hooks 一致（pre → normal → post）
      return transportMiddlewares.reduceRight<WeiboTransport>(
        (next, middleware) => middleware(next),
        base,
      )
    },
    async beforeRequest(context) {
      for (const hook of beforeRequestHooks)
        await hook(context)
    },
    async afterResponse(context) {
      for (const hook of afterResponseHooks)
        await hook(context)
    },
    async beforeRetry(context) {
      let retry = true
      let delayMs = context.delayMs
      for (const hook of beforeRetryHooks) {
        const result = await hook({ ...context, retry, delayMs })
        if (!result || typeof result !== 'object')
          continue
        if (result.retry !== undefined)
          retry = result.retry
        if (typeof result.delayMs === 'number' && Number.isFinite(result.delayMs))
          delayMs = Math.max(0, result.delayMs)
      }
      return { retry, delayMs }
    },
    async onError(context) {
      let error = context.error
      for (const hook of onErrorHooks) {
        const result = await hook({ ...context, error })
        if (result instanceof Error)
          error = result
      }
      return error
    },
    observe(event) {
      for (const observer of observers) {
        try {
          ignoreRejection(observer(event))
        }
        catch {
          // observers must not break SDK behavior
        }
      }
    },
  }
}
