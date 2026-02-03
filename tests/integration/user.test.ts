import { UserNormalizer } from '~/utils/Normalizer'
import { WeiboSDK } from '~/WeiboSDK'

const weibo = new WeiboSDK({
  cookie: process.env.WEIBO_COOKIE || '',
})

const rawUser = await weibo.users.info('3478353331')
const user = UserNormalizer.normalize(rawUser)

console.log(user, rawUser)
