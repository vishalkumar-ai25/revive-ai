const fs = require('fs');
let content = fs.readFileSync('src/lib/agents/strategy-agent.ts', 'utf8');

content = content.replace(/private calculateOptimalRetryTime\(event: PaymentFailureEvent\): Date \{[\s\S]+?return retryDate;\n  \}/,
`private calculateOptimalRetryTime(event: PaymentFailureEvent): Date {
    const bank = event.bank ?? "DEFAULT";
    const window = BANK_RETRY_WINDOWS[bank] ?? BANK_RETRY_WINDOWS["DEFAULT"]!;

    const now = this.clock.now();
    const istHour = toIstHour(now);

    // If current IST hour is in the avoid window or outside best window
    if (
      window.avoidHours.includes(istHour) ||
      istHour < window.bestHourStart ||
      istHour > window.bestHourEnd
    ) {
      // Schedule for the middle of the best window
      const targetHour = Math.floor((window.bestHourStart + window.bestHourEnd) / 2);
      return nextIstTime(now, targetHour, 15);
    }

    // Otherwise schedule soon, but slightly randomized within the next hour
    return new Date(now.getTime() + (10 + Math.random() * 50) * 60000);
  }`);

content = content.replace(/private calculateNudgeTime\(\): Date \{[\s\S]+?return nudge;\n  \}/,
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
