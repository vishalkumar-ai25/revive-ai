# Task Checklist: ReviveAI Implementation

## Phase 1: Immediate Bug Fixes & Clock Infrastructure

- [x] **Task 1.1: Fix Quiet Hours in StoppingRulesEngine**
  - Description: Update `StoppingRulesEngine.evaluate` so quiet hours (9 PM – 9 AM IST) strictly gates customer-facing outreach (`CUSTOMER_NUDGE`, email/SMS) while allowing silent backend `SMART_RETRY` to proceed.
  - Acceptance: `SMART_RETRY` passes during quiet hours; `CUSTOMER_NUDGE` is halted.
  - Verify: Test with virtual time set to 11 PM IST.
  - Files: `src/lib/engine/stopping-rules.ts`.

- [x] **Task 1.2: Fix ESLint Rule Configuration**
  - Description: Fix the broken `@typescript-eslint/no-unused-vars` rule in `.eslintrc.json` so `npm run lint` executes cleanly.
  - Acceptance: `npm run lint` passes without rule definition errors.
  - Verify: Run `npm run lint`.
  - Files: `.eslintrc.json`.

- [x] **Task 1.3: Implement Injectable Clock Interface**
  - Description: Create `src/lib/time/clock.ts` exporting `Clock`, `SystemClock`, and `VirtualClock` (with `advanceHours()` / `advanceMinutes()`).
  - Acceptance: Clock interface provides virtual time advancement for simulation tests.
  - Verify: Unit test in `tests/clock.test.ts`.
  - Files: `src/lib/time/clock.ts`.

- [x] **Task 1.4: Add Docker Compose for PostgreSQL**
  - Description: Create `docker-compose.yml` for local PostgreSQL 16 on port 5432 with volume persistence and healthcheck.
  - Acceptance: `docker compose up -d` starts PostgreSQL instance seamlessly.
  - Verify: Run `docker compose config`.
  - Files: `docker-compose.yml`.

---

## Phase 2: Dynamic Escalation Ladder & Multi-Attempt Lifecycle

- [x] **Task 2.1: `currentEscalationLevel()` pure function + tests**
  - Description: Add `currentEscalationLevel(hoursSinceFailure: number): EscalationLevel` in a new `src/lib/engine/escalation-ladder.ts`. Returns the highest `ESCALATION_CONFIG.delayHours` threshold crossed. Pure function — no side effects, no behavior change yet (unused until Task 2.4).
  - Acceptance: All escalation-ladder tests pass; function is not yet wired into any call site.
  - Verify: `npm test` (new `tests/escalation-ladder.test.ts`).
  - Files: `src/lib/engine/escalation-ladder.ts`, `tests/escalation-ladder.test.ts`.

- [x] **Task 2.2: Add `paymentId?` to `AuditLogger.log()` + pass from `RecoveryEngine`**
  - Description: Add optional `paymentId?: string` to `AuditEntry` interface. When present, `AuditLogger.log()` uses it directly for `db.auditLog.create()` relation, skipping `findUnique({ externalId })`. Pass `payment.id` from all `RecoveryEngine` `auditLogger.log()` call sites. Removes per-call lookup amplification before multi-attempt multiplies it.
  - Acceptance: `npm test` passes; `npm run typecheck` clean; no behavior change, only removed DB lookup.
  - Verify: `npm test && npm run typecheck`.
  - Files: `src/lib/audit/logger.ts`, `src/lib/engine/recovery-engine.ts`.

- [x] **Task 2.3: Split `processFailure()` → `intake()` + `tick()` (highest-risk task)**
  - Description: Full engine refactor per spec §12.3. Scope: (a) `intake()` creates first attempt as `outcome: PENDING`, `executedAt: null`; (b) `tick(asOf)` batch-fetches due attempts in one query (`scheduledAt IS NULL OR scheduledAt <= asOf`), re-evaluates stopping rules, simulates outcome, schedules next attempt via `pipeline.processRetry()` on failure; (c) `processFailure()` becomes `intake()` + `tick(clock.now())` shim; (d) fix Step 6 `"FAILED"` status regression — failed attempts leave Payment at `RECOVERY_IN_PROGRESS`; (e) add `processRetry()` to `RecoveryPipeline` (skips diagnosis, no `DIAGNOSIS_COMPLETE` audit entry); (f) add outcome-filter to Rules 3 and 4 in `stopping-rules.ts`; (g) 5 new PENDING/STOPPED_BY_RULE exclusion tests.
  - Acceptance: All 33+ tests pass; typecheck clean; full diff reviewed before merge.
  - Verify: `npm test && npm run typecheck` — full diff required.
  - Files: `src/lib/engine/recovery-engine.ts`, `src/lib/agents/index.ts`, `src/lib/engine/stopping-rules.ts`, `tests/stopping-rules.test.ts`.

