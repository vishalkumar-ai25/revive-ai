// =============================================================================
// CLOCK TESTS — Task 1.3
// =============================================================================
// Tests for SystemClock and VirtualClock.
// Run with: npm test (tsx --test)
// =============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SystemClock, VirtualClock } from "../src/lib/time/clock.js";

// ---------------------------------------------------------------------------
// SystemClock
// ---------------------------------------------------------------------------

describe("SystemClock", () => {
  it("returns a Date close to real wall-clock time", () => {
    const clock = new SystemClock();
    const before = Date.now();
    const result = clock.now();
    const after = Date.now();

    assert.ok(result instanceof Date, "now() must return a Date");
    assert.ok(
      result.getTime() >= before && result.getTime() <= after,
      "SystemClock.now() must be within real wall-clock range",
    );
  });

  it("returns a new Date instance on each call (no shared reference)", () => {
    const clock = new SystemClock();
    const t1 = clock.now();
    const t2 = clock.now();
    assert.notStrictEqual(t1, t2, "Each call must return a distinct Date instance");
  });
});

// ---------------------------------------------------------------------------
// VirtualClock — construction
// ---------------------------------------------------------------------------

describe("VirtualClock — construction", () => {
  it("starts at the provided time", () => {
    const start = new Date("2025-01-15T10:00:00.000Z");
    const clock = new VirtualClock(start);
    assert.equal(clock.now().toISOString(), start.toISOString());
  });

  it("does not mutate the constructor argument", () => {
    const start = new Date("2025-01-15T10:00:00.000Z");
    const originalTime = start.getTime();
    const clock = new VirtualClock(start);
    clock.advanceHours(5);
    assert.equal(start.getTime(), originalTime, "Constructor argument must not be mutated");
  });

  it("returns a new Date instance on each now() call", () => {
    const clock = new VirtualClock(new Date("2025-01-15T10:00:00.000Z"));
    const t1 = clock.now();
    const t2 = clock.now();
    assert.notStrictEqual(t1, t2, "now() must return distinct Date instances");
  });
});

// ---------------------------------------------------------------------------
// VirtualClock — advanceHours
// ---------------------------------------------------------------------------

describe("VirtualClock.advanceHours", () => {
  it("advances time by the correct number of hours", () => {
    const start = new Date("2025-01-15T10:00:00.000Z");
    const clock = new VirtualClock(start);
    clock.advanceHours(3);
    assert.equal(clock.now().toISOString(), "2025-01-15T13:00:00.000Z");
  });

  it("can advance across midnight", () => {
    const start = new Date("2025-01-15T22:00:00.000Z");
    const clock = new VirtualClock(start);
    clock.advanceHours(4);
    assert.equal(clock.now().toISOString(), "2025-01-16T02:00:00.000Z");
  });

  it("supports cumulative advances", () => {
    const clock = new VirtualClock(new Date("2025-01-15T00:00:00.000Z"));
    clock.advanceHours(24);
    clock.advanceHours(48);
    assert.equal(clock.now().toISOString(), "2025-01-18T00:00:00.000Z");
  });

  it("supports fractional hours (e.g. 0.5 = 30 minutes)", () => {
    const start = new Date("2025-01-15T10:00:00.000Z");
    const clock = new VirtualClock(start);
    clock.advanceHours(0.5);
    assert.equal(clock.now().toISOString(), "2025-01-15T10:30:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// VirtualClock — advance (milliseconds)
// ---------------------------------------------------------------------------

describe("VirtualClock.advance", () => {
  it("advances time by the given number of milliseconds", () => {
    const start = new Date("2025-01-15T10:00:00.000Z");
    const clock = new VirtualClock(start);
    clock.advance(90_000); // 90 seconds
    assert.equal(clock.now().toISOString(), "2025-01-15T10:01:30.000Z");
  });
});

// ---------------------------------------------------------------------------
// VirtualClock — quiet hours integration (key use-case for Task 1.1)
// ---------------------------------------------------------------------------
// IST is UTC+5:30. "21:00 IST" = 15:30 UTC.
// This validates the clock can freeze time at 11 PM IST for quiet-hours tests.

describe("VirtualClock — quiet hours scenario", () => {
  it("frozen at 11 PM IST (17:30 UTC) returns correct IST hour", () => {
    // 17:30 UTC = 23:00 IST
    const elevenPmIst = new Date("2025-01-15T17:30:00.000Z");
    const clock = new VirtualClock(elevenPmIst);
    const now = clock.now();

    const istOffsetMinutes = 5.5 * 60;
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const istMinutes = (utcMinutes + istOffsetMinutes) % (24 * 60);
    const istHour = Math.floor(istMinutes / 60);

    assert.equal(istHour, 23, "Clock frozen at 17:30 UTC should read 23:00 IST");
  });

  it("frozen at 10 AM IST (04:30 UTC) is outside quiet hours", () => {
    // 04:30 UTC = 10:00 IST — NOT quiet hours
    const tenAmIst = new Date("2025-01-15T04:30:00.000Z");
    const clock = new VirtualClock(tenAmIst);
    const now = clock.now();

    const istOffsetMinutes = 5.5 * 60;
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const istMinutes = (utcMinutes + istOffsetMinutes) % (24 * 60);
    const istHour = Math.floor(istMinutes / 60);

    assert.equal(istHour, 10, "Clock frozen at 04:30 UTC should read 10:00 IST");
    // 10 AM IST is NOT in quiet hours (9 PM – 9 AM)
    assert.ok(istHour >= 9 && istHour < 21, "10 AM IST should be outside quiet hours");
  });
});
