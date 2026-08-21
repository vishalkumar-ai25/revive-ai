# Specification: ReviveAI — Autonomous Revenue Recovery Agent

**Version:** 1.0.0  
**Status:** Draft for Review  
**Author:** Vishal Kumar  
**Track:** Track 03 · Autonomous Revenue Recovery (Razorpay AI Buildathon 2026)  

---

## 1. Objective

### 1.1 Problem Statement
In the Indian digital payments ecosystem, revenue loss rarely occurs in a single clean event. It happens progressively through multi-step degradations:
1. **One-Time Payment Degradation:** Bank downtime, UPI PSP timeouts, or gateway drops cause failed transactions. Dumb systems blindly retry immediately, exacerbating peak load or failing repeatedly.
2. **Checkout Drop-Off:** Distracted or hesitant buyers abandon checkout sessions without attempting payment.
3. **Failed Subscription Renewals:** In SaaS, OTT, and recurring billing, renewals fail due to expired cards, temporary low balances, or bank-side issues, directly causing involuntary customer churn.
4. **Mandate & Auto-Debit Failures:** Recurring e-mandates (UPI Autopay, e-NACH, SIPs, EMIs) fail due to balance timing, PSP downtimes, or expired mandates, with strict RBI compliance rules governing retries.

### 1.2 The ReviveAI Solution
ReviveAI is an autonomous multi-agent revenue recovery engine that:
- **Detects revenue at risk in real time** across one-time payments, checkout drop-offs, subscriptions, and auto-debit mandates.
- **Intelligently diagnoses root causes** using LLM reasoning (Gemini 2.0 Flash) combined with high-precision deterministic rules and bank health telemetry.
- **Selects and schedules optimal interventions:** Smart Bank-Timed Retries, Privacy-Preserving Customer Nudges, Alternative Payment Rail Switching, and Compliant Mandate Retry Sequences.
- **Enforces strict, bounded stopping rules and compliance guardrails:** Hard limits on retry attempts (max 4), customer nudges (max 3), 72-hour recovery windows, quiet hours (9 PM – 9 AM IST), zero retries on fraud blocks, and customer opt-out respect.
- **Measures aggregate money recovered across 500–1000 payment batches**, delivering empirical proof of ROI and maintaining an immutable audit log of every agent decision.

---

## 2. Core Failure Directions (Scope)

ReviveAI combines four high-impact failure recovery directions:

| Direction | Domain | Failure Mechanism | Autonomous Recovery Intervention |
|---|---|---|---|
| **#1 Payment Failure Recovery** | One-time transactions (UPI, Cards, Netbanking) | Bank server timeouts, PSP errors, network dropouts | Bank-specific optimal time window retries (e.g., HDFC 8–10 AM), intelligent routing, alternative payment rail suggestion |
| **#2 Checkout Drop-Off Recovery** | Pre-payment abandonment | Cart opened, checkout initialized, user navigated away | Timed respectful recovery email/SMS with cart reservation token and direct one-click checkout link |
| **#3 Failed Subscription Recovery** | Recurring SaaS / OTT billing | Card expired, renewal failed, transient low balance | Grace period management, salary-cycle-aligned retry (1st–5th of month), update payment method prompt |
| **#4 Mandate Retry Sequencer** | UPI Autopay / e-NACH mandates | Bank debit failed, mandate timing issue, RBI re-auth | RBI-compliant 4-attempt sequencer with progressive time spacing and automatic rail fallback (UPI $\rightarrow$ e-NACH/Card) |

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

### 3.2 Compliant Escalation Ladder
ReviveAI enforces a progressive 5-level escalation ladder:
- **Level 1 (Immediate / T+0):** On-screen suggestion on the checkout page (e.g., switch payment rail).
- **Level 2 (T+1 hour / Post-Window):** Personalized recovery email containing a direct, secure payment link.
- **Level 3 (T+24 hours):** SMS reminder if email remains unopened/unpaid.
- **Level 4 (T+48 hours):** Escalation flag on the Merchant Dashboard for high-value or complex manual follow-up.
- **Level 5 (T+72 hours):** Marked as `DEAD` / Unrecoverable. All automated outreach permanently halts.

