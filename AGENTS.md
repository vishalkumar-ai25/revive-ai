# AGENTS.md — ReviveAI Development Guidelines

This file provides guidance to AI coding agents (Antigravity, Claude Code, Cursor, Copilot) when working with code in this repository.

## Project Overview
ReviveAI is an autonomous multi-agent payment recovery platform for Indian payment gateways and merchants (Razorpay AI Buildathon 2026 · Track 03).

## Gated Lifecycle & Skill Enforcement
All agents working on this codebase must strictly follow the skill-driven lifecycle:
- **DEFINE** → `spec-driven-development` ([`docs/spec.md`](docs/spec.md))
- **PLAN** → `planning-and-task-breakdown` ([`tasks/plan.md`](tasks/plan.md), [`tasks/todo.md`](tasks/todo.md))
- **BUILD** → `incremental-implementation` + `test-driven-development`
- **VERIFY** → `debugging-and-error-recovery` + `npm test`
- **REVIEW** → `code-review-and-quality` + `code-simplification`
- **SHIP** → `shipping-and-launch` + `git-workflow-and-versioning`

## Intent → Skill Mapping
- Feature / New functionality → `incremental-implementation` + `test-driven-development`
- Bug / Failure / Unexpected behavior → `debugging-and-error-recovery`
- Refactoring / Clean up → `code-simplification`
- API / Interface design → `api-and-interface-design`
- Frontend UI → `frontend-ui-engineering`

## Anti-Rationalization Rules
- Never jump straight to coding without updating `tasks/todo.md`.
- Never claim unbuilt or aspirational frameworks (e.g. LangGraph). Code must match documentation with zero gap.
- Every business logic module in `src/lib/` must have an accompanying test in `tests/`.

## Core Boundaries & Compliance Rules
- **Always:** Write immutable audit logs before and after recovery decisions with human-readable reasoning.
- **Always:** Enforce quiet hours (9:00 PM – 9:00 AM IST) on customer-facing outreach (`CUSTOMER_NUDGE`, email/SMS).
- **Always:** Allow silent backend bank retries (`SMART_RETRY`) during quiet hours.
- **Always:** Gate client-facing recovery endpoints (`/recover/[paymentId]`) with stopping-rule re-evaluation.
- **Never:** Retry any payment flagged as `FRAUD_DETECTED` or `SUSPECTED_FRAUD`.
- **Never:** Send more than 3 nudge communications to a single customer for a transaction.
- **Never:** Hardcode API keys or secrets in source code.

## Executable Commands
```bash
# Development
npm run dev

# Testing
npm test

# Batch Benchmark
npm run simulate 1000

# Quality
npm run typecheck
npm run lint
npm run format
```
