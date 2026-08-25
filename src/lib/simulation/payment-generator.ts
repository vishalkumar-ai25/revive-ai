// =============================================================================
// PAYMENT GENERATOR — Synthetic Data for Batch Simulation
// =============================================================================
// Generates realistic failed payment events for batch testing.
// Uses weighted distributions matching real Indian payment failure patterns.
// =============================================================================

import type { PaymentMethod } from "@prisma/client";
import { SIMULATION } from "@/lib/constants";
import type { PaymentFailureEvent } from "@/lib/types";
import { type Clock, SystemClock } from "@/lib/time/clock";

// ---------------------------------------------------------------------------
// Error descriptions per failure type (realistic messages from Indian banks)
// ---------------------------------------------------------------------------

const ERROR_DESCRIPTIONS: Record<string, string[]> = {
  BANK_TIMEOUT: [
    "Bank server did not respond within the stipulated time",
    "Transaction timed out at bank end",
    "Payment processing timeout - bank server unresponsive",
  ],
  INSUFFICIENT_FUNDS: [
    "Insufficient funds in the account",
    "Transaction declined due to insufficient balance",
    "Account balance is less than the transaction amount",
  ],
  CARD_DECLINED: [
    "Card declined by issuing bank",
    "Do not honor - contact card issuer",
    "Restricted card - transaction not permitted",
  ],
  NETWORK_ERROR: [
    "Connection to bank server failed",
    "Network error during transaction processing",
    "Unable to establish connection with payment processor",
  ],
  UPI_PSP_ERROR: [
    "UPI PSP server error",
    "Transaction failed at PSP level",
    "VPA validation failed or PSP timeout",
  ],
  OTP_EXPIRED: [
    "OTP entered has expired. Please retry",
    "Authentication timeout - OTP not received in time",
    "3D Secure authentication failed - session expired",
  ],
  LIMIT_EXCEEDED: [
    "Daily transaction limit exceeded",
    "Per-transaction limit exceeded for this account",
    "UPI daily limit of ₹1,00,000 reached",
  ],
  FRAUD_DETECTED: [
    "Transaction declined - suspected fraudulent activity",
    "Risk engine flagged transaction for review",
    "Transaction blocked by bank fraud detection system",
  ],
  MANDATE_EXPIRED: [
    "Auto-debit mandate has expired",
    "Mandate revoked by customer",
    "e-NACH mandate not active",
  ],
  CHECKOUT_ABANDONED: [
    "Customer closed checkout without attempting payment",
    "Checkout session expired - no payment attempt",
    "Customer navigated away from payment page",
  ],
  SUBSCRIPTION_FAILED: [
    "Recurring payment authorization failed",
    "Subscription renewal charge declined",
    "Auto-renewal payment could not be processed",
  ],
};

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export interface SyntheticPaymentEvent extends PaymentFailureEvent {
  groundTruthRecoveryProbability: number;
}

export class PaymentGenerator {
  private merchantId: string;
  private clock: Clock;

  constructor(merchantId: string, clock: Clock = new SystemClock()) {
    this.merchantId = merchantId;
    this.clock = clock;
  }

  /**
   * Generate a batch of realistic failed payment events.
   */
  generateBatch(count: number): SyntheticPaymentEvent[] {
    const events: SyntheticPaymentEvent[] = [];

    for (let i = 0; i < count; i++) {
      events.push(this.generateSingle(i));
    }

    return events;
  }

