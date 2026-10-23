import type { UserBrief } from '~/types/domain/IUser'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeUserBrief } from '~/models/data/User'
import { renderFollowingUserListMarkdown } from '~/models/view/UserList'

function loadFixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(join('tests/fixtures/raw', name), 'utf8'))
}

/** 构造 `UserBrief` 夹具（只关心列表渲染用到的字段，计数默认 0）。 */
function mkUser(patch: Partial<UserBrief> & { id: string }): UserBrief {
  return {
    name: `u${patch.id}`,
    avatar: 'https://x.jpg',
    url: `https://weibo.com/u/${patch.id}`,
    gender: 'n' as UserBrief['gender'],
    stats: { followers: 0, friends: 0, statuses: 0 },
    verified: false,
    verifiedType: -1 as UserBrief['verifiedType'],
    ...patch,
  }
}

describe('renderFollowingUserListMarkdown', () => {
  it('renders users from a real followings fixture', () => {
    const raw = loadFixture('friendships_followings_u2142312651.json')
    // 上游 raw（`friendships.users[]`）归一化成渲染器接收的 `UserBrief`
    const users = raw.users.slice(0, 2).map((item: unknown) => normalizeUserBrief(item))

    const markdown = renderFollowingUserListMarkdown(users, {
      title: '关注列表',
      notes: ['总数：176'],
    })

    expect(markdown).toContain('# 关注列表')
    expect(markdown).toContain('总数：176')
    expect(markdown).toContain('1. **@条鹅TIAOGOOSE**（已认证')
    expect(markdown).toContain('粉丝 47,289')
    expect(markdown).toContain('江苏')
    expect(markdown).toContain('https://weibo.com/u/')
  })

  it('labels mutual / one-way follow relations', () => {
    const markdown = renderFollowingUserListMarkdown([
      mkUser({ id: '1', name: '互关', following: true, followedBy: true }),
      mkUser({ id: '2', name: '我关注的人', following: true, followedBy: false }),
      mkUser({ id: '3', name: '关注我的人', following: false, followedBy: true }),
      mkUser({ id: '4', name: '无关系', following: false, followedBy: false }),
    ], { title: '关系' })

    expect(markdown).toContain('**@互关** · 互相关注')
    expect(markdown).toContain('**@我关注的人** · 已关注')
    expect(markdown).toContain('**@关注我的人** · 关注了你')
    expect(markdown).toContain('4. **@无关系**\n')
  })

  it('renders an explicit placeholder for an empty page', () => {
    expect(renderFollowingUserListMarkdown([], { title: '粉丝列表' })).toContain('（本页没有用户）')
  })
})
