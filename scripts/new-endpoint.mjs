// 端点脚手架：pnpm new:endpoint <domain>/<name>
// 生成一个最小 EndpointSpec 文件，并打印后续接入步骤（fixture → service → CLI → 测试 → 文档）。
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [target] = process.argv.slice(2)
if (!target || !target.includes('/')) {
  console.error('用法: pnpm new:endpoint <domain>/<name>')
  console.error('示例: pnpm new:endpoint tweet/bookmarks')
  process.exit(1)
}

const [domain, rawName] = target.split('/')
const SEGMENT_RE = /^[a-z][A-Za-z0-9]*$/
if (!SEGMENT_RE.test(domain) || !SEGMENT_RE.test(rawName)) {
  console.error('domain / name 必须是小写开头的字母数字（camelCase 允许）')
  process.exit(1)
}

const name = rawName
const pascal = name[0].toUpperCase() + name.slice(1)
const file = join(
  process.cwd(),
  'src',
  'services',
  'endpoints',
  `${domain}-${name}.ts`,
)
if (existsSync(file)) {
  console.error(`文件已存在: ${file}`)
  process.exit(1)
}

const resourceType = `${domain.toUpperCase()}_${name.replace(/([A-Z])/g, '_$1').toUpperCase()}`
const endpoint = `ajax/${domain}/${name}`

const template = `import type { EndpointSpec } from '../internal/EndpointSpec'
import { z } from 'zod'
import { defineEndpoint } from '../internal/EndpointSpec'

/**
 * ${domain}/${name} 端点。
 *
 * 抓包与字段说明写在这里；schema 必须以真实 fixture 为准（tests/fixtures/raw/）。
 */
const ${pascal}ArgsSchema = z.object({
  // TODO: 按真实请求参数补齐（分页游标 / uid / id 等）
}).strict()

const ${pascal}ResponseSchema = z.object({
  ok: z.number(),
  data: z.unknown(),
}).loose()

export type ${pascal}Response = z.infer<typeof ${pascal}ResponseSchema>

export const ${name}Spec: EndpointSpec<resourceType.${resourceType}, typeof ${pascal}ArgsSchema> = defineEndpoint({
  resourceType: '${resourceType}',
  endpoint: '${endpoint}',
  argsSchema: ${pascal}ArgsSchema,
  buildResource: () => ({
    method: 'GET',
    url: 'https://weibo.com/${endpoint}',
    headers: { referer: 'https://weibo.com/' },
  }),
  okPolicy: { mode: 'require_ok_1' },
  schema: ${pascal}ResponseSchema,
})
`

mkdirSync(join(process.cwd(), 'src', 'services', 'endpoints'), {
  recursive: true,
})
writeFileSync(file, template)

console.log(
  JSON.stringify(
    {
      created: file,
      resourceType,
      endpoint,
      next: [
        '用已登录浏览器抓取真实响应（pnpm capture:endpoint <url>），脱敏后放入 tests/fixtures/raw/',
        '在 tests/fixtures/raw/INDEX.md 与 scripts/validate-fixtures.ts 的 FIXTURE_RULES 登记',
        '补全 argsSchema / responseSchema，并用 fixture 做 safeParse',
        '在对应 Service 中调用 this.request(spec, args)，补归一化（可选）',
        '补 CLI 子命令、unit / component 测试与 website/cli/index.md',
      ],
    },
    null,
    2,
  ),
)
