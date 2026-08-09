// capture/src/filter.ts — 请求过滤与文件名生成（纯函数）

/** 判断 URL 是否为值得捕获的微博 API 请求：排除静态资源与埋点噪声 */
export function isApi(url: string): boolean {
  if (/\.(?:js|css|png|jpe?g|gif|svg|woff2?|mp4|webp|ico)(?:\?|$)/i.test(url))
    return false
  if (/\/log\/action/.test(url) || /\/log\/rum/.test(url))
    return false // 埋点噪声
  return /weibo\.com\/ajax\//.test(url)
    || /weibo\.cn\/api\//.test(url)
    || /m\.weibo\.cn\/api\//.test(url)
}

/** 由 URL 生成稳定的落盘文件名：<seq>_<path>[_u<uid>][_p<page>] */
export function fileName(url: string, seq: number): string {
  const u = new URL(url)
  const path = u.pathname.replace(/\/+/g, '_').replace(/^_/, '') || 'root'
  const uid = u.searchParams.get('uid')
  const page = u.searchParams.get('page')
  let name = `${String(seq).padStart(3, '0')}_${path}`
  if (uid)
    name += `_u${uid}`
  if (page)
    name += `_p${page}`
  return name
}
