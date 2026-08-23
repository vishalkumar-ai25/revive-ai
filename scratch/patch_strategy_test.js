const fs = require('fs');
let content = fs.readFileSync('tests/strategy-agent.test.ts', 'utf8');

if (!content.includes('function createMockDiagnosis')) {
  const insertIndex = content.indexOf('// Helper');
  const mockFunc = `
function createMockDiagnosis(overrides = {}) {
  return {
    category: "BANK_TIMEOUT",
    isRecoverable: true,
    confidence: 0.9,
    rootCause: "Test cause",
    signals: [],
    ...overrides
  };
}
`;
  content = content.slice(0, insertIndex) + mockFunc + '\n' + content.slice(insertIndex);
  fs.writeFileSync('tests/strategy-agent.test.ts', content);
}
