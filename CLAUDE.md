# CLAUDE.md — ReviveAI Assistant Guide

This document provides architectural guidance and key file mappings for AI assistants working on ReviveAI.

## Architecture
- **Framework:** Next.js 14 App Router + React 18 + Tailwind CSS + TypeScript
- **Database & ORM:** PostgreSQL + Prisma ORM 6.8 (Single authoritative schema in `prisma/schema.prisma`)
- **AI & LLM:** Google Gemini 2.0 Flash (`@google/generative-ai`) + high-precision deterministic rule fallback
- **Test Runner:** Node 20 built-in test runner via `tsx --test`

## Key Directories
- `src/lib/agents/` — Multi-agent pipeline (`DiagnosisAgent`, `RiskAssessmentAgent`, `StrategyAgent`, `MandateRetrySequencer`, `RecoveryPipeline`)
- `src/lib/engine/` — Guardrails & orchestration (`StoppingRulesEngine`, `EscalationLadder`, `RecoveryEngine`)
- `src/lib/simulation/` — Synthetic payment generator and multi-attempt batch runner (`PaymentGenerator`, `BatchRunner`)
- `src/lib/time/` — Injectable virtual clock (`Clock`, `SystemClock`, `VirtualClock`)
- `src/lib/audit/` — Immutable decision provenance (`AuditLogger`)
- `src/components/` — UI components (`MetricCards`, `LiveFeed`, `AuditModal`, `EscalationQueue`, `SimulationControls`)
- `src/app/recover/[paymentId]/` — Guardrailed customer checkout recovery page
- `tests/` — Automated test suite mirroring `src/lib/`
- `docs/` — Specification (`docs/spec.md`) and RBI compliance (`docs/rbi-compliance.md`)
- `tasks/` — Implementation plan (`tasks/plan.md`) and task checklist (`tasks/todo.md`)

## Key Commands
- Dev Server: `npm run dev`
- Run Tests: `npm test`
- 1,000-Payment Benchmark: `npm run simulate 1000`
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- DB Push: `npm run db:push`
- DB Seed: `npm run db:seed`
