import type { infer as ZodInfer, ZodType, ZodTypeAny } from 'zod'
import type { IRequestResource } from './FetcherService'
import type { WeiboSDKError } from '~/models/errors/WeiboSDKError'
import type { IResource, IResourceType } from '~/types/resources'

/**
 * 端点声明的鉴权要求。
 *
 * - `cookie`（默认）：必须登录 Cookie；guest 模式下直接拒绝，不发请求。
 * - `guest`：访客 token 可用；Cookie 模式下仍优先使用 Cookie。
 * - `none`：不需要任何凭证（不注入 Cookie）。
 */
export type EndpointAuth = 'cookie' | 'guest' | 'none'

export type EndpointOkPolicy
  = | { mode: 'none' }
    | {
      mode: 'require_ok_1'
      notOkError?: (ctx: {
        endpoint: string
        args: Record<string, unknown> | undefined
        ok: number
        message?: string
        raw: unknown
      }) => WeiboSDKError
    }

export type EndpointArgsFromSchema<TArgsSchema extends ZodTypeAny | undefined>
  = TArgsSchema extends ZodTypeAny ? ZodInfer<TArgsSchema> : undefined

export interface EndpointSpec<
  TResource extends IResourceType,
  TArgsSchema extends ZodTypeAny | undefined = undefined,
> {
  resourceType: TResource
  endpoint: string
  argsSchema?: TArgsSchema
  buildResource: (args: EndpointArgsFromSchema<TArgsSchema>) => IRequestResource
  okPolicy?: EndpointOkPolicy
  /** 鉴权要求（默认 `cookie`，避免已有端点被意外放行）。 */
  auth?: EndpointAuth
  schema: ZodType<IResource[TResource]>
}

/**
 * helper：让 endpoint 定义更容易做类型推导（args 从 argsSchema 推导）
 */
export function defineEndpoint<
  const TResource extends IResourceType,
  const TArgsSchema extends ZodTypeAny | undefined,
>(spec: EndpointSpec<TResource, TArgsSchema>): EndpointSpec<TResource, TArgsSchema> {
  return spec
}
