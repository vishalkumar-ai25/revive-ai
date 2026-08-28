// =============================================================================
// SEEDED PRNG — Deterministic Random Number Generator for Simulation
// =============================================================================
// Uses the mulberry32 algorithm to produce reproducible random sequences.
// Replaces Math.random() in simulation code so benchmark results are
// deterministic and reproducible given the same seed.
//
// Usage:
//   import { setGlobalSeed, random } from "@/lib/simulation/rng";
//   setGlobalSeed(42);          // call once at startup
//   const r = random();         // returns [0, 1) deterministically
// =============================================================================

/**
 * Mulberry32: a fast, high-quality 32-bit seeded PRNG.
 * Period: 2^32. Passes BigCrush statistical tests.
 */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0; // ensure 32-bit integer
  }

  /** Returns a pseudo-random float in [0, 1). */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

// ---------------------------------------------------------------------------
// Global singleton — mirrors the Math.random() API for easy replacement
// ---------------------------------------------------------------------------

let globalRng = new SeededRng(42);

/** Reset the global PRNG with a new seed. Call once before simulation. */
export function setGlobalSeed(seed: number): void {
  globalRng = new SeededRng(seed);
}

/** Drop-in replacement for Math.random() backed by the seeded PRNG. */
export function random(): number {
  return globalRng.next();
}
