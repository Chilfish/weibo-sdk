import type { TelemetryEvent, WeiboSDKTelemetry } from '~/types/telemetry'

/**
 * 测试用 telemetry 收集器：把 Wide Events 收集到数组，供断言事件序列。
 *
 * 放这里而不是各测试文件内联，避免多份复制（见 postmortem「测试工具收敛到 tests/testkit/」）。
 */
export class TelemetryCollector implements WeiboSDKTelemetry {
  public events: TelemetryEvent[] = []

  async emit(event: TelemetryEvent): Promise<void> {
    this.events.push(event)
  }

  /** 按事件名过滤。 */
  byName(name: TelemetryEvent['event_name']): TelemetryEvent[] {
    return this.events.filter(event => event.event_name === name)
  }
}
