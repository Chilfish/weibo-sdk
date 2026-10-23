import type { BandUnifiedResponse } from '../endpoints/side'
import type { IWeiboConfig } from '~/types/config'
import type { TrendItem } from '~/types/domain/ITrend'
import { normalizeTrendItem } from '~/models/data/Trend'
import { bandUnifiedSpec } from '../endpoints/side'
import { FetcherService } from '../internal/FetcherService'

/**
 * 热搜领域服务。
 *
 * 只读上游 `ajax/side/bandUnified`，按 `type` 取不同榜单（热搜 / 话题 / 文娱），
 * `hotBand` 返回归一化条目；完整上游响应走 `fetchRawBand`。
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
   * 获取榜单原始响应（低层数据源，公开使用请走 `hotBand`）
   *
   * `GET https://weibo.com/ajax/side/bandUnified?type=hot`
   */
  public async fetchRawBand(type: 'hot' | 'topic' | 'entertainment' = 'hot'): Promise<BandUnifiedResponse> {
    return await this.request(bandUnifiedSpec, { type })
  }

  /**
   * 获取热搜榜单（归一化）
   *
   * @param type 榜单类型：hot（热搜）、topic（话题）、entertainment（文娱）；默认 `hot`
   * @returns 归一化榜单条目（`word` 为空的条目已跳过）
   */
  public async hotBand(type: 'hot' | 'topic' | 'entertainment' = 'hot'): Promise<TrendItem[]> {
    const raw = await this.fetchRawBand(type)
    const items: TrendItem[] = []
    for (const item of raw.data.realtime ?? []) {
      const normalized = normalizeTrendItem(item)
      if (normalized)
        items.push(normalized)
    }
    return items
  }
}
