import type { IRequestResource } from '../internal/FetcherService'
import type { IWeiboConfig } from '~/types/config'
import type { IUserDetailsResponse } from '~/types/raw/user/Details'
import type { IUserInfoResponse } from '~/types/raw/user/Info'
import { User } from '~/models/data/User'
import { WeiboAPINotOkError, WeiboSessionExpiredError } from '~/models/errors/BusinessError'
import { UnexpectedAPIResponseError } from '~/models/errors/ProtocolError'
import { getMessage, getOk, isRecord } from '~/utils/response'
import { FetcherService } from '../internal/FetcherService'

export class UserService extends FetcherService {
  constructor(config: IWeiboConfig, deps?: ConstructorParameters<typeof FetcherService>[1]) {
    super(config, deps)
  }

  /**
   * 获取用户信息
   * @param id 用户ID (uid)
   */
  public async info(id: string): Promise<IUserInfoResponse> {
    const resource: IRequestResource = {
      method: 'GET',
      url: 'https://weibo.com/ajax/profile/info',
      headers: {
        referer: `https://weibo.com/u/${id}`,
      },
    }

    const raw = await this.fetch<unknown>(resource, { uid: id })
    const ok = getOk(raw)

    if (ok !== 1) {
      const error = new WeiboAPINotOkError('Weibo API returned ok != 1 (profile/info).', {
        endpoint: 'ajax/profile/info',
        uid: id,
        ok,
        message: getMessage(raw),
        raw,
      })
      await this.emitError(error, {
        phase: 'response',
        endpoint: 'ajax/profile/info',
        request: resource,
        args: { uid: id },
        ok,
        message: getMessage(raw),
        trace_id: this.newTraceId(),
        timestamp: Date.now(),
      })
      throw error
    }

    if (!isRecord(raw) || !isRecord(raw.data) || !isRecord(raw.data.user)) {
      const error = new UnexpectedAPIResponseError('Weibo API response missing required fields (profile/info).', {
        endpoint: 'ajax/profile/info',
        uid: id,
        raw,
      })
      await this.emitError(error, {
        phase: 'parse',
        endpoint: 'ajax/profile/info',
        request: resource,
        args: { uid: id },
        trace_id: this.newTraceId(),
        timestamp: Date.now(),
      })
      throw error
    }

    const data = raw as unknown as IUserInfoResponse
    await this.emitFetched('USER_INFO', data, { endpoint: 'ajax/profile/info', request: resource, args: { uid: id } })
    return data
  }

  /**
   * 获取用户详情
   */
  public async details(id: string): Promise<IUserDetailsResponse> {
    const resource: IRequestResource = {
      method: 'GET',
      url: 'https://weibo.com/ajax/profile/detail',
      headers: {
        referer: `https://weibo.com/u/${id}`,
      },
    }

    const raw = await this.fetch<unknown>(resource, { uid: id })
    const ok = getOk(raw)

    if (ok !== 1) {
      const error = new WeiboAPINotOkError('Weibo API returned ok != 1 (profile/detail).', {
        endpoint: 'ajax/profile/detail',
        uid: id,
        ok,
        message: getMessage(raw),
        raw,
      })
      await this.emitError(error, {
        phase: 'response',
        endpoint: 'ajax/profile/detail',
        request: resource,
        args: { uid: id },
        ok,
        message: getMessage(raw),
        trace_id: this.newTraceId(),
        timestamp: Date.now(),
      })
      throw error
    }

    if (!isRecord(raw) || !isRecord(raw.data)) {
      const error = new UnexpectedAPIResponseError('Weibo API response missing required fields (profile/detail).', {
        endpoint: 'ajax/profile/detail',
        uid: id,
        raw,
      })
      await this.emitError(error, {
        phase: 'parse',
        endpoint: 'ajax/profile/detail',
        request: resource,
        args: { uid: id },
        trace_id: this.newTraceId(),
        timestamp: Date.now(),
      })
      throw error
    }

    const data = raw as unknown as IUserDetailsResponse
    await this.emitFetched('USER_DETAILS', data, { endpoint: 'ajax/profile/detail', request: resource, args: { uid: id } })
    return data
  }

  /**
   * 获取当前登录用户的详情（不带 uid 参数）。
   *
   * 该接口常用于会话自检：Cookie 过期/未登录时，通常会返回 `ok !== 1`。
   */
  public async myDetails(): Promise<IUserDetailsResponse> {
    const resource: IRequestResource = {
      method: 'GET',
      url: 'https://weibo.com/ajax/profile/detail',
      headers: {
        referer: 'https://weibo.com/',
      },
    }

    const raw = await this.fetch<unknown>(resource, undefined, { skipPreflight: true })
    const ok = getOk(raw)

    if (ok !== 1) {
      const error = new WeiboSessionExpiredError('Weibo session expired or cookie is invalid.', {
        endpoint: 'ajax/profile/detail',
        ok,
        message: getMessage(raw),
        raw,
      })
      await this.emitError(error, {
        phase: 'response',
        endpoint: 'ajax/profile/detail',
        request: resource,
        ok,
        message: getMessage(raw),
        trace_id: this.newTraceId(),
        timestamp: Date.now(),
      })
      throw error
    }

    if (!isRecord(raw) || !isRecord(raw.data)) {
      const error = new UnexpectedAPIResponseError('Weibo API response missing required fields (profile/detail without uid).', {
        endpoint: 'ajax/profile/detail',
        raw,
      })
      await this.emitError(error, {
        phase: 'parse',
        endpoint: 'ajax/profile/detail',
        request: resource,
        trace_id: this.newTraceId(),
        timestamp: Date.now(),
      })
      throw error
    }

    const data = raw as unknown as IUserDetailsResponse
    await this.emitFetched('USER_DETAILS', data, { endpoint: 'ajax/profile/detail', request: resource })
    return data
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
