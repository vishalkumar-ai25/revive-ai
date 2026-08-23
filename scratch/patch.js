const fs = require('fs');
let content = fs.readFileSync('src/lib/engine/stopping-rules.ts', 'utf8');

if (!content.includes('toIstHour')) {
  content = 'import { toIstHour } from "@/lib/time/ist";\n' + content;
}

content = content.replace(/private isQuietHours\([^\}]+\{\s+const istOffset[^}]+istHour < QUIET_HOURS\.END_HOUR;\n  \}/, 
`private isQuietHours(): boolean {
    const istHour = toIstHour(this.clock.now());
    return istHour >= QUIET_HOURS.START_HOUR || istHour < QUIET_HOURS.END_HOUR;
  }`);

fs.writeFileSync('src/lib/engine/stopping-rules.ts', content);
