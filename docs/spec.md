# Specification: ReviveAI — Autonomous Revenue Recovery Agent

**Version:** 2.1.0  
**Status:** Approved for Implementation  
**Author:** Vishal Kumar  
**Track:** Track 03 · Autonomous Revenue Recovery (Razorpay AI Buildathon 2026)  

---

## 1. Objective

### 1.1 Problem Statement
In the Indian digital payments ecosystem, revenue loss rarely occurs in a single clean event. It happens progressively through multi-step degradations:
1. **One-Time Payment Degradation:** Bank downtime, UPI PSP timeouts, or gateway drops cause failed transactions. Naive systems retry immediately, worsening peak load or repeating the same failure.
2. **Checkout Drop-Off:** Distracted or hesitant buyers abandon checkout sessions without attempting payment.
3. **Failed Subscription Renewals:** In SaaS, OTT, and recurring billing, renewals fail due to expired cards, temporary low balances, or bank-side issues, directly causing involuntary customer churn.
4. **Mandate & Auto-Debit Failures:** Recurring e-mandates (UPI Autopay, e-NACH, SIPs, EMIs) fail due to balance timing, PSP downtimes, or expired mandates, with strict RBI circular rules governing retries.

### 1.2 The ReviveAI Solution
ReviveAI is an autonomous, rule-bounded multi-agent revenue recovery engine that:
- **Detects revenue at risk in real time** across one-time payments, checkout drop-offs, subscriptions, and auto-debit mandates.
- **Intelligently diagnoses root causes** using LLM reasoning (Gemini 2.0 Flash) combined with high-precision deterministic rules.
- **Selects and schedules optimal interventions:** Smart Bank-Timed Retries, Privacy-Preserving Customer Nudges, Alternative Payment Rail Suggestions, Merchant Escalation, and RBI-Compliant Mandate Retry Sequences.
- **Enforces strict, bounded stopping rules and compliance guardrails:** Hard limits on retry attempts (max 4), customer nudges (max 3), 72-hour recovery windows, quiet hours (9 PM – 9 AM IST for customer-facing outreach only), zero retries on fraud blocks, and customer opt-out respect.
- **Drives a dynamic multi-attempt escalation ladder** through an injectable virtual clock ($T+0 \rightarrow T+1\text{h} \rightarrow T+24\text{h} \rightarrow T+48\text{h} \rightarrow T+72\text{h}$).
- **Measures aggregate money recovered across 500–1,000 payment batches**, delivering empirical proof of ROI and maintaining an immutable audit log of every agent decision.

### 1.3 User Personas & Success Definition
1. **Merchant Operations Analyst:** Watches the live activity feed, inspects step-by-step agent chain-of-thought provenance in the audit modal, and resolves high-value Level-4 escalations from the dedicated merchant queue.
2. **Buildathon Judge / Technical Evaluator:** Runs `npm run simulate 1000`, reviews the printed aggregate recovery report, spot-checks audit decision provenance for individual payments, and verifies that stopping rules fire deterministically.

---

## 2. Core Failure Directions (Scope)

| Direction | Domain | Failure Mechanism | Autonomous Recovery Intervention | Status |
|---|---|---|---|---|
| **#1 Payment Failure Recovery** | One-time transactions (UPI, Cards, Netbanking) | Bank server timeouts, PSP errors, network dropouts | Bank-specific optimal time window retries (e.g., HDFC 8–10 AM), intelligent routing, alternative payment rail suggestion | ✅ Implemented |
| **#2 Checkout Drop-Off Recovery** | Pre-payment abandonment | Cart opened, checkout initialized, user navigated away | Timed respectful recovery email/SMS with cart reservation token and direct one-click checkout link | ✅ Implemented |
| **#3 Failed Subscription Recovery** | Recurring SaaS / OTT billing | Card expired, renewal failed, transient low balance | Grace period management, salary-cycle-aligned retry (1st–5th of month), update payment method prompt | ✅ Implemented |
| **#4 Mandate Retry Sequencer** | UPI Autopay / e-NACH mandates | Bank debit failed, mandate timing issue, RBI re-auth | RBI-compliant 4-attempt sequencer with progressive time spacing and automatic rail fallback (UPI $\rightarrow$ e-NACH/Card) | ✅ Implemented |

