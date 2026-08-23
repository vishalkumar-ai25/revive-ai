const fs = require('fs');
let content = fs.readFileSync('src/lib/engine/recovery-engine.ts', 'utf8');

content = content.replace(/private getNext9AmIst\(now: Date\): Date \{[\s\S]+?return new Date\(Date\.UTC\([^)]+\)\);\n  \}/,
`private getNext9AmIst(now: Date): Date {
    return nextIstTime(now, 9, 0);
  }`);

fs.writeFileSync('src/lib/engine/recovery-engine.ts', content);
