# ReviveAI
> **Razorpay AI Buildathon 2026 · Track 03: Autonomous Revenue Recovery**

ReviveAI is a deterministic, rule-bounded multi-agent pipeline designed to recover failed payments, abandoned checkouts, and broken subscriptions for Indian merchants. It acts as an autonomous collections team, analyzing every failure and executing custom recovery strategies without human intervention, while strictly adhering to compliance and quiet-hour regulations.

## 🚀 The Multi-Agent Pipeline (How it works)

When a payment fails (e.g., Bank Timeout, Insufficient Funds, OTP Expired), the event enters the ReviveAI pipeline and is processed by three specialized agents in real-time:

1. **Diagnosis Agent:** Analyzes the raw error code, bank, and payment method. It uses deterministic rules for known errors, falling back to a Google Gemini LLM for nuanced or ambiguous error interpretation.
2. **Risk Assessment Agent:** Evaluates the customer's lifetime value and history to calculate a mathematical `RecoveryProbability` score.
3. **Strategy Agent:** Based on the diagnosis and risk score, it selects the optimal recovery action (`SMART_RETRY`, `CUSTOMER_NUDGE`, `ALT_PAYMENT`, or `ESCALATE_MERCHANT`).

### 🛡 The Stopping Rules Engine (Compliance Guardrails)
Before *any* agent is allowed to execute an action, a strict, deterministic Stopping Rules Engine evaluates the decision to ensure compliance:
* **Quiet Hours:** If the Strategy Agent decides to SMS/Email a customer at 11:00 PM IST, the rules engine physically blocks it and reschedules it for 9:00 AM IST. (Silent backend `SMART_RETRY` is permitted 24/7).
* **Fraud Protection:** Any transaction flagged as `FRAUD_DETECTED` is instantly killed (`DEAD`). Zero retries are permitted.
* **Time & Attempt Limits:** A hard limit of 4 retries, 3 customer nudges, and a strict 72-hour window (168 hours for mandates) are enforced to prevent spam.

## 📊 1,000-Payment Batch Simulation Benchmark

To prove the system's scalability and decision-making logic, we built a virtual time-travel simulator. It ingests synthetic failed payments and advances a virtual clock over a 169-hour period, running the multi-agent pipeline against every payment and its subsequent retries.

**Actual Benchmark Report Output:**
```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📊 REVIVE AI — BATCH RECOVERY BENCHMARK REPORT (1,000 PAYMENTS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Total Failed Payments:        1,000
  Total Revenue at Risk:        ₹5,080,425

  ✅ Payments Recovered:        969 (96.9%)
  ✅ Revenue Recovered:         ₹5,016,013 (98.7% GMV recovered)
  ⏱  Total Benchmark Time:     2.3s (2ms per payment)

  CATEGORY BREAKDOWN:
    BANK_TIMEOUT             291 / 292 recovered        (99.7%)
    INSUFFICIENT_FUNDS       179 / 179 recovered        (100.0%)
    UPI_PSP_ERROR            110 / 110 recovered        (100.0%)
    CARD_DECLINED            107 / 107 recovered        (100.0%)
    CHECKOUT_ABANDONED       71 / 82 recovered          (86.6%)
    NETWORK_ERROR            78 / 78 recovered          (100.0%)
    OTP_EXPIRED              45 / 48 recovered          (93.8%)
    SUBSCRIPTION_FAILED      42 / 42 recovered          (100.0%)
    LIMIT_EXCEEDED           40 / 40 recovered          (100.0%)
    FRAUD_DETECTED           0 / 16 recovered           (0.0%)
    MANDATE_EXPIRED          6 / 6 recovered            (100.0%)

  STRATEGY BREAKDOWN:
    SMART_RETRY              479 successful out of 590 attempted
    ALT_PAYMENT              332 successful out of 593 attempted
    CUSTOMER_NUDGE           158 successful out of 271 attempted
    DO_NOTHING               0 successful out of 16 attempted

  STOPPING RULES & COMPLIANCE ENFORCEMENT:
    Fraud Blocks Enforced:       16 transactions (100% compliance)
    Quiet Hours Deferrals:       0 nudges deferred to 9:00 AM IST
    Retry Cap Terminations:      0 transactions halted at 4 attempts
    Below Min Amount Halted:     0 transactions under ₹50
    Total Stopped by Rules:      31 payments marked DEAD

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

> **Note on Benchmark Timing:** This 2.3s / 1,000-payment benchmark was measured against a local PostgreSQL instance (Homebrew) to validate engine throughput independent of network latency. The same optimizations apply when running against hosted Neon Serverless Postgres, but the exact hosted-latency timing has not been re-benchmarked since the round-trip reduction work landed; a prior, pre-optimization baseline measured ~17.5 minutes for 100 payments over Neon.

## 🛠 Quick Start Guide

### Prerequisites
- Node.js >= 20
- Docker & Docker Compose (or native PostgreSQL)

### 1. Start the Local Database
```bash
docker compose up -d
```

### 2. Configure Environment
Create a `.env` file in the root directory:
```env
DATABASE_URL="postgresql://revive:revive_dev@localhost:5432/revive_ai?schema=public&connection_limit=20"
GOOGLE_AI_API_KEY="" # Optional: Uses deterministic fallback if empty
RESEND_API_KEY="" # Optional: Dispatches real emails if provided
NEXT_PUBLIC_APP_URL="http://localhost:3000"
NODE_ENV="development"
```

### 3. Initialize Schema & Start App
```bash
npm install
npx prisma db push
npm run dev
```
Open `http://localhost:3000` to view the merchant dashboard.

