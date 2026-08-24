# ⚡ ReviveAI — Autonomous Payment Revenue Recovery System

> **Razorpay AI Builder Buildathon 2026 — Track 03: AI Revenue Recovery**  
> An autonomous multi-agent platform that detects revenue at risk, diagnoses root causes across Indian banking rails & PSPs, and executes bounded recovery workflows with compliant stopping rules and immutable audit trails.

---

<div align="center">

[![Track](https://img.shields.io/badge/Razorpay_Buildathon_2026-Track_03:_AI_Revenue_Recovery-blue.svg?style=flat-square)](https://github.com/vishalkumar-ai25/revive-ai)
[![Tests](https://img.shields.io/badge/Automated_Tests-120%2F120_Passing_(100%25)-brightgreen.svg?style=flat-square)](https://github.com/vishalkumar-ai25/revive-ai)
[![Performance](https://img.shields.io/badge/Pipeline_Speed-Fast_Execution-orange.svg?style=flat-square)](https://github.com/vishalkumar-ai25/revive-ai)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict_Mode_(0_Errors)-blue.svg?style=flat-square)](https://github.com/vishalkumar-ai25/revive-ai)
[![Architecture](https://img.shields.io/badge/AI_Engine-Gemini_2.0_Flash_%2B_Deterministic_Fallback-purple.svg?style=flat-square)](https://github.com/vishalkumar-ai25/revive-ai)

</div>

---

## 🎯 The Problem

In India, **30%–35% of all payment attempts degrade or fail** due to bank timeouts, insufficient funds, network drops, and PSP throttling. For a high-velocity merchant, this means lakhs of rupees in GMV leaking daily.

Current systems either **do nothing** or **blindly retry**, causing spam and customer frustration. ReviveAI enforces a strict operational escalation ladder — quiet-hours suppression, zero-retry fraud blocks, and mandate pre-debit notice — informed by e-mandate industry practice.

---

## 🏗️ How Our Multi-Agent System Is Structured

ReviveAI implements a **custom, lightweight, type-safe multi-agent architecture in pure TypeScript** (zero heavy framework overhead like LangGraph). This guarantees fast execution, 100% deterministic fallback during LLM outages or rate limits (HTTP 429), and strict compliance boundaries.

```mermaid
flowchart TD
    WH["📥 Payment Failure Event / Webhook<br/>(PaymentFailureEvent)"] --> ORCH["⚙️ RecoveryPipeline Orchestrator<br/>(src/lib/agents/index.ts)"]

    subgraph MultiAgentCore["🧠 Autonomous Multi-Agent Core"]
        direction TB
        
        A1["1️⃣ DiagnosisAgent<br/>• Google Gemini 2.0 Flash (structured JSON schema)<br/>• 24-code deterministic rule fallback<br/>• Context signals (late night, recurring)"]
        
        A2["2️⃣ RiskAssessmentAgent<br/>• Multi-factor weighted scoring model<br/>• Evaluates CLV, Amount, Category Base Rate<br/>• Computes Recovery Probability (0.0 to 1.0)"]
        
        A3["3️⃣ StrategyAgent<br/>• Selects bounded recovery strategy<br/>• Calculates optimal retry/nudge timing<br/>• Maps 5-tier escalation channel"]

        A4["🔄 MandateRetrySequencer<br/>(Recurring E-Mandates)<br/>• 4-attempt spacing (T+0, T+48h, T+96h, T+144h)<br/>• 10:15 AM IST bank clearing windows<br/>• Progressive rail fallback (UPI → e-NACH → On-Demand)<br/>• 24h pre-debit notifications"]

        A1 -->|DiagnosisResult| A2
        A2 -->|RiskAssessmentResult| A3
        A3 -.->|Mandate Context| A4
    end

    ORCH --> A1

    subgraph Guardrails["🛡️ Guardrails & Compliance Engine"]
        direction TB
        SRE["StoppingRulesEngine (9 Non-Negotiable Rules)<br/>1. FRAUD_BLOCK (Never retry fraud)<br/>2. STRATEGY_DO_NOTHING (Agent abort)<br/>3. BELOW_MIN_AMOUNT (< ₹50)<br/>4. MAX_RETRIES_EXCEEDED (≥ 4 retries)<br/>5. MAX_NUDGES_EXCEEDED (≥ 3 nudges)<br/>6. RECOVERY_WINDOW_EXPIRED (72h / 168h)<br/>7. MAX_ALT_PAYMENT_EXCEEDED (Cap 1)<br/>8. MAX_ESCALATE_MERCHANT_EXCEEDED (Cap 1)<br/>9. QUIET_HOURS (9 PM – 9 AM IST)"]
        
        P1["Passed"]
        P2["Hard Stop / Violation"]
        P3["Quiet Hours (9 PM–9 AM IST)"]
        
        SRE --> P1 & P2 & P3
        
        ACT_EXEC["Execute Recovery / Schedule Attempt<br/>• SMART_RETRY (Bank-optimal windows)<br/>• CUSTOMER_NUDGE (Email / SMS / WhatsApp)<br/>• ALT_PAYMENT (On-demand link)"]
        ACT_HALT["Halt Recovery Permanently<br/>• DO_NOTHING (Fraud or limit reached)<br/>• ESCALATE_MERCHANT (Dashboard alert)"]
        ACT_DEFER["Defer Outreach to 9:00 AM IST<br/>• OUTREACH_DEFERRED (Status: IN_PROGRESS)"]
        
        P1 --> ACT_EXEC
        P2 --> ACT_HALT
        P3 --> ACT_DEFER
    end

    A3 --> SRE
    A4 --> SRE

    subgraph Provenance["📜 Immutable Audit Trail"]
        AUDIT["AuditLogger (PostgreSQL)<br/>• Records complete reasoning & agent provenance<br/>• Non-blocking zero-crash fault isolation"]
    end

    ACT_EXEC --> AUDIT
    ACT_HALT --> AUDIT
    ACT_DEFER --> AUDIT
```

---

### 🤖 Agent Roles & Responsibilities

1. **[`DiagnosisAgent`](file:///Users/vishalkumar/revive-ai/src/lib/agents/diagnosis-agent.ts) (Root Cause Identification)**
   - Analyzes raw error codes, bank latency profiles, payment methods, and timestamps.
   - Uses **Google Gemini 2.0 Flash** for unstructured error context with an instant 24-code **deterministic rule fallback** if the API is unconfigured or rate-limited.
   - Extracts contextual signals (e.g. `late_night_failure` during 11 PM–2 AM IST, `recurring_payment` mandate context).

2. **[`RiskAssessmentAgent`](file:///Users/vishalkumar/revive-ai/src/lib/agents/risk-assessment-agent.ts) (Recovery Viability Scoring)**
   - Computes an empirical weighted recovery probability score based on 5 factors:
     - Failure Category Base Rate (weight: 0.35)
     - Customer Lifetime Value / CLV (weight: 0.25)
     - Payment Amount (weight: 0.20)
     - Diagnosis Confidence (weight: 0.10)
     - Recoverability Signal (weight: 0.10)

3. **[`StrategyAgent`](file:///Users/vishalkumar/revive-ai/src/lib/agents/strategy-agent.ts) (Intervention & Timing Sequencer)**
   - Selects the optimal recovery action: `SMART_RETRY`, `CUSTOMER_NUDGE`, `ALT_PAYMENT`, `ESCALATE_MERCHANT`, or `DO_NOTHING`.
   - Schedules retries during **bank-optimal clearing windows** (e.g., avoiding bank maintenance hours).
   - Maps customer outreach to the **5-Tier Escalation Ladder** (On-screen $\to$ Email $\to$ SMS $\to$ Merchant Alert $\to$ Dead).

4. **[`MandateRetrySequencer`](file:///Users/vishalkumar/revive-ai/src/lib/agents/mandate-sequencer.ts) (Recurring E-Mandate Recovery)**
   - Autonomous sequencer for subscription and recurring mandate failures.
   - Implements 4-attempt spacing ($T_0 \to T+48\text{h} \to T+96\text{h} \to T+144\text{h}$) aligned with Indian bank clearing windows (10:15 AM IST).
   - Progressive rail switching: `UPI_AUTOPAY` $\to$ `E_NACH` $\to$ `ON_DEMAND_LINK`.
   - Triggers 24-hour pre-debit notifications (`preDebitNotificationSentAt`) prior to each execution, enforcing an operational policy informed by e-mandate industry practice.

5. **[`StoppingRulesEngine`](file:///Users/vishalkumar/revive-ai/src/lib/engine/stopping-rules.ts) (Compliance Guardrails)**
   - Enforces **6 non-negotiable rules**: Fraud blocks (zero-retry), minimum amount (<₹50), max 4 retries, max 3 nudges, recovery window expiry (72h standard / 168h mandate), and **Quiet Hours** (9:00 PM – 9:00 AM IST).
   - Quiet hours safely defers customer nudges to 9:00 AM IST while permitting silent backend bank retries.

6. **[`AuditLogger`](file:///Users/vishalkumar/revive-ai/src/lib/audit/logger.ts) (Immutable Decision Trail)**
   - Writes immutable audit records to PostgreSQL before and after every recovery decision.
   - Captures human-readable reasoning, agent provenance, and metadata without blocking financial state changes.

---

## 📜 Explainable AI in Action — Real Multi-Agent Audit Trail

Every recovery decision in ReviveAI writes an immutable provenance log capturing the full chain-of-thought across all agents. Below is an actual audit trail for a transaction that failed late at night:

```json
[
  {
    "agentName": "DiagnosisAgent",
    "action": "DIAGNOSIS_COMPLETE",
    "reasoning": "Classified BANK_TIMEOUT with 85% confidence. Root cause: HDFC bank gateway failed to respond within 15000ms. Detected late_night_failure signal (23:42 IST).",
    "metadata": { "category": "BANK_TIMEOUT", "confidence": 0.85, "isRecoverable": true }
  },
  {
    "agentName": "RiskAssessmentAgent",
    "action": "RISK_ASSESSED",
    "reasoning": "Recovery probability: 0.78. High-value loyal customer (6 purchases, ₹14,500 LTV). Category base recovery rate for BANK_TIMEOUT is 75%.",
    "metadata": { "recoveryProbability": 0.78, "shouldAttemptRecovery": true }
  },
  {
    "agentName": "StrategyAgent",
    "action": "STRATEGY_SELECTED",
    "reasoning": "Selected SMART_RETRY. Identified bank maintenance window (HDFC overnight batch). Scheduled retry for next optimal clearing window at 10:15 AM IST.",
    "metadata": { "strategy": "SMART_RETRY", "optimalExecutionTime": "2026-08-22T04:45:00.000Z" }
  },
  {
    "agentName": "StoppingRulesEngine",
    "action": "OUTREACH_DEFERRED",
    "reasoning": "Quiet hours active (11:42 PM IST). Customer nudge prohibited between 9:00 PM – 9:00 AM IST. Backend smart retry scheduled; customer communication deferred to 9:00 AM IST.",
    "metadata": { "rule": "QUIET_HOURS", "rescheduledFor": "2026-08-22T03:30:00.000Z" }
  }
]
```

---

## 📊 Evaluation & The Bar

ReviveAI is built specifically to address the criteria defined in **Track 03 — The Bar**:

| Judging Criterion | Implementation in ReviveAI | Direct Verification Command |
|---|---|:---:|
| **1. Measured money recovered across a batch** | Simulates 1,000+ payments across realistic Indian failure distributions, tracking recovered GMV and percentage lift. | `npm run simulate 1000` |
| **2. Compliant escalation ladder** | 5-level progressive contact ladder (`On-screen` $\to$ `Email` $\to$ `SMS` $\to$ `Merchant Alert` $\to$ `Dead stop`). | `npx tsx --test tests/multi-attempt-lifecycle.test.ts` |
| **3. Strict stopping rules** | Pure rule engine enforcing 4-retry cap, 3-nudge cap, quiet hours (9 PM–9 AM IST), and zero-tolerance fraud blocks. | `npx tsx --test tests/stopping-rules.test.ts` |
| **4. Immutable audit trail** | Immutable `audit_logs` table storing every agent's step-by-step chain-of-thought, decision factors, and timestamps. | `npx tsx --test tests/pipeline.test.ts` |
| **5. Concurrency Guard** | Atomic CTE with row-level locking (`SELECT FOR UPDATE SKIP LOCKED`) prevents double-processing during concurrent background jobs. | `npx tsx --test tests/concurrency-guard.integration.test.ts` |


---

## 📈 1,000-Payment Batch Simulation Benchmark

To prove the system's scalability and decision-making logic, we built a virtual time-travel simulator. It ingests synthetic failed payments and advances a virtual clock over a 169-hour period, running the multi-agent pipeline against every payment and its subsequent retries.

**Actual Benchmark Report Output (Hosted Neon):**

![Neon Benchmark Execution](docs/assets/benchmark_execution.webp)
![Neon Benchmark Report](docs/assets/benchmark_report.webp)

> **Benchmark Execution Timing:**
> - **Local PostgreSQL (Zero Latency):** 2.3 seconds total (2ms per payment). Used to validate pure engine logic and throughput.
> - **Hosted Neon Serverless Postgres (Pooled):** 41 minutes total (2.45s per payment). Measured post-optimization against real-world cloud latency for the full 1,000-payment, multi-day lifecycle loop.

*Note: Quiet-hours deferrals appear as `0` in the benchmark because the StrategyAgent proactively schedules nudges for 9:00 AM IST, pre-empting the stopping-rules engine from needing to block them during quiet hours.*

---

## 🧪 Automated Test Suite (`npm test`)

Run the complete test suite verifying all 5 agents, escalation ladders, mandate sequencing, and stopping rules:

```bash
npm test
```

```text
# tests 145
# suites 34
# pass 145
# fail 0
# cancelled 0
# skipped 0
# duration_ms 608.56ms
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js >= 20.x
- PostgreSQL database (Neon, Supabase, or local)
- `GOOGLE_AI_API_KEY` ([Get free key](https://aistudio.google.com/)) *(Optional: Reviewers can run the full 1,000-payment benchmark **without an API key**. If omitted, the DiagnosisAgent instantly falls back to the 24-code deterministic mapping for zero-friction testing.)*

### Installation

```bash
# 1. Clone repository
git clone https://github.com/vishalkumar-ai25/revive-ai.git
cd revive-ai

# 2. Install dependencies
npm install

# 3. Setup environment variables
cp .env.example .env
# Fill in your DATABASE_URL in .env
# Add RECOVERY_LINK_HMAC_SECRET (required for email verification links)
# Add WEBHOOK_SIGNING_SECRET (required for Razorpay webhook validation)

# 4. Push database schema
npx prisma generate
npx prisma db push

# 5. Seed with initial simulated batch
npm run simulate 50

# 6. Run development server
npm run dev
```

Visit **`http://localhost:3000`** to access the Merchant Recovery Dashboard.

---

## 🛠 Tech Stack

- **Framework**: Next.js 14 (App Router, Server Actions, Route Handlers)
- **Language**: TypeScript (Strict mode enabled — 0 errors)
- **AI & LLM**: Google Gemini 2.0 Flash (`@google/generative-ai`)
- **Database & ORM**: PostgreSQL + Prisma ORM
- **UI & Styling**: Tailwind CSS, Lucide Icons, Radix UI

---

## 👨‍💻 Author

**Vishal Kumar**  
B.Tech, Mathematics & Computing, IIT (ISM) Dhanbad  
GitHub: [@vishalkumar-ai25](https://github.com/vishalkumar-ai25)
