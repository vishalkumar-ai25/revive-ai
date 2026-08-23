
> revive-ai@0.1.0 simulate
> tsx --env-file=.env src/lib/simulation/batch-runner.ts 1000


🚀 Starting batch simulation: 1000 payments

  📥 Ingesting 1000 failed payment events...
  📊 Ingested 100/1000 payments
  📊 Ingested 200/1000 payments
  📊 Ingested 300/1000 payments
  📊 Ingested 400/1000 payments
  📊 Ingested 500/1000 payments
  📊 Ingested 600/1000 payments
  📊 Ingested 700/1000 payments
  📊 Ingested 800/1000 payments
  📊 Ingested 900/1000 payments
  📊 Ingested 1000/1000 payments
  ⏳ Progressing virtual time over up to 169 hours...
  ⏳ T+24h — 170 attempts still pending
  ⏳ T+48h — 170 attempts still pending
  ✨ All recovery attempts resolved at T+72h

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📊 REVIVE AI — BATCH RECOVERY BENCHMARK REPORT (1,000 PAYMENTS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Total Failed Payments:        1,000
  Total Revenue at Risk:        ₹5,556,229

  ✅ Payments Recovered:        676 (67.6%)
  ✅ Revenue Recovered:         ₹4,055,221 (73.0% GMV recovered)
  ⏱  Total Benchmark Time:     9.0s (9ms per payment)

  CATEGORY BREAKDOWN:
    BANK_TIMEOUT             223 / 278 recovered        (80.2%)
    INSUFFICIENT_FUNDS       100 / 180 recovered        (55.6%)
    UPI_PSP_ERROR            87 / 110 recovered         (79.1%)
    CARD_DECLINED            67 / 103 recovered         (65.0%)
    NETWORK_ERROR            73 / 93 recovered          (78.5%)
    CHECKOUT_ABANDONED       40 / 79 recovered          (50.6%)
    OTP_EXPIRED              36 / 55 recovered          (65.5%)
    LIMIT_EXCEEDED           27 / 51 recovered          (52.9%)
    SUBSCRIPTION_FAILED      20 / 34 recovered          (58.8%)
    FRAUD_DETECTED           0 / 11 recovered           (0.0%)
    MANDATE_EXPIRED          3 / 6 recovered            (50.0%)

  STRATEGY BREAKDOWN:
    SMART_RETRY              383 successful out of 481 attempted
    ALT_PAYMENT              197 successful out of 340 attempted
    CUSTOMER_NUDGE           96 successful out of 168 attempted
    DO_NOTHING               0 successful out of 7976 attempted

  STOPPING RULES & COMPLIANCE ENFORCEMENT:
    Fraud Blocks Enforced:       11 transactions (100% compliance)
    Quiet Hours Deferrals:       0 nudges deferred to 9:00 AM IST
    Retry Cap Terminations:      0 transactions halted at 4 attempts
    Below Min Amount Halted:     0 transactions under ₹50
    Total Stopped by Rules:      324 payments marked DEAD

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

