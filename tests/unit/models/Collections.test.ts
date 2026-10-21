import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  normalizeAlbum,
  normalizeMblogGroups,
  normalizeSuperTopic,
  normalizeSuperTopicCategory,
  normalizeUserGroups,
} from '~/models/data'
import {
  renderAlbumListMarkdown,
  renderMblogGroupListMarkdown,
  renderSuperTopicCategoryListMarkdown,
  renderSuperTopicListMarkdown,
  renderTrendListMarkdown,
  renderUserGroupListMarkdown,
} from '~/models/view/Collections'

function loadFixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(join('tests/fixtures/raw', name), 'utf8'))
}

describe('group renderers', () => {
  it('renders follow groups with category and type', () => {
    const groups = normalizeUserGroups(loadFixture('feed_groups.json'))

    const markdown = renderUserGroupListMarkdown(groups)

    expect(markdown).toContain('# 关注分组')
    expect(markdown).toContain('1. **全部关注**')
    expect(markdown).toContain('分类：默认分组')
    expect(markdown).toContain('type ')
  })

  it('renders mblog groups', () => {
    const groups = normalizeMblogGroups(loadFixture('mblog_groups.json'))

    const markdown = renderMblogGroupListMarkdown(groups)

    expect(markdown).toContain('# 微博分组')
    expect(markdown).toContain('1. **海洋鱼** · id ')
    expect(markdown).toContain('pageObjectId：')
  })
})

describe('topic renderers', () => {
  it('renders categories', () => {
    const categories = loadFixture('stopic_cates.json').data.map(normalizeSuperTopicCategory)

    const markdown = renderSuperTopicCategoryListMarkdown(categories)

    expect(markdown).toContain('# 超话分类')
    expect(markdown).toContain('1. **最近使用** · id 123333')
    expect(markdown).toContain('2. **游戏** · id 126')
  })

  it('renders topics with their page id', () => {
    const topics = loadFixture('stopic_list_p1.json').data.map(normalizeSuperTopic)

    const markdown = renderSuperTopicListMarkdown(topics, { title: '超话列表' })

    expect(markdown).toContain('# 超话列表')
    expect(markdown).toContain('1. **青木阳菜** · 100808')
  })
})

describe('album renderer', () => {
  it('renders the album list', () => {
    const albums = loadFixture('album_list.json').data.map(normalizeAlbum)

    const markdown = renderAlbumListMarkdown(albums)

    expect(markdown).toContain('# 相册')
    expect(markdown).toContain('1. **赞过** · containerId ')
    expect(markdown).toContain('3. **原创** · containerId ')
  })
})

describe('trend renderer', () => {
  it('renders the hot search ranking from a real fixture', () => {
    const items = loadFixture('hot_trends.json').data.realtime

    const markdown = renderTrendListMarkdown(items, { title: '热搜榜（hot）' })

    expect(markdown).toContain('# 热搜榜（hot）')
    expect(markdown).toContain('1. 张雪机车捷克站夺冠 · 热度 1,987,490 · 新')
    expect(markdown).toContain('2. 女孩盲道被撞摆拍细节露馅')
  })
})
