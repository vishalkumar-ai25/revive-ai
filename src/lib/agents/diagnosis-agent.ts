// =============================================================================
// DIAGNOSIS AGENT
// =============================================================================
// Analyzes a raw payment failure event and classifies it into a structured
// diagnosis: failure category, root cause, confidence score, and whether
// the payment is recoverable.
//
// Uses Google Gemini LLM for nuanced cases with automatic fallback to
// deterministic rule matching when the API key is missing or the LLM fails.
// =============================================================================

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { FailureCategory } from "@prisma/client";
import { LLM_CONFIG } from "@/lib/constants";
import type { DiagnosisResult, DiagnosisSignal, PaymentFailureEvent } from "@/lib/types";

// ---------------------------------------------------------------------------
// Deterministic Error Code → Category Mapping
// ---------------------------------------------------------------------------

const ERROR_CODE_MAP: Record<string, FailureCategory> = {
  BANK_TIMEOUT: "BANK_TIMEOUT",
  SERVER_TIMEOUT: "BANK_TIMEOUT",
  GATEWAY_TIMEOUT: "BANK_TIMEOUT",
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
  INSUFFICIENT_BALANCE: "INSUFFICIENT_FUNDS",
  CARD_DECLINED: "CARD_DECLINED",
  DO_NOT_HONOR: "CARD_DECLINED",
  RESTRICTED_CARD: "CARD_DECLINED",
  NETWORK_ERROR: "NETWORK_ERROR",
  CONNECTION_FAILED: "NETWORK_ERROR",
  UPI_PSP_ERROR: "UPI_PSP_ERROR",
  PSP_TIMEOUT: "UPI_PSP_ERROR",
  VPA_NOT_FOUND: "UPI_PSP_ERROR",
  OTP_EXPIRED: "OTP_EXPIRED",
  OTP_TIMEOUT: "OTP_EXPIRED",
  LIMIT_EXCEEDED: "LIMIT_EXCEEDED",
  DAILY_LIMIT: "LIMIT_EXCEEDED",
  FRAUD_DETECTED: "FRAUD_BLOCK",
  SUSPECTED_FRAUD: "FRAUD_BLOCK",
  MANDATE_EXPIRED: "MANDATE_EXPIRED",
  MANDATE_REVOKED: "MANDATE_EXPIRED",
  CHECKOUT_ABANDONED: "CHECKOUT_ABANDONED",
  SUBSCRIPTION_FAILED: "SUBSCRIPTION_FAILED",
  SUBSCRIPTION_CANCELLED: "SUBSCRIPTION_FAILED",
};

// ---------------------------------------------------------------------------
// Diagnosis Agent
// ---------------------------------------------------------------------------

export class DiagnosisAgent {
  private genAI: GoogleGenerativeAI | null = null;

  constructor() {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (apiKey && apiKey !== LLM_CONFIG.PLACEHOLDER_KEY && apiKey.trim().length > 0) {
      this.genAI = new GoogleGenerativeAI(apiKey);
    }
  }

  /**
   * Diagnose a payment failure event.
   * Attempts LLM-based diagnosis first, falls back to deterministic rules.
   */
  async diagnose(event: PaymentFailureEvent): Promise<DiagnosisResult> {
    // Always try LLM first for richer reasoning
    if (this.genAI) {
      try {
        return await this.diagnoseLLM(event);
      } catch (error) {
        console.warn("[DiagnosisAgent] LLM failed, falling back to rules:", error);
      }
    }

    // Fallback: deterministic rule-based diagnosis
    return this.diagnoseRuleBased(event);
  }

  // -------------------------------------------------------------------------
  // LLM-Based Diagnosis
  // -------------------------------------------------------------------------

