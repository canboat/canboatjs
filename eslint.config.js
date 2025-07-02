const { defineConfig, globalIgnores } = require('eslint/config')
const js = require('@eslint/js')
const globals = require('globals')
const tseslint = require('typescript-eslint')
const prettier = require('eslint-config-prettier/flat')

module.exports = defineConfig([
  globalIgnores(['**/public', '**/dist', 'examples', 'ios_canboat.js', 'ios.js', '**/lib/*.test.*', '**/test'] ),

  // TypeScript options
  {
    files: ['**/*.ts'],
    extends: [common('@typescript-eslint/'), tseslint.configs.recommended],
    languageOptions: {
      parser: tseslint.parser,
      globals: globals.node
    },
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },

  // JavasScript-only options
  {
    files: ['**/*.js'],
    extends: [common(), js.configs.recommended],
    languageOptions: {
      globals: globals.node
    }
  },

  // Disable rules that prettier handles
  prettier
])

// Common rules for all files
function common(prefix = '') {
  return {
    rules: {
      [`${prefix}no-unused-vars`]: [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      [`${prefix}no-unused-expressions`]: [
        'error',
        {
          allowShortCircuit: true,
          allowTernary: true
        }
      ]
    }
  }
}
