const fs = require('fs');
let content = fs.readFileSync('tests/strategy-agent.test.ts', 'utf8');

// Undo the bad replace
content = content.replace(/return \{ category: "BANK_TIMEOUT" as any, \n/g, 'return {\n');

// specifically fix createMockDiagnosis
content = content.replace(/function createMockDiagnosis\(overrides = \{\}\) \{\n  return \{\n    category: "BANK_TIMEOUT",/g,
\`function createMockDiagnosis(overrides = {}): any {
  return {
    category: "BANK_TIMEOUT",\`);

fs.writeFileSync('tests/strategy-agent.test.ts', content);
