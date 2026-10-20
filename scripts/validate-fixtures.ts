// scripts/validate-fixtures.ts — 离线契约回归（E5 / P0-5）
//
// 遍历 tests/fixtures/raw/*.json × 对应 EndpointSpec.schema 做 safeParse：
// - mapped fixture 必须 safeParse 通过（上游漂移 / schema 回归的护城河）
// - unmodeled fixture（端点未建模）显式登记原因，跳过校验但计入报告
// - 新增 fixture 未登记 → fail loudly（防静默漏网）
//
// 用法：pnpm run validate:fixtures（CI 与 tests/unit/scripts/validate-fixtures.test.ts 复用同一逻辑）

import type { ZodTypeAny } from 'zod'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { myCommentsSpec } from '../src/services/endpoints/commentHistory'
import { favoritesSpec, favoritesTagsSpec } from '../src/services/endpoints/favorite'
import { followContentSpec, friendshipsSpec } from '../src/services/endpoints/follow'
import { likeListSpec } from '../src/services/endpoints/like'
import { searchUsersSpec } from '../src/services/endpoints/search'
import { bandUnifiedSpec } from '../src/services/endpoints/side'
import { buildCommentsSpec, friendstimelineSpec, longtextSpec, myMblogSpec, repostTimelineSpec, searchProfileSpec, statusShowSpec } from '../src/services/endpoints/tweet'
import { userDetailsSpec, userInfoSpec } from '../src/services/endpoints/user'

export type FixtureRule
  = | { kind: 'validate', endpoint: string, schema: ZodTypeAny }
    | { kind: 'unmodeled', note: string }

function validate(spec: { endpoint: string, schema: ZodTypeAny }): FixtureRule {
  return {
    kind: 'validate',
    endpoint: spec.endpoint,
    schema: spec.schema,
  }
}

/**
 * fixture → 校验规则映射（单一事实来源）。
 *
 * 新增 fixture 必须在此登记：mapped（配 spec）或 unmodeled（注明原因）。
 * 未建模的 5 个均为 2026-05-16 抓包样本，无对应 EndpointSpec。
 */
export const FIXTURE_RULES: Record<string, FixtureRule> = {
  // tweet
  'mymblog_page1.json': validate(myMblogSpec),
  'mymblog_page1_since_id_numeric.json': validate(myMblogSpec),
  'mymblog_page_end.json': validate(myMblogSpec),
  'timeline_u1740358225.json': validate(myMblogSpec),
  'timeline_u2365795232.json': validate(myMblogSpec),
  'feed_home.json': validate(friendstimelineSpec),
  'tweet_QqsYymYOS.json': validate(statusShowSpec),
  'tweet_OgHLUyXYP.json': validate(statusShowSpec),
  'tweet_P6yhlzD3j.json': validate(statusShowSpec),
  'tweet_PCN4v8k6W.json': validate(statusShowSpec),
  'tweet_QFekiwGId.json': validate(statusShowSpec),
  'comments.json': validate(buildCommentsSpec),
  'comments_feed.json': validate(buildCommentsSpec),
  'repost_timeline.json': validate(repostTimelineSpec),
  'repost_timeline_p2.json': validate(repostTimelineSpec),
  'searchProfile_p1.json': validate(searchProfileSpec),
  'searchProfile_p2.json': validate(searchProfileSpec),
  'longtext.json': validate(longtextSpec),
  // favorite
  'favorites_p1.json': validate(favoritesSpec),
  'favorites_tags.json': validate(favoritesTagsSpec),
  // follow
  'friendships_followings_u7679065628.json': validate(friendshipsSpec),
  'friendships_followings_u2142312651.json': validate(friendshipsSpec),
  'friendships_fans_u2365795232.json': validate(friendshipsSpec),
  'friendships_fans_u2365795232_p2.json': validate(friendshipsSpec),
  'followContent.json': validate(followContentSpec),
  'followContent_p2.json': validate(followContentSpec),
  'followContent_p3.json': validate(followContentSpec),
  // user
  'profile_info_u1740358225.json': validate(userInfoSpec),
  'profile_info_u2365795232.json': validate(userInfoSpec),
  'profile_detail.json': validate(userDetailsSpec),
  'profile_detail_v2.json': validate(userDetailsSpec),
  // side / search
  'hot_trends.json': validate(bandUnifiedSpec),
  'search_users_p2.json': validate(searchUsersSpec),
  'search_users_p3.json': validate(searchUsersSpec),
  // 2026-10-20 真实抓包：我的评论 / 我赞过的微博
  'my_comments_p1.json': validate(myCommentsSpec),
  'my_comments_p2.json': validate(myCommentsSpec),
  'my_comments_end.json': validate(myCommentsSpec),
  'likes_p1.json': validate(likeListSpec),
  'likes_p2.json': validate(likeListSpec),
  'likes_end.json': validate(likeListSpec),
  // getLikeList（个人页「赞」瀑布流）尚未建模
  'like_list_cursor_p1.json': { kind: 'unmodeled', note: '/ajax/profile/getLikeList 未建模（cursor/next_cursor 分页）' },
  'like_list_cursor_end.json': { kind: 'unmodeled', note: '/ajax/profile/getLikeList 结束态未建模（list:[]，next_cursor=-1）' },
  // 未建模端点（2026-05-16 抓包，无 EndpointSpec）
  'profile_sidedetail.json': { kind: 'unmodeled', note: 'sidedetail 端点未建模（无 EndpointSpec）' },
  'feed_groups.json': { kind: 'unmodeled', note: 'feed 分组端点未建模' },
  'side_cards.json': { kind: 'unmodeled', note: 'side cards 端点未建模' },
  'check_reward.json': { kind: 'unmodeled', note: 'check_reward 端点未建模' },
  'statuses_config.json': { kind: 'unmodeled', note: 'statuses/config 端点未建模' },
}

