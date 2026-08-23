
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
  ✨ All recovery attempts resolved at T+10h

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📊 REVIVE AI — BATCH RECOVERY BENCHMARK REPORT (1,000 PAYMENTS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Total Failed Payments:        1,000
  Total Revenue at Risk:        ₹5,221,602

  ✅ Payments Recovered:        683 (68.3%)
  ✅ Revenue Recovered:         ₹3,752,444 (71.9% GMV recovered)
  ⏱  Total Benchmark Time:     1.7s (2ms per payment)

  CATEGORY BREAKDOWN:
    BANK_TIMEOUT             236 / 288 recovered        (81.9%)
    INSUFFICIENT_FUNDS       100 / 183 recovered        (54.6%)
    UPI_PSP_ERROR            98 / 123 recovered         (79.7%)
    CARD_DECLINED            56 / 104 recovered         (53.8%)
    NETWORK_ERROR            79 / 93 recovered          (84.9%)
    CHECKOUT_ABANDONED       45 / 80 recovered          (56.3%)
    OTP_EXPIRED              43 / 59 recovered          (72.9%)
    LIMIT_EXCEEDED           16 / 28 recovered          (57.1%)
    SUBSCRIPTION_FAILED      9 / 21 recovered           (42.9%)
    FRAUD_DETECTED           0 / 18 recovered           (0.0%)
    MANDATE_EXPIRED          1 / 3 recovered            (33.3%)

  STRATEGY BREAKDOWN:
    SMART_RETRY              413 successful out of 504 attempted
    ALT_PAYMENT              173 successful out of 318 attempted
    CUSTOMER_NUDGE           97 successful out of 160 attempted
    DO_NOTHING               0 successful out of 172 attempted

  STOPPING RULES & COMPLIANCE ENFORCEMENT:
    Fraud Blocks Enforced:       18 transactions (100% compliance)
    Quiet Hours Deferrals:       0 nudges deferred to 9:00 AM IST
    Retry Cap Terminations:      0 transactions halted at 4 attempts
    Below Min Amount Halted:     0 transactions under ₹50
    Total Stopped by Rules:      317 payments marked DEAD

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