**Deliberately Out of Scope:** B2B receivables chaser (requires full accounting ERP domain), Hinglish voice agent (telephony/voice latency bloat), promise-to-pay tracker. Explicitly calling these out as conscious scoping decisions.

---

## 3. The Bar: Evaluation & Quality Non-Negotiables

### 3.1 Measured Money Recovered Across a Batch
- **Batch Benchmark Engine:** Processes batches of 500 to 1,000 synthetic payment failures modeled after realistic Indian payment distributions (55% UPI, 20% Debit Card, 12% Credit Card, 5% Netbanking, 3% Wallet, 3% EMI, 2% Mandate).
- **Comprehensive Aggregate Report:**
  - Total Payments Processed & Total Revenue at Risk (₹)
  - Payments Recovered & Revenue Recovered (₹)
  - Overall Recovery Success Rate (%)
  - Breakdown by Strategy: Smart Retries, Customer Nudges, Alt-Payment Suggestions, Merchant Escalations
  - Breakdown of Unrecoverable Transactions: Fraud blocks, Customer unresponsive, Max retry limit reached, Amount below threshold (<₹50)
- **Probabilistic Outcome Simulation:** Transparently documented as a probabilistic outcome model based on risk score and strategy efficacy modifier (`Math.random() < adjustedProbability`), serving as a placeholder for live gateway webhooks.

### 3.2 Dynamic Compliant Escalation Ladder
ReviveAI enforces a dynamic 5-level escalation ladder progressed through an injectable virtual clock:
- **Level 1 (Immediate / T+0):** On-screen suggestion or silent backend retry.
- **Level 2 (T+1 hour / Post-Window):** Personalized recovery email containing a direct secure `/recover/[paymentId]` link.
- **Level 3 (T+24 hours):** SMS reminder if email remains uncompleted.
- **Level 4 (T+48 hours):** Escalation flag in Merchant Escalation Queue for manual high-value relationship manager follow-up.
- **Level 5 (T+72 hours):** Marked as `DEAD` / Unrecoverable. All automated outreach permanently halts.

**Compliance Constraints:**
- **Quiet Hours (TRAI / DPDP):** No customer communications (Email/SMS) dispatched between 9:00 PM and 9:00 AM IST. Silent backend retries (`SMART_RETRY`) are explicitly **exempt** from quiet hours because they do not contact the customer.
- **Max Customer Contacts:** No more than 3 customer-facing messages per transaction.
- **Privacy Protection:** Never disclose sensitive failure reasons (e.g. "insufficient balance") to customers; communications use neutral, respectful phrasing ("your bank was unable to complete the transaction").

### 3.3 Strict Stopping Rules & Guardrails
```typescript
export const STOPPING_RULES = {
  MAX_RETRY_ATTEMPTS: 4,               // Hard limit per RBI mandate / merchant policy
  MAX_NUDGE_MESSAGES: 3,               // Anti-spam customer protection
  MAX_RECOVERY_WINDOW_HOURS: 72,       // Hard expiry for recovery efforts
  MIN_RECOVERY_AMOUNT_INR: 50,         // Do not spend recovery cost on micro-amounts
  MIN_RECOVERY_PROBABILITY: 0.15,      // Threshold below which recovery is skipped
  FRAUD_BLOCK_POLICY: "NEVER_RETRY",   // Strict zero tolerance for bank fraud flags
  CUSTOMER_OPT_OUT_POLICY: "STOP_ALL", // Instant halt if customer opts out
} as const;
```

