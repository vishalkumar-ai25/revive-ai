// =============================================================================
// RECOVERY ENGINE
// =============================================================================
// Executes the recovery strategy selected by the agent pipeline.
// Coordinates between the agent pipeline, stopping rules, escalation ladder,
// and the database to carry out recovery actions.
//
// Refactored in Phase 2 into a two-phase lifecycle:
//   1. intake() — Registers failure, runs pipeline, creates initial PENDING attempt
//   2. tick()   — Processes due PENDING attempts in batch across simulated time
// =============================================================================

import { db } from "@/lib/db";
import { RecoveryPipeline } from "@/lib/agents";
import { AuditLogger } from "@/lib/audit/logger";
import { StoppingRulesEngine } from "./stopping-rules";
import type { CustomerHistory, DiagnosisResult, PaymentFailureEvent } from "@/lib/types";
import { type Clock, SystemClock } from "@/lib/time/clock";
import type { EscalationLevel } from "@prisma/client";

export interface IntakeResult {
  paymentId: string;
  strategy: string;
  outcome: string;
  processingTimeMs: number;
}

export interface TickResult {
  attemptId: string;
  paymentId: string;
  strategy: string;
  outcome: string;
}

export class RecoveryEngine {
  private pipeline: RecoveryPipeline;
  private stoppingRules: StoppingRulesEngine;
  private auditLogger: AuditLogger;
  private clock: Clock;

  constructor(clock: Clock = new SystemClock()) {
    this.clock = clock;
    this.pipeline = new RecoveryPipeline(clock);
    this.stoppingRules = new StoppingRulesEngine(clock);
    this.auditLogger = new AuditLogger();
  }

