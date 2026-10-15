const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['web/**', 'node_modules/**', 'data/**', 'src/data/**', 'lavalink/**', '.shots/**', 'test-results/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
