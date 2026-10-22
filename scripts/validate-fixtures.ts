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
import { feedGroupsSpec, mblogGroupsSpec } from '../src/services/endpoints/groups'
import { likeListSpec } from '../src/services/endpoints/like'
import { likersSpec } from '../src/services/endpoints/likers'
import { albumDetailSpec, imageWallSpec, waterfallSpec } from '../src/services/endpoints/media'
import { mentionsSpec } from '../src/services/endpoints/mentions'
import { mobileContainerSpec } from '../src/services/endpoints/mobile'
import { messageAttitudesSpec, messageCommentsSpec } from '../src/services/endpoints/notifications'
import { searchUsersSpec } from '../src/services/endpoints/search'
import { bandUnifiedSpec } from '../src/services/endpoints/side'
import { stopicCatesSpec, stopicListSpec } from '../src/services/endpoints/topic'
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
  // 2026-10-20 首页「最新微博」friendstimeline 实测：max_id 翻旧页 / since_id 增量 / 空页
  'feed_latest_p1.json': validate(friendstimelineSpec),
  'feed_latest_p2.json': validate(friendstimelineSpec),
  'feed_latest_incremental.json': validate(friendstimelineSpec),
  'feed_latest_end.json': validate(friendstimelineSpec),
  'tweet_QqsYymYOS.json': validate(statusShowSpec),
  'tweet_OgHLUyXYP.json': validate(statusShowSpec),
  'tweet_P6yhlzD3j.json': validate(statusShowSpec),
  'tweet_PCN4v8k6W.json': validate(statusShowSpec),
  'tweet_QFekiwGId.json': validate(statusShowSpec),
  'comments.json': validate(buildCommentsSpec),
  'comments_feed.json': validate(buildCommentsSpec),
  // 2026-10-20 真实抓包：buildComments 去 type=feed 后的翻页 / 防火墙 / 空页样本
  'comments_no_type_p1.json': validate(buildCommentsSpec),
  'comments_no_type_p2.json': validate(buildCommentsSpec),
  'comments_no_type_end.json': validate(buildCommentsSpec),
  'comments_firewall.json': validate(buildCommentsSpec),
  'comments_hot_empty.json': validate(buildCommentsSpec),
  // 2026-10-20 真实抓包：图片评论（单图 / 多图重复 url_struct）
  'comments_pic_multi.json': validate(buildCommentsSpec),
  'repost_timeline.json': validate(repostTimelineSpec),
  'repost_timeline_p2.json': validate(repostTimelineSpec),
  'searchProfile_p1.json': validate(searchProfileSpec),
  'searchProfile_p2.json': validate(searchProfileSpec),
  'longtext.json': validate(longtextSpec),
  // media (D4/D5)
  'image_wall_p1.json': validate(imageWallSpec),
  'image_wall_p2.json': validate(imageWallSpec),
  'waterfall_p1.json': validate(waterfallSpec),
  'waterfall_p2.json': validate(waterfallSpec),
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
  'profile_detail_hometown.json': validate(userDetailsSpec),
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
  // D8 / D9 / D10 / D11（2026-10-20 真实抓包）
  'likers_p1.json': validate(likersSpec),
  'likers_p2.json': validate(likersSpec),
  'likers_end.json': validate(likersSpec),
  'mentions_p1.json': validate(mentionsSpec),
  'mentions_p2.json': validate(mentionsSpec),
  'mentions_end.json': validate(mentionsSpec),
  'message_cmt_p1.json': validate(messageCommentsSpec),
  'message_cmt_p2.json': validate(messageCommentsSpec),
  'message_cmt_end.json': validate(messageCommentsSpec),
  'message_attitudes_p1.json': validate(messageAttitudesSpec),
  'message_attitudes_p2.json': validate(messageAttitudesSpec),
  'message_attitudes_end.json': validate(messageAttitudesSpec),
  'mblog_groups.json': validate(mblogGroupsSpec),
  'feed_groups.json': validate(feedGroupsSpec),
  // 2026-10-20 追加抓包：关键词搜索 / 二级评论 / 置顶 / 相册 / 音频 / 超话 / @
  'searchProfile_q.json': validate(searchProfileSpec),
  'comment_replies_p1.json': validate(buildCommentsSpec),
  'comment_replies_p2.json': validate(buildCommentsSpec),
  'comment_replies_end.json': validate(buildCommentsSpec),
  'mymblog_pinned.json': validate(myMblogSpec),
  'image_wall_with_albums.json': validate(imageWallSpec),
  'at_status.json': validate(statusShowSpec),
  'audio_status.json': validate(statusShowSpec),
  // 2026-10-20 真实转发链（8 层、5 层带图 + 末端原微博 1 图）：repostChain / url_struct reppic
  'tweet_RmITUtJpd.json': validate(statusShowSpec),
  // 2026-10-20 真实外链卡片：B 站网页卡 / 网易云音乐音频卡（pageInfo + linkCards 元数据）
  'tweet_RmyjwrKDs.json': validate(statusShowSpec),
  'tweet_ReZzZFxVQ.json': validate(statusShowSpec),
  // 2026-10-20 isGetLongText=true：url_struct 重复下发同一条网页卡（linkCards 去重）
  'tweet_RmX9TuHhV.json': validate(statusShowSpec),
  // 2026-10-22 真实抓包：网页端 /ajax/statuses/show 的特殊卡片
  // article → object_type: 'article' / type: '24'；hudongvote（投票）→ 'hudongvote' / '23'；
  // live → 'live' / '26' + media_info；抽奖微博本身没有 page_info，抽奖卡在 url_struct[0]（url_type: 39）
  'status_article.json': validate(statusShowSpec),
  'status_vote.json': validate(statusShowSpec),
  'status_live.json': validate(statusShowSpec),
  'status_lottery.json': validate(statusShowSpec),
  // 2026-10-20 追加：相册 / 超话（album_list 为 mobile containerid 形态，详情接口可能返回空）
  'album_list.json': { kind: 'unmodeled', note: '/ajax/profile/albumlist（mobile containerid 与 getAlbumDetail 不兼容；实现走 getImageWall?has_album=true）' },
  'album_detail_p1.json': validate(albumDetailSpec),
  'album_detail_p2.json': validate(albumDetailSpec),
  'stopic_cates.json': validate(stopicCatesSpec),
  'stopic_list_p1.json': validate(stopicListSpec),
  'stopic_list_p2.json': validate(stopicListSpec),
  'stopic_list_search.json': validate(stopicListSpec),
  // 2026-10-20 guest（未登录 / 匿名）态 m 站抓包：mobile_*.json
  // 均只有第 1 页（匿名态 page>=2 被登录门控）。容器样本（data.cards[] + cardlistInfo）由组件解析测试覆盖，
  // 故登记为 unmodeled；仅 mobile_likers_p1 的响应与已建模的 likersSpec 同构（m 站 attitudes/show），直接 mapped。
  'mobile_likers_p1.json': validate(likersSpec),
  'mobile_timeline_p1.json': validate(mobileContainerSpec),
  'mobile_likes_p1.json': validate(mobileContainerSpec),
  'mobile_followings_p1.json': validate(mobileContainerSpec),
  'mobile_fans_p1.json': validate(mobileContainerSpec),
  'mobile_videos_p1.json': validate(mobileContainerSpec),
  'mobile_album_tab.json': validate(mobileContainerSpec),
  'mobile_photos_p1.json': validate(mobileContainerSpec),
  'mobile_search_users_p1.json': validate(mobileContainerSpec),
  'mobile_search_tweets_p1.json': validate(mobileContainerSpec),
  // 空容器：{ ok: 0, msg: '这里还没有内容', data: { cards: [] } }，属正常空页而非鉴权失败
  'mobile_empty_container.json': validate(mobileContainerSpec),
  'mobile_comments_p1.json': { kind: 'unmodeled', note: 'm 站 api/comments/show 未建模（data.data[] + total_number + max，与网页端 buildComments 响应不同）：guest mobile container; covered by component parsing tests' },
  // m 站 statuses/show（`{ ok, data: 微博 }` 包装，字段集与网页端 statusShowSpec 不同）：SDK 未建模该端点。
  // 实测：投票 / 直播在 m 站**没有** page_info（投票走 is_vote + cardid，直播走 extend_info.live_summary），
  // 视频卡片的 page_info 只在 /statuses/show（非 /api/ 路径）下发，故 video 样本取自该路径。
  'mobile_status_vote.json': { kind: 'unmodeled', note: 'm 站 /api/statuses/show 未建模（{ ok, data } 包装；投票在 m 站无 page_info，只有 is_vote + cardid）' },
  'mobile_status_live.json': { kind: 'unmodeled', note: 'm 站 /api/statuses/show 未建模（{ ok, data } 包装；直播在 m 站无 page_info，只有 extend_info.live_summary）' },
  'mobile_video_page.json': { kind: 'unmodeled', note: 'm 站 /statuses/show 未建模（{ ok, data } 包装）：page_info.object_type=11 / type=video 的 m 站形态样本，供 m 侧 page_info 归一化回归用' },
  // 未建模端点（2026-05-16 抓包，无 EndpointSpec）
  'profile_sidedetail.json': { kind: 'unmodeled', note: 'sidedetail 端点未建模（无 EndpointSpec）' },
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