  /**
   * Intake a new payment failure event:
   * 1. Persist/upsert payment record
   * 2. Evaluate pre-pipeline stopping rules
   * 3. Run full agent pipeline (Diagnosis → Risk → Strategy)
   * 4. Evaluate post-pipeline stopping rules
   * 5. Persist FailureEvent record
   * 6. Create initial RecoveryAttempt as PENDING (does not simulate outcome immediately)
   */
  async intake(event: PaymentFailureEvent): Promise<IntakeResult> {
    // --- Step 1: Persist payment record ---
    const customer = await this.getOrCreateCustomer(event);
    const payment = await db.payment.upsert({
      where: { externalId: event.externalId },
      create: {
        externalId: event.externalId,
        merchantId: event.merchantId,
        customerId: customer.id,
        amount: event.amount,
        currency: event.currency,
        method: event.method,
        bank: event.bank,
        upiApp: event.upiApp,
        status: "FAILED",
        errorCode: event.errorCode,
        errorDescription: event.errorDescription,
        isRecurring: event.isRecurring,
        subscriptionId: event.subscriptionId,
        mandateId: event.mandateId,
      },
      update: {
        status: "FAILED",
        errorCode: event.errorCode,
        errorDescription: event.errorDescription,
      },
    });

    // --- Step 2: Check stopping rules against previous attempts ---
    const previousAttempts = await db.recoveryAttempt.findMany({
      where: { paymentId: payment.id },
      select: { attemptNumber: true, strategy: true, outcome: true },
    });

    const isFraud =
      event.errorCode === "FRAUD_DETECTED" || event.errorCode === "SUSPECTED_FRAUD";

    const stopDecision = this.stoppingRules.evaluate(
      event,
      previousAttempts,
      isFraud,
    );

    if (stopDecision.shouldStop) {
      await db.payment.update({
        where: { id: payment.id },
        data: { status: "DEAD" },
      });

      await db.recoveryAttempt.create({
        data: {
          paymentId: payment.id,
          attemptNumber: previousAttempts.length + 1,
          strategy: "DO_NOTHING",
          escalationLevel: "LEVEL_5_DEAD",
          outcome: "STOPPED_BY_RULE",
          stoppedByRule: stopDecision.rule,
          scheduledAt: this.clock.now(),
          executedAt: this.clock.now(),
          channel: "none",
          messageContent: stopDecision.reason,
        },
      });

      await this.auditLogger.log({
        paymentId: payment.id,
        paymentExternalId: event.externalId,
        agentName: "StoppingRulesEngine",
        action: "RECOVERY_STOPPED",
        reasoning: stopDecision.reason,
        metadata: { rule: stopDecision.rule },
      });

      return {
        paymentId: payment.id,
        strategy: "DO_NOTHING",
        outcome: "STOPPED_BY_RULE",
        processingTimeMs: 0,
      };
    }

    // --- Step 3: Run agent pipeline ---
    await db.payment.update({
      where: { id: payment.id },
      data: { status: "RECOVERY_IN_PROGRESS" },
    });

    const customerHistory: CustomerHistory = {
      totalPurchases: customer.totalPurchases,
      lifetimeValue: customer.lifetimeValue,
      previousFailures: previousAttempts.length,
      daysSinceLastPurchase: null,
    };

    const pipelineResult = await this.pipeline.process(
      event,
      customerHistory,
      payment.id,
    );

    // --- Step 3.5: Post-pipeline stopping rules check (e.g. Quiet Hours for CUSTOMER_NUDGE) ---
    const postStrategyStopDecision = this.stoppingRules.evaluate(
      event,
      previousAttempts,
      isFraud,
      pipelineResult.strategy.strategy,
    );

    if (postStrategyStopDecision.shouldStop) {
      await db.payment.update({
        where: { id: payment.id },
        data: { status: "DEAD" },
      });

      await db.recoveryAttempt.create({
        data: {
          paymentId: payment.id,
          attemptNumber: previousAttempts.length + 1,
          strategy: pipelineResult.strategy.strategy,
          escalationLevel:
            pipelineResult.strategy.executionParams.escalationLevel ??
            ("LEVEL_5_DEAD" as EscalationLevel),
          outcome: "STOPPED_BY_RULE",
          stoppedByRule: postStrategyStopDecision.rule,
          scheduledAt: this.clock.now(),
          executedAt: this.clock.now(),
          channel: pipelineResult.strategy.executionParams.channel,
          messageContent: postStrategyStopDecision.reason,
        },
      });

      await this.auditLogger.log({
        paymentId: payment.id,
        paymentExternalId: event.externalId,
        agentName: "StoppingRulesEngine",
        action: "RECOVERY_STOPPED",
        reasoning: postStrategyStopDecision.reason,
        metadata: {
          rule: postStrategyStopDecision.rule,
          intendedStrategy: pipelineResult.strategy.strategy,
        },
      });

      return {
        paymentId: payment.id,
        strategy: pipelineResult.strategy.strategy,
        outcome: "STOPPED_BY_RULE",
        processingTimeMs: pipelineResult.processingTimeMs,
      };
    }

    // --- Step 4: Persist failure event ---
    await db.failureEvent.upsert({
      where: { paymentId: payment.id },
      create: {
        paymentId: payment.id,
        category: pipelineResult.diagnosis.category,
        rootCause: pipelineResult.diagnosis.rootCause,
        diagnosisConfidence: pipelineResult.diagnosis.confidence,
        isRecoverable: pipelineResult.diagnosis.isRecoverable,
        recoveryProbability: pipelineResult.riskAssessment.recoveryProbability,
      },
      update: {
        category: pipelineResult.diagnosis.category,
        rootCause: pipelineResult.diagnosis.rootCause,
        diagnosisConfidence: pipelineResult.diagnosis.confidence,
        isRecoverable: pipelineResult.diagnosis.isRecoverable,
        recoveryProbability: pipelineResult.riskAssessment.recoveryProbability,
      },
    });

    // --- Step 5: Create initial recovery attempt as PENDING ---
    const attemptNumber = previousAttempts.length + 1;
    const { strategy, executionParams } = pipelineResult.strategy;

    await db.recoveryAttempt.create({
      data: {
        paymentId: payment.id,
        attemptNumber,
        strategy,
        escalationLevel: executionParams.escalationLevel,
        outcome: "PENDING",
        scheduledAt: executionParams.scheduledAt,
        executedAt: null,
        channel: executionParams.channel,
        messageContent: executionParams.messageContent,
      },
    });

    return {
      paymentId: payment.id,
      strategy,
      outcome: "PENDING",
      processingTimeMs: pipelineResult.processingTimeMs,
    };
  }

