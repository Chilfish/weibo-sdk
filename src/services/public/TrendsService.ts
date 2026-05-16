import type { BandUnifiedResponse } from '../endpoints/side'
import type { IWeiboConfig } from '~/types/config'
import { bandUnifiedSpec } from '../endpoints/side'
import { FetcherService } from '../internal/FetcherService'

export class TrendsService extends FetcherService {
  constructor(config: IWeiboConfig, deps?: ConstructorParameters<typeof FetcherService>[1]) {
    super(config, deps)
  }

  /**
   * 获取热搜榜单
   *
   * `GET https://weibo.com/ajax/side/bandUnified?type=hot`
   *
   * @param type 榜单类型：hot（热搜）、topic（话题）、entertainment（文娱）
   */
  public async hotBand(type: 'hot' | 'topic' | 'entertainment' = 'hot'): Promise<BandUnifiedResponse> {
    return await this.request(bandUnifiedSpec, { type })
  }
}
