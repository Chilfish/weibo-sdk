import { join } from 'node:path'
import { readEnvValue } from '../../src/utils/envFile'

// Cookie 只从 <pwd>/.env 读取；不继承可能过期的 WEIBO_COOKIE 环境变量。
const cookie = readEnvValue(join(process.cwd(), '.env'), 'WEIBO_COOKIE')
process.env.WEIBO_COOKIE = cookie ?? ''
