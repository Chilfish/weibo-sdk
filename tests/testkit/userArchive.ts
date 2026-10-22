import type { Tweet } from '~/models/data/Tweet'
import type { ArchiveCheckpoint, ArchiveItem } from '~/services/public/ArchiveService'
import type { ITweet, ITweetComment } from '~/types/domain/ITweet'
import type { IUser } from '~/types/domain/IUser'
import { TWEET_CONTRACT_VERSION } from '~/types/domain/ITweet'

export function makeArchiveTweet(mblogId: string, createdAt = '2025-01-15T00:00:00.000Z'): ITweet {
  return {
    id: mblogId,
    mblogId,
    createdAt,
    text: `text-${mblogId}`,
    source: '微博网页版',
    user: {} as ITweet['user'],
    stats: { likes: 0, comments: 0, reposts: 0 },
    visible: {} as ITweet['visible'],
    media: [],
  }
}

export function makeArchiveComment(id: string, options: { replies?: ITweetComment[], totalReplies?: number } = {}): ITweetComment {
  return {
    id,
    createdAt: '2025-01-15T00:00:00.000Z',
    text: `comment-${id}`,
    source: '微博网页版',
    likes: 0,
    user: {} as ITweetComment['user'],
    ...(options.replies === undefined ? {} : { replies: options.replies }),
    ...(options.totalReplies === undefined ? {} : { totalReplies: options.totalReplies }),
  }
}

export function makeArchiveUser(uid = '1234567890', name = 'tester'): IUser {
  return {
    id: uid,
    name,
    stats: { statuses: 10 },
  } as IUser
}

export function makeArchiveCheckpoint(uid: string, overrides: Partial<ArchiveCheckpoint> = {}): ArchiveCheckpoint {
  return { uid, phase: 'timeline', ...overrides }
}

export function makeArchiveItem(tweet: ITweet, checkpoint: ArchiveCheckpoint): ArchiveItem {
  return {
    schemaVersion: TWEET_CONTRACT_VERSION,
    source: 'timeline',
    mblogId: tweet.mblogId,
    tweet: tweet as unknown as Tweet,
    schemaDigest: {},
    checkpoint,
  }
}