### 3.4 Immutable Audit Trail & Decision Provenance
Every decision made by any agent is logged as an immutable record in `audit_logs` containing:
- Timestamp (ISO 8601 UTC & IST)
- Agent Name (`DiagnosisAgent`, `RiskAssessmentAgent`, `StrategyAgent`, `MandateSequencer`, `StoppingRulesEngine`, `RecoveryEngine`)
- Action Triggered (e.g., `DIAGNOSIS_COMPLETE`, `RISK_ASSESSED`, `STRATEGY_SELECTED`, `RETRY_SCHEDULED`, `RECOVERY_STOPPED`)
- Reasoning Chain-of-Thought (Plain English justification for the decision)
- Structured Metadata (Probability scores, confidence values, execution parameters)
- Visual timeline presentation in the Merchant Dashboard with expandable JSON payload inspection.
- **Optimized Persistence:** Eliminates N+1 DB lookup by directly utilizing `paymentId` foreign key.

---

## 4. Multi-Agent Architecture

```
                       ┌────────────────────────┐
                       │  Payment Failure Event │
                       │ (Webhook / Simulation) │
                       └───────────┬────────────┘
                                   │
                                   ▼
                       ┌────────────────────────┐
                       │  Stopping Rules Engine │ ◄── [Fraud / Limit / Opt-Out Check]
                       └───────────┬────────────┘
                                   │ Passed
                                   ▼
                       ┌────────────────────────┐
                       │    Diagnosis Agent     │
                       │ (Gemini + Rule Fallback)
                       └───────────┬────────────┘
                                   │ Category & Root Cause
                                   ▼
                       ┌────────────────────────┐
                       │ Risk Assessment Agent  │
                       │  (LTV + Amount + CLV)  │
                       └───────────┬────────────┘
                                   │ Recovery Probability
                                   ▼
                       ┌────────────────────────┐
                       │     Strategy Agent     │
                       │   & Mandate Sequencer  │
                       └───────────┬────────────┘
                                   │ Strategy & Execution Params
                                   ▼
                       ┌────────────────────────┐
                       │    Recovery Engine     │
                       │ (Multi-Attempt Loop)   │ ◄── [Injectable Virtual Clock]
                       └───────────┬────────────┘
                                   │
                                   ▼
                       ┌────────────────────────┐
                       │   Escalation Ladder    │ ───► [Level 4 Merchant Queue]
                       └───────────┬────────────┘
                                   │
                                   ▼
                       ┌────────────────────────┐
                       │  Immutable Audit Log   │
                       └────────────────────────┘
```

**Architecture Note:** ReviveAI uses a strongly-typed, sequential TypeScript pipeline orchestrator (`RecoveryPipeline` in `src/lib/agents/index.ts`). No third-party agent graph dependencies (LangGraph) are used, ensuring zero runtime overhead and direct maintainability.

---

## 5. Virtual Clock & Time Virtualization

To enable the simulation of a 72-hour multi-attempt recovery lifecycle in milliseconds:
```typescript
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class VirtualClock implements Clock {
  private currentTime: Date;

  constructor(startTime: Date = new Date()) {
    this.currentTime = new Date(startTime);
  }

  now(): Date {
    return new Date(this.currentTime);
  }

  advanceHours(hours: number): void {
    this.currentTime.setHours(this.currentTime.getHours() + hours);
  }
}
```

---

## 6. Interactive Recovery Checkout Page (`/recover/[paymentId]`)

Provides an interactive demo surface where judges or customers can complete a recovery:
- **Route:** `/recover/[paymentId]`
- **Security Guardrail:** On page load and before capturing payment, the endpoint **strictly re-evaluates `StoppingRulesEngine.evaluate()`**. If the payment was flagged as `FRAUD_BLOCK`, expired past 72h, or reached max attempts, the page displays a disabled "Session Expired" alert and refuses payment capture.
- **Pay Action:** Clicking "Pay Now" triggers a simulated gateway capture, updating status to `RECOVERED` and logging `PAYMENT_RECOVERED_VIA_NUDGE_LINK` in the immutable audit trail.