**Compliance Constraints:**
- **Quiet Hours:** Absolutely no customer communication between 9:00 PM and 9:00 AM IST (TRAI/DPDP compliance).
- **Max Customer Contacts:** No more than 3 customer-facing messages per failed transaction.
- **Privacy Protection:** Never disclose sensitive reasons (e.g. "insufficient funds") to customers; communications use neutral, respectful phrasing ("your bank was unable to complete the transaction").

### 3.3 Strict Stopping Rules & Guardrails
```typescript
export const STOPPING_RULES = {
  MAX_RETRY_ATTEMPTS: 4,          // Hard limit per RBI mandate / merchant guidelines
  MAX_NUDGE_MESSAGES: 3,          // Anti-spam customer protection
  MAX_RECOVERY_WINDOW_HOURS: 72,  // Hard expiry for recovery efforts
  MIN_RECOVERY_AMOUNT_INR: 50,    // Do not spend recovery cost on micro-amounts
  MIN_RECOVERY_PROBABILITY: 0.15, // Threshold below which recovery is skipped
  FRAUD_BLOCK_POLICY: "NEVER_RETRY", // Strict zero tolerance for bank fraud flags
  CUSTOMER_OPT_OUT_POLICY: "STOP_ALL", // Instant halt if customer opts out
};
```

### 3.4 Immutable Audit Trail & Decision Provenance
Every decision made by any agent is logged as an immutable record in `audit_logs` containing:
- Timestamp (ISO 8601 UTC & IST)
- Agent Name (`DiagnosisAgent`, `RiskAssessmentAgent`, `StrategyAgent`, `MandateSequencer`, `StoppingRulesEngine`)
- Action Triggered (e.g., `DIAGNOSIS_COMPLETE`, `RISK_ASSESSED`, `STRATEGY_SELECTED`, `RETRY_SCHEDULED`, `RECOVERY_STOPPED`)
- Reasoning Chain-of-Thought (Plain English justification for the decision)
- Structured Metadata (Probability scores, confidence values, bank health telemetry, execution parameters)
- Visual timeline presentation in the Merchant Dashboard with expandable JSON payload inspection.

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
                       │ (LLM + Rule Fallback)  │
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
                                   │ Execution Strategy & Schedule
                                   ▼
                       ┌────────────────────────┐
                       │    Recovery Engine     │
                       │ (Execute / Nudge / DB) │
                       └───────────┬────────────┘
                                   │
                                   ▼
                       ┌────────────────────────┐
                       │  Immutable Audit Log   │
                       └────────────────────────┘
```

---

## 5. Tech Stack & Dependencies

| Component | Technology | Version | Purpose |
|---|---|---|---|
| **Framework** | Next.js (App Router) | 14.2.21 | Full-stack web application & API endpoints |
| **Language** | TypeScript | 5.7.0 | End-to-end type safety |
| **Styling** | Tailwind CSS | 3.4.17 | Modern dark-mode responsive dashboard |
| **Icons** | Lucide React | 0.468.0 | Dashboard iconography |
| **Database & ORM**| Prisma ORM | 6.8.0 | Schema modeling, migrations, client queries |
| **AI / LLM** | Google Generative AI | 0.21.0 | Gemini 2.0 Flash reasoning engine |
| **Validation** | Zod | 3.24.0 | Runtime schema validation for webhooks & events |
| **Testing** | Node Native Test Runner | v20.20.2 (`tsx --test`) | Fast, zero-dependency unit and integration tests |

---

## 6. Commands & Tooling

```bash
# 1. Development & Build
npm run dev                  # Start Next.js development server on localhost:3000
npm run build                # Produce optimized production build
npm start                    # Start production server

# 2. Automated Tests
npm test                     # Run all unit and integration tests via tsx --test

