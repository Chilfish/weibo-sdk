import type { ITweetComment } from '~/types/domain/ITweet'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeComment } from '~/models/data/Tweet'

function loadFixture(name: string): any {
  return JSON.parse(readFileSync(new URL(`../../fixtures/raw/${name}`, import.meta.url), 'utf8'))
}

describe('normalizeComment image comments', () => {
  it('extracts pics from a real single-image comment fixture', () => {
    const raw = loadFixture('comments.json')
    const withPics = raw.data.filter((comment: any) => comment.url_struct?.some((u: any) => u.pic_infos))
    expect(withPics.length).toBeGreaterThan(0)

    const comment = normalizeComment(withPics[0])
    expect(comment.pics).toBeDefined()
    expect(comment.pics!.length).toBeGreaterThan(0)
    expect(comment.pics![0].id).toBe(withPics[0].url_struct[0].pic_ids[0])
    expect(comment.pics![0].imageUrl).toBe('<URL>')
    expect(comment.pics![0].width).toBeGreaterThan(0)
    expect(comment.pics![0].height).toBeGreaterThan(0)
    expect(Object.keys(comment.pics![0]).sort()).toEqual(['height', 'id', 'imageUrl', 'width'])
  })

  it('dedupes url_struct entries for a real multi-image comment', () => {
    const raw = loadFixture('comments_pic_multi.json')
    const comments: ITweetComment[] = raw.data.map((item: any) => normalizeComment(item))

    const multi = comments.find(comment => comment.pics?.length === 2)
    expect(multi).toBeDefined()
    expect(new Set(multi!.pics!.map(pic => pic.id)).size).toBe(2)

    const single = comments.find(comment => comment.pics?.length === 1)
    expect(single).toBeDefined()
  })

  it('also extracts pics from myCmt fixtures', () => {
    const raw = loadFixture('my_comments_p1.json')
    const withPics = raw.data.comments.filter((comment: any) => comment.url_struct?.some((u: any) => u.pic_infos))
    expect(withPics.length).toBeGreaterThan(0)

    const normalized = normalizeComment(withPics[0])
    expect(normalized.pics!.length).toBeGreaterThan(0)
  })

  it('omits pics when the comment has no image card', () => {
    const comment = normalizeComment({ idstr: '1', text_raw: 'no image' })
    expect('pics' in comment).toBe(false)
  })

  it('prefers the largest available size and keeps numeric dimensions', () => {
    const comment = normalizeComment({
      idstr: '1',
      url_struct: [{
        pic_ids: ['pic-a'],
        pic_infos: {
          'pic-a': {
            thumbnail: { url: 'https://wx/thumbnail.jpg', width: 100, height: 120 },
            large: { url: 'https://wx/large.jpg', width: '1147', height: '1371' },
            woriginal: { url: 'https://wx/woriginal.jpg', width: '2048', height: '2730' },
          },
        },
      }],
    })

    expect(comment.pics).toEqual([
      { id: 'pic-a', imageUrl: 'https://wx/woriginal.jpg', width: 2048, height: 2730 },
    ])
  })

  it('normalizes pics on replies and reply_comment', () => {
    const comment = normalizeComment({
      idstr: '1',
      comments: [{
        idstr: '2',
        url_struct: [{ pic_infos: { 'pic-b': { large: { url: 'https://wx/b.jpg', width: 10, height: 20 } } } }],
      }],
      reply_comment: {
        idstr: '3',
        url_struct: [{ pic_infos: { 'pic-c': { bmiddle: { url: 'https://wx/c.jpg', width: 3, height: 4 } } } }],
      },
    })

    expect(comment.replies![0].pics).toEqual([
      { id: 'pic-b', imageUrl: 'https://wx/b.jpg', width: 10, height: 20 },
    ])
    expect(comment.replyTo!.pics).toEqual([
      { id: 'pic-c', imageUrl: 'https://wx/c.jpg', width: 3, height: 4 },
    ])
  })
})
