// =============================================================================
// CLOCK ABSTRACTION — Task 1.3
// =============================================================================
// Provides an injectable time source for all time-dependent business logic.
//
// Why this exists:
//   - Stopping rules, strategy timing, and the recovery window all depend on
//     "what time is it now". Without an injectable clock, these modules call
//     `new Date()` or `Date.now()` directly — making unit tests time-dependent
//     (flaky) and the batch simulator unable to advance 72 h in milliseconds.
//
// Usage:
//   // Production — pass nothing, defaults to SystemClock
//   const engine = new StoppingRulesEngine();
//
//   // Tests and batch simulation — pass a VirtualClock
//   const clock = new VirtualClock(new Date("2025-01-15T17:30:00.000Z"));
//   const engine = new StoppingRulesEngine(clock);
//   clock.advanceHours(24); // now the engine sees T+24h
// =============================================================================

// ---------------------------------------------------------------------------
// Clock interface
// ---------------------------------------------------------------------------

/** Time source injected into all time-dependent modules. */
export interface Clock {
  /** Returns the current time as a Date. Each call returns a new instance. */
  now(): Date;
}

// ---------------------------------------------------------------------------
// SystemClock — production implementation
// ---------------------------------------------------------------------------

/** Delegates to real wall-clock time. Safe default for all constructors. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

// ---------------------------------------------------------------------------
// VirtualClock — test / simulation implementation
// ---------------------------------------------------------------------------

/**
 * A deterministic clock whose time can be advanced programmatically.
 *
 * Use in:
 *  - Unit tests (freeze time at a known value for predictable assertions)
 *  - BatchRunner (advance 72 h in milliseconds to simulate the full lifecycle)
 *
 * @example
 *   const clock = new VirtualClock(new Date("2025-01-15T17:30:00.000Z"));
 *   clock.advanceHours(1);
 *   clock.now(); // 2025-01-15T18:30:00.000Z
 */
export class VirtualClock implements Clock {
  private currentTime: Date;

  /**
   * @param startTime — Starting point for the virtual clock.
   *                    Defaults to the real current time if omitted.
   *                    The provided Date is copied; the original is NOT mutated.
   */
  constructor(startTime: Date = new Date()) {
    // Copy so the caller's Date is never mutated by advanceHours/advance.
    this.currentTime = new Date(startTime.getTime());
  }

  /**
   * Returns the current virtual time.
   * Returns a new Date instance on every call — callers cannot mutate
   * internal state by modifying the returned value.
   */
  now(): Date {
    return new Date(this.currentTime.getTime());
  }

  /**
   * Advance virtual time by the given number of hours.
   * Supports fractional values (e.g. 0.5 = 30 minutes).
   */
  advanceHours(hours: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + hours * 60 * 60 * 1000);
  }

  /**
   * Advance virtual time by the given number of milliseconds.
   * Use for fine-grained control in tests.
   */
  advance(ms: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + ms);
  }
}