---

## 7. Tech Stack & Infrastructure

| Component | Technology | Version | Purpose |
|---|---|---|---|
| **Framework** | Next.js (App Router) | 14.2.21 | Full-stack web application & API routes |
| **Language** | TypeScript | 5.7.0 | Strict type safety |
| **Database & ORM** | PostgreSQL + Prisma ORM | 6.8.0 | Single authoritative schema for state & audit logs |
| **Local Infrastructure** | Docker Compose | v2 | 1-command local Postgres instance (`docker compose up -d`) |
| **Cloud DB** | Neon / Supabase | Serverless PG | Zero-setup 1-click cloud database option |
| **AI / LLM** | Google Generative AI | 0.21.0 | Gemini 2.0 Flash reasoning with deterministic fallback |
| **Validation** | Zod | 3.24.0 | Runtime schema validation for webhooks & inputs |
| **Testing** | Node Native Test Runner (`tsx --test`) | v20.20.2 | Fast, zero-dependency unit and lifecycle test suite |
| **Email (Optional)** | Resend | 4.1.0 | Defensively wired; silently logs if `RESEND_API_KEY` unset |

---

## 8. Commands & Tooling

```bash
# 1. Local Database Setup (Choose One)
docker compose up -d         # Option A: Local Docker Postgres
# OR fill DATABASE_URL in .env with free Neon connection string (Option B)

# 2. Database Management
npm run db:generate          # Generate Prisma Client
npm run db:push              # Push schema to database
npm run db:seed              # Seed demo merchant & baseline records
npm run db:studio            # Open Prisma Studio web inspector

# 3. Development & Build
npm run dev                  # Start Next.js on localhost:3000
npm run build                # Production build
npm start                    # Start production server

# 4. Automated Test Suite
npm test                     # Run all unit & lifecycle tests via tsx --test

# 5. Batch Simulation & Benchmarking
npm run simulate             # Default 1000-payment batch benchmark
npm run simulate -- 500      # 500-payment batch benchmark
npm run simulate -- 100      # 100-payment batch benchmark

# 6. Quality Checks
npm run typecheck            # TypeScript compiler check (tsc --noEmit)
npm run lint                 # ESLint check
npm run format               # Prettier format check
```

---

## 9. Testing Strategy

```
tests/
├── diagnosis-agent.test.ts        # 12 categories, LLM + deterministic fallback
├── risk-assessment.test.ts        # CLV scoring, amount tiers, weighted math
├── strategy-agent.test.ts         # Strategy scoring & bank retry windows
├── mandate-sequencer.test.ts      # RBI circular compliance, 4-attempt cap, rail switching
├── stopping-rules.test.ts         # All 6 rules + quiet hours (SMART_RETRY allowance)
├── escalation-ladder.test.ts      # Level 1 → Level 5 progression & privacy messaging
├── multi-attempt-lifecycle.test.ts# Full attempt 1→2→3→4 progression with virtual clock
└── batch-runner.test.ts           # 1,000-payment benchmark validation & report metrics
```

---

## 10. Boundaries (Always / Ask First / Never)

### Always:
- Write an immutable audit log entry before and after every recovery decision.
- Respect Quiet Hours (9:00 PM – 9:00 AM IST) for all **customer-facing** channels (email/SMS).
- Permit silent backend retries (`SMART_RETRY`) during quiet hours.
- Abort recovery immediately on `FRAUD_DETECTED` or customer opt-out.
- Use privacy-preserving customer messaging (never disclose embarrassing details like "insufficient balance").
- Re-evaluate stopping rules on `/recover/[paymentId]` entry before allowing payment capture.

