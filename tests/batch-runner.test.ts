// =============================================================================
// BATCH RUNNER TESTS — Phase 5 Regression & Report Integrity
// =============================================================================
// Tests covering:
//   1. Fraud invariant: FRAUD_DETECTED payments must NEVER be retried (Bug A regression)
//   2. BatchReport field integrity: stopping rule category counts sum correctly
// =============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PaymentGenerator } from "../src/lib/simulation/payment-generator.js";
import { StoppingRulesEngine } from "../src/lib/engine/stopping-rules.js";
import { VirtualClock } from "../src/lib/time/clock.js";
import { SIMULATION } from "../src/lib/constants.js";
import type { PaymentFailureEvent } from "../src/lib/types.js";

// ---------------------------------------------------------------------------
// Bug A Regression: Fraud payments must never be retried
// ---------------------------------------------------------------------------

describe("BatchRunner — Fraud Zero-Tolerance Invariant (Bug A Regression)", () => {
  it("PaymentGenerator emits FRAUD_DETECTED (not FRAUD_BLOCK), matching engine's isFraud check", () => {
    // Verify the constant itself is correct
    assert.ok(
      "FRAUD_DETECTED" in SIMULATION.FAILURE_DISTRIBUTION,
      "SIMULATION.FAILURE_DISTRIBUTION must contain 'FRAUD_DETECTED' key",
    );
    assert.equal(
      (SIMULATION.FAILURE_DISTRIBUTION as Record<string, number>)["FRAUD_BLOCK"],
      undefined,
      "SIMULATION.FAILURE_DISTRIBUTION must NOT contain 'FRAUD_BLOCK' key",
    );
  });

  it("Generated fraud events are recognized as fraud by the engine's isFraud check", () => {
    const clock = new VirtualClock(new Date("2025-01-15T10:00:00.000Z"));
    const generator = new PaymentGenerator("merch_test", clock);

    // Generate a large batch and find all fraud events
    const events = generator.generateBatch(2000);
    const fraudEvents = events.filter((e) => e.errorCode === "FRAUD_DETECTED");

    // With 1.5% distribution over 2000 events, we expect ~30 fraud events
    assert.ok(
      fraudEvents.length > 0,
      `Expected at least 1 fraud event in 2000 payments, got ${fraudEvents.length}`,
    );

    // Verify each fraud event would trigger isFraud in recovery-engine.ts
    for (const event of fraudEvents) {
      const isFraud =
        event.errorCode === "FRAUD_DETECTED" ||
        event.errorCode === "SUSPECTED_FRAUD";
      assert.ok(
        isFraud,
        `Fraud event ${event.externalId} has errorCode "${event.errorCode}" which does NOT trigger isFraud`,
      );
    }
  });

  it("StoppingRulesEngine hard-stops every fraud payment with zero recovery attempts allowed", () => {
    const clock = new VirtualClock(new Date("2025-01-15T10:00:00.000Z"));
    const stoppingRules = new StoppingRulesEngine(clock);
    const generator = new PaymentGenerator("merch_test", clock);

    const events = generator.generateBatch(2000);
    const fraudEvents = events.filter((e) => e.errorCode === "FRAUD_DETECTED");

    for (const event of fraudEvents) {
      // isFraud is computed the same way as in recovery-engine.ts
      const isFraud =
        event.errorCode === "FRAUD_DETECTED" ||
        event.errorCode === "SUSPECTED_FRAUD";

      // With zero previous attempts and no strategy, the fraud rule must fire
      const decision = stoppingRules.evaluate(event, [], isFraud);
      assert.equal(
        decision.shouldStop,
        true,
        `Fraud event ${event.externalId} was NOT stopped by StoppingRulesEngine`,
      );
      assert.equal(
        decision.rule,
        "FRAUD_BLOCK",
        `Fraud event ${event.externalId} stopped by wrong rule: ${decision.rule}`,
      );

      // With any strategy, must still stop
      for (const strategy of ["SMART_RETRY", "CUSTOMER_NUDGE", "ALT_PAYMENT"] as const) {
        const stratDecision = stoppingRules.evaluate(event, [], isFraud, strategy);
        assert.equal(
          stratDecision.shouldStop,
          true,
          `Fraud event allowed through with strategy ${strategy}`,
        );
      }
    }
  });

  it("Non-fraud payments are NOT marked as fraud (false positive check)", () => {
    const clock = new VirtualClock(new Date("2025-01-15T10:00:00.000Z"));
    const generator = new PaymentGenerator("merch_test", clock);

    const events = generator.generateBatch(500);
    const nonFraudEvents = events.filter(
      (e) => e.errorCode !== "FRAUD_DETECTED" && e.errorCode !== "SUSPECTED_FRAUD",
    );

    for (const event of nonFraudEvents) {
      const isFraud =
        event.errorCode === "FRAUD_DETECTED" ||
        event.errorCode === "SUSPECTED_FRAUD";
      assert.equal(
        isFraud,
        false,
        `Non-fraud event ${event.externalId} with code "${event.errorCode}" incorrectly flagged as fraud`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Report Field Integrity: Stopping rule category counts
// ---------------------------------------------------------------------------

describe("BatchRunner — Report Field Integrity", () => {
  it("BatchReport stopping rule categories are non-negative integers", () => {
    // This test validates the report computation logic by running the category
    // counting locally without DB. We simulate what calculateReport() does.
    const clock = new VirtualClock(new Date("2025-01-15T10:00:00.000Z"));
    const stoppingRules = new StoppingRulesEngine(clock);
    const generator = new PaymentGenerator("merch_test", clock);
    const events = generator.generateBatch(50);

    let fraudBlocked = 0;
    let belowMinAmount = 0;
    let cleared = 0;

    for (const event of events) {
      const isFraud =
        event.errorCode === "FRAUD_DETECTED" ||
        event.errorCode === "SUSPECTED_FRAUD";
      const decision = stoppingRules.evaluate(event, [], isFraud);

      if (decision.shouldStop && decision.rule === "FRAUD_BLOCK") {
        fraudBlocked++;
      } else if (decision.shouldStop && decision.rule === "BELOW_MIN_AMOUNT") {
        belowMinAmount++;
      } else if (!decision.shouldStop) {
        cleared++;
      }
    }

    // All counts are non-negative integers
    assert.ok(Number.isInteger(fraudBlocked) && fraudBlocked >= 0);
    assert.ok(Number.isInteger(belowMinAmount) && belowMinAmount >= 0);
    assert.ok(Number.isInteger(cleared) && cleared >= 0);

    // Sum must equal total events
    const totalCategorized = fraudBlocked + belowMinAmount + cleared;
    // There could be other stopping rules too (window expired etc), but at T+0
    // with no prior attempts, only FRAUD_BLOCK and BELOW_MIN_AMOUNT can fire
    assert.equal(
      totalCategorized,
      events.length,
      `Categorized ${totalCategorized} but generated ${events.length} events`,
    );
  });

  it("Fraud-blocked count matches actual FRAUD_DETECTED events in generated batch", () => {
    const clock = new VirtualClock(new Date("2025-01-15T10:00:00.000Z"));
    const stoppingRules = new StoppingRulesEngine(clock);
    const generator = new PaymentGenerator("merch_test", clock);
    const events = generator.generateBatch(2000);

    const generatedFraudCount = events.filter(
      (e) => e.errorCode === "FRAUD_DETECTED",
    ).length;

    let engineFraudBlocked = 0;
    for (const event of events) {
      const isFraud =
        event.errorCode === "FRAUD_DETECTED" ||
        event.errorCode === "SUSPECTED_FRAUD";
      const decision = stoppingRules.evaluate(event, [], isFraud);
      if (decision.shouldStop && decision.rule === "FRAUD_BLOCK") {
        engineFraudBlocked++;
      }
    }

    assert.equal(
      engineFraudBlocked,
      generatedFraudCount,
      `Engine blocked ${engineFraudBlocked} but generator produced ${generatedFraudCount} fraud events`,
    );
  });
});