# 3. Batch Simulation & Benchmarking
npm run simulate             # Run default 1000-payment batch simulation via CLI
npm run simulate 500         # Run 500-payment batch simulation via CLI
npm run simulate 100         # Run 100-payment batch simulation via CLI

# 4. Database Management
npm run db:generate          # Generate Prisma client
npm run db:push              # Push schema changes to database
npm run db:seed              # Seed demo merchant and historical baseline data
npm run db:studio            # Open Prisma Studio web inspector

# 5. Quality & Type Checking
npm run typecheck            # Full TypeScript compiler verification (no emit)
npm run lint                 # ESLint check
npm run format               # Prettier code formatting
```

---

## 7. Project Directory Structure

```
revive-ai/
├── docs/
│   ├── spec.md                     # This formal specification document
│   ├── architecture.md             # System architecture & multi-agent data flow
│   └── rbi-compliance.md           # RBI mandate & TRAI/DPDP compliance guide
├── tasks/
│   ├── plan.md                     # Implementation plan with vertical slices & checkpoints
│   └── todo.md                     # Task breakdown checklist with verification steps
├── prisma/
│   ├── schema.prisma               # Complete data models (Payment, FailureEvent, RecoveryAttempt, AuditLog, BatchRun)
│   └── seed.ts                     # Database seeder
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── analytics/route.ts  # KPI aggregations & category breakdown
│   │   │   ├── audit/[paymentId]/  # Audit trail retrieval route
│   │   │   ├── simulate/route.ts   # Simulation execution route (single & batch)
│   │   │   └── webhooks/payment/   # Gateway webhook ingestion route
│   │   ├── globals.css             # Tailwind base & dark theme styles
│   │   ├── layout.tsx              # Root HTML & metadata shell
│   │   └── page.tsx                # Merchant Dashboard UI
│   ├── components/
│   │   ├── AuditModal.tsx          # Step-by-step decision provenance timeline modal
│   │   ├── EscalationQueue.tsx     # Level 4 merchant action item queue
│   │   ├── LiveFeed.tsx            # Real-time recovery feed with category filter tabs
│   │   ├── MetricCards.tsx         # Revenue at risk, recovered amount, recovery rate KPIs
│   │   └── SimulationControls.tsx  # Batch simulation trigger panel with presets
│   └── lib/
│       ├── agents/
│       │   ├── diagnosis-agent.ts        # Failure category classifier (LLM + rules)
│       │   ├── risk-assessment-agent.ts  # Recovery probability & CLV evaluator
│       │   ├── strategy-agent.ts         # Strategy selector & bank timing scheduler
│       │   ├── mandate-sequencer.ts      # RBI-compliant mandate retry sequencer
│       │   └── index.ts                  # Agent pipeline orchestrator
│       ├── audit/
│       │   └── logger.ts                 # Immutable audit logger
│       ├── engine/
│       │   ├── escalation-ladder.ts      # 5-level escalation manager
│       │   ├── recovery-engine.ts        # Recovery execution engine
│       │   └── stopping-rules.ts         # Stopping rules evaluator
│       ├── simulation/
│       │   ├── batch-runner.ts           # Batch processor with aggregate reporting
│       │   └── payment-generator.ts      # Synthetic payment event generator
│       ├── constants.ts                  # Centralized configuration & thresholds
│       ├── db.ts                         # Prisma client singleton
│       └── types.ts                      # Core TypeScript definitions
└── tests/
    ├── diagnosis-agent.test.ts     # Unit tests for Diagnosis Agent
    ├── risk-assessment.test.ts     # Unit tests for Risk Assessment Agent
    ├── strategy-agent.test.ts      # Unit tests for Strategy Agent
    ├── mandate-sequencer.test.ts   # Unit tests for Mandate Sequencer
    ├── stopping-rules.test.ts      # Unit tests for Stopping Rules Engine
    ├── escalation-ladder.test.ts   # Unit tests for Escalation Ladder
    └── batch-runner.test.ts        # Integration tests for Batch Simulation
