module.exports = {
  testEnvironment: 'node',
  // FASE 4: los suites reales viven en __tests__/. tests/ quedo para humo
  // (eliminado en phase-4) y no debe entrar en Jest.
  testMatch: ['**/__tests__/**/*.test.js'],
  clearMocks: true,
  restoreMocks: true,
  // Evita que el mapa de Jest parsee package.json inválido en outputs/ (artefactos del orquestador)
  modulePathIgnorePatterns: ['<rootDir>/outputs/', '<rootDir>/node_modules/']
};