  /**
   * Advance simulation or background worker by processing due PENDING attempts:
   * 1. Batch-fetch all PENDING attempts with scheduledAt <= asOf (or null)
   * 2. For each attempt: re-evaluate stopping rules, simulate outcome
   * 3. On SUCCESS: mark Payment RECOVERED
   * 4. On FAILED: keep Payment RECOVERY_IN_PROGRESS, schedule next attempt via processRetry()
   */
  async tick(asOf: Date): Promise<TickResult[]> {
    const dueAttempts = await db.recoveryAttempt.findMany({
      where: {
        outcome: "PENDING",
        OR: [{ scheduledAt: null }, { scheduledAt: { lte: asOf } }],
        payment: {
          status: "RECOVERY_IN_PROGRESS",
        },
      },
      include: {
        payment: {
          include: {
            customer: true,
            failureEvent: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const results: TickResult[] = [];

    for (const dueAttempt of dueAttempts) {
      const payment = dueAttempt.payment;
      const isFraud =
        payment.errorCode === "FRAUD_DETECTED" ||
        payment.errorCode === "SUSPECTED_FRAUD";

      const previousAttempts = await db.recoveryAttempt.findMany({
        where: { paymentId: payment.id },
        select: { attemptNumber: true, strategy: true, outcome: true },
      });

      const event: PaymentFailureEvent = {
        externalId: payment.externalId,
        merchantId: payment.merchantId,
        customerId: payment.customerId,
        amount: payment.amount,
        currency: payment.currency,
        method: payment.method,
        bank: payment.bank,
        upiApp: payment.upiApp,
        errorCode: payment.errorCode ?? "UNKNOWN",
        errorDescription: payment.errorDescription ?? "Unknown failure",
        isRecurring: payment.isRecurring,
        subscriptionId: payment.subscriptionId,
        mandateId: payment.mandateId,
        timestamp: payment.createdAt,
      };

      // Check stopping rules before executing this attempt
      const stopDecision = this.stoppingRules.evaluate(
        event,
        previousAttempts,
        isFraud,
        dueAttempt.strategy,
      );

      if (stopDecision.shouldStop) {
        await db.recoveryAttempt.update({
          where: { id: dueAttempt.id },
          data: {
            outcome: "STOPPED_BY_RULE",
            stoppedByRule: stopDecision.rule,
            executedAt: asOf,
          },
        });

        await db.payment.update({
          where: { id: payment.id },
          data: { status: "DEAD" },
        });

        await this.auditLogger.log({
          paymentId: payment.id,
          paymentExternalId: payment.externalId,
          agentName: "StoppingRulesEngine",
          action: "RECOVERY_STOPPED",
          reasoning: stopDecision.reason,
          metadata: { rule: stopDecision.rule },
        });

        results.push({
          attemptId: dueAttempt.id,
          paymentId: payment.id,
          strategy: dueAttempt.strategy,
          outcome: "STOPPED_BY_RULE",
        });
        continue;
      }

      // Simulate recovery outcome based on probability
      const recoveryProbability =
        payment.failureEvent?.recoveryProbability ?? 0.5;
      const isSimulatedSuccess = this.simulateOutcome(
        recoveryProbability,
        dueAttempt.strategy,
      );
      const outcome = isSimulatedSuccess ? "SUCCESS" : "FAILED";

      await db.recoveryAttempt.update({
        where: { id: dueAttempt.id },
        data: {
          outcome,
          executedAt: asOf,
        },
      });

      if (isSimulatedSuccess) {
        await db.payment.update({
          where: { id: payment.id },
          data: { status: "RECOVERED" },
        });

        await this.auditLogger.log({
          paymentId: payment.id,
          paymentExternalId: payment.externalId,
          agentName: "RecoveryEngine",
          action: "PAYMENT_RECOVERED",
          reasoning: `Strategy: ${dueAttempt.strategy} | Attempt #${dueAttempt.attemptNumber} | Outcome: SUCCESS`,
          metadata: {
            strategy: dueAttempt.strategy,
            attemptNumber: dueAttempt.attemptNumber,
            outcome: "SUCCESS",
          },
        });

        results.push({
          attemptId: dueAttempt.id,
          paymentId: payment.id,
          strategy: dueAttempt.strategy,
          outcome: "SUCCESS",
        });
      } else {
        // Failed attempt — keep payment at RECOVERY_IN_PROGRESS (do not regress to FAILED)
        await this.auditLogger.log({
          paymentId: payment.id,
          paymentExternalId: payment.externalId,
          agentName: "RecoveryEngine",
          action: "RECOVERY_ATTEMPT_FAILED",
          reasoning: `Strategy: ${dueAttempt.strategy} | Attempt #${dueAttempt.attemptNumber} | Outcome: FAILED`,
          metadata: {
            strategy: dueAttempt.strategy,
            attemptNumber: dueAttempt.attemptNumber,
            outcome: "FAILED",
          },
        });

        results.push({
          attemptId: dueAttempt.id,
          paymentId: payment.id,
          strategy: dueAttempt.strategy,
          outcome: "FAILED",
        });

        // Re-evaluate stopping rules for subsequent attempt
        const updatedPreviousAttempts = await db.recoveryAttempt.findMany({
          where: { paymentId: payment.id },
          select: { attemptNumber: true, strategy: true, outcome: true },
        });

        const nextStopDecision = this.stoppingRules.evaluate(
          event,
          updatedPreviousAttempts,
          isFraud,
        );

        if (nextStopDecision.shouldStop) {
          await db.payment.update({
            where: { id: payment.id },
            data: { status: "DEAD" },
          });

          await this.auditLogger.log({
            paymentId: payment.id,
            paymentExternalId: payment.externalId,
            agentName: "StoppingRulesEngine",
            action: "RECOVERY_STOPPED",
            reasoning: nextStopDecision.reason,
            metadata: { rule: nextStopDecision.rule },
          });
        } else {
          // Reconstruct diagnosis from failure event (skips fresh Gemini LLM call)
          const fe = payment.failureEvent;
          const reconstructedDiagnosis: DiagnosisResult = {
            category: fe?.category ?? "UNKNOWN",
            rootCause: fe?.rootCause ?? "Payment failure",
            confidence: fe?.diagnosisConfidence ?? 0.5,
            isRecoverable: fe?.isRecoverable ?? true,
            signals: [],
          };

          const customerHistory: CustomerHistory = {
            totalPurchases: payment.customer.totalPurchases,
            lifetimeValue: payment.customer.lifetimeValue,
            previousFailures: updatedPreviousAttempts.length,
            daysSinceLastPurchase: null,
          };

          const retryPipelineResult = await this.pipeline.processRetry(
            event,
            reconstructedDiagnosis,
            customerHistory,
            payment.id,
          );

          // Post-strategy stopping rules check
          const postRetryStopDecision = this.stoppingRules.evaluate(
            event,
            updatedPreviousAttempts,
            isFraud,
            retryPipelineResult.strategy.strategy,
          );

          if (postRetryStopDecision.shouldStop) {
            await db.payment.update({
              where: { id: payment.id },
              data: { status: "DEAD" },
            });

            await this.auditLogger.log({
              paymentId: payment.id,
              paymentExternalId: payment.externalId,
              agentName: "StoppingRulesEngine",
              action: "RECOVERY_STOPPED",
              reasoning: postRetryStopDecision.reason,
              metadata: {
                rule: postRetryStopDecision.rule,
                intendedStrategy: retryPipelineResult.strategy.strategy,
              },
            });
          } else {
            // Schedule the next candidate attempt as PENDING
            await db.recoveryAttempt.create({
              data: {
                paymentId: payment.id,
                attemptNumber: updatedPreviousAttempts.length + 1,
                strategy: retryPipelineResult.strategy.strategy,
                escalationLevel:
                  retryPipelineResult.strategy.executionParams.escalationLevel,
                outcome: "PENDING",
                scheduledAt:
                  retryPipelineResult.strategy.executionParams.scheduledAt,
                executedAt: null,
                channel: retryPipelineResult.strategy.executionParams.channel,
                messageContent:
                  retryPipelineResult.strategy.executionParams.messageContent,
              },
            });
          }
        }
      }
    }

    return results;
  }

  /**
   * Compatibility shim: Intake failure then immediately tick at current clock time.
   */
  async processFailure(event: PaymentFailureEvent): Promise<{
    paymentId: string;
    strategy: string;
    outcome: string;
    processingTimeMs: number;
  }> {
    const intakeResult = await this.intake(event);

    if (intakeResult.outcome === "STOPPED_BY_RULE") {
      return intakeResult;
    }

    const tickResults = await this.tick(this.clock.now());
    const matchedTick = tickResults.find(
      (r) => r.paymentId === intakeResult.paymentId,
    );

    return {
      paymentId: intakeResult.paymentId,
      strategy: matchedTick ? matchedTick.strategy : intakeResult.strategy,
      outcome: matchedTick ? matchedTick.outcome : intakeResult.outcome,
      processingTimeMs: intakeResult.processingTimeMs,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Simulate a recovery outcome based on probability.
   * In production, this would be replaced with actual payment retries.
   */
  private simulateOutcome(
    recoveryProbability: number,
    strategy: string,
  ): boolean {
    // Strategy-specific success modifiers
    const strategyModifiers: Record<string, number> = {
      SMART_RETRY: 1.1,
      CUSTOMER_NUDGE: 0.85,
      ALT_PAYMENT: 0.95,
      ESCALATE_MERCHANT: 0.7,
      DO_NOTHING: 0,
    };

    const modifier = strategyModifiers[strategy] ?? 1.0;
    const adjustedProbability = Math.min(recoveryProbability * modifier, 0.95);

    return Math.random() < adjustedProbability;
  }

  /**
   * Get or create a customer record from the event data.
   */
  private async getOrCreateCustomer(event: PaymentFailureEvent) {
    const existing = await db.customer.findFirst({
      where: { id: event.customerId },
    });

    if (existing) return existing;

    return db.customer.create({
      data: {
        id: event.customerId,
        email: `customer_${event.customerId.slice(-6)}@example.com`,
        phone: null,
        totalPurchases: Math.floor(Math.random() * 10),
        lifetimeValue: Math.floor(Math.random() * 50000),
      },
    });
  }
}