### Ask First:
- Modifying RBI mandate retry rules or increasing max retry limits beyond 4 attempts.
- Making database schema migrations or altering audit log schemas.

### Never:
- Attempt recovery on any transaction flagged as fraudulent by issuing banks.
- Send more than 3 nudge communications to a single customer for a transaction.
- Hardcode API keys or secrets in source code files.
- Claim unsupported frameworks or unbuilt files in documentation.

---

## 11. Acceptance & Success Criteria

- [ ] `docs/spec.md` and `README.md` describe 100% real codebase artifacts with zero aspirational claims.
- [ ] Quiet hours in `stopping-rules.ts` only gates customer-facing outreach (`CUSTOMER_NUDGE`), allowing silent `SMART_RETRY` to proceed.
- [ ] `MandateRetrySequencer` enforces RBI 4-attempt maximum, spacing, and rail-fallback from UPI Autopay to e-NACH/Card.
- [ ] Escalation ladder dynamically progresses unrecovered payments across levels, populating the Level-4 Merchant Escalation Queue.
- [ ] `npm test` runs cleanly across all test suites including multi-attempt lifecycle tests.
- [ ] `npm run lint` and `npm run typecheck` pass with 0 errors.
- [ ] 1,000-payment batch simulation completes in $<5$s with complete aggregate reporting.
- [ ] Interactive checkout page `/recover/[paymentId]` works with guardrails gating payment against dead/fraud transactions.

---

## 12. Phase 2 Addendum — Escalation Ladder & Multi-Attempt Lifecycle

**Version:** v2 (reviewed, challenges resolved)
**Status:** Approved for implementation — all open decisions resolved except Decision 1.
**Schema impact:** None. All changes work against the existing `prisma/schema.prisma`.
`RecoveryAttempt.outcome` already defaults to `PENDING`; `stoppedByRule` already exists.

---

### §12.0 Verified Findings (grounded against source, confirmed in review)

1. **The escalation ladder is not progressive.** `LEVEL_3_SMS` / channel `"sms"` exist in
   `constants.ts` / `types.ts` but are never assigned in `strategy-agent.ts::buildParams()`.
   Every `CUSTOMER_NUDGE` attempt is hardcoded to `LEVEL_2_EMAIL` forever.

2. **`stoppedByRule` / `STOPPED_BY_RULE` never reach the database.** Both stop paths in
   `recovery-engine.ts` return `outcome: "STOPPED_BY_RULE"` as an in-memory value and update
   `Payment.status = "DEAD"`, but no `RecoveryAttempt` row is created in either path. A
   rule-stopped payment leaves no `recovery_attempts` trace.

3. **Quiet hours permanently kills the payment, not just the one contact.** `recovery-engine.ts`
   Step 3.5 marks `Payment.status = "DEAD"` on a `QUIET_HOURS` trip — same as fraud. This is
   almost certainly wrong: quiet hours should defer the nudge, not terminate the payment.
   See Decision 1.

---

### §12.1 Terminology Clarification

**"Escalation ladder"** in this spec refers specifically to **contact-channel escalation for
customer-facing strategies** (email → SMS → merchant alert, driven by elapsed time). It does
**not** control which `RecoveryStrategy` is chosen per attempt — that remains `StrategyAgent`'s
responsibility, independently, per attempt, based on diagnosis + risk score.

A payment can legitimately sequence: `SMART_RETRY` (attempt 1) → `CUSTOMER_NUDGE` via email
(attempt 2) → `SMART_RETRY` again (attempt 3). The ladder only decides which *channel* a
`CUSTOMER_NUDGE` attempt uses at that elapsed-time point.

---

### §12.2 State Machine

#### Payment.status (transitions now span multiple attempts)

```
FAILED ──▶ RECOVERY_IN_PROGRESS ──▶ RECOVERED   (terminal — an attempt succeeded)
                │
                └────────────────▶ DEAD         (terminal — a stopping rule fired)
```