export interface FixtureValidationResult {
  file: string
  status: 'ok' | 'unmodeled' | 'fail' | 'unmapped'
  endpoint?: string
  note?: string
  /** status=fail 时的 zod issue 摘要（最多 3 条） */
  issues?: string
}

const DEFAULT_FIXTURES_DIR = fileURLToPath(new URL('../tests/fixtures/raw', import.meta.url))

export function listFixtureFiles(fixturesDir: string = DEFAULT_FIXTURES_DIR): string[] {
  return readdirSync(fixturesDir).filter(f => f.endsWith('.json')).sort()
}

function summarizeIssues(error: { issues: Array<{ path: PropertyKey[], message: string }> }): string {
  return error.issues
    .slice(0, 3)
    .map(issue => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`)
    .join('; ')
}

/** 校验全部 fixture；规则表与目录不一致（unmapped）也会产出结果项，由调用方判定失败。 */
export function validateFixtures(
  rules: Record<string, FixtureRule> = FIXTURE_RULES,
  fixturesDir: string = DEFAULT_FIXTURES_DIR,
): FixtureValidationResult[] {
  const files = listFixtureFiles(fixturesDir)
  const results: FixtureValidationResult[] = []

  for (const file of files) {
    const rule = rules[file]
    if (!rule) {
      results.push({ file, status: 'unmapped', note: '未在 FIXTURE_RULES 登记：mapped 或 unmodeled 二选一' })
      continue
    }
    if (rule.kind === 'unmodeled') {
      results.push({ file, status: 'unmodeled', note: rule.note })
      continue
    }

    const raw: unknown = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8'))
    const parsed = rule.schema.safeParse(raw)
    if (parsed.success) {
      results.push({ file, status: 'ok', endpoint: rule.endpoint })
    }
    else {
      results.push({ file, status: 'fail', endpoint: rule.endpoint, issues: summarizeIssues(parsed.error) })
    }
  }

  // 规则表里登记了但目录中不存在的文件（改名/删除后忘了同步映射）
  for (const file of Object.keys(rules)) {
    if (!files.includes(file))
      results.push({ file, status: 'unmapped', note: 'FIXTURE_RULES 登记的文件在 fixtures 目录中不存在' })
  }

  return results
}

export function isValidationPass(results: FixtureValidationResult[]): boolean {
  return results.every(r => r.status === 'ok' || r.status === 'unmodeled')
}

function main(): void {
  const results = validateFixtures()
  const count = (status: FixtureValidationResult['status']) => results.filter(r => r.status === status).length

  for (const r of results) {
    if (r.status === 'fail')
      console.error(`FAIL ${r.file} (${r.endpoint}): ${r.issues}`)
    else if (r.status === 'unmapped')
      console.error(`UNMAPPED ${r.file}: ${r.note}`)
    else if (r.status === 'unmodeled')
      console.warn(`unmodeled ${r.file}: ${r.note}`)
  }

  console.log(`fixtures: ${results.length} | ok: ${count('ok')} | unmodeled: ${count('unmodeled')} | fail: ${count('fail')} | unmapped: ${count('unmapped')}`)

  if (!isValidationPass(results))
    process.exitCode = 1
}

const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun)
  main()
