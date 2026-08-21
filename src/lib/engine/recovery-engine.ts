// =============================================================================
// RECOVERY ENGINE
// =============================================================================
// Executes the recovery strategy selected by the agent pipeline.
// Coordinates between the agent pipeline, stopping rules, escalation ladder,
// and the database to carry out recovery actions.
//
// This is the "hands" of the system — it takes the agent's decision and acts.
// =============================================================================

import { db } from "@/lib/db";
import { RecoveryPipeline } from "@/lib/agents";
import { AuditLogger } from "@/lib/audit/logger";
import { StoppingRulesEngine } from "./stopping-rules";
import type { CustomerHistory, PaymentFailureEvent } from "@/lib/types";

export class RecoveryEngine {
  private pipeline: RecoveryPipeline;
  private stoppingRules: StoppingRulesEngine;
  private auditLogger: AuditLogger;

  constructor() {
    this.pipeline = new RecoveryPipeline();
    this.stoppingRules = new StoppingRulesEngine();
    this.auditLogger = new AuditLogger();
  }

  /**
   * Process a single failed payment through the full recovery workflow:
   * 1. Persist the payment event
   * 2. Check stopping rules
   * 3. Run the agent pipeline (Diagnosis → Risk → Strategy)
   * 4. Persist the failure event and recovery attempt
   * 5. Execute the chosen recovery action
   *
   * Returns the recovery attempt outcome.
   */
  async processFailure(event: PaymentFailureEvent): Promise<{
    paymentId: string;
    strategy: string;
    outcome: string;
    processingTimeMs: number;
  }> {
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

    const stopDecision = this.stoppingRules.evaluate(
      event,
      previousAttempts,
      event.errorCode === "FRAUD_DETECTED" || event.errorCode === "SUSPECTED_FRAUD",
    );

    if (stopDecision.shouldStop) {
      // Mark as DEAD and log the stopping rule
      await db.payment.update({
        where: { id: payment.id },
        data: { status: "DEAD" },
      });

      await this.auditLogger.log({
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
      daysSinceLastPurchase: null, // TODO: Calculate from purchase history
    };

    const pipelineResult = await this.pipeline.process(event, customerHistory);

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

    // --- Step 5: Create recovery attempt record ---
    const attemptNumber = previousAttempts.length + 1;
    const { strategy, executionParams } = pipelineResult.strategy;

    // Simulate recovery outcome based on probability
    // In production, this would be replaced with actual payment retry / nudge delivery
    const isSimulatedSuccess = this.simulateOutcome(
      pipelineResult.riskAssessment.recoveryProbability,
      strategy,
    );

    const outcome = isSimulatedSuccess ? "SUCCESS" : "FAILED";

    await db.recoveryAttempt.create({
      data: {
        paymentId: payment.id,
        attemptNumber,
        strategy,
        escalationLevel: executionParams.escalationLevel,
        outcome,
        scheduledAt: executionParams.scheduledAt,
        executedAt: new Date(),
        channel: executionParams.channel,
        messageContent: executionParams.messageContent,
      },
    });

    // --- Step 6: Update payment status ---
    await db.payment.update({
      where: { id: payment.id },
      data: {
        status: isSimulatedSuccess ? "RECOVERED" : "FAILED",
      },
    });

    // Log final outcome
    await this.auditLogger.log({
      paymentExternalId: event.externalId,
      agentName: "RecoveryEngine",
      action: isSimulatedSuccess ? "PAYMENT_RECOVERED" : "RECOVERY_ATTEMPT_FAILED",
      reasoning: `Strategy: ${strategy} | Attempt #${attemptNumber} | Outcome: ${outcome}`,
      metadata: {
        strategy,
        attemptNumber,
        outcome,
        processingTimeMs: pipelineResult.processingTimeMs,
      },
    });

    return {
      paymentId: payment.id,
      strategy,
      outcome,
      processingTimeMs: pipelineResult.processingTimeMs,
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
    // In simulation, customerId maps to a deterministic customer
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
