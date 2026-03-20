module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  clearMocks: true,
  restoreMocks: true,
  // Evita que el mapa de Jest parsee package.json inválidos en outputs/ (artefactos del orquestador)
  modulePathIgnorePatterns: ['<rootDir>/outputs/', '<rootDir>/node_modules/']
};

