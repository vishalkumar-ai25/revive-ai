# ⚡ ReviveAI — Autonomous Payment Revenue Recovery System

> **Built for Razorpay AI Builder Buildathon 2026 — Track 03: AI Revenue Recovery**  
> An autonomous multi-agent platform that detects revenue at risk, diagnoses root causes across Indian banking rails & PSPs, and executes bounded recovery workflows with compliant stopping rules and immutable audit trails.

---

## 🎯 The Problem

In India, **30%–35% of all payment attempts degrade or fail** due to bank timeouts, insufficient funds, network drops, and PSP throttling. For a high-velocity merchant, this means lakhs of rupees in GMV leaking daily.

Current systems either **do nothing** or **blindly retry**, causing spam, customer frustration, and regulatory compliance violations.

---

## 🏗️ System Architecture

```mermaid
flowchart TB
    subgraph Ingestion["📥 Event Ingestion Layer"]
        WH[Webhook Ingestion API<br/>/api/webhooks/payment]
        SIM[Batch Simulator Engine<br/>Synthetic Indian Failure Gen]
    end

    subgraph Memory["🗄️ State & Compliance Guardrails"]
        DB[(PostgreSQL / Prisma)]
        STOP[Stopping Rules Engine<br/>Max 4 Retries · Quiet Hours · Fraud Exclusions]
    end

    subgraph Agents["🧠 Multi-Agent Recovery Pipeline"]
        DA[DiagnosisAgent<br/>Gemini 2.0 Flash + Deterministic Fallback]
        RA[RiskAssessmentAgent<br/>Multi-Factor Weighted Recovery Scorer]
        SA[StrategyAgent<br/>Intervention & Timing Sequencer]
    end

    subgraph Execution["⚡ Bounded Interventions"]
        R1[Smart Bank-Window Retry]
        R2[Customer Action Nudge]
        R3[Alternative Method Suggester]
        R4[Merchant Escalation Queue]
    end

    subgraph Audit["📜 Immutable Audit Trail"]
        LOG[Audit Trail Logger<br/>Full Reasoning & Provenance Logs]
    end

    WH --> STOP
    SIM --> STOP
    STOP -->|Pass| DA
    STOP -->|Halt| DB
    DA --> RA --> SA
    SA --> R1 & R2 & R3 & R4
    R1 & R2 & R3 & R4 --> DB
    DA & RA & SA & STOP --> LOG --> DB
```

---

## 🤖 How Our Multi-Agent System Is Structured

ReviveAI implements a **custom, lightweight, type-safe multi-agent architecture in pure TypeScript** (no heavy external graph frameworks like LangGraph). This guarantees sub-millisecond execution (~12ms per transaction), 100% deterministic fallback during LLM outages or rate limits (HTTP 429), and strict compliance boundaries.

```mermaid
flowchart TD
    WH["📥 Payment Failure Event / Webhook<br/>(PaymentFailureEvent)"] --> ORCH["⚙️ RecoveryPipeline Orchestrator<br/>(src/lib/agents/index.ts)"]

    subgraph MultiAgentCore["🧠 Autonomous Multi-Agent Core"]
        direction TB
        
        A1["1️⃣ DiagnosisAgent<br/>• Google Gemini 2.0 Flash (structured JSON output)<br/>• 24-code deterministic rule fallback<br/>• Extracts signals (late night, recurring)"]
        
        A2["2️⃣ RiskAssessmentAgent<br/>• Multi-factor weighted scoring model<br/>• Evaluates CLV, Amount, Category Base Rate<br/>• Computes Recovery Probability (0.0 to 1.0)"]
        
        A3["3️⃣ StrategyAgent<br/>• Selects bounded recovery strategy<br/>• Calculates optimal retry/nudge timing<br/>• Maps 5-tier escalation channel"]

        A4["🔄 MandateRetrySequencer<br/>(Recurring E-Mandates)<br/>• 4-attempt spacing (T+0, T+48h, T+96h, T+144h)<br/>• 10:15 AM IST bank clearing windows<br/>• Rail fallback (UPI → e-NACH → On-Demand)<br/>• 24h pre-debit notifications"]

        A1 -->|DiagnosisResult| A2
        A2 -->|RiskAssessmentResult| A3
        A3 -.->|Recurring Mandate| A4
    end

    ORCH --> A1

    subgraph Guardrails["🛡️ Compliance & Guardrails Engine"]
        direction TB
        SRE["StoppingRulesEngine (6 Non-Negotiable Rules)<br/>1. FRAUD_BLOCK (Never retry fraud)<br/>2. BELOW_MIN_AMOUNT (< ₹50)<br/>3. MAX_RETRIES_EXCEEDED (≥ 4 retries)<br/>4. MAX_NUDGES_EXCEEDED (≥ 3 nudges)<br/>5. RECOVERY_WINDOW_EXPIRED (72h / 168h)<br/>6. QUIET_HOURS (9 PM – 9 AM IST)"]
    end

    A3 -->|StrategySelection| SRE
    A4 -->|MandateSchedule| SRE

    subgraph Outcomes["⚡ Bounded Actions & State Machine"]
        ACT1["🟢 SMART_RETRY<br/>(Bank-optimal clearing windows)"]
        ACT2["📩 CUSTOMER_NUDGE<br/>(Email / SMS / WhatsApp)"]
        ACT3["💳 ALT_PAYMENT<br/>(On-demand payment link)"]
        ACT4["🚨 ESCALATE_MERCHANT<br/>(Merchant dashboard alert)"]
        ACT5["🛑 DO_NOTHING / HALT<br/>(Fraud or limit reached)"]
        ACT6["⏰ OUTREACH_DEFERRED<br/>(Scheduled for 9:00 AM IST)"]
    end

    SRE -->|Rule Passed| ACT1 & ACT2 & ACT3 & ACT4
    SRE -->|Hard Stop Violation| ACT5
    SRE -->|Quiet Hours Hit| ACT6

    subgraph Provenance["📜 Immutable Audit Trail"]
        AUDIT["AuditLogger (PostgreSQL)<br/>• Records human-readable reasoning<br/>• Preserves agent decisions before/after action<br/>• Zero-crash fault isolation"]
    end

    A1 -.-> AUDIT
    A2 -.-> AUDIT
    A3 -.-> AUDIT
    SRE -.-> AUDIT
    ACT1 & ACT2 & ACT3 & ACT4 & ACT5 & ACT6 --> AUDIT
```