- [x] **Task 2.4: Wire `currentEscalationLevel()` into `CUSTOMER_NUDGE` channel selection**
  - Description: In `strategy-agent.ts::buildParams()`, replace hardcoded `LEVEL_2_EMAIL` / `channel: "email"` with `currentEscalationLevel(hoursSinceFailure)` → channel derived from `ESCALATION_CONFIG`. Includes `"sms"` branch at `LEVEL_3_SMS`. `StrategyAgent` requires `hoursSinceFailure` context — pass from `RecoveryEngine` via `select()` call.
  - Acceptance: A `CUSTOMER_NUDGE` attempt at < 1h uses email; at 24h–48h uses sms; `npm test` passes.
  - Verify: `npm test && npm run typecheck`.
  - Files: `src/lib/agents/strategy-agent.ts`.

- [x] **Task 2.5: Quiet-hours defer-not-kill (gated on Decision 1)**
  - Description: Change quiet-hours trip behavior from `Payment.status = "DEAD"` to rescheduling `scheduledAt` to next 9:00 AM IST, leaving `outcome: PENDING`, not touching Payment.status. Changes existing `tests/stopping-rules.test.ts` assertions for quiet-hours case. Do not start until Decision 1 is explicitly confirmed.
  - Acceptance: Quiet-hours trip on `CUSTOMER_NUDGE` produces a rescheduled `PENDING` attempt, not `DEAD` payment. All existing tests pass with updated assertions.
  - Verify: `npm test`.
  - Files: `src/lib/engine/recovery-engine.ts`, `tests/stopping-rules.test.ts`.

- [x] **Task 2.6: BatchRunner loop redesign — `intake()` + fixed 1h tick loop**
  - Description: Replace single `processFailure()` call per payment with: (1) all events through `engine.intake()`; (2) fixed 1h tick loop advancing `VirtualClock` until `MAX_RECOVERY_WINDOW_HOURS + 1h` or no pending attempts remain; (3) `engine.tick(t)` each iteration with one batch query. `calculateReport()` reads final outcomes across all attempts.
  - Acceptance: 1,000-payment batch produces multi-attempt outcomes; `npm run simulate 1000` completes correctly.
  - Verify: `npm run simulate 100` (smoke test before 1000).
  - Files: `src/lib/simulation/batch-runner.ts`.

---


## Phase 3: DB Query Optimization & RBI Mandate Sequencer

- [x] **Task 3.1: Optimize AuditLogger DB Queries**
  - Description: Already implemented in Task 2.2 (commit `8d8c007`). `paymentId?: string` added to `AuditEntry`, fast-path in `log()` bypasses `findUnique({ externalId })`. All `RecoveryEngine` and `RecoveryPipeline` call sites verified to pass `paymentId`.
  - Acceptance: Audit logging executes a single `db.auditLog.create` without redundant lookup.
  - Verify: Code inspection confirmed; no further changes needed.

- [x] **Task 3.2a: Reframe RBI Compliance Documentation**
  - Description: Rewrite `docs/rbi-compliance.md` §2.1 to stop citing unverifiable circular RBI/2019-20/55. Reframe 4-attempt/168h design as ReviveAI's own retry policy informed by common e-mandate industry practice. Acknowledge 2026 consolidated framework exists but has not been independently verified against. Add note about mandatory 24h pre-debit notification requirement.
  - Acceptance: No specific RBI circular numbers cited as regulatory requirements. 4-attempt limit framed as policy, not regulation.
  - Files: `docs/rbi-compliance.md`.

- [x] **Task 3.2b: Make StoppingRulesEngine Window-Aware for Mandates**
  - Description: Rule 5 (recovery window expiry) in `stopping-rules.ts` currently uses `STOPPING_RULES.MAX_RECOVERY_WINDOW_HOURS` (72h) for ALL payments. Mandate retry schedules need 168h. Fix: make the window check type-aware — use `MANDATE_RULES.WINDOW_HOURS` (168) when `event.isRecurring && event.mandateId` is truthy. Add `MANDATE_RULES` constants to `constants.ts`.
  - Acceptance: Mandate payments survive past 72h; non-mandate payments still expire at 72h. Existing stopping-rules tests still pass.
  - Verify: `npm test && npm run typecheck`.
  - Files: `src/lib/engine/stopping-rules.ts`, `src/lib/constants.ts`, `tests/stopping-rules.test.ts`.

