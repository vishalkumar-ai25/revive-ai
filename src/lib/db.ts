// =============================================================================
// PRISMA CLIENT SINGLETON
// =============================================================================
// Prevents multiple Prisma Client instances in development (Next.js hot reload).
// Standard pattern from Prisma + Next.js documentation.
// =============================================================================

import { PrismaClient } from "@prisma/client";

try {
  process.loadEnvFile?.();
} catch {
  // Ignore missing .env in environments where env vars are injected directly
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG_QUERIES === "true" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