**Concrete regression to fix (Task 2.3):** `recovery-engine.ts` Step 6 currently does:
```ts
status: isSimulatedSuccess ? "RECOVERED" : "FAILED",
```
A failed first attempt today sets `Payment.status` back to `"FAILED"`. In the multi-attempt
world this silently breaks the loop. Fix: a failed attempt must leave `Payment.status` at
`RECOVERY_IN_PROGRESS`. Only a stopping rule moves it to `DEAD`; only success moves it to
`RECOVERED`.

#### RecoveryAttempt.outcome

```
PENDING ──(scheduledAt reached, tick() executes)──▶ SUCCESS → Payment.status = RECOVERED
                                                  └▶ FAILED  → re-run stopping rules:
                                                                  stop  → Payment.status = DEAD
                                                                  pass  → next attempt PENDING
PENDING ──(stopping rule trips before scheduledAt)──▶ STOPPED_BY_RULE → Payment.status = DEAD
```

#### Escalation level — time-driven, channel-selection only

```ts
function currentEscalationLevel(hoursSinceFailure: number): EscalationLevel {
  // Highest ESCALATION_CONFIG.delayHours threshold crossed wins.
  // Thresholds: 0h=LEVEL_1_ONSCREEN, 1h=LEVEL_2_EMAIL, 24h=LEVEL_3_SMS,
  //             48h=LEVEL_4_MERCHANT_ALERT, 72h=LEVEL_5_DEAD
}
```

Feeds only the `channel` field of a `CUSTOMER_NUDGE` attempt. `StrategyAgent` strategy
selection is untouched.

---

### §12.2a `previousAttempts` Outcome Semantics in StoppingRulesEngine (NEW — from review)

**Root cause:** Rules 3 and 4 in `stopping-rules.ts` filter only by `strategy` with no
`outcome` check. In the multi-attempt world, `tick()` calls `stoppingRules.evaluate()` while
other attempts are `PENDING`. An unexecuted `PENDING` attempt would be counted toward the
max-retry limit, potentially blocking a payment that has only made N-1 *completed* retries.

**Outcome semantics for Rules 3 and 4:**

| `RecoveryOutcome` | Counts toward Rules 3/4? | Reason |
|---|---|---|
| `FAILED` | ✅ Yes | Ran, didn't recover |
| `SUCCESS` | ✅ Yes | Ran and recovered |
| `PENDING` | ❌ No | Not yet executed |
| `STOPPED_BY_RULE` | ❌ No | Halted before execution, never delivered |
| `EXPIRED` | ❌ No | Never executed |

**Exact change required in Task 2.3:**
```ts
// Rule 3 — count only EXECUTED retries
const retryAttempts = previousAttempts.filter(
  (a) => a.strategy === "SMART_RETRY" &&
         (a.outcome === "FAILED" || a.outcome === "SUCCESS")
);

// Rule 4 — count only DELIVERED nudges
const nudgeAttempts = previousAttempts.filter(
  (a) => a.strategy === "CUSTOMER_NUDGE" &&
         (a.outcome === "FAILED" || a.outcome === "SUCCESS")
);
```

`"outcome"` is already in the `Pick<RecoveryAttempt, ...>` type for `evaluate()` — no
signature change needed.

**Required tests (add to Task 2.3 in `tests/stopping-rules.test.ts`):**
- 4× `SMART_RETRY PENDING` → Rule 3 does NOT fire (0 executed retries)
- 4× `SMART_RETRY FAILED` + 1× `PENDING` → Rule 3 DOES fire (4 executed ≥ MAX_RETRY_ATTEMPTS)
- 3× `CUSTOMER_NUDGE FAILED` + 1× `PENDING` → Rule 4 DOES fire (3 executed ≥ MAX_NUDGE_MESSAGES)
- 2× `CUSTOMER_NUDGE FAILED` + 1× `PENDING` → Rule 4 does NOT fire
- 1× `SMART_RETRY STOPPED_BY_RULE` + 3× `SMART_RETRY FAILED` → Rule 3 does NOT fire

