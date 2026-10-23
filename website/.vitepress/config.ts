import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: 'Weibo SDK',
  description: '用 TypeScript 读取微博公开数据并归档的 SDK 与 CLI。',
  base: '/',
  cleanUrls: true,
  lastUpdated: true,
  sitemap: {
    hostname: 'https://weibo-sdk.chilfish.top',
  },
  head: [
    ['meta', { name: 'theme-color', content: '#e6162d' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'Weibo SDK' }],
  ],
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: '指南', link: '/guide/' },
      { text: 'API 参考', link: '/api/' },
      { text: 'CLI', link: '/cli/' },
      { text: '契约与格式', link: '/reference/tweet-contract' },
      {
        text: '链接',
        items: [
          { text: 'npm', link: 'https://www.npmjs.com/package/@chilfish/weibo-sdk' },
          { text: 'GitHub', link: 'https://github.com/Chilfish/weibo-sdk' },
          { text: 'Issues', link: 'https://github.com/Chilfish/weibo-sdk/issues' },
        ],
      },
    ],
    sidebar: {
      '/guide/': [
        {
          text: '开始',
          items: [
            { text: '概览', link: '/guide/' },
            { text: '安装与环境', link: '/guide/installation' },
            { text: '快速开始', link: '/guide/quick-start' },
            { text: '鉴权与访客模式', link: '/guide/authentication' },
          ],
        },
        {
          text: '使用',
          items: [
            { text: '分页与流式读取', link: '/guide/pagination-streaming' },
            { text: '错误、重试与限流', link: '/guide/errors-retries' },
            { text: '归档账号', link: '/guide/archive' },
            { text: '下载媒体', link: '/guide/media' },
            { text: '遥测与日志', link: '/guide/observability' },
            { text: '传输与插件', link: '/guide/extending' },
          ],
        },
        {
          text: '边界',
          items: [
            { text: '运行环境', link: '/guide/environments' },
            { text: '范围与限制', link: '/guide/limitations' },
          ],
        },
      ],
      '/api/': [
        {
          text: '使用参考',
          items: [
            { text: '如何阅读', link: '/api/' },
            { text: 'WeiboSDK 门面', link: '/api/sdk' },
            { text: '能力清单', link: '/api/capabilities' },
            { text: '错误', link: '/api/errors' },
          ],
        },
        {
          text: '服务',
          items: [
            { text: 'users', link: '/api/users' },
            { text: 'tweets（单条）', link: '/api/tweets' },
            { text: 'tweets（时间线）', link: '/api/tweets-timeline' },
            { text: 'tweets（评论 / 转发 / 点赞者）', link: '/api/tweets-engagement' },
            { text: 'followings', link: '/api/followings' },
            { text: 'favorites', link: '/api/favorites' },
            { text: 'likes', link: '/api/likes' },
            { text: 'commentHistory', link: '/api/comment-history' },
            { text: 'media', link: '/api/media' },
            { text: 'notifications', link: '/api/notifications' },
            { text: 'topics', link: '/api/topics' },
            { text: 'trends', link: '/api/trends' },
            { text: 'search', link: '/api/search' },
            { text: 'archive', link: '/api/archive' },
            { text: 'userArchive', link: '/api/user-archive' },
          ],
        },
        {
          text: '类型',
          items: [
            { text: '导出索引', link: '/api/types/' },
            { text: '领域模型', link: '/api/types/domain' },
            { text: '微博上下文', link: '/api/types/tweet-context' },
            { text: '归档与续跑', link: '/api/types/archive' },
            { text: '配置与扩展', link: '/api/types/config' },
            { text: '原始响应类型', link: '/api/types/raw' },
          ],
        },
      ],
      '/cli/': [
        {
          text: '命令行',
          items: [
            { text: '命令参考', link: '/cli/' },
          ],
        },
      ],
      '/reference/': [
        {
          text: '契约与格式',
          items: [
            { text: 'ITweet 契约', link: '/reference/tweet-contract' },
            { text: '归档格式', link: '/reference/archive-format' },
            { text: '范围归档', link: '/reference/user-archive' },
            { text: '媒体下载', link: '/reference/media-download' },
          ],
        },
        {
          text: '扩展与排障',
          items: [
            { text: '传输与插件', link: '/reference/plugins' },
            { text: '日志', link: '/reference/logging' },
            { text: '故障排查', link: '/reference/troubleshooting' },
          ],
        },
      ],
    },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            noResultsText: '没有找到结果',
            resetButtonTitle: '清除条件',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
          },
        },
      },
    },
    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一页', next: '下一页' },
    editLink: {
      pattern: 'https://github.com/Chilfish/weibo-sdk/edit/main/website/:path',
      text: '在 GitHub 上编辑此页',
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/Chilfish/weibo-sdk' },
      { icon: 'npm', link: 'https://www.npmjs.com/package/@chilfish/weibo-sdk' },
    ],
    footer: {
      message: '只读公开数据；请遵守微博服务条款与隐私边界。',
      copyright: 'MIT Licensed',
    },
  },
})
