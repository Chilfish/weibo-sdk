// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'lib',
    pnpm: true,
  },
  {
    // schemas/** 是 `pnpm schema:archive` 的生成产物，不参与 lint / 自动修复
    // data/** 是本地抓取数据（已被 data/.gitignore 忽略），不应影响发布门禁
    ignores: ['tests/fixtures/raw/*.json', 'schemas/**/*.json', 'data/**', '**/*.md'],
  },
  {
    rules: {
      'unused-imports/no-unused-vars': 'warn',
      'no-console': 'off',
      'antfu/no-import-dist': 'off',
      'antfu/no-top-level-await': 'off',
      'node/prefer-global/buffer': 'off',
      'node/prefer-global/process': 'off',
      'accessor-pairs': 'off',
      'style/multiline-ternary': 'off',
      'ts/no-use-before-define': 'warn',
      'no-case-declarations': 'off',
    },
  },
)
