import { configDefaults, defineConfig } from 'vitest/config'
import path from 'path'

// [F] node environment, no React plugin: layer 0 tests exercise pure
// functions (contracts, auth, logging), not components. Lane D's DB-backed
// tests also run under this config.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // `server-only` throws unless the bundler resolves the React server
      // condition, which Vitest does not. Point it at the package's own
      // empty.js (what the react-server condition would pick) so server
      // modules such as lib/auth/session.ts can be unit tested.
      'server-only': path.resolve(__dirname, 'node_modules/server-only/empty.js'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Lane D's DB-backed test files all share one Postgres instance (no
    // per-file schema or transaction isolation), so running test files in
    // parallel would let them race on the same rows. Force one file at a
    // time; within a file, tests still run in the normal Vitest order.
    fileParallelism: false,
    // Session worktrees live under .claude/worktrees; never collect their tests.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
})
