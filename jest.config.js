module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.js'],
  clearMocks: true,
  restoreMocks: true,
  // Evita que el mapa de Jest parsee package.json inválido en outputs/ (artefactos del orquestador)
  modulePathIgnorePatterns: ['<rootDir>/outputs/', '<rootDir>/node_modules/']
};

