import { describe, expect, it } from 'vitest'
import { User } from '~/models/data/User'

describe('user model normalization', () => {
  it('prefers avatar_hd then avatar_large then profile_image_url', () => {
    const baseInfo: any = {
      id: 1,
      idstr: '111',
      screen_name: 'sn',
      profile_url: '/u/111',
      cover_image_phone: '',
      verified: false,
      verified_type: 0,
      verified_reason: '',
      description: '',
      location: '',
      gender: 'n',
      followers_count: 0,
      friends_count: 0,
      statuses_count: 0,
    }

    const details: any = {
      created_at: 'x',
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
    }

    expect(new User({ ...baseInfo, avatar_hd: 'hd', avatar_large: 'lg', profile_image_url: 'img' }, details).avatar).toBe('hd')
    expect(new User({ ...baseInfo, avatar_hd: '', avatar_large: 'lg', profile_image_url: 'img' }, details).avatar).toBe('lg')
    expect(new User({ ...baseInfo, avatar_hd: '', avatar_large: '', profile_image_url: 'img' }, details).avatar).toBe('img')
  })

  it('normalizes location from ip_location (strip prefix) with fallback', () => {
    const info: any = {
      id: 1,
      idstr: '1',
      screen_name: 'sn',
      avatar_hd: '',
      avatar_large: '',
      profile_image_url: '',
      profile_url: '/u/1',
      cover_image_phone: '',
      verified: false,
      verified_type: 0,
      verified_reason: '',
      description: '',
      location: 'old-loc',
      gender: 'n',
      followers_count: 0,
      friends_count: 0,
      statuses_count: 0,
    }

    const detailsWithIp: any = {
      created_at: 'x',
      desc_text: '',
      ip_location: 'IP属地：北京',
      gender: 'n',
      education: { school: '' },
      sunshine_credit: { level: '0' },
      followers: { total_number: 0, users: [] },
      label_desc: [],
      verified_url: '',
      friend_info: '',
      links: [],
    }

    const detailsWithoutIp: any = { ...detailsWithIp, ip_location: '' }

    expect(new User(info, detailsWithIp).location).toBe('北京')
    expect(new User(info, detailsWithoutIp).location).toBe('old-loc')
  })

  it('uses userInfo.description with fallback to details.desc_text', () => {
    const infoWithDesc: any = {
      id: 1,
      idstr: '1',
      screen_name: 'sn',
      avatar_hd: '',
      avatar_large: '',
      profile_image_url: '',
      profile_url: '/u/1',
      cover_image_phone: '',
      verified: false,
      verified_type: 0,
      verified_reason: '',
      description: 'from-info',
      location: '',
      gender: 'n',
      followers_count: 0,
      friends_count: 0,
      statuses_count: 0,
    }

    const infoWithoutDesc: any = { ...infoWithDesc, description: '' }

    const details: any = {
      created_at: 'x',
      desc_text: 'from-details',
      ip_location: '',
      gender: 'n',
      education: { school: 'sch' },
      sunshine_credit: { level: '2' },
      followers: { total_number: 0, users: [] },
      label_desc: [],
      verified_url: '',
      friend_info: '',
      links: [{ title: 't', url: 'u' }],
      real_name: { name: '姓名：张三' },
    }

    expect(new User(infoWithDesc, details).description).toBe('from-info')
    expect(new User(infoWithoutDesc, details).description).toBe('from-details')
  })

  it('extracts realName from details and builds url', () => {
    const info: any = {
      id: 1,
      idstr: '111',
      screen_name: 'sn',
      avatar_hd: '',
      avatar_large: '',
      profile_image_url: '',
      profile_url: '/u/111',
      cover_image_phone: '',
      verified: true,
      verified_type: 1,
      verified_reason: 'reason',
      description: '',
      location: '',
      gender: '',
      followers_count: 3,
      friends_count: 4,
      statuses_count: 5,
    }

    const details: any = {
      created_at: 'x',
      desc_text: '',
      ip_location: '',
      gender: 'n',
      education: { school: 'sch' },
      sunshine_credit: { level: '2' },
      followers: { total_number: 0, users: [] },
      label_desc: [],
      verified_url: '',
      friend_info: '',
      links: [{ title: 't', url: 'u' }],
      real_name: { name: '姓名：张三' },
    }

    const user = new User(info, details)
    expect(user.url).toBe('https://weibo.com/u/111')
    expect(user.realName).toBe('张三')
    expect(user.creditLevel).toBe('2')
    expect(user.externalLinks).toEqual([{ title: 't', url: 'u' }])
    expect(user.stats).toEqual({ followers: 3, friends: 4, statuses: 5 })
  })
})
