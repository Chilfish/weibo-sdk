import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeTweet } from '~/models/data/Tweet'

/**
 * 附件归一化的 fixture 快照（脱敏后的真实抓包）。
 *
 * 与显式断言的 `TweetAttachments.test.ts` 互补：这里锁定「真实 fixture 的完整附件形状」，
 * 字段增删会直接反映在 snapshot diff 里；网络 / Cookie 都不需要。
 */
function load(name: string): unknown {
  return JSON.parse(readFileSync(`tests/fixtures/raw/${name}.json`, 'utf8'))
}

function attachmentsOf(raw: unknown) {
  return normalizeTweet(raw as Parameters<typeof normalizeTweet>[0]).attachments
}

describe('tweet attachment fixture snapshots', () => {
  it('matches sanitized PC and m-site fixture shapes', () => {
    const mobileVideo = load('mobile_video_page') as { data?: unknown }

    expect({
      pcArticle: attachmentsOf(load('status_article')),
      pcVote: attachmentsOf(load('status_vote')),
      pcLive: attachmentsOf(load('status_live')),
      mobileVote: attachmentsOf(load('mobile_status_vote')),
      mobileLive: attachmentsOf(load('mobile_status_live')),
      mobileVideoMedia: normalizeTweet(mobileVideo.data as Parameters<typeof normalizeTweet>[0]).media,
    }).toMatchSnapshot()
  })
})
