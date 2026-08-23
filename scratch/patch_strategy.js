const fs = require('fs');
let content = fs.readFileSync('src/lib/agents/strategy-agent.ts', 'utf8');

if (!content.includes('toIstHour')) {
  // Find last import
  const lastImportIndex = content.lastIndexOf('import');
  const nextLineIndex = content.indexOf('\n', lastImportIndex);
  content = content.slice(0, nextLineIndex + 1) + 'import { toIstHour, nextIstTime } from "@/lib/time/ist";\n' + content.slice(nextLineIndex + 1);
}

content = content.replace(/private calculateOptimalRetryTime\(\): Date \{[\s\S]+?return retryDate;\n  \}/,
`private calculateOptimalRetryTime(): Date {
    const now = this.clock.now();
    const istHour = toIstHour(now);

    // If it's late night IST (10 PM to 6 AM), schedule for 8 AM IST next morning.
    // Real banks run batch reconciliations at night, retries during this window often fail.
    if (istHour >= 22 || istHour < 6) {
      return nextIstTime(now, 8, 0);
    }

    // Otherwise, add a backoff (e.g. 2 hours)
    return new Date(now.getTime() + 2 * 60 * 60 * 1000);
  }`);

content = content.replace(/private calculateNudgeTime\(\): Date \{[\s\S]+?return scheduledTime;\n  \}/,
`private calculateNudgeTime(): Date {
    const now = this.clock.now();
    
    // Nudges wait 2 hours from current time
    const scheduledTime = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const scheduledIstHour = toIstHour(scheduledTime);

    // If the scheduled time falls in quiet hours (9 PM - 9 AM IST),
    // push it to 9 AM IST the following morning.
    if (scheduledIstHour >= 21 || scheduledIstHour < 9) {
      return nextIstTime(now, 9, 0);
    }

    return scheduledTime;
  }`);

fs.writeFileSync('src/lib/agents/strategy-agent.ts', content);