- [x] **Task 3.2c: Implement Mandate Retry Sequencer**
  - Description: Create `src/lib/agents/mandate-sequencer.ts` — pure deterministic scheduling module (no LLM calls). 4-attempt limit (ReviveAI policy), salary-cycle-aligned spacing (T+0/T+48h/T+96h/T+144h), bank-optimal timing (10:15 AM IST), rail switching (UPI Autopay → e-NACH → Card → on-demand link). Expired/revoked mandates → re-authorization path, not retry. Include `preDebitNotificationSentAt: Date | null` field (T-24h before each attempt). All reasoning strings avoid asserting specific regulatory citations as fact.
  - Acceptance: Generates correct retry schedule; handles expired vs. active mandate distinction; preDebitNotificationSentAt is T-24h before scheduledAt.
  - Verify: `npm test` (new `tests/mandate-sequencer.test.ts`).
  - Files: `src/lib/agents/mandate-sequencer.ts`, `src/lib/types.ts`, `src/lib/constants.ts`.

- [x] **Task 3.3: Wire Mandate Sequencer into Pipeline**
  - Description: Integrate `MandateRetrySequencer` into `StrategyAgent` for mandate failure events (`event.isRecurring && event.mandateId` or `diagnosis.category === 'MANDATE_EXPIRED'`). Export from `agents/index.ts` barrel. StrategyAgent delegates timing/rail selection to sequencer, still owns final `StrategyResult`.
  - Acceptance: Mandate failures route through sequencer; non-mandate payments unchanged.
  - Verify: `npm test && npm run typecheck`.
  - Files: `src/lib/agents/strategy-agent.ts`, `src/lib/agents/index.ts`.

- [x] **Task 3.4: Mandate Pipeline Integration Test**
  - Description: Integration test running a mandate-failure payment through `RecoveryEngine.intake()` + repeated `tick()` calls at T+48h, T+96h, T+144h, T+168h using `VirtualClock`. Confirms attempts 3 and 4 actually execute through the real pipeline (not just sequencer in isolation). This is the test that catches the 72h vs. 168h window conflict.
  - Acceptance: All 4 mandate attempts fire through the real engine at their scheduled times; attempt at T+168h produces termination.
  - Verify: `npm test`.
  - Files: `tests/mandate-sequencer.test.ts` (integration section).

---

## Phase 4: Automated Test Suite (`npm test`)

- [x] **Task 4.1: Wire `npm test` Script in package.json**
  - Description: Configured `"test": "tsx --test $(find tests -name '*.test.ts' | tr '\\n' ' ')"` in `package.json`.
  - Acceptance: `npm test` automatically discovers and executes all test files.
  - Verify: Confirmed working across 77 passing tests.
  - Files: `package.json`.

- [x] **Task 4.2: End-to-End RecoveryPipeline Test Suite (`tests/pipeline.test.ts`)**
  - Description: Created `tests/pipeline.test.ts` covering 3-stage pipeline flow (`Diagnosis` $\to$ `Risk` $\to$ `Strategy`), `processRetry()` isolation, rule fallback on LLM bypass/429, malformed/noisy webhook payload resilience ("chaos"), and audit trail provenance.
  - Acceptance: All pipeline integration paths pass without unhandled errors; audit schema verified.
  - Verify: Confirmed passing 14/14 tests in suite.
  - Files: `tests/pipeline.test.ts`.

- [x] **Task 4.3: Unit Tests for DiagnosisAgent & RiskAssessmentAgent**
  - Description: Created `tests/diagnosis-agent.test.ts` and `tests/risk-assessment.test.ts` testing all 12 error code mappings, signal extraction, LTV weight factors, fraud zero-tolerance, and confidence calculations.
  - Acceptance: 100% of classification and scoring logic verified with strict assertion checks.
  - Verify: Confirmed passing 33 new unit tests across both suites.
  - Files: `tests/diagnosis-agent.test.ts`, `tests/risk-assessment.test.ts`.

- [x] **Task 4.4: Multi-Attempt Lifecycle State Machine Tests**
  - Description: Created `tests/multi-attempt-lifecycle.test.ts` verifying complete end-to-end multi-attempt progression ($T_0 \to T+48\text{h} \to T+96\text{h} \to T+144\text{h} \to \text{DEAD}$) under `VirtualClock`.
  - Acceptance: Verifies state transitions, stopping rules re-evaluation at each tick, and recovery termination.
  - Verify: Confirmed passing 4/4 multi-attempt progression and rule boundary tests.
  - Files: `tests/multi-attempt-lifecycle.test.ts`.

---

## Phase 5: Batch Simulation Benchmark (1,000 Payments)

