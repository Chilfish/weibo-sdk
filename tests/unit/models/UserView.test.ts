import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { User } from '~/models/data/User'
import { renderGuestSessionMarkdown } from '~/models/view/Session'
import { renderUserMarkdown } from '~/models/view/User'

function loadFixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(join('tests/fixtures/raw', name), 'utf8'))
}

/** 最小 raw 骨架；字段名与真实 `profile/info` + `profile/detail` 响应对齐。 */
function makeUser(info: Record<string, unknown> = {}, details: Record<string, unknown> = {}): User {
  return new User({
    id: 1,
    idstr: '1111681197',
    screen_name: '测试用户',
    avatar_hd: '',
    avatar_large: '',
    profile_image_url: '',
    profile_url: '/u/1111681197',
    cover_image_phone: '',
    verified: false,
    verified_type: -1,
    verified_reason: '',
    description: '',
    location: '',
    gender: 'n',
    followers_count: 0,
    friends_count: 0,
    statuses_count: 0,
    ...info,
  } as any, {
    created_at: '',
    desc_text: '',
    ip_location: '',
    gender: 'n',
    education: { school: '' },
    sunshine_credit: { level: '0' },
    followers: { total_number: 0, users: [] },
    label_desc: [],
    verified_url: '',
    friend_info: '',
    links: [],
    ...details,
  } as any)
}

describe('renderUserMarkdown', () => {
  it('renders a real profile fixture as a readable card', () => {
    const user = new User(
      loadFixture('profile_info_u2365795232.json').data.user,
      loadFixture('profile_detail_v2.json').data,
    )

    const markdown = renderUserMarkdown(user)

    expect(markdown).toContain('# Cigarcola_beta')
    expect(markdown).toContain('- UID：<ID>')
    expect(markdown).toContain('- 认证：未认证')
    expect(markdown).toContain('- 简介：世无新事，周而复始。')
    expect(markdown).toContain('- 所在地：广东 · 性别：男')
    expect(markdown).toContain('- 粉丝 266 · 关注 2,426 · 微博 13,291')
    expect(markdown).toContain('- 会员：等级 6')
    expect(markdown).toContain('- 学校：华南农业大学')
    expect(markdown).toContain('- 标签：视频累计播放量4728')
    expect(markdown).toContain('- 阳光信用：较好')
    expect(markdown).toContain('- 注册时间：2011-09-01 18:54:03')
    expect(markdown).toContain('- 主页：https://weibo.com/u/2365795232')
  })

  it('omits optional fields that upstream did not publish', () => {
    const markdown = renderUserMarkdown(makeUser())

    expect(markdown).toContain('# 测试用户')
    expect(markdown).toContain('- UID：1111681197')
    expect(markdown).toContain('- 认证：未认证')
    expect(markdown).toContain('- 性别：未公开')
    expect(markdown).toContain('- 粉丝 0 · 关注 0 · 微博 0')
    expect(markdown).not.toContain('简介')
    expect(markdown).not.toContain('生日')
    expect(markdown).not.toContain('会员')
    expect(markdown).not.toContain('标签')
    expect(markdown).not.toContain('链接')
    expect(markdown).not.toContain('注册时间')
  })

  it('renders verification, multiline bio and birthday', () => {
    const markdown = renderUserMarkdown(makeUser({
      screen_name: '认证用户',
      verified: true,
      verified_type: 0,
      verified_reason: '微博知名互联网博主',
      description: '第一行\n第二行',
      gender: 'f',
      location: '北京',
    }, {
      birthday: '1990-01-01',
    }))

    expect(markdown).toContain('- 认证：已认证（微博知名互联网博主）')
    expect(markdown).toContain('- 简介：第一行\n  第二行')
    expect(markdown).toContain('- 所在地：北京 · 性别：女 · 生日：1990-01-01')
  })

  it('escapes link text and wraps urls that contain parentheses', () => {
    const markdown = renderUserMarkdown(makeUser({}, {
      links: [{ title: '主页[1]', url: 'https://example.com/a(b)' }],
    }))

    expect(markdown).toContain('- 链接：[主页\\[1\\]](<https://example.com/a(b)>)')
  })
})

describe('renderGuestSessionMarkdown', () => {
  it('renders token metadata without the token itself', () => {
    const markdown = renderGuestSessionMarkdown({
      issuedAt: Date.UTC(2026, 9, 20),
      scope: 'all',
      source: 'mobile',
    })

    expect(markdown).toContain('# 访客身份（未登录）')
    expect(markdown).toContain('- 登录：否')
    expect(markdown).toContain('- token 签发时间：2026-10-20T00:00:00.000Z')
    expect(markdown).toContain('- token scope：all')
    expect(markdown).toContain('- token 来源：mobile')
  })

  it('states when no guest token is available', () => {
    expect(renderGuestSessionMarkdown(undefined)).toContain('- token：未取得')
  })
})
