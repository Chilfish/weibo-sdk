// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'lib',
    pnpm: true,
  },
  {
    rules: {
      'no-console': 'off',
      'no-unused-vars': 'warn',
      'ts/no-unsafe-function-type': 'warn',
    },
  },
)
