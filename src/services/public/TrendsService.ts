import type { BandUnifiedResponse } from '../endpoints/side'
import type { IWeiboConfig } from '~/types/config'
import { bandUnifiedSpec } from '../endpoints/side'
import { FetcherService } from '../internal/FetcherService'

/**
 * 热搜领域服务。
 *
 * 只读上游 `ajax/side/bandUnified`，按 `type` 取不同榜单（热搜 / 话题 / 文娱），
 * 返回 raw 响应（行为 CLI `trends` 命令的数据源）。
 */
export class TrendsService extends FetcherService {
  /**
   * @param config SDK 配置（Cookie / 限流 / hooks / telemetry）
   * @param deps 可选依赖覆盖（axios 实例、Auth/RateLimit 服务、hooks），主要用于测试注入
   */
  constructor(config: IWeiboConfig, deps?: ConstructorParameters<typeof FetcherService>[1]) {
    super(config, deps)
  }

  /**
   * 获取热搜榜单
   *
   * `GET https://weibo.com/ajax/side/bandUnified?type=hot`
   *
   * @param type 榜单类型：hot（热搜）、topic（话题）、entertainment（文娱）；默认 `hot`
   * @returns 校验后的榜单响应（`data.band_list` 为条目数组，字段含 `word` / `num` / `note` 等）
   */
  public async hotBand(type: 'hot' | 'topic' | 'entertainment' = 'hot'): Promise<BandUnifiedResponse> {
    return await this.request(bandUnifiedSpec, { type })
  }
}
