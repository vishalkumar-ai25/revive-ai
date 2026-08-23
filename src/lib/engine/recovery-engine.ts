import { nextIstTime } from "@/lib/time/ist";
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
  private clock: Clock;

  constructor(clock: Clock = new SystemClock()) {
    this.clock = clock;
    this.pipeline = new RecoveryPipeline(clock);
    this.stoppingRules = new StoppingRulesEngine(clock);
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
    // --- Step 0: Idempotency Guard ---
    const existingPayment = await db.payment.findUnique({
      where: { externalId: event.externalId },
      select: { status: true },
    });

    if (
      existingPayment &&
      (existingPayment.status === "RECOVERY_IN_PROGRESS" ||
        existingPayment.status === "RECOVERED" ||
        existingPayment.status === "DEAD")
    ) {
      return {
        paymentId: "SKIPPED_DUPLICATE",
        strategy: "DO_NOTHING",
        outcome: "STOPPED_BY_RULE",
        processingTimeMs: 0,
      };
    }

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
        failedAt: event.timestamp,
      },
      update: {
        status: existingPayment?.status ?? "FAILED",
        errorCode: event.errorCode,
        errorDescription: event.errorDescription,
        // failedAt is intentionally omitted here to preserve original failure timestamp
      },
      include: {
        recoveryAttempts: {
          select: { attemptNumber: true, strategy: true, outcome: true },
        },
      },
    });

    // --- Step 2: Check stopping rules against previous attempts ---
    const previousAttempts = payment.recoveryAttempts;

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
        data: {
          status: "DEAD",
          recoveryAttempts: {
            create: {
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
          },
          auditLogs: {
            create: {
              agentName: "StoppingRulesEngine",
              action: "RECOVERY_STOPPED",
              reasoning: stopDecision.reason,
              metadata: { rule: stopDecision.rule },
            },
          },
        },
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

    // --- Step 3.5: Evaluate stopping rules POST strategy ---
    // Update isFraud to include LLM diagnosis (prevent infinite DO_NOTHING loop)
    let isFraudUpdate = isFraud;
    if (pipelineResult.diagnosis.category === "FRAUD_BLOCK") {
        isFraudUpdate = true;
    }

    const postStrategyStopDecision = this.stoppingRules.evaluate(
      event,
      previousAttempts,
      isFraudUpdate,
      pipelineResult.strategy.strategy,
    );

    if (postStrategyStopDecision.shouldStop) {
      // Step 4: Persist failure event (must happen even if we stop/defer)
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

      const outcome = await this.handleStopDecision(
        postStrategyStopDecision,
        payment.id,
        null, // No attempt row exists yet
        this.clock.now(),
        previousAttempts.length + 1,
        pipelineResult.strategy.strategy,
        pipelineResult.strategy.executionParams.escalationLevel ?? "LEVEL_5_DEAD",
        pipelineResult.strategy.executionParams.channel ?? null,
        pipelineResult.strategy.executionParams.messageContent ?? null
      );

      return {
        paymentId: payment.id,
        strategy: pipelineResult.strategy.strategy,
        outcome: outcome === "DEFERRED" ? "PENDING" : "STOPPED_BY_RULE",
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
            recoveryAttempts: {
              select: { attemptNumber: true, strategy: true, outcome: true },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const results: TickResult[] = [];

    const chunkArray = <T>(arr: T[], size: number): T[][] =>
      Array.from({ length: Math.ceil(arr.length / size) }, (_v, i) =>
        arr.slice(i * size, i * size + size)
      );

    const attemptChunks = chunkArray(dueAttempts, 20);

    for (const chunk of attemptChunks) {
      const chunkResults = await Promise.all(
        chunk.map((dueAttempt) => this.processDueAttempt(dueAttempt, asOf))
      );
      results.push(...chunkResults.filter((r): r is TickResult => r !== null));
    }

    return results;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async processDueAttempt(dueAttempt: any, asOf: Date): Promise<TickResult | null> {
    const payment = dueAttempt.payment;
    const isFraud =
      payment.errorCode === "FRAUD_DETECTED" ||
      payment.errorCode === "SUSPECTED_FRAUD";

    const previousAttempts = payment.recoveryAttempts;

    const event: PaymentFailureEvent = {
      externalId: payment.externalId,
      merchantId: payment.merchantId,
      customerId: payment.customerId,
      amount: payment.amount,
      currency: payment.currency,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      method: payment.method as any,
      bank: payment.bank,
      upiApp: payment.upiApp,
      errorCode: payment.errorCode ?? "UNKNOWN",
      errorDescription: payment.errorDescription ?? "Unknown failure",
      isRecurring: payment.isRecurring,
      subscriptionId: payment.subscriptionId,
      mandateId: payment.mandateId,
      timestamp: payment.createdAt,
    };

    // Pre-execution evaluation
    const stopDecision = this.stoppingRules.evaluate(
      event,
      previousAttempts,
      isFraud,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dueAttempt.strategy as any,
    );

    if (stopDecision.shouldStop) {
      const outcome = await this.handleStopDecision(
        stopDecision,
        payment.id,
        dueAttempt.id,
        asOf,
        dueAttempt.attemptNumber,
        dueAttempt.strategy,
        dueAttempt.escalationLevel,
        dueAttempt.channel,
        dueAttempt.messageContent
      );

      return {
        attemptId: dueAttempt.id,
        paymentId: payment.id,
        strategy: dueAttempt.strategy,
        outcome: outcome,
      };
    }

    // Simulate recovery outcome based on probability
    const recoveryProbability =
      payment.failureEvent?.recoveryProbability ?? 0.5;
    const isSimulatedSuccess = this.simulateOutcome(
      recoveryProbability,
      dueAttempt.strategy,
    );
    const outcome = isSimulatedSuccess ? "SUCCESS" : "FAILED";

    if (isSimulatedSuccess) {
      await db.payment.update({
        where: { id: payment.id },
        data: {
          status: "RECOVERED",
          recoveryAttempts: {
            update: {
              where: { id: dueAttempt.id },
              data: { outcome, executedAt: asOf },
            },
          },
          auditLogs: {
            create: {
              agentName: "RecoveryEngine",
              action: "PAYMENT_RECOVERED",
              reasoning: `Strategy: ${dueAttempt.strategy} | Attempt #${dueAttempt.attemptNumber} | Outcome: SUCCESS`,
              metadata: {
                strategy: dueAttempt.strategy,
                attemptNumber: dueAttempt.attemptNumber,
                outcome: "SUCCESS",
              },
            },
          },
        },
      });

      return {
        attemptId: dueAttempt.id,
        paymentId: payment.id,
        strategy: dueAttempt.strategy,
        outcome: "SUCCESS",
      };
    } else {
      // Failed attempt
      await db.payment.update({
        where: { id: payment.id },
        data: {
          recoveryAttempts: {
            update: {
              where: { id: dueAttempt.id },
              data: { outcome, executedAt: asOf },
            },
          },
          auditLogs: {
            create: {
              agentName: "RecoveryEngine",
              action: "RECOVERY_ATTEMPT_FAILED",
              reasoning: `Strategy: ${dueAttempt.strategy} | Attempt #${dueAttempt.attemptNumber} | Outcome: FAILED`,
              metadata: {
                strategy: dueAttempt.strategy,
                attemptNumber: dueAttempt.attemptNumber,
                outcome: "FAILED",
              },
            },
          },
        },
      });

      // Re-evaluate stopping rules
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updatedPreviousAttempts = previousAttempts.map((a: any) => 
        a.attemptNumber === dueAttempt.attemptNumber 
          ? { ...a, outcome: "FAILED" as const } 
          : a
      );

      const nextStopDecision = this.stoppingRules.evaluate(
        event,
        updatedPreviousAttempts,
        isFraud,
      );

      if (nextStopDecision.shouldStop) {
        await db.payment.update({
          where: { id: payment.id },
          data: { 
            status: "DEAD",
            auditLogs: {
              create: {
                agentName: "StoppingRulesEngine",
                action: "RECOVERY_STOPPED",
                reasoning: nextStopDecision.reason,
                metadata: { rule: nextStopDecision.rule },
              },
            },
          },
        });
      } else {
        // Reconstruct diagnosis from failure event
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

        // Update isFraud to include LLM diagnosis
        let isFraudUpdate = isFraud;
        if (reconstructedDiagnosis.category === "FRAUD_BLOCK") {
           isFraudUpdate = true;
        }

        // Post-strategy stopping rules check
        const postRetryStopDecision = this.stoppingRules.evaluate(
          event,
          updatedPreviousAttempts,
          isFraudUpdate,
          retryPipelineResult.strategy.strategy,
        );

        if (postRetryStopDecision.shouldStop) {
          await this.handleStopDecision(
            postRetryStopDecision,
            payment.id,
            null, // Create new attempt row
            asOf,
            dueAttempt.attemptNumber + 1,
            retryPipelineResult.strategy.strategy,
            retryPipelineResult.strategy.executionParams.escalationLevel ?? "LEVEL_5_DEAD",
            retryPipelineResult.strategy.executionParams.channel ?? null,
            retryPipelineResult.strategy.executionParams.messageContent ?? null
          );
        } else {
          // Schedule next attempt
          await db.recoveryAttempt.create({
            data: {
              paymentId: payment.id,
              attemptNumber: dueAttempt.attemptNumber + 1,
              strategy: retryPipelineResult.strategy.strategy,
              outcome: "PENDING",
              scheduledAt: retryPipelineResult.strategy.executionParams.scheduledAt,
              escalationLevel: retryPipelineResult.strategy.executionParams.escalationLevel ?? "LEVEL_1_ONSCREEN",
              channel: retryPipelineResult.strategy.executionParams.channel ?? "none",
              messageContent: retryPipelineResult.strategy.executionParams.messageContent ?? null,
            },
          });
        }
      }

      return {
        attemptId: dueAttempt.id,
        paymentId: payment.id,
        strategy: dueAttempt.strategy,
        outcome: "FAILED",
      };
    }
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

  private async handleStopDecision(
    decision: { shouldStop: boolean; rule: string | null; reason: string },
    paymentId: string,
    attemptId: string | null,
    asOf: Date,
    attemptNumber: number,
    strategy: import("@prisma/client").RecoveryStrategy,
    escalationLevel: EscalationLevel,
    channel: string | null,
    messageContent: string | null
  ): Promise<"DEFERRED" | "STOPPED_BY_RULE"> {
    if (decision.rule === "QUIET_HOURS") {
      const next9Am = this.getNext9AmIst(asOf);
      
      await db.payment.update({
        where: { id: paymentId },
        data: {
          recoveryAttempts: attemptId
            ? {
                update: {
                  where: { id: attemptId },
                  data: { scheduledAt: next9Am },
                },
              }
            : {
                create: {
                  attemptNumber,
                  strategy,
                  escalationLevel,
                  outcome: "PENDING",
                  scheduledAt: next9Am,
                  executedAt: null,
                  channel,
                  messageContent,
                },
              },
          auditLogs: {
            create: {
              agentName: "StoppingRulesEngine",
              action: "OUTREACH_DEFERRED",
              reasoning: `Quiet hours active (${decision.reason}). Customer outreach deferred to 9:00 AM IST.`,
              metadata: {
                rule: "QUIET_HOURS",
                deferredUntil: next9Am.toISOString(),
                intendedStrategy: strategy,
              },
            },
          },
        },
      });

      return "DEFERRED";
    }

    await db.payment.update({
      where: { id: paymentId },
      data: {
        status: "DEAD",
        recoveryAttempts: attemptId
          ? {
              update: {
                where: { id: attemptId },
                data: {
                  outcome: "STOPPED_BY_RULE",
                  stoppedByRule: decision.rule,
                  executedAt: asOf,
                  messageContent: decision.reason,
                },
              },
            }
          : {
              create: {
                attemptNumber,
                strategy,
                escalationLevel,
                outcome: "STOPPED_BY_RULE",
                stoppedByRule: decision.rule,
                scheduledAt: asOf,
                executedAt: asOf,
                channel,
                messageContent: decision.reason,
              },
            },
        auditLogs: {
          create: {
            agentName: "StoppingRulesEngine",
            action: "RECOVERY_STOPPED",
            reasoning: decision.reason,
            metadata: {
              rule: decision.rule,
              intendedStrategy: strategy,
            },
          },
        },
      },
    });

    return "STOPPED_BY_RULE";
  }

  private async getOrCreateCustomer(event: PaymentFailureEvent) {
    return db.customer.upsert({
      where: { id: event.customerId },
      update: {},
      create: {
        id: event.customerId,
        email: `customer_${event.customerId.slice(-6)}@example.com`,
        phone: null,
        totalPurchases: event.customerTotalPurchases ?? 0,
        lifetimeValue: event.customerLifetimeValue ?? 0,
      },
    });
  }

  /**
   * Calculate the next 9:00 AM IST timestamp (returned as UTC Date) from a given date.
   */
  private getNext9AmIst(now: Date): Date {
    return nextIstTime(now, 9, 0);
  }
}
