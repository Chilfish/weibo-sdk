import { dataPath, rawPath, userId, writeJson } from 'tests/utils'
import { WeiboSDK } from '~/WeiboSDK'

const weibo = new WeiboSDK({
  cookie: process.env.WEIBO_COOKIE || '',
})

weibo.users.onFetched = async (resource, data) => {
  await writeJson(data, `${rawPath}/${resource}.json`)
}

// const rawDetail = await weibo.users.details(userId)
// const rawUser = await weibo.users.info(userId)

// const user = new User(rawUser.data.user, rawDetail.data)

const user = await weibo.users.getById(userId)

await writeJson(user, `${dataPath}/user.json`)
