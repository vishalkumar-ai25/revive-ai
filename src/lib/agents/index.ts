// =============================================================================
// AGENT PIPELINE ORCHESTRATOR
// =============================================================================
// Wires the three agents into a sequential pipeline:
//   Diagnosis Agent → Risk Assessment Agent → Strategy Agent
//
// Each agent's output feeds into the next. The full pipeline result includes
// all three outputs plus total processing time.
//
// Audit logging happens at each stage for full traceability.
// =============================================================================

import { DiagnosisAgent } from "./diagnosis-agent";
import { RiskAssessmentAgent } from "./risk-assessment-agent";
import { StrategyAgent } from "./strategy-agent";
import { AuditLogger } from "@/lib/audit/logger";
import type { CustomerHistory, PaymentFailureEvent, PipelineResult } from "@/lib/types";
import { type Clock, SystemClock } from "@/lib/time/clock";

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export class RecoveryPipeline {
  private diagnosisAgent: DiagnosisAgent;
  private riskAgent: RiskAssessmentAgent;
  private strategyAgent: StrategyAgent;
  private auditLogger: AuditLogger;

  constructor(clock: Clock = new SystemClock()) {
    this.diagnosisAgent = new DiagnosisAgent();
    this.riskAgent = new RiskAssessmentAgent();
    this.strategyAgent = new StrategyAgent(clock);
    this.auditLogger = new AuditLogger();
  }

  /**
   * Run the full recovery pipeline on a failed payment event.
   *
   * Pipeline: Diagnosis → Risk Assessment → Strategy Selection
   * Each stage is audit-logged with reasoning for full traceability.
   */
  async process(
    event: PaymentFailureEvent,
    customerHistory: CustomerHistory,
  ): Promise<PipelineResult> {
    const startTime = performance.now();

    // --- Stage 1: Diagnosis ---
    const diagnosis = await this.diagnosisAgent.diagnose(event);

    await this.auditLogger.log({
      paymentExternalId: event.externalId,
      agentName: "DiagnosisAgent",
      action: "DIAGNOSIS_COMPLETE",
      reasoning: `Category: ${diagnosis.category} | Root cause: ${diagnosis.rootCause} | Confidence: ${(diagnosis.confidence * 100).toFixed(0)}% | Recoverable: ${diagnosis.isRecoverable}`,
      metadata: {
        category: diagnosis.category,
        confidence: diagnosis.confidence,
        signals: diagnosis.signals,
      },
    });

    // --- Stage 2: Risk Assessment ---
    const riskAssessment = this.riskAgent.assess(event, diagnosis, customerHistory);

    await this.auditLogger.log({
      paymentExternalId: event.externalId,
      agentName: "RiskAssessmentAgent",
      action: "RISK_ASSESSED",
      reasoning: riskAssessment.reasoning,
      metadata: {
        recoveryProbability: riskAssessment.recoveryProbability,
        shouldAttemptRecovery: riskAssessment.shouldAttemptRecovery,
        factors: riskAssessment.factors,
      },
    });

    // --- Stage 3: Strategy Selection ---
    const strategy = this.strategyAgent.select(event, diagnosis, riskAssessment);

    await this.auditLogger.log({
      paymentExternalId: event.externalId,
      agentName: "StrategyAgent",
      action: "STRATEGY_SELECTED",
      reasoning: strategy.reasoning,
      metadata: {
        strategy: strategy.strategy,
        confidence: strategy.confidence,
        executionParams: strategy.executionParams,
      },
    });

    const processingTimeMs = Math.round(performance.now() - startTime);

    return {
      diagnosis,
      riskAssessment,
      strategy,
      processingTimeMs,
    };
  }
}

// Export individual agents for direct use in tests
export { DiagnosisAgent } from "./diagnosis-agent";
export { RiskAssessmentAgent } from "./risk-assessment-agent";
export { StrategyAgent } from "./strategy-agent";
