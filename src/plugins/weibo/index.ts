import type { IPlugin } from '~/types/core'
import { WeiboProvider } from './provider'

/**
 * 微博插件工厂函数
 */
export function createWeiboPlugin(): IPlugin {
  return {
    name: 'plugin-weibo',
    setup(context) {
      const provider = new WeiboProvider(context)

      // 注册 Provider
      context.providers.register(provider)

      // 可以在这里扩展 context，例如添加一些微博特有的工具方法
      // context['weiboHelper'] = { ... };

      context.logger.info('Weibo plugin loaded successfully.')
    },
  }
}
