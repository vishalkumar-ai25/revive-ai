const fs = require('fs');
let content = fs.readFileSync('src/app/api/webhooks/payment/route.ts', 'utf8');
content = content.replace(/import crypto from "crypto";\nimport crypto from "crypto";/, 'import crypto from "crypto";');
fs.writeFileSync('src/app/api/webhooks/payment/route.ts', content);

let testContent = fs.readFileSync('tests/strategy-agent.test.ts', 'utf8');
testContent = testContent.replace(/return \{/g, 'return { category: "BANK_TIMEOUT" as any, ');
fs.writeFileSync('tests/strategy-agent.test.ts', testContent);

// Fix MANDATE_RULES unused in strategy-agent.ts
let strategyContent = fs.readFileSync('src/lib/agents/strategy-agent.ts', 'utf8');
strategyContent = strategyContent.replace(/  MANDATE_RULES,\n/g, '');
fs.writeFileSync('src/lib/agents/strategy-agent.ts', strategyContent);
