import type { ZodType } from 'zod'
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

export interface EndpointSpec<
  TResource extends IResourceType,
  TArgs extends object | undefined,
> {
  resourceType: TResource
  endpoint: string
  buildResource: (args: TArgs) => IRequestResource
  okPolicy?: EndpointOkPolicy
  schema: ZodType<IResource[TResource]>
}
