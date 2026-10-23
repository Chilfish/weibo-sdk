import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { collectCallUsage, collectImportedNames } from '../../../scripts/playground-coverage'

function parse(text: string): ts.SourceFile {
  return ts.createSourceFile('sample.ts', text, ts.ScriptTarget.Latest, true)
}

describe('collectImportedNames', () => {
  it('collects named and type imports from the package root only', () => {
    const source = parse([
      'import type { ITweet, ITweetContext } from \'@chilfish/weibo-sdk\'',
      'import { WeiboSDK, mergeArchiveFiles } from \'@chilfish/weibo-sdk\'',
      'import { readFileSync } from \'node:fs\'',
    ].join('\n'))

    expect(collectImportedNames(source)).toEqual([
      'ITweet',
      'ITweetContext',
      'WeiboSDK',
      'mergeArchiveFiles',
    ])
  })
})

describe('collectCallUsage', () => {
  const serviceProps = new Set(['users', 'tweets'])
  const facadeMethods = new Set(['getSession', 'checkSession'])

  it('matches service and facade calls but ignores unrelated methods', () => {
    const source = parse([
      'sdk.users.getById(\'1\')',
      'sdk.tweets.streamComments(\'id\')',
      'sdk.getSession()',
      'sdk.checkSession()',
      'array.map(item => item)',
    ].join('\n'))

    const usage = collectCallUsage(source, serviceProps, facadeMethods)
    expect(usage.serviceCalls).toEqual([
      { service: 'users', method: 'getById' },
      { service: 'tweets', method: 'streamComments' },
    ])
    expect(usage.facadeCalls).toEqual(['getSession', 'checkSession'])
  })

  it('only counts receivers that are known service properties', () => {
    const source = parse('other.tweets.getById(\'1\')')
    expect(collectCallUsage(source, new Set(['users']), facadeMethods).serviceCalls).toEqual([])
  })
})
