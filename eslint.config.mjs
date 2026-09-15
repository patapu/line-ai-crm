import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

// [F] flat config: `next lint` was removed in Next 16, so ESLint runs via
// its own CLI (see `npm run lint`). See node_modules/next/dist/docs/01-app/
// 03-api-reference/05-config/03-eslint.md for the setup this mirrors.
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    '.claude/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'lib/generated/**',
    'coverage/**',
  ]),
])

export default eslintConfig
