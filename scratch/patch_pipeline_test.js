const fs = require('fs');
let content = fs.readFileSync('tests/pipeline.test.ts', 'utf8');
content = content.replace(/previousFailures: 1,/, 'previousFailures: 0,');
fs.writeFileSync('tests/pipeline.test.ts', content);