### 4. Run the Benchmark Simulator
You can trigger the batch simulation directly from the web dashboard UI, or via the terminal:
```bash
NODE_ENV=production npm run simulate 1000
```
*(For a faster test run over remote networks, try `npm run simulate 100`).*

## 🏛 Architecture Diagram

```mermaid
graph TD
    %% Define Events
    Webhook[Payment Failure Webhook] --> Intake[BatchRunner / Recovery Engine Intake]
    
    %% Engine Flow
    Intake --> DE[Stopping Rules Engine - Pre Check]
    DE -- Fraud/Dead --> AuditLog[Immutable Audit Log]
    DE -- Valid --> P[Pipeline Process]
    
    %% Agent Pipeline
    subgraph Multi-Agent Triage
        P --> DA[Diagnosis Agent]
        DA --> RA[Risk Assessment Agent]
        RA --> SA[Strategy Agent]
    end
    
    %% Outcomes
    SA --> Action[Recovery Attempt Generation]
    Action --> DE2[Stopping Rules Engine - Post Check]
    
    DE2 -- Quiet Hours --> Schedule[Defer to 9AM IST]
    DE2 -- Valid --> Dispatch[Execute Strategy]
    
    Dispatch --> DB[(PostgreSQL Database)]
    Schedule --> DB
    
    %% Client Flow
    Dispatch -- CUSTOMER_NUDGE --> ClientUI[Interactive Client Recovery Page]
    ClientUI --> DE3[Stopping Rules Engine - Verify Link]
    DE3 -- Expired --> Reject[Block Checkout]
    DE3 -- Valid --> Checkout[Complete Payment]
    Checkout --> DB
```

## ✅ Track 03 Criteria Mapping
- **Detection & Diagnosis**: Evaluates real-time failure events using `DiagnosisAgent` (deterministic + Gemini fallback).
- **Intelligent Intervention**: Routes via `StrategyAgent` for SMART_RETRY, CUSTOMER_NUDGE, or ALT_PAYMENT.
- **Compliance Boundaries**: Enforces strict RBI-aligned limits via `StoppingRulesEngine` (zero fraud retries, 4-attempt caps, quiet hours).
- **Auditability**: Every agent decision and rule enforcement is immutably written to the `AuditLog` table, viewable directly from the Dashboard.
