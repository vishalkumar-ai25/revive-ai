const fs = require('fs');
let content = fs.readFileSync('src/lib/engine/recovery-engine.ts', 'utf8');
content = content.replace('import { nextIstTime } from "@/lib/time/ist";\n', '');
content = 'import { nextIstTime } from "@/lib/time/ist";\n' + content;
fs.writeFileSync('src/lib/engine/recovery-engine.ts', content);