```

---

## 8. Code Style & Example Patterns

### 8.1 Zero Magic Numbers
All numerical thresholds, limits, and configurations are defined in `src/lib/constants.ts` and referenced by name.

### 8.2 Strongly Typed Agent Interfaces
```typescript
export interface DiagnosisResult {
  category: FailureCategory;
  rootCause: string;
  confidence: number; // 0.0 to 1.0
  isRecoverable: boolean;
  signals: DiagnosisSignal[];
}

export interface MandateRetrySchedule {
  attemptNumber: number;
  scheduledAt: Date;
  recommendedMethod: PaymentMethod;
  railSwitchReason: string | null;
  isCompliant: boolean;
}
```

### 8.3 Immutable Audit Logging
```typescript
await this.auditLogger.log({
  paymentExternalId: event.externalId,
  agentName: "MandateSequencer",
  action: "MANDATE_SCHEDULE_GENERATED",
  reasoning: `Scheduled attempt #2 in 48h (salary credit window) switching to e-NACH rail due to recurrent UPI PSP timeouts.`,
  metadata: { attempt: 2, rail: "MANDATE", delayHours: 48 },
});
```

---

## 9. Testing Strategy

### 9.1 Unit Tests (`tests/*.test.ts`)
- **Diagnosis Agent:** Verify all 12 failure categories are correctly classified under both LLM and deterministic fallback.
- **Risk Assessment Agent:** Verify CLV scoring, amount tiering, and recovery probability weighting.
- **Strategy Agent:** Verify strategy selection and bank retry timing calculation (HDFC, SBI, ICICI, etc.).
- **Mandate Sequencer:** Verify RBI 4-attempt maximum, exponential spacing, and rail-switching recommendations.
- **Stopping Rules Engine:** Verify immediate stop on fraud block, quiet hours blocking (9 PM - 9 AM IST), max retry cap, max nudge cap, and <₹50 threshold.
- **Escalation Ladder:** Verify 5-stage progression and privacy preservation.

### 9.2 End-to-End Batch Simulation Verification
- Execute `BatchRunner` with 1,000 synthetic payments.
- Verify aggregate metrics calculation: Total at Risk, Recovered Revenue, Strategy Breakdown, and Unrecoverable breakdown.
- Ensure 0% retry on fraud-blocked payments.

---

## 10. Boundaries (Always / Ask First / Never)

### Always:
- Write an immutable audit log entry before and after every recovery decision.
- Respect Quiet Hours (9:00 PM – 9:00 AM IST) for all customer outreach.
- Abort recovery immediately if bank flags `FRAUD_DETECTED` or customer requests opt-out.
- Use privacy-preserving customer messaging (never disclose embarrassing details like "insufficient balance").

### Ask First:
- Modifying RBI mandate retry rules or increasing max retry limits beyond 4 attempts.
- Making database schema migrations or altering audit log schemas.

### Never:
- Attempt recovery on any transaction flagged as fraudulent by issuing banks.
- Send more than 3 nudge communications to a single customer for a transaction.
- Hardcode API keys or secrets in source code files.

---

## 11. Success Criteria (Acceptance Gate)

- [ ] **Multi-Agent Flow:** Payment event ingested $\rightarrow$ Diagnosed $\rightarrow$ Risk Assessed $\rightarrow$ Strategy/Mandate Sequenced in $<100$ms.
- [ ] **Batch Simulation Benchmark:** Successfully runs 1,000 simulated payments and produces a detailed report displaying $\sim 50\text{–}60\%$ recovery rate and complete unrecoverable breakdown.
- [ ] **Compliance & Stopping Rules:** 100% test pass rate for all stopping rules (Max retries, Max nudges, 72h window, Min ₹50 amount, Quiet hours, Fraud blocks).
- [ ] **Audit Trail Provenance:** Full timeline viewable in the dashboard modal for any payment.
- [ ] **Merchant Dashboard:** Functional dark-mode UI with live feed filters, escalation queue, simulation controls, and real-time metrics.
- [ ] **Automated Test Suite:** `npm test` runs and passes all unit and integration tests.
