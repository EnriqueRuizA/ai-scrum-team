// .eslintrc.cjs - FASE 4: lint minimo (Node CommonJS). Se endurece en FASE 5.
module.exports = {
  env: { node: true, es2022: true, jest: true },
  extends: ['eslint:recommended'],
  parserOptions: { ecmaVersion: 2022 },
  rules: {
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-eval': 'error',
    'no-implied-eval': 'error',
    // Los catch vacios son intencionales (best-effort); van documentados.
    'no-empty': ['error', { allowEmptyCatch: true }]
  },
  // FASE 5: src/ es codigo muerto pendiente de eliminar; fuera del gate.
  ignorePatterns: ['node_modules/', 'outputs/', 'sessions/', 'logs/', 'public/', 'src/', '*.min.js']
};