- [x] **Task 5.1: Refine Synthetic Payment Generator**
  - Description: Update `payment-generator.ts` with complete Indian failure distributions across all 12 categories, recurring mandates, and banks.
  - Acceptance: Generates statistically representative datasets with realistic metadata.
  - Verify: Batch generation test.
  - Files: `src/lib/simulation/payment-generator.ts`.

- [x] **Task 5.2: Multi-Attempt Virtual Timeline Batch Runner**
  - Description: Update `batch-runner.ts` to simulate full multi-attempt lifecycle with virtual time progression and print the comprehensive 4-part aggregate report.
  - Acceptance: 1,000-payment batch runs in $<5$s and outputs exact money recovered and unrecoverable reasons.
  - Verify: Run `npm run simulate 1000`.
  - Files: `src/lib/simulation/batch-runner.ts`, `src/app/api/simulate/route.ts`.

---

## Phase 6: Demo Polish (Client Recovery Page & Resend Dispatcher)

- [x] **Task 6.1: Build Interactive Recovery Page with Guardrails**
  - Description: Create `src/app/recover/[paymentId]/page.tsx` displaying order details, alternative payment suggestions, and a "Pay Now" action.
  - Acceptance: Page strictly re-evaluates `StoppingRulesEngine.evaluate()`; rejects dead/fraud payments; captures valid payments.
  - Verify: Navigate to `/recover/[paymentId]` and test pay flow.
  - Files: `src/app/recover/[paymentId]/page.tsx`, `src/app/api/recover/[paymentId]/route.ts`.

- [x] **Task 6.2: Defensively Wired Resend Email Dispatcher**
  - Description: Create `src/lib/notifications/email-dispatcher.ts` sending real HTML recovery emails if `RESEND_API_KEY` is present, or silently logging to audit trail if unset.
  - Acceptance: Non-blocking execution without crashing when key is missing.
  - Verify: Test dispatch with and without key.
  - Files: `src/lib/notifications/email-dispatcher.ts`.

- [x] **Task 6.3: Polish Dashboard UI & Filter Tabs**
  - Description: Polish `MetricCards.tsx`, add category filter tabs to `LiveFeed.tsx` (All, UPI/Cards, Checkout Drop-off, Subscriptions, Mandates), and refine `AuditModal.tsx`.
  - Acceptance: Clean responsive UI with instant filtering and rich audit modal.
  - Verify: Visual inspection on `localhost:3000`.
  - Files: `src/components/MetricCards.tsx`, `src/components/LiveFeed.tsx`, `src/components/AuditModal.tsx`.

---

## Phase 7: Quality Gates & Handover

- [x] **Task 7.1: Final Quality Verification (Typecheck, Lint, Tests)**
  - Description: Run `npm test`, `npm run typecheck`, and `npm run lint`.
  - Acceptance: 0 errors, clean output.
  - Verify: `npm test && npm run typecheck && npm run lint`.

- [x] **Task 7.2: Ship to Git & Final Documentation**
  - Description: Update `README.md` and commit final code to GitHub `main`.
  - Acceptance: Clean git status, pushed to GitHub.
  - Verify: `git status && git push`.

---

## Phase 8: Concurrency Guard + Test Assertion Audit

- [x] **Task 8.1: Test Assertion Audit — `mandate-sequencer.test.ts`**
  - Description: Upgrade 8 weak `assert.ok(... !== null)` existence checks to value assertions. 4 are idiomatic cleanups (already have follow-up value assertions); 4 are genuinely weak and need `scheduledAt` UTC hour/minute/date assertions derived from the 10:15 AM IST = 04:45 UTC requirement.
  - Acceptance: All 120 tests pass; mutation test (break IST math → test fails → revert) proves the upgraded assertions detect the class of bug they're meant to catch.
  - Verify: `npm test && npm run typecheck && npm run lint`.
  - Files: `tests/mandate-sequencer.test.ts`.

- [x] **Task 8.2: Concurrency Guard — Row-Level Locking for `tick()`**
  - Description: Add `claimedAt DateTime?` to `RecoveryAttempt` schema. Replace `tick()`'s `findMany` with atomic `SELECT FOR UPDATE SKIP LOCKED` + `UPDATE` CTE via `db.$queryRaw`. Load full relational data via Prisma for claimed IDs. Create first live-database integration test proving zero overlap under concurrent claims.
  - Acceptance: Concurrent claim test passes reliably (5 consecutive runs). Full existing suite unchanged. `npm run simulate 1000` produces benchmark numbers in expected range.
  - Verify: `npm test && npm run typecheck && npm run lint && npm run simulate 1000`.
  - Files: `prisma/schema.prisma`, `src/lib/engine/recovery-engine.ts`, `tests/concurrency-guard.integration.test.ts`.