  private async diagnoseLLM(event: PaymentFailureEvent): Promise<DiagnosisResult> {
    const model = this.genAI!.getGenerativeModel({
      model: LLM_CONFIG.MODEL_NAME,
      generationConfig: {
        temperature: LLM_CONFIG.TEMPERATURE,
        maxOutputTokens: LLM_CONFIG.MAX_OUTPUT_TOKENS,
        responseMimeType: "application/json",
      },
    });

    const prompt = `You are a Payment Failure Diagnosis Agent for an Indian payment gateway.
Analyze this failed payment and classify it.

PAYMENT EVENT:
- Amount: ₹${event.amount}
- Method: ${event.method}
- Bank: ${event.bank ?? "N/A"}
- UPI App: ${event.upiApp ?? "N/A"}
- Error Code: ${event.errorCode}
- Error Description: ${event.errorDescription}
- Is Recurring: ${event.isRecurring}
- Time: ${event.timestamp.toISOString()}

CLASSIFY into exactly one category:
BANK_TIMEOUT, INSUFFICIENT_FUNDS, CARD_DECLINED, NETWORK_ERROR, UPI_PSP_ERROR,
OTP_EXPIRED, LIMIT_EXCEEDED, FRAUD_BLOCK, MANDATE_EXPIRED, CHECKOUT_ABANDONED,
SUBSCRIPTION_FAILED, UNKNOWN

Respond in JSON:
{
  "category": "<FailureCategory>",
  "rootCause": "<human-readable explanation of why this payment failed>",
  "confidence": <0.0-1.0>,
  "isRecoverable": <true|false>,
  "signals": [
    { "name": "<signal name>", "value": "<signal value>", "weight": <0.0-1.0> }
  ]
}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text) as DiagnosisResult;

    // Validate the category is a known enum value
    if (!isValidCategory(parsed.category)) {
      parsed.category = "UNKNOWN";
      parsed.confidence = Math.min(parsed.confidence, 0.5);
    }

    return parsed;
  }

  // -------------------------------------------------------------------------
  // Rule-Based Diagnosis (Deterministic Fallback)
  // -------------------------------------------------------------------------

  private diagnoseRuleBased(event: PaymentFailureEvent): DiagnosisResult {
    const signals: DiagnosisSignal[] = [];

    // Signal 1: Direct error code mapping
    const mappedCategory = ERROR_CODE_MAP[event.errorCode];
    if (mappedCategory) {
      signals.push({
        name: "error_code_match",
        value: event.errorCode,
        weight: 0.9,
      });
    }

    // Signal 2: Time-based analysis (late night = higher bank failure rate)
    const hour = event.timestamp.getHours();
    const isLateNight = hour >= 23 || hour <= 2;
    if (isLateNight && (mappedCategory === "BANK_TIMEOUT" || mappedCategory === "UPI_PSP_ERROR")) {
      signals.push({
        name: "late_night_failure",
        value: `Payment at ${hour}:00 — known high-failure window`,
        weight: 0.7,
      });
    }

    // Signal 3: Subscription / Mandate context
    if (event.isRecurring) {
      signals.push({
        name: "recurring_payment",
        value: event.subscriptionId ?? event.mandateId ?? "recurring",
        weight: 0.6,
      });
    }

    const category: FailureCategory = mappedCategory ?? "UNKNOWN";
    const isRecoverable = category !== "FRAUD_BLOCK";
    const confidence = mappedCategory ? 0.85 : 0.4;

    return {
      category,
      rootCause: this.generateRootCause(category, event),
      confidence,
      isRecoverable,
      signals,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private generateRootCause(category: FailureCategory, event: PaymentFailureEvent): string {
    const rootCauses: Record<string, string> = {
      BANK_TIMEOUT: `${event.bank ?? "Bank"} server did not respond within the timeout window. Common during peak hours.`,
      INSUFFICIENT_FUNDS: `Customer's ${event.method} account has insufficient balance for ₹${event.amount}.`,
      CARD_DECLINED: `${event.bank ?? "Issuing bank"} declined the card transaction. Possible reasons: unusual pattern, security flag, or card restrictions.`,
      NETWORK_ERROR: `Network connectivity issue between payment gateway and ${event.bank ?? "bank"}. Transaction could not complete.`,
      UPI_PSP_ERROR: `UPI PSP (${event.upiApp ?? "unknown"}) experienced a processing error. May indicate PSP-level degradation.`,
      OTP_EXPIRED: `Customer did not enter OTP within the allowed time window. The authentication session expired.`,
      LIMIT_EXCEEDED: `Transaction of ₹${event.amount} exceeds the customer's daily/per-transaction limit for ${event.method}.`,
      FRAUD_BLOCK: `${event.bank ?? "Bank"} flagged this transaction as potentially fraudulent. Recovery should NOT be attempted.`,
      MANDATE_EXPIRED: `Auto-debit mandate has expired or been revoked by the customer. Re-authorization required.`,
      CHECKOUT_ABANDONED: `Customer opened the checkout page but did not attempt payment. Likely distracted or reconsidering.`,
      SUBSCRIPTION_FAILED: `Recurring subscription payment failed. The subscription is at risk of cancellation.`,
      UNKNOWN: `Unable to determine root cause from error code: ${event.errorCode}. Manual review recommended.`,
    };

    return rootCauses[category] ?? rootCauses["UNKNOWN"]!;
  }
}

function isValidCategory(category: string): category is FailureCategory {
  const valid = new Set([
    "BANK_TIMEOUT", "INSUFFICIENT_FUNDS", "CARD_DECLINED", "NETWORK_ERROR",
    "UPI_PSP_ERROR", "OTP_EXPIRED", "LIMIT_EXCEEDED", "FRAUD_BLOCK",
    "MANDATE_EXPIRED", "CHECKOUT_ABANDONED", "SUBSCRIPTION_FAILED", "UNKNOWN",
  ]);
  return valid.has(category);
}
