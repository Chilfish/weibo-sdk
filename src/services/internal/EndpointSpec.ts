import type { infer as ZodInfer, ZodType, ZodTypeAny } from 'zod'
import type { IRequestResource } from './FetcherService'
import type { WeiboSDKError } from '~/models/errors/WeiboSDKError'
import type { IResource, IResourceType } from '~/types/resources'

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
