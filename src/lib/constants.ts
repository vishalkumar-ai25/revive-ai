// =============================================================================
// CONSTANTS — ReviveAI Configuration
// =============================================================================
// All magic numbers, thresholds, and policy values live here.
// No hardcoded values in business logic — ever.
// =============================================================================

import type { EscalationLevel, RecoveryStrategy } from "@prisma/client";

// ---------------------------------------------------------------------------
// Stopping Rules — When the agent MUST stop trying to recover
// ---------------------------------------------------------------------------

export const STOPPING_RULES = {
  /** Decay factor for retry recovery probability */
  RETRY_PROBABILITY_DECAY: 0.1,

  /** Maximum number of ALT_PAYMENT attempts */
  MAX_ALT_PAYMENT_ATTEMPTS: 1,

  /** Maximum number of ESCALATE_MERCHANT attempts */
  MAX_ESCALATE_MERCHANT_ATTEMPTS: 1,
  /** Maximum number of retry attempts per payment */
  MAX_RETRY_ATTEMPTS: 4,

  /** Maximum number of nudge messages sent to a customer */
  MAX_NUDGE_MESSAGES: 3,

  /** Maximum time window (hours) to attempt recovery before giving up */
  MAX_RECOVERY_WINDOW_HOURS: 72,

  /** Minimum payment amount (INR) worth recovering — below this, cost > benefit */
  MIN_RECOVERY_AMOUNT_INR: 50,

  /** If recovery probability is below this threshold, don't attempt */
  MIN_RECOVERY_PROBABILITY: 0.15,

  /** Never retry a payment flagged as fraud by the bank */
  FRAUD_BLOCK_POLICY: "NEVER_RETRY" as const,

  /** If customer explicitly opts out, stop all recovery immediately */
  CUSTOMER_OPT_OUT_POLICY: "STOP_ALL" as const,
} as const;

// ---------------------------------------------------------------------------
// Escalation Ladder — Compliant, progressive escalation
// ---------------------------------------------------------------------------

export const ESCALATION_CONFIG: Record<
  EscalationLevel,
  {
    delayHours: number;
    channel: string;
    description: string;
  }
> = {
  LEVEL_1_ONSCREEN: {
    delayHours: 0,
    channel: "onscreen",
    description: "Show alternative payment suggestion on checkout page",
  },
  LEVEL_2_EMAIL: {
    delayHours: 1,
    channel: "email",
    description: "Send recovery email with payment link",
  },
  LEVEL_3_SMS: {
    delayHours: 24,
    channel: "sms",
    description: "Send SMS reminder with payment link",
  },
  LEVEL_4_MERCHANT_ALERT: {
    delayHours: 48,
    channel: "merchant_dashboard",
    description: "Alert merchant dashboard for manual follow-up",
  },
  LEVEL_5_DEAD: {
    delayHours: 72,
    channel: "none",
    description: "Mark as unrecoverable. Stop all contact.",
  },
};

// ---------------------------------------------------------------------------
// Quiet Hours — Never contact customers during these hours
// ---------------------------------------------------------------------------

export const QUIET_HOURS = {
  /** Start of quiet period (24h format, IST) */
  START_HOUR: 21, // 9 PM
  /** End of quiet period (24h format, IST) */
  END_HOUR: 9, // 9 AM
  /** Timezone for quiet hours */
  TIMEZONE: "Asia/Kolkata",
} as const;

// ---------------------------------------------------------------------------
// Customer-Facing Strategies — Gated by quiet hours (9PM - 9AM IST)
// ---------------------------------------------------------------------------
// ALT_PAYMENT is channel "onscreen" (passive, customer must already be on the
// page — not gated). ESCALATE_MERCHANT targets the merchant dashboard, not the
// customer — not gated. SMART_RETRY is silent backend — not gated. Only
// CUSTOMER_NUDGE proactively contacts the customer (channel "email") and is
// gated by quiet hours.
export const CUSTOMER_FACING_STRATEGIES: RecoveryStrategy[] = ["CUSTOMER_NUDGE"];

// ---------------------------------------------------------------------------
// Bank-Specific Retry Timing — Optimal retry windows per bank
// ---------------------------------------------------------------------------

export const BANK_RETRY_WINDOWS: Record<
  string,
  { bestHourStart: number; bestHourEnd: number; avoidHours: number[] }
> = {
  HDFC: { bestHourStart: 8, bestHourEnd: 10, avoidHours: [23, 0, 1] },
  SBI: { bestHourStart: 10, bestHourEnd: 12, avoidHours: [0, 1, 2] },
  ICICI: { bestHourStart: 9, bestHourEnd: 11, avoidHours: [23, 0] },
  AXIS: { bestHourStart: 8, bestHourEnd: 11, avoidHours: [0, 1] },
  KOTAK: { bestHourStart: 9, bestHourEnd: 12, avoidHours: [23, 0, 1] },
  DEFAULT: { bestHourStart: 9, bestHourEnd: 11, avoidHours: [23, 0, 1, 2] },
};

