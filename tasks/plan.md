# Implementation Plan: ReviveAI — Autonomous Payment Revenue Recovery System

**Project:** ReviveAI  
**Track:** Track 03 · Autonomous Revenue Recovery (Razorpay AI Buildathon 2026)  
**Specification:** [`docs/spec.md`](file:///Users/vishalkumar/revive-ai/docs/spec.md) (Version 2.1.0)  
**Methodology:** [`agent-skills-main`](file:///Users/vishalkumar/agent-skills-main) Gated Lifecycle  

---

## 1. Architectural Strategy & Phasing

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: Immediate Bug Fixes & Clock Infrastructure                             │
│ • Fix Quiet Hours in stopping-rules.ts (allow silent SMART_RETRY)               │
│ • Fix broken ESLint rule in .eslintrc.json                                      │
│ • Implement Injectable Clock (Clock, SystemClock, VirtualClock) in src/lib/time │
│ • Add docker-compose.yml for 1-command local PostgreSQL                         │
└───────────────────────────────────────┬─────────────────────────────────────────┘
                                        │ Checkpoint 1: Quiet hours fix & clock verified
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 2: Dynamic Escalation Ladder & Multi-Attempt State Machine                │
│ • Build escalation-ladder.ts (Level 1 → 2 → 3 → 4 → 5 progression)              │
│ • Multi-attempt progression loop in RecoveryEngine (attempt 1→2→3→4)            │
│ • Fix /api/analytics escalation queue query & build EscalationQueue.tsx UI      │
└───────────────────────────────────────┬─────────────────────────────────────────┘
                                        │ Checkpoint 2: Escalation ladder & queue active
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 3: DB Query Optimization & RBI Mandate Sequencer                          │
│ • Optimize AuditLogger (pass paymentId directly, eliminate N+1 lookup)          │
│ • Implement mandate-sequencer.ts (RBI compliance, 4-attempt cap, rail fallback) │
│ • Wire MandateRetrySequencer into StrategyAgent and RecoveryPipeline            │
└───────────────────────────────────────┬─────────────────────────────────────────┘
                                        │ Checkpoint 3: Mandate sequencer & fast DB logging
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 4: Automated Test Suite (npm test via tsx --test)                         │
│ • Unit tests: diagnosis, risk assessment, strategy, mandate sequencer           │
│ • Stopping rules & quiet-hours tests (including SMART_RETRY allowance)          │
│ • Multi-attempt lifecycle test: payment progressing attempt 1→2→3→4 → DEAD      │
└───────────────────────────────────────┬─────────────────────────────────────────┘
                                        │ Checkpoint 4: 100% test suite green
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 5: Batch Simulation Benchmark (1,000 Payments)                            │
│ • Update payment-generator.ts with 12 realistic Indian failure distributions    │
│ • Multi-attempt virtual timeline batch runner (1,000 payments in <5s)           │
│ • Print comprehensive 4-part aggregate report                                   │
└───────────────────────────────────────┬─────────────────────────────────────────┘
                                        │ Checkpoint 5: 1,000 payment benchmark verified
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 6: Demo Polish (Client Recovery Page & Resend Dispatcher)                 │
│ • Build /recover/[paymentId] checkout page with StoppingRule gate on entry      │
│ • Wire Resend email dispatcher defensively (silent fallback if unconfigured)    │
│ • Polish MetricCards, LiveFeed filter tabs, and AuditModal UI                   │
└───────────────────────────────────────┬─────────────────────────────────────────┘
                                        │ Checkpoint 6: Interactive checkout & email live
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 7: Review, Documentation & Ship                                           │
│ • Update README.md (architecture diagrams, setup, quick start)                  │
│ • Final typecheck, lint, and git commit/push                                    │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Key Technical Decisions

| Area | Decision | Rationale |
|---|---|---|
| **Time Virtualization** | `InjectableClock` (`VirtualClock` + `SystemClock`) | Allows batch simulation to simulate 72 hours of multi-attempt recovery in milliseconds without real-world sleep delays. |
| **Escalation Queue** | Store attempt status as `PENDING` during intermediate escalation levels | Enables `/api/analytics` to query real Level-4 items requiring merchant analyst manual intervention. |
| **Local DB Dev** | `docker-compose.yml` with Postgres 16 | One-command local PostgreSQL (`docker compose up -d`) prevents SQLite enum mapping fragmentation. |
| **Audit DB Performance**| Pass `paymentId` directly into `AuditLogger.log` | Avoids thousands of redundant `findUnique({ externalId })` queries in 1,000-payment batch runs. |
| **Recovery Guardrail**| Re-evaluate `StoppingRulesEngine` on `/recover/[paymentId]` | Prevents expired or fraud-flagged transactions from being captured through stale nudge links. |
