// =============================================================================
// ESCALATION LADDER TESTS
// =============================================================================
// Verifies currentEscalationLevel() returns the correct level for every
// threshold boundary and representative mid-range values.
//
// "Escalation level" is a contact-channel selector for customer-facing
// strategies — it does NOT control which RecoveryStrategy is chosen.
//
// Thresholds from ESCALATION_CONFIG:
//   LEVEL_1_ONSCREEN       ≥  0h
//   LEVEL_2_EMAIL          ≥  1h
//   LEVEL_3_SMS            ≥ 24h
//   LEVEL_4_MERCHANT_ALERT ≥ 48h
//   LEVEL_5_DEAD           ≥ 72h
// =============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { currentEscalationLevel, channelForLevel } from "../src/lib/engine/escalation-ladder";

// ---------------------------------------------------------------------------
// currentEscalationLevel — exact boundary values
// ---------------------------------------------------------------------------

describe("currentEscalationLevel — exact thresholds", () => {
  it("0h → LEVEL_1_ONSCREEN (at threshold)", () => {
    assert.equal(currentEscalationLevel(0), "LEVEL_1_ONSCREEN");
  });

  it("1h → LEVEL_2_EMAIL (at threshold)", () => {
    assert.equal(currentEscalationLevel(1), "LEVEL_2_EMAIL");
  });

  it("24h → LEVEL_3_SMS (at threshold)", () => {
    assert.equal(currentEscalationLevel(24), "LEVEL_3_SMS");
  });

  it("48h → LEVEL_4_MERCHANT_ALERT (at threshold)", () => {
    assert.equal(currentEscalationLevel(48), "LEVEL_4_MERCHANT_ALERT");
  });

  it("72h → LEVEL_5_DEAD (at threshold)", () => {
    assert.equal(currentEscalationLevel(72), "LEVEL_5_DEAD");
  });
});

// ---------------------------------------------------------------------------
// currentEscalationLevel — just below threshold (boundary - epsilon)
// ---------------------------------------------------------------------------

describe("currentEscalationLevel — just below thresholds", () => {
  it("0.9h → LEVEL_1_ONSCREEN (below LEVEL_2 1h threshold)", () => {
    assert.equal(currentEscalationLevel(0.9), "LEVEL_1_ONSCREEN");
  });

  it("23.9h → LEVEL_2_EMAIL (below LEVEL_3 24h threshold)", () => {
    assert.equal(currentEscalationLevel(23.9), "LEVEL_2_EMAIL");
  });

  it("47.9h → LEVEL_3_SMS (below LEVEL_4 48h threshold)", () => {
    assert.equal(currentEscalationLevel(47.9), "LEVEL_3_SMS");
  });

  it("71.9h → LEVEL_4_MERCHANT_ALERT (below LEVEL_5 72h threshold)", () => {
    assert.equal(currentEscalationLevel(71.9), "LEVEL_4_MERCHANT_ALERT");
  });
});

// ---------------------------------------------------------------------------
// currentEscalationLevel — mid-range values
// ---------------------------------------------------------------------------

describe("currentEscalationLevel — mid-range values", () => {
  it("0.5h → LEVEL_1_ONSCREEN", () => {
    assert.equal(currentEscalationLevel(0.5), "LEVEL_1_ONSCREEN");
  });

  it("12h → LEVEL_2_EMAIL", () => {
    assert.equal(currentEscalationLevel(12), "LEVEL_2_EMAIL");
  });

  it("36h → LEVEL_3_SMS", () => {
    assert.equal(currentEscalationLevel(36), "LEVEL_3_SMS");
  });

  it("60h → LEVEL_4_MERCHANT_ALERT", () => {
    assert.equal(currentEscalationLevel(60), "LEVEL_4_MERCHANT_ALERT");
  });

  it("100h → LEVEL_5_DEAD (beyond window, stays at DEAD)", () => {
    assert.equal(currentEscalationLevel(100), "LEVEL_5_DEAD");
  });
});

// ---------------------------------------------------------------------------
// currentEscalationLevel — exact zero
// ---------------------------------------------------------------------------

describe("currentEscalationLevel — edge cases", () => {
  it("exactly 0h → LEVEL_1_ONSCREEN (payment just failed)", () => {
    assert.equal(currentEscalationLevel(0), "LEVEL_1_ONSCREEN");
  });

  it("fractional hours work correctly (1.5h → LEVEL_2_EMAIL)", () => {
    assert.equal(currentEscalationLevel(1.5), "LEVEL_2_EMAIL");
  });

  it("fractional hours work correctly (24.001h → LEVEL_3_SMS)", () => {
    assert.equal(currentEscalationLevel(24.001), "LEVEL_3_SMS");
  });
});

// ---------------------------------------------------------------------------
// channelForLevel — verifies channel strings match ESCALATION_CONFIG
// ---------------------------------------------------------------------------

describe("channelForLevel — channel strings per level", () => {
  it("LEVEL_1_ONSCREEN → 'onscreen'", () => {
    assert.equal(channelForLevel("LEVEL_1_ONSCREEN"), "onscreen");
  });

  it("LEVEL_2_EMAIL → 'email'", () => {
    assert.equal(channelForLevel("LEVEL_2_EMAIL"), "email");
  });

  it("LEVEL_3_SMS → 'sms'", () => {
    assert.equal(channelForLevel("LEVEL_3_SMS"), "sms");
  });

  it("LEVEL_4_MERCHANT_ALERT → 'merchant_dashboard'", () => {
    assert.equal(channelForLevel("LEVEL_4_MERCHANT_ALERT"), "merchant_dashboard");
  });

  it("LEVEL_5_DEAD → 'none'", () => {
    assert.equal(channelForLevel("LEVEL_5_DEAD"), "none");
  });
});
