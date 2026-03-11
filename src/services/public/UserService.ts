import type { ZodType } from 'zod'
import type { EndpointSpec } from '../internal/EndpointSpec'
import type { IWeiboConfig } from '~/types/config'
import type { IUserDetailsResponse } from '~/types/raw/user/Details'
import type { IUserInfoResponse } from '~/types/raw/user/Info'
import { z } from 'zod'
import { User } from '~/models/data/User'
import { WeiboSessionExpiredError } from '~/models/errors/BusinessError'
import { FetcherService } from '../internal/FetcherService'

const UserInfoResponseSchema = z.object({
  ok: z.number(),
  data: z.object({
    user: z.object({}).loose(),
  }).loose(),
}).loose() as unknown as ZodType<IUserInfoResponse>

const UserDetailsResponseSchema = z.object({
  ok: z.number(),
  data: z.object({}).loose(),
}).loose() as unknown as ZodType<IUserDetailsResponse>

const userInfoSpec: EndpointSpec<'USER_INFO', { uid: string }> = {
  resourceType: 'USER_INFO',
  endpoint: 'ajax/profile/info',
  buildResource: ({ uid }) => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/profile/info',
    headers: {
      referer: `https://weibo.com/u/${uid}`,
    },
  }),
  okPolicy: { mode: 'require_ok_1' },
  schema: UserInfoResponseSchema,
}

const userDetailsSpec: EndpointSpec<'USER_DETAILS', { uid: string }> = {
  resourceType: 'USER_DETAILS',
  endpoint: 'ajax/profile/detail',
  buildResource: ({ uid }) => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/profile/detail',
    headers: {
      referer: `https://weibo.com/u/${uid}`,
    },
  }),
  okPolicy: { mode: 'require_ok_1' },
  schema: UserDetailsResponseSchema,
}

const myDetailsSpec: EndpointSpec<'USER_DETAILS', undefined> = {
  resourceType: 'USER_DETAILS',
  endpoint: 'ajax/profile/detail',
  buildResource: () => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/profile/detail',
    headers: {
      referer: 'https://weibo.com/',
    },
  }),
  okPolicy: {
    mode: 'require_ok_1',
    notOkError: ({ endpoint, ok, message, raw }) => new WeiboSessionExpiredError('Weibo session expired or cookie is invalid.', {
      endpoint,
      ok,
      message,
      raw,
    }),
  },
  schema: UserDetailsResponseSchema,
}

export class UserService extends FetcherService {
  constructor(config: IWeiboConfig, deps?: ConstructorParameters<typeof FetcherService>[1]) {
    super(config, deps)
  }

  /**
   * 获取用户信息
   * @param id 用户ID (uid)
   */
  public async info(id: string): Promise<IUserInfoResponse> {
    return await this.request(userInfoSpec, { uid: id })
  }

  /**
   * 获取用户详情
   */
  public async details(id: string): Promise<IUserDetailsResponse> {
    return await this.request(userDetailsSpec, { uid: id })
  }

  /**
   * 获取当前登录用户的详情（不带 uid 参数）。
   *
   * 该接口常用于会话自检：Cookie 过期/未登录时，通常会返回 `ok !== 1`。
   */
  public async myDetails(): Promise<IUserDetailsResponse> {
    return await this.request(myDetailsSpec, undefined, { skipPreflight: true })
  }

  /**
   * 获取用户详情信息，返回解析后的 User 类
   */
  public async getById(id: string): Promise<User> {
    const [info, details] = await Promise.all([
      this.info(id),
      this.details(id),
    ])

    return new User(info.data.user, details.data)
  }
}