  /**
   * Generate a single realistic failed payment event.
   */
  generateSingle(index: number): SyntheticPaymentEvent {
    const method = this.weightedRandom(SIMULATION.METHOD_DISTRIBUTION) as PaymentMethod;
    const errorCode = this.weightedRandom(SIMULATION.FAILURE_DISTRIBUTION);
    const bank = SIMULATION.BANKS[Math.floor(Math.random() * SIMULATION.BANKS.length)]!;
    const upiApp = method === "UPI"
      ? SIMULATION.UPI_APPS[Math.floor(Math.random() * SIMULATION.UPI_APPS.length)]!
      : null;

    // Generate realistic amount with Indian price distribution
    const amount = this.generateAmount();

    // Generate realistic timestamp within the last 24 hours
    const offsetMs = Math.floor(Math.random() * 24 * 60 * 60 * 1000);
    const timestamp = new Date(this.clock.now().getTime() - offsetMs);

    // Determine if this is a recurring payment
    const isRecurring = errorCode === "SUBSCRIPTION_FAILED" ||
      errorCode === "MANDATE_EXPIRED" ||
      Math.random() < 0.08;

    const descriptions = ERROR_DESCRIPTIONS[errorCode] ?? ["Unknown error"];

    const customerTotalPurchases = Math.floor(Math.random() * 10);
    const customerLifetimeValue = Math.floor(Math.random() * 50000);

    // Calculate a ground truth probability independent of risk agent
    let baseRate = 0.4;
    if (errorCode === "BANK_TIMEOUT" || errorCode === "NETWORK_ERROR") baseRate += 0.2;
    if (errorCode === "INSUFFICIENT_FUNDS" || errorCode === "CARD_DECLINED") baseRate -= 0.15;
    if (errorCode === "FRAUD_DETECTED" || errorCode === "SUSPECTED_FRAUD") baseRate = 0;
    if (amount < 2000) baseRate += 0.1;
    if (customerTotalPurchases > 3) baseRate += 0.1;

    // Add noise
    let groundTruth = baseRate + (Math.random() * 0.15 - 0.075);
    groundTruth = Math.max(0, Math.min(1, groundTruth));

    if (errorCode === "FRAUD_DETECTED" || errorCode === "SUSPECTED_FRAUD") {
        groundTruth = 0;
    }

    return {
      externalId: `pay_sim_${Date.now()}_${index.toString().padStart(5, "0")}`,
      merchantId: this.merchantId,
      customerId: `cust_sim_${(index % 200).toString().padStart(4, "0")}`, // ~200 unique customers
      amount: Math.round(amount * 100) / 100,
      currency: "INR",
      method,
      bank,
      upiApp,
      errorCode,
      errorDescription: descriptions[Math.floor(Math.random() * descriptions.length)]!,
      isRecurring,
      subscriptionId: isRecurring && errorCode === "SUBSCRIPTION_FAILED"
        ? `sub_${index.toString().padStart(4, "0")}`
        : null,
      mandateId: isRecurring && errorCode === "MANDATE_EXPIRED"
        ? `mandate_${index.toString().padStart(4, "0")}`
        : null,
      timestamp,
      customerTotalPurchases,
      customerLifetimeValue,
      groundTruthRecoveryProbability: groundTruth,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Generate realistic Indian payment amounts.
   * Distribution: many small (₹99-₹999), some medium (₹1000-₹5000), few large (₹5000+).
   */
  private generateAmount(): number {
    const r = Math.random();

    if (r < 0.3) {
      // Small: ₹99 - ₹999
      return SIMULATION.MIN_AMOUNT + Math.random() * 900;
    } else if (r < 0.7) {
      // Medium: ₹1,000 - ₹5,000
      return 1000 + Math.random() * 4000;
    } else if (r < 0.9) {
      // Large: ₹5,000 - ₹15,000
      return 5000 + Math.random() * 10000;
    } else {
      // High-value: ₹15,000 - ₹25,000
      return 15000 + Math.random() * (SIMULATION.MAX_AMOUNT - 15000);
    }
  }

  /**
   * Weighted random selection from a distribution map.
   */
  private weightedRandom(distribution: Record<string, number>): string {
    const entries = Object.entries(distribution);
    const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
    let random = Math.random() * totalWeight;

    for (const [key, weight] of entries) {
      random -= weight;
      if (random <= 0) return key;
    }

    // Fallback to first entry
    return entries[0]![0];
  }
}