---

### §12.3 RecoveryEngine — `intake()` + `tick()`

#### `intake(event)`
Everything `processFailure()` does today through Step 4, but Step 5 changes: instead of
calling `simulateOutcome()` immediately, creates the first `RecoveryAttempt` as
`outcome: PENDING`, `executedAt: null`, `scheduledAt` = StrategyAgent's computed value.
Returns without simulating.

#### `tick(asOf: Date)`
Batch-fetches all due `RecoveryAttempt` rows in **one query per tick**:
```ts
where: {
  outcome: "PENDING",
  OR: [
    { scheduledAt: null },        // null = "execute at earliest opportunity"
    { scheduledAt: { lte: asOf } }
  ],
  payment: { status: "RECOVERY_IN_PROGRESS" }
}
```

**`scheduledAt: null` semantics:** Means "execute at next tick." tick() must fetch
`scheduledAt IS NULL OR scheduledAt <= asOf`, not just `scheduledAt <= asOf`, or null-scheduled
attempts (e.g. an immediate SMART_RETRY) will never be processed.

**Newly created `PENDING` attempts inside the same tick() call are NOT processed that tick** —
they were not in the initial batch fetch. They will be picked up on the next tick. This is
correct behavior and must be documented to prevent "it looks broken" confusion.

For each fetched attempt:
1. Re-run `stoppingRules.evaluate()` (window may have expired since scheduling). If it stops:
   mark attempt `STOPPED_BY_RULE`, set `stoppedByRule`, `Payment.status = DEAD`, audit log.
2. Otherwise: `simulateOutcome()`, set `outcome`, `executedAt: asOf`.
   - `SUCCESS` → `Payment.status = RECOVERED`.
   - `FAILED` → **leave `Payment.status = RECOVERY_IN_PROGRESS`** → re-run stopping rules for
     next candidate. If stops: `Payment.status = DEAD`. If passes: call
     `pipeline.processRetry()` → create next attempt as `PENDING`.

#### `processFailure()` compatibility shim
`processFailure(event)` = `intake(event)` then immediately `tick(clock.now())`. Preserves
single-shot behavior for existing callers and tests where scheduledAt is in the past.

---

### §12.4 `RecoveryPipeline.processRetry(event, diagnosis, customerHistory)`

Runs stages 2 (risk) + 3 (strategy) only, using a caller-supplied `DiagnosisResult`.
**Does not call `DiagnosisAgent.diagnose()`.** Does not emit `DIAGNOSIS_COMPLETE` audit entry
(which would misrepresent a re-run as a fresh diagnosis).

The reconstructed `DiagnosisResult` has `signals: []` since `FailureEvent` doesn't persist the
original `signals` array. This affects audit metadata richness on retries only — `signals` is
not read by risk/strategy scoring.

**Why not re-run the full pipeline?**
- `DiagnosisAgent` calls Gemini 2.0 Flash (real LLM API). Re-running it on every retry attempt
  in a 1,000-payment batch = 2,000+ unnecessary API calls.
- The `FailureEvent` is immutable per payment. Diagnosis output would be identical.
- Re-emitting `DIAGNOSIS_COMPLETE` in the audit trail would falsely imply a fresh diagnosis.

---

### §12.5 AuditLogger Optimization (folded into Task 2.3)

Add optional `paymentId?: string` to `AuditEntry`. When present, `AuditLogger.log()` uses it
directly for the `db.auditLog.create()` relation — skipping the `findUnique({ externalId })`
lookup that fires on every call today.