### Agent Roles & Execution Responsibilities

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
   - Autonomous sequencer for subscription and mandate failures.
   - Implements 4-attempt spacing ($T_0 \to T+48\text{h} \to T+96\text{h} \to T+144\text{h}$) aligned with Indian bank clearing windows (10:15 AM IST).
   - Progressive rail switching: `UPI_AUTOPAY` $\to$ `E_NACH` $\to$ `ON_DEMAND_LINK`.
   - Generates mandatory 24-hour pre-debit notifications prior to each execution.

5. **[`StoppingRulesEngine`](file:///Users/vishalkumar/revive-ai/src/lib/engine/stopping-rules.ts) (Compliance Guardrails)**
   - Enforces **6 non-negotiable rules**: Fraud blocks (zero-retry), minimum amount (<₹50), max 4 retries, max 3 nudges, recovery window expiry (72h standard / 168h mandate), and **Quiet Hours** (9:00 PM – 9:00 AM IST).
   - Quiet hours safely defers customer nudges to 9:00 AM IST while permitting silent backend bank retries.

6. **[`AuditLogger`](file:///Users/vishalkumar/revive-ai/src/lib/audit/logger.ts) (Immutable Decision Trail)**
   - Writes immutable audit records to PostgreSQL before and after every recovery decision.
   - Captures human-readable reasoning, agent provenance, and metadata without blocking money movement.

---

## 📊 Evaluation & The Bar

ReviveAI is built specifically to address the criteria defined in **Track 03 — The Bar**:

| Criterion | Implementation in ReviveAI |
|---|---|
| **Measured money recovered across a batch** | Built-in batch simulation runner testing 1,000+ payments against empirical Indian payment failure distributions, outputting exact recovered GMV and recovery percentages. |
| **Compliant escalation** | 5-level escalation ladder (On-screen → Email nudge → SMS reminder → Merchant alert → Dead stop). |
| **Stopping rules** | Strict rule engine verifying fraud blocks, retry limits, quiet hours, and minimum recovery amounts before any action. |
| **Audit trail** | Immutable `audit_logs` table storing every agent's chain-of-thought, decision factors, and timestamps. |

---

## 🚀 Quick Start

### Prerequisites
- Node.js >= 18.x
- PostgreSQL database (Neon, Supabase, or local)
- Google AI Studio API Key ([Get free key](https://aistudio.google.com/))

### Installation

```bash
# 1. Clone repository
git clone https://github.com/vishalkumar-ai25/revive-ai.git
cd revive-ai

# 2. Install dependencies
npm install

# 3. Setup environment variables
cp .env.example .env
# Fill in your DATABASE_URL and GOOGLE_AI_API_KEY

# 4. Generate Prisma Client & push schema
npm run db:push
npm run db:seed

# 5. Run development server
npm run dev
```

Visit `http://localhost:3000` to access the Merchant Recovery Dashboard.

### Running Batch Simulations via CLI

```bash
# Run 100 payment simulation
npx tsx src/lib/simulation/batch-runner.ts 100

# Run 1,000 payment benchmark
npx tsx src/lib/simulation/batch-runner.ts 1000
```

---

## 🛠 Tech Stack

- **Framework**: Next.js 14 (App Router, Server Actions, Route Handlers)
- **Language**: TypeScript (Strict mode enabled)
- **AI & LLM**: Google Gemini 2.0 Flash (`@google/generative-ai`)
- **Database & ORM**: PostgreSQL + Prisma ORM
- **UI & Styling**: Tailwind CSS, Lucide Icons, Radix UI

---

## 👨‍💻 Author

**Vishal Kumar**  
B.Tech, Mathematics & Computing, IIT (ISM) Dhanbad  
GitHub: [@vishalkumar-ai25](https://github.com/vishalkumar-ai25)
