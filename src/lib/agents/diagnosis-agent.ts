// =============================================================================
// DIAGNOSIS AGENT
// =============================================================================
// Analyzes raw PaymentFailureEvent data to determine the root cause,
// categorize the failure, and calculate an initial confidence score that
// the payment is recoverable.
//
// Multi-Model Architecture:
// 1. Tries Google Gemini (Cloud) if API key is present.
// 2. Falls back to Ollama (Air-Gapped/On-Premise) if URL is present.
// 3. Falls back to deterministic rule matching if AI is unavailable.
// =============================================================================

import { DiagnosisResultSchema } from "../schemas";
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
  private ollamaBaseUrl: string | null = null;

  constructor(llmClient?: GoogleGenerativeAI, ollamaUrl?: string) {
    // 1. Setup Gemini Cloud (Primary for Judges)
    if (llmClient) {
      this.genAI = llmClient;
    } else {
      const apiKey = process.env.GOOGLE_AI_API_KEY;
      if (apiKey && apiKey !== LLM_CONFIG.PLACEHOLDER_KEY && apiKey.trim().length > 0) {
        this.genAI = new GoogleGenerativeAI(apiKey);
      }
    }

    // 2. Setup Ollama On-Premise (For heavy batching / air-gapped privacy)
    if (ollamaUrl) {
      this.ollamaBaseUrl = ollamaUrl;
    } else {
      const url = process.env.OLLAMA_BASE_URL;
      if (url && url.trim().length > 0) {
        this.ollamaBaseUrl = url;
      }
    }
  }

  /**
   * Diagnose a payment failure event using a cascading fallback strategy.
   */
  async diagnose(event: PaymentFailureEvent): Promise<DiagnosisResult> {
    // Attempt 1: Cloud AI (Gemini)
    if (this.genAI) {
      try {
        return await this.diagnoseGemini(event);
      } catch (error) {
        console.warn("[DiagnosisAgent] Gemini Cloud failed, attempting failover...", error);
      }
    }

    // Attempt 2: Air-Gapped AI (Ollama)
    if (this.ollamaBaseUrl) {
      try {
        return await this.diagnoseOllama(event);
      } catch (error) {
        console.warn("[DiagnosisAgent] Ollama Local failed, falling back to deterministic rules:", error);
      }
    }

    // Attempt 3: Deterministic Rules
    return this.diagnoseRuleBased(event);
  }

  // -------------------------------------------------------------------------
  // LLM Logic: Gemini Cloud
  // -------------------------------------------------------------------------

  private async diagnoseGemini(event: PaymentFailureEvent): Promise<DiagnosisResult> {
    const model = this.genAI!.getGenerativeModel({
      model: "gemini-3.6-flash", // Hardcoded safely for fallback
      generationConfig: {
        temperature: LLM_CONFIG.TEMPERATURE,
        maxOutputTokens: LLM_CONFIG.MAX_OUTPUT_TOKENS,
        responseMimeType: "application/json",
      },
    });

    const result = await model.generateContent(this.buildPrompt(event));
    const text = result.response.text();
    const parsed = DiagnosisResultSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new Error("Invalid Gemini diagnosis payload");
    
    return parsed.data as DiagnosisResult;
  }

  // -------------------------------------------------------------------------
  // LLM Logic: Ollama Local (Air-Gapped)
  // -------------------------------------------------------------------------

  private async diagnoseOllama(event: PaymentFailureEvent): Promise<DiagnosisResult> {
    const response = await fetch(`${this.ollamaBaseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LLM_CONFIG.MODEL_NAME, // e.g. qwen2.5:14b
        prompt: this.buildPrompt(event, true),
        stream: false,
        format: "json",
        options: {
          temperature: LLM_CONFIG.TEMPERATURE,
          num_predict: LLM_CONFIG.MAX_OUTPUT_TOKENS,
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = await response.json();
    let text = data.response;
    
    // Aggressively clean markdown blocks Qwen sometimes injects
    text = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    const parsed = DiagnosisResultSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new Error("Invalid Ollama diagnosis payload");

    return parsed.data as DiagnosisResult;
  }

  // -------------------------------------------------------------------------
  // Rule-Based Diagnosis (Deterministic Fallback)
  // -------------------------------------------------------------------------

  private diagnoseRuleBased(event: PaymentFailureEvent): DiagnosisResult {
    const signals: DiagnosisSignal[] = [];

    const mappedCategory = ERROR_CODE_MAP[event.errorCode];
    if (mappedCategory) {
      signals.push({ name: "error_code_match", value: event.errorCode, weight: 0.9 });
    }

    const hour = event.timestamp.getHours();
    const isLateNight = hour >= 23 || hour <= 2;
    if (isLateNight && (mappedCategory === "BANK_TIMEOUT" || mappedCategory === "UPI_PSP_ERROR")) {
      signals.push({ name: "late_night_failure", value: `Payment at ${hour}:00`, weight: 0.7 });
    }

    if (event.isRecurring) {
      signals.push({ name: "recurring_payment", value: "recurring", weight: 0.6 });
    }

    const category: FailureCategory = mappedCategory ?? "UNKNOWN";
    const isRecoverable = category !== "FRAUD_BLOCK";

    return {
      category,
      rootCause: this.generateRootCause(category, event),
      confidence: mappedCategory ? 0.85 : 0.4,
      isRecoverable,
      signals,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private buildPrompt(event: PaymentFailureEvent, forceRawJson: boolean = false): string {
    const base = `You are a Payment Failure Diagnosis Agent for an Indian payment gateway.
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

Respond in JSON ONLY.
{
  "category": "<FailureCategory>",
  "rootCause": "<human-readable explanation of why this payment failed>",
  "confidence": <0.0-1.0>,
  "isRecoverable": <true|false>,
  "signals": [
    { "name": "<signal name>", "value": "<signal value>", "weight": <0.0-1.0> }
  ]
}`;
    return forceRawJson ? base + "\nDo not use markdown blocks like ```json." : base;
  }

  private generateRootCause(category: FailureCategory, event: PaymentFailureEvent): string {
    const rootCauses: Record<string, string> = {
      BANK_TIMEOUT: `${event.bank ?? "Bank"} server did not respond.`,
      INSUFFICIENT_FUNDS: `Insufficient balance for ₹${event.amount}.`,
      CARD_DECLINED: `Card transaction declined.`,
      NETWORK_ERROR: `Network connectivity issue.`,
      UPI_PSP_ERROR: `UPI PSP error.`,
      OTP_EXPIRED: `OTP session expired.`,
      LIMIT_EXCEEDED: `Transaction limit exceeded.`,
      FRAUD_BLOCK: `Flagged as potentially fraudulent.`,
      MANDATE_EXPIRED: `Auto-debit mandate expired.`,
      CHECKOUT_ABANDONED: `Customer abandoned checkout.`,
      SUBSCRIPTION_FAILED: `Recurring payment failed.`,
      UNKNOWN: `Manual review recommended.`,
    };
    return rootCauses[category] ?? rootCauses["UNKNOWN"]!;
  }
}