// ---------------------------------------------------------------------------
// Recovery Strategy Weights — Used by Strategy Agent scoring
// ---------------------------------------------------------------------------

export const STRATEGY_WEIGHTS: Record<
  RecoveryStrategy,
  {
    basePriority: number;
    applicableCategories: string[];
  }
> = {
  SMART_RETRY: {
    basePriority: 0.9,
    applicableCategories: ["BANK_TIMEOUT", "NETWORK_ERROR", "UPI_PSP_ERROR"],
  },
  CUSTOMER_NUDGE: {
    basePriority: 0.7,
    applicableCategories: [
      "CHECKOUT_ABANDONED",
      "OTP_EXPIRED",
      "SUBSCRIPTION_FAILED",
    ],
  },
  ALT_PAYMENT: {
    basePriority: 0.8,
    applicableCategories: [
      "INSUFFICIENT_FUNDS",
      "CARD_DECLINED",
      "LIMIT_EXCEEDED",
      "MANDATE_EXPIRED",
    ],
  },
  ESCALATE_MERCHANT: {
    basePriority: 0.5,
    applicableCategories: ["UNKNOWN"],
  },
  DO_NOTHING: {
    basePriority: 0.0,
    applicableCategories: ["FRAUD_BLOCK"],
  },
};

// ---------------------------------------------------------------------------
// Simulation Defaults
// ---------------------------------------------------------------------------

export const SIMULATION = {
  /** Default number of payments in a batch run */
  DEFAULT_BATCH_SIZE: 1000,

  /** Simulated base success rate for recovery attempts */
  BASE_RECOVERY_SUCCESS_RATE: 0.55,

  /** Amount range for simulated payments (INR) */
  MIN_AMOUNT: 99,
  MAX_AMOUNT: 25000,

  /** Distribution weights for payment methods in simulation */
  METHOD_DISTRIBUTION: {
    UPI: 0.55,
    DEBIT_CARD: 0.2,
    CREDIT_CARD: 0.12,
    NETBANKING: 0.05,
    WALLET: 0.03,
    EMI: 0.03,
    MANDATE: 0.02,
  } as Record<string, number>,

  /** Distribution weights for failure categories in simulation */
  FAILURE_DISTRIBUTION: {
    BANK_TIMEOUT: 0.28,
    INSUFFICIENT_FUNDS: 0.18,
    UPI_PSP_ERROR: 0.12,
    CARD_DECLINED: 0.1,
    NETWORK_ERROR: 0.09,
    CHECKOUT_ABANDONED: 0.08,
    OTP_EXPIRED: 0.06,
    LIMIT_EXCEEDED: 0.04,
    SUBSCRIPTION_FAILED: 0.03,
    FRAUD_DETECTED: 0.015,
    MANDATE_EXPIRED: 0.005,
  } as Record<string, number>,

  /** Indian banks for simulation */
  BANKS: ["HDFC", "SBI", "ICICI", "AXIS", "KOTAK", "PNB", "BOB", "YES", "IDFC"],

  /** UPI apps for simulation */
  UPI_APPS: ["phonepe", "gpay", "paytm", "cred", "bhim"],
} as const;

// ---------------------------------------------------------------------------
// Mandate Retry Policy — ReviveAI's self-imposed retry limits for recurring
// e-mandate payments, informed by common industry practice.
// Semantically distinct from STOPPING_RULES (which govern one-time payments).
// ---------------------------------------------------------------------------

export const MANDATE_RULES = {
  /** Maximum auto-debit retry attempts per recurring debit cycle */
  MAX_ATTEMPTS: 4,

  /** Total recovery window (hours) for mandate retries — 7 days */
  WINDOW_HOURS: 168,

  /** Spacing between retry attempts (hours from original failure) */
  RETRY_SPACING_HOURS: [0, 48, 96, 144] as readonly number[],

  /** Optimal bank debit hour (IST) — 10:15 AM IST for batch processing */
  OPTIMAL_DEBIT_HOUR_IST: 10,
  OPTIMAL_DEBIT_MINUTE_IST: 15,

  /** Pre-debit notification must be sent this many hours before each attempt */
  PRE_DEBIT_NOTIFICATION_HOURS: 24,
} as const;

// ---------------------------------------------------------------------------
// LLM Configuration
// ---------------------------------------------------------------------------

export const LLM_CONFIG = {
  /** Gemini model to use for agent reasoning */
  MODEL_NAME: "gemini-3.6-flash",

  /** Maximum tokens for agent responses */
  MAX_OUTPUT_TOKENS: 1024,

  /** Temperature for deterministic-ish agent outputs */
  TEMPERATURE: 0.2,

  /** Placeholder API key value to detect unconfigured state */
  PLACEHOLDER_KEY: "your-google-ai-api-key",
} as const;
