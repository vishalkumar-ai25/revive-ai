// =============================================================================
// ESCALATION LADDER
// =============================================================================
// Pure function: given hours elapsed since a payment failure, returns the
// current escalation level.
//
// "Escalation level" here refers specifically to the contact-channel tier for
// customer-facing strategies (CUSTOMER_NUDGE). It does NOT control which
// RecoveryStrategy is chosen per attempt — that remains StrategyAgent's job.
//
// The ladder is driven by ESCALATION_CONFIG.delayHours thresholds:
//   LEVEL_1_ONSCREEN     ≥  0h  (immediate, onscreen)
//   LEVEL_2_EMAIL        ≥  1h  (email nudge)
//   LEVEL_3_SMS          ≥ 24h  (SMS reminder)
//   LEVEL_4_MERCHANT_ALERT ≥ 48h (merchant dashboard alert)
//   LEVEL_5_DEAD         ≥ 72h  (unrecoverable — matches MAX_RECOVERY_WINDOW_HOURS)
//
// The highest threshold crossed wins. Input is assumed non-negative.
// =============================================================================

import type { EscalationLevel } from "@prisma/client";
import { ESCALATION_CONFIG } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Ordered escalation levels from lowest to highest, matching ESCALATION_CONFIG. */
const ORDERED_LEVELS: EscalationLevel[] = [
  "LEVEL_1_ONSCREEN",
  "LEVEL_2_EMAIL",
  "LEVEL_3_SMS",
  "LEVEL_4_MERCHANT_ALERT",
  "LEVEL_5_DEAD",
];

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Returns the current escalation level based on hours elapsed since the
 * payment failure.
 *
 * The highest ESCALATION_CONFIG.delayHours threshold that has been crossed
 * wins. For example:
 *   - 0h  → LEVEL_1_ONSCREEN
 *   - 1h  → LEVEL_2_EMAIL
 *   - 23h → LEVEL_2_EMAIL   (24h threshold not yet crossed)
 *   - 24h → LEVEL_3_SMS
 *   - 48h → LEVEL_4_MERCHANT_ALERT
 *   - 72h → LEVEL_5_DEAD
 *
 * @param hoursSinceFailure - Non-negative number of hours since the payment failed.
 * @returns The current EscalationLevel.
 */
export function currentEscalationLevel(hoursSinceFailure: number): EscalationLevel {
  // Walk from highest to lowest — first threshold crossed wins.
  for (let i = ORDERED_LEVELS.length - 1; i >= 0; i--) {
    const level = ORDERED_LEVELS[i]!;
    const config = ESCALATION_CONFIG[level];
    if (hoursSinceFailure >= config.delayHours) {
      return level;
    }
  }
  // Fallback: 0h always satisfies LEVEL_1_ONSCREEN (delayHours: 0),
  // so this line is unreachable for non-negative input.
  return "LEVEL_1_ONSCREEN";
}

/**
 * Returns the channel string for a given escalation level,
 * sourced from ESCALATION_CONFIG.
 *
 * Convenience wrapper so callers don't need to import ESCALATION_CONFIG directly.
 */
export function channelForLevel(level: EscalationLevel): string {
  return ESCALATION_CONFIG[level].channel;
}