`RecoveryEngine` always has `payment.id` in scope at every `auditLogger.log()` call site.
Passing it eliminates the lookup at the call site that dominates audit volume. This is not a
full N+1 fix (Phase 5's scope) but removes amplification at source before multi-attempt
multiplies it.

---

### §12.6 BatchRunner Loop — Fixed 1h Ticks

```
1. generate all N failure events at t0
2. for each event: engine.intake(event)
3. let t = t0
   while t < t0 + (MAX_RECOVERY_WINDOW_HOURS + 1h buffer) AND pendingAttemptsExist():
     virtualClock.advanceHours(1)   // fixed — matches LEVEL_2_EMAIL 1h granularity
     t = virtualClock.now()
     engine.tick(t)                 // one batch query, not N+1
4. calculateReport()
```

**Why fixed ticks, not event-driven:** 73 ticks × 1 batch query per tick is not a performance
problem at N=1,000. Event-driven jumps add min-heap complexity, irregular time gaps that are
harder to debug, and edge cases around concurrent scheduledAt values. Fixed ticks give a
uniform, loggable timeline at zero added complexity.

**Phase 5 dependency:** Downgraded from "hard prerequisite" to "independently valuable, not
blocking." `tick()`'s batch query is written correctly from the start. Phase 5 targets
remaining N+1 patterns (customer lookup, payment upsert) which exist today and are worth
fixing independently.

---

### §12.7 Open Decisions

**Decision 1 — Quiet hours: defer or kill?** (OPEN — requires explicit sign-off)
Proposed: change quiet-hours trip from `Payment.status = "DEAD"` to rescheduling
`scheduledAt` to next 9:00 AM IST, leaving `outcome: PENDING`, not touching Payment.status.
This matches `StrategyAgent.calculateNudgeTime()`'s own intent ("push to 9AM"). However, it
changes existing `tests/stopping-rules.test.ts` assertions. Task 2.5 is gated on this answer.

**Decision 2 — SMS/LEVEL_3 in Phase 2:** ✅ Resolved — include channel-string branch only.
No SMS delivery provider integration in scope (no SMS dependency in `package.json`; email
nudges are already simulation-only via Resend, so SMS is no different).

**Decision 3 — Tick granularity:** ✅ Resolved — fixed 1h ticks.

---

### §12.8 Task Breakdown (one commit each)

| Task | Scope | Risk | Files |
|---|---|---|---|
| **2.1** | `currentEscalationLevel(hoursSinceFailure)` pure function + tests | Low | `src/lib/engine/escalation-ladder.ts`, `tests/escalation-ladder.test.ts` |
| **2.2** | Add `paymentId?` to `AuditLogger.log()` + `AuditEntry` type; pass from all `RecoveryEngine` call sites | Low | `src/lib/audit/logger.ts`, `src/lib/engine/recovery-engine.ts` |
| **2.3** | Split `processFailure()` → `intake()` + `tick()`; fix Step 6 `"FAILED"` regression; add `processRetry()` to pipeline; add outcome-filter to Rules 3/4; fix `tick()` batch query for `scheduledAt: null`; 5 new stopping-rules tests | **High** | `src/lib/engine/recovery-engine.ts`, `src/lib/agents/index.ts`, `src/lib/engine/stopping-rules.ts`, `tests/stopping-rules.test.ts` |
| **2.4** | Wire `currentEscalationLevel()` into `CUSTOMER_NUDGE` channel selection including `"sms"` at LEVEL_3 | Low | `src/lib/agents/strategy-agent.ts` |
| **2.5** | Quiet-hours defer-not-kill (Decision 1) — gated on answer | Medium | `src/lib/engine/recovery-engine.ts`, `tests/stopping-rules.test.ts` |
| **2.6** | BatchRunner loop redesign: `intake()` + fixed 1h tick loop | Medium | `src/lib/simulation/batch-runner.ts` |

**Note — Task 2.7 dropped:** `analytics/route.ts` escalation queue already queries
`outcome: "PENDING"` at `LEVEL_4_MERCHANT_ALERT`. This is correct as-is and needs no changes.
Verified directly against source.

