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

- [ ] **Task 3.1: Optimize AuditLogger DB Queries**
  - Description: Update `AuditLogger.log` to accept `paymentId` directly instead of querying `findUnique({ externalId })` on every call, eliminating N+1 overhead.
  - Acceptance: Audit logging executes a single `db.auditLog.create` without redundant lookup.
  - Verify: Check execution time during batch runs.
  - Files: `src/lib/audit/logger.ts`, `src/lib/agents/index.ts`, `src/lib/engine/recovery-engine.ts`.

- [ ] **Task 3.2: Implement RBI-Compliant Mandate Retry Sequencer**
  - Description: Create `src/lib/agents/mandate-sequencer.ts` implementing 4-attempt limit, salary-cycle window alignment (T+48h), time-of-day bank optimization, and automatic rail switching (UPI Autopay $\rightarrow$ e-NACH/Card).
  - Acceptance: Generates compliant retry schedule; returns re-authorization prompt when mandate expired.
  - Verify: Run mandate sequencer unit tests.
  - Files: `src/lib/agents/mandate-sequencer.ts`, `src/lib/types.ts`.

- [ ] **Task 3.3: Wire Mandate Sequencer into Pipeline**
  - Description: Integrate `MandateRetrySequencer` into `StrategyAgent` and `RecoveryPipeline` for `isRecurring` and mandate failure events.
  - Acceptance: Mandate failures route through the sequencer and log decision provenance.
  - Verify: Test mandate failure event processing.
  - Files: `src/lib/agents/strategy-agent.ts`, `src/lib/agents/index.ts`.

---

## Phase 4: Automated Test Suite (`npm test`)

- [ ] **Task 4.1: Wire `npm test` Script in package.json**
  - Description: Add `"test": "tsx --test tests/**/*.test.ts"` to `package.json`.
  - Acceptance: `npm test` executes all test files.
  - Verify: Run `npm test`.
  - Files: `package.json`.

- [ ] **Task 4.2: Unit Tests for All Agents & Sequencer**
  - Description: Create unit tests in `tests/`: `diagnosis-agent.test.ts`, `risk-assessment.test.ts`, `strategy-agent.test.ts`, `mandate-sequencer.test.ts`.
  - Acceptance: 100% of agent tests pass with high assertion coverage.
  - Verify: Run `npm test`.
  - Files: `tests/diagnosis-agent.test.ts`, `tests/risk-assessment.test.ts`, `tests/strategy-agent.test.ts`, `tests/mandate-sequencer.test.ts`.

- [ ] **Task 4.3: Tests for Stopping Rules, Quiet Hours & Escalation**
  - Description: Create `tests/stopping-rules.test.ts` (verifying all 6 rules, fraud blocks, and quiet hours SMART_RETRY exemption) and `tests/escalation-ladder.test.ts`.
  - Acceptance: All guardrail tests pass.
  - Verify: Run `npm test`.
  - Files: `tests/stopping-rules.test.ts`, `tests/escalation-ladder.test.ts`.

- [ ] **Task 4.4: Multi-Attempt Lifecycle Progression Test**
  - Description: Create `tests/multi-attempt-lifecycle.test.ts` verifying a payment progressing attempt 1 $\rightarrow$ 2 $\rightarrow$ 3 $\rightarrow$ 4 $\rightarrow$ DEAD under virtual time.
  - Acceptance: Verifies state transitions and stopping rules termination.
  - Verify: Run `npm test`.
  - Files: `tests/multi-attempt-lifecycle.test.ts`.

---

## Phase 5: Batch Simulation Benchmark (1,000 Payments)

- [ ] **Task 5.1: Refine Synthetic Payment Generator**
  - Description: Update `payment-generator.ts` with complete Indian failure distributions across all 12 categories, recurring mandates, and banks.
  - Acceptance: Generates statistically representative datasets with realistic metadata.
  - Verify: Batch generation test.
  - Files: `src/lib/simulation/payment-generator.ts`.

- [ ] **Task 5.2: Multi-Attempt Virtual Timeline Batch Runner**
  - Description: Update `batch-runner.ts` to simulate full multi-attempt lifecycle with virtual time progression and print the comprehensive 4-part aggregate report.
  - Acceptance: 1,000-payment batch runs in $<5$s and outputs exact money recovered and unrecoverable reasons.
  - Verify: Run `npm run simulate 1000`.
  - Files: `src/lib/simulation/batch-runner.ts`, `src/app/api/simulate/route.ts`.

---

## Phase 6: Demo Polish (Client Recovery Page & Resend Dispatcher)

- [ ] **Task 6.1: Build Interactive Recovery Page with Guardrails**
  - Description: Create `src/app/recover/[paymentId]/page.tsx` displaying order details, alternative payment suggestions, and a "Pay Now" action.
  - Acceptance: Page strictly re-evaluates `StoppingRulesEngine.evaluate()`; rejects dead/fraud payments; captures valid payments.
  - Verify: Navigate to `/recover/[paymentId]` and test pay flow.
  - Files: `src/app/recover/[paymentId]/page.tsx`, `src/app/api/recover/[paymentId]/route.ts`.

- [ ] **Task 6.2: Defensively Wired Resend Email Dispatcher**
  - Description: Create `src/lib/notifications/email-dispatcher.ts` sending real HTML recovery emails if `RESEND_API_KEY` is present, or silently logging to audit trail if unset.
  - Acceptance: Non-blocking execution without crashing when key is missing.
  - Verify: Test dispatch with and without key.
  - Files: `src/lib/notifications/email-dispatcher.ts`.

- [ ] **Task 6.3: Polish Dashboard UI & Filter Tabs**
  - Description: Polish `MetricCards.tsx`, add category filter tabs to `LiveFeed.tsx` (All, UPI/Cards, Checkout Drop-off, Subscriptions, Mandates), and refine `AuditModal.tsx`.
  - Acceptance: Clean responsive UI with instant filtering and rich audit modal.
  - Verify: Visual inspection on `localhost:3000`.
  - Files: `src/components/MetricCards.tsx`, `src/components/LiveFeed.tsx`, `src/components/AuditModal.tsx`.

---

## Phase 7: Review, Documentation & Ship

- [ ] **Task 7.1: Update README.md & System Documentation**
  - Description: Update `README.md` with accurate architecture diagrams, quick-start guide, Docker commands, and Track 03 criteria mapping.
  - Acceptance: 100% alignment between README, spec, and codebase.
  - Verify: Markdown preview and link validation.
  - Files: `README.md`.

- [ ] **Task 7.2: Final Quality Verification & Git Ship**
  - Description: Run `npm test`, `npm run typecheck`, and `npm run lint`. Commit clean codebase and push to GitHub `main`.
  - Acceptance: 0 errors, clean git status, pushed to GitHub.
  - Verify: `npm test && npm run typecheck && npm run lint && git status`.
