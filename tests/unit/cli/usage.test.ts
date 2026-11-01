import { describe, expect, it } from 'vitest'
import { main } from '~/cli'
import { tweetDetail } from '~/cli/commands/tweet'
import { displayWidth, renderCliUsage } from '~/cli/usage'

describe('displayWidth', () => {
  it('counts CJK characters as two columns', () => {
    expect(displayWidth('abc')).toBe(3)
    expect(displayWidth('中文')).toBe(4)
    expect(displayWidth('a中b')).toBe(4)
  })
})

describe('renderCliUsage', () => {
  it('aligns columns by display width and never pads to the longest line', async () => {
    const usage = await renderCliUsage(main)
    const lines = usage.split('\n')

    for (const line of lines)
      expect(line).toBe(line.trimEnd())

    for (const line of lines)
      expect(displayWidth(line)).toBeLessThan(160)

    // COMMANDS 表：每条命令的描述都从同一列开始（按显示宽度算）
    const descColumns = lines
      .filter(line => /^ {2}\S/.test(line))
      .map((line) => {
        // 表格用 2+ 空格分隔「命令」与「描述」两列
        const description = line.split(/ {2,}/)[2]
        if (!description)
          return undefined
        return displayWidth(line.slice(0, line.indexOf(description)))
      })
      .filter((value): value is number => value !== undefined)

    expect(descColumns.length).toBeGreaterThan(10)
    expect(new Set(descColumns).size).toBe(1)
  })

  it('renders the declared options of a leaf command', async () => {
    const usage = await renderCliUsage(tweetDetail, { meta: { name: 'tweet' } })

    expect(usage).toContain('tweet detail')
    expect(usage).toContain('--full')
    expect(usage).toContain('-f, --format=<format>')
    expect(usage).toContain('<ID>')
  })
})
