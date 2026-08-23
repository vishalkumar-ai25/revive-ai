const fs = require('fs');
let content = fs.readFileSync('tests/clock-wiring.test.ts', 'utf8');
content = content.replace(/getFullYear\(\)/g, 'getUTCFullYear()');
fs.writeFileSync('tests/clock-wiring.test.ts', content);
