import type { ArchiveCheckpoint, ArchivePhase } from '../public/ArchiveService'

/**
 * 归档阶段的规范顺序。
 *
 * 具体启用哪些阶段由选项决定；checkpoint 停在未启用阶段时自动跳到下一个启用阶段。
 */
export const CANONICAL_PHASES: readonly ArchivePhase[] = [
  'timeline',
  'likes',
  'comments',
  'favorites',
  'images',
  'videos',
  'done',
]

/**
 * 归档运行的显式状态机。
 *
 * 与 `ArchiveCheckpoint`（对外序列化形态，字段随时间点变化）不同，这里保存
 * 「当前运行」的完整游标，阶段收敛只发生在 `applyPhaseCheckpoint`。
 */
export interface ArchiveRunState {
  phase: ArchivePhase
  /** mymblog 阶段当前页（恢复时从该页重跑） */
  page?: number
  /** 已完整处理（含其转发）的最后一条微博 mblogId */
  lastTimelineMblogId?: string
  favoritesPage?: number
  likesPage?: number
  imagesCursor?: string
  videosCursor?: string
  commentHistoryCursor?: number
  sliceEnd?: number
  slicePage?: number
  sliceWindow?: number
  /** timeline 增量 / 搜索窗口已触达边界（需要提前结束 timeline 阶段） */
  incrementalReached: boolean
}

/** 从上游 checkpoint 恢复运行状态（只复制已知字段，旧字段不回流）。 */
export function createRunState(input?: ArchiveCheckpoint): ArchiveRunState {
  const state: ArchiveRunState = {
    phase: input?.phase ?? 'timeline',
    page: input?.page,
    lastTimelineMblogId: input?.lastTimelineMblogId,
    favoritesPage: input?.favoritesPage,
    likesPage: input?.likesPage,
    imagesCursor: input?.imagesCursor,
    videosCursor: input?.videosCursor,
    commentHistoryCursor: input?.commentHistoryCursor,
    sliceEnd: input?.sliceEnd,
    slicePage: input?.slicePage,
    sliceWindow: input?.sliceWindow,
    incrementalReached: false,
  }

  // 旧 checkpoint 的 page 语义是「下一页」，新语义是「当前页」：倒退一页重跑，避免漏项。
  const legacyVisited = (input as { visitedMblogIds?: unknown } | undefined)?.visitedMblogIds
  if (legacyVisited !== undefined && state.phase === 'timeline' && state.page !== undefined)
    state.page = Math.max(1, state.page - 1)

  return state
}

/** 本次运行启用的阶段（固定顺序）。 */
export function resolveEnabledPhases(
  options: {
    includeLikes: boolean
    includeCommentHistory: boolean
    includeFavorites: boolean
    includeImages: boolean
    includeVideos: boolean
  },
): ArchivePhase[] {
  return [
    'timeline',
    ...(options.includeLikes ? ['likes' as const] : []),
    ...(options.includeCommentHistory ? ['comments' as const] : []),
    ...(options.includeFavorites ? ['favorites' as const] : []),
    ...(options.includeImages ? ['images' as const] : []),
    ...(options.includeVideos ? ['videos' as const] : []),
    'done',
  ]
}

/** 构造初始 checkpoint（与运行状态同形，但只携带当前阶段的游标）。 */
export function createCheckpoint(uid: string, state: ArchiveRunState): ArchiveCheckpoint {
  const cp: ArchiveCheckpoint = {
    uid,
    phase: state.phase,
    page: state.page,
    lastTimelineMblogId: state.lastTimelineMblogId,
    favoritesPage: state.favoritesPage,
  }
  // 仅在续跑对应阶段时带上该阶段的游标，避免把无关字段写回其它阶段（checkpoint 保持恒定大小）。
  if (state.phase === 'likes' && state.likesPage !== undefined)
    cp.likesPage = state.likesPage
  if (state.phase === 'images' && state.imagesCursor !== undefined)
    cp.imagesCursor = state.imagesCursor
  if (state.phase === 'videos' && state.videosCursor !== undefined)
    cp.videosCursor = state.videosCursor
  if (state.phase === 'comments' && state.commentHistoryCursor !== undefined)
    cp.commentHistoryCursor = state.commentHistoryCursor
  // 续跑日期切片时保留 slice 游标；新流程不会把这些字段写进 mymblog checkpoint。
  if (state.sliceEnd !== undefined)
    cp.sliceEnd = state.sliceEnd
  if (state.slicePage !== undefined)
    cp.slicePage = state.slicePage
  if (state.sliceWindow !== undefined)
    cp.sliceWindow = state.sliceWindow
  return cp
}

/**
 * 把 checkpoint 收敛到当前阶段（清掉其它阶段的游标，保持恒定大小）。
 *
 * 会回写 `state` 里该阶段的默认值（likes / favorites 页从 1 开始）。
 */
export function applyPhaseCheckpoint(cp: ArchiveCheckpoint, state: ArchiveRunState): void {
  cp.phase = state.phase
  if (state.phase !== 'timeline') {
    cp.page = undefined
    cp.lastTimelineMblogId = undefined
    delete cp.sliceEnd
    delete cp.slicePage
    delete cp.sliceWindow
  }
  else {
    cp.page = state.page
    cp.lastTimelineMblogId = state.lastTimelineMblogId
  }
  cp.favoritesPage = undefined
  delete cp.likesPage
  delete cp.commentHistoryCursor
  delete cp.imagesCursor
  delete cp.videosCursor
  if (state.phase === 'likes') {
    cp.likesPage = state.likesPage ?? 1
    state.likesPage = cp.likesPage
  }
  if (state.phase === 'comments' && state.commentHistoryCursor !== undefined)
    cp.commentHistoryCursor = state.commentHistoryCursor
  if (state.phase === 'favorites') {
    cp.favoritesPage = state.favoritesPage ?? 1
    state.favoritesPage = cp.favoritesPage
  }
  if (state.phase === 'images' && state.imagesCursor !== undefined)
    cp.imagesCursor = state.imagesCursor
  if (state.phase === 'videos' && state.videosCursor !== undefined)
    cp.videosCursor = state.videosCursor
}

/** 推进到下一个启用阶段（原地修改 `state.phase`）。 */
export function advancePhase(state: ArchiveRunState, enabledPhases: readonly ArchivePhase[]): void {
  const currentIndex = CANONICAL_PHASES.indexOf(state.phase)
  const rest = currentIndex >= 0 ? CANONICAL_PHASES.slice(currentIndex + 1) : CANONICAL_PHASES
  state.phase = rest.find(candidate => enabledPhases.includes(candidate)) ?? 'done'
}

/** checkpoint 停在未启用阶段时（例如上次启用了 likes、本次关闭）跳到下一个启用阶段。 */
export function reconcileInitialPhase(state: ArchiveRunState, enabledPhases: readonly ArchivePhase[]): void {
  if (state.phase === 'done' || enabledPhases.includes(state.phase))
    return
  const currentIndex = CANONICAL_PHASES.indexOf(state.phase)
  state.phase = CANONICAL_PHASES.slice(currentIndex + 1).find(candidate => enabledPhases.includes(candidate)) ?? 'done'
}
