import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderFollowingUserListMarkdown } from '~/models/view/UserList'

function loadFixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(join('tests/fixtures/raw', name), 'utf8'))
}

describe('renderFollowingUserListMarkdown', () => {
  it('renders users from a real followings fixture', () => {
    const raw = loadFixture('friendships_followings_u2142312651.json')
    const users = raw.users.slice(0, 2)

    const markdown = renderFollowingUserListMarkdown(users, {
      title: '关注列表',
      notes: [`总数：${raw.total_number}`],
    })

    expect(markdown).toContain('# 关注列表')
    expect(markdown).toContain(`总数：${raw.total_number}`)
    expect(markdown).toContain('1. **@条鹅TIAOGOOSE**（已认证')
    expect(markdown).toContain('粉丝 47,289')
    expect(markdown).toContain('江苏')
    expect(markdown).toContain('https://weibo.com/u/')
  })

  it('labels mutual / one-way follow relations', () => {
    const markdown = renderFollowingUserListMarkdown([
      { id: '1', screen_name: '互关', following: true, follow_me: true },
      { id: '2', screen_name: '我关注的人', following: true, follow_me: false },
      { id: '3', screen_name: '关注我的人', following: false, follow_me: true },
      { id: '4', screen_name: '无关系', following: false, follow_me: false },
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
