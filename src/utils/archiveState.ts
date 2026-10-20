import type { ArchiveItem } from '../services/public/ArchiveService'

/**
 * 单账号增量归档状态（`state.json` 中按 uid 保存）。
 *
 * 只保存「上次同步到哪里」的最小信息：最后一条微博的 mblogId / 发布时间 / 运行时间，
 * 不保存全量 id 数组（避免状态文件随归档规模膨胀）。
 */
export interface ArchiveUserState {
  /** 最后成功归档的微博 mblogId（下次作为 `stopAtMblogId` 早停） */
  lastMblogId?: string
  /** 最后一条微博的上游 `created_at` 原样字符串（可作为 `since` 兜底） */
  lastCreatedAt?: string
  /** 最近一次运行时间（ISO 字符串） */
  lastRunAt?: string
}

/** 增量归档状态文件。 */
export interface ArchiveState {
  version: 1
  /** 按 uid 保存的状态 */
  users: Record<string, ArchiveUserState>
  /** 最近一次更新时间（ISO 字符串） */
  updatedAt?: string
}

/** 创建空状态。 */
export function createEmptyArchiveState(): ArchiveState {
  return { version: 1, users: {} }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** 宽容解析状态文件：非法结构回退为空状态，不抛错。 */
export function parseArchiveState(raw: unknown): ArchiveState {
  if (!isRecord(raw))
    return createEmptyArchiveState()

  const users: Record<string, ArchiveUserState> = {}
  if (isRecord(raw.users)) {
    for (const [uid, value] of Object.entries(raw.users)) {
      if (!isRecord(value))
        continue
      const entry: ArchiveUserState = {}
      if (typeof value.lastMblogId === 'string' && value.lastMblogId !== '')
        entry.lastMblogId = value.lastMblogId
      if (typeof value.lastCreatedAt === 'string' && value.lastCreatedAt !== '')
        entry.lastCreatedAt = value.lastCreatedAt
      if (typeof value.lastRunAt === 'string' && value.lastRunAt !== '')
        entry.lastRunAt = value.lastRunAt
      users[uid] = entry
    }
  }

  const state: ArchiveState = { version: 1, users }
  if (typeof raw.updatedAt === 'string')
    state.updatedAt = raw.updatedAt
  return state
}

/** 读取某 uid 的状态。 */
export function getArchiveUserState(state: ArchiveState, uid: string): ArchiveUserState | undefined {
  return state.users[uid]
}

/**
 * 用一个归档条目更新状态（返回新对象，不修改入参）。
 *
 * 图片条目可能没有 `mblogId`，此时只更新时间，不推进位置。
 */
export function updateArchiveState(
  state: ArchiveState,
  uid: string,
  item: Pick<ArchiveItem, 'mblogId' | 'tweet'>,
  now: Date = new Date(),
): ArchiveState {
  const previous = state.users[uid] ?? {}
  const entry: ArchiveUserState = { ...previous, lastRunAt: now.toISOString() }
  if (item.mblogId)
    entry.lastMblogId = item.mblogId
  if (item.tweet?.createdAt)
    entry.lastCreatedAt = item.tweet.createdAt

  return {
    version: 1,
    users: { ...state.users, [uid]: entry },
    updatedAt: now.toISOString(),
  }
}

/**
 * 从状态推导增量选项。
 *
 * 优先用 `lastMblogId` 早停；没有时用 `lastCreatedAt` 推导时间下界。
 * 时间无法解析时返回 `undefined`（退化为全量扫描）。
 */
export function incrementalOptionsFromState(
  state: ArchiveState,
  uid: string,
): { stopAtMblogId?: string, since?: number } | undefined {
  const entry = state.users[uid]
  if (!entry)
    return undefined

  const result: { stopAtMblogId?: string, since?: number } = {}
  if (entry.lastMblogId)
    result.stopAtMblogId = entry.lastMblogId
  if (entry.lastCreatedAt) {
    const ms = Date.parse(entry.lastCreatedAt)
    if (Number.isFinite(ms))
      result.since = Math.floor(ms / 1000)
  }
  return Object.keys(result).length > 0 ? result : undefined
}
