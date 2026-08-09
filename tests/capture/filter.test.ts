// tests/capture/filter.test.ts — isApi / fileName 纯函数
import { describe, expect, it } from 'vitest'
import { fileName, isApi } from '../../capture/src/filter'

describe('isApi', () => {
  it('保留微博 ajax / api 请求', () => {
    expect(isApi('https://weibo.com/ajax/statuses/mymblog?uid=1')).toBe(true)
    expect(isApi('https://weibo.cn/api/statuses/show')).toBe(true)
    expect(isApi('https://m.weibo.cn/api/container/getIndex')).toBe(true)
  })

  it('排除静态资源', () => {
    expect(isApi('https://weibo.com/static/1.js?x=1')).toBe(false)
    expect(isApi('https://weibo.com/img/logo.png')).toBe(false)
    expect(isApi('https://weibo.com/favicon.ico')).toBe(false)
  })

  it('排除埋点噪声', () => {
    expect(isApi('https://weibo.com/ajax/log/action')).toBe(false)
    expect(isApi('https://weibo.com/ajax/log/rum')).toBe(false)
  })

  it('排除非微博 host', () => {
    expect(isApi('https://example.com/ajax/foo')).toBe(false)
  })
})

describe('fileName', () => {
  it('按 path + seq 命名', () => {
    expect(fileName('https://weibo.com/ajax/side/bandUnified?type=hot', 6)).toBe('006_ajax_side_bandUnified')
  })

  it('附加 uid 与 page 参数', () => {
    const n = fileName('https://weibo.com/ajax/statuses/mymblog?uid=2365795232&page=1', 8)
    expect(n).toBe('008_ajax_statuses_mymblog_u2365795232_p1')
  })

  it('空 path 回退 root', () => {
    expect(fileName('https://weibo.com/', 1)).toBe('001_root')
  })
})
