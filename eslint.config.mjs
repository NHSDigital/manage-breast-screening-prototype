// eslint.config.mjs
//
// The lint step of the smoke suite. Its job is narrow: catch identifiers that
// do not resolve - the kind of bug a routes split leaves behind, where a helper
// stays in one module while all its callers move to another. Node only throws
// on that when the route actually runs, so nothing else notices until someone
// clicks the page.
//
// Style is Prettier's job, not this config's, so stylistic rules stay off.

import js from '@eslint/js'
import globals from 'globals'

export default [
  {
    ignores: [
      'node_modules/**',
      'public/**',
      'app/data/generated/**',
      '.cache/**',
      '.tmp/**',
      'test-results/**',
      'playwright-report/**',

      // Jest specs inherited from the prototype kit. Jest is not installed, so
      // they cannot run - see notes/2026-07-15-smoke-tests/snags.md
      'tests/lib/**'
    ]
  },

  // Server-side code: app routes, helpers, generators, scripts and tests
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node
      }
    },
    rules: {
      ...js.configs.recommended.rules,

      // The point of this config
      'no-undef': 'error',

      // This is prototype code. Tidiness findings are worth seeing but should
      // not fail a run - only things that are, or hide, real breakage do.
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-useless-assignment': 'warn',
      'no-useless-escape': 'warn',
      'no-case-declarations': 'warn',
      'no-empty-pattern': 'warn',

      // Empty catch blocks are used deliberately for optional lookups
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },

  // Browser code, bundled by esbuild and served to the page
  {
    files: ['app/assets/javascript/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Set up by other scripts on the page
        openModal: 'readonly',
        closeModal: 'readonly'
      }
    }
  },

  // End-to-end tests. Callbacks passed to page.evaluate and
  // page.waitForFunction run in the browser, not in Node.
  {
    files: ['tests/e2e/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser
      }
    }
  },

  // ES modules
  {
    files: ['**/*.mjs'],
    languageOptions: {
      sourceType: 'module'
    }
  }
]
