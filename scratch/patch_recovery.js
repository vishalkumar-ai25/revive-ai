const fs = require('fs');
let content = fs.readFileSync('src/lib/engine/recovery-engine.ts', 'utf8');

if (!content.includes('nextIstTime')) {
  // Find last import
  const lastImportIndex = content.lastIndexOf('import');
  const nextLineIndex = content.indexOf('\n', lastImportIndex);
  content = content.slice(0, nextLineIndex + 1) + 'import { nextIstTime } from "@/lib/time/ist";\n' + content.slice(nextLineIndex + 1);
}

content = content.replace(/private getNext9AmIst\(\): Date \{[\s\S]+?return new Date\(Date\.UTC\([\s\S]+?\}\n\s+\}/,
`private getNext9AmIst(): Date {
    return nextIstTime(this.clock.now(), 9, 0);
  }`);

fs.writeFileSync('src/lib/engine/recovery-engine.ts', content);
