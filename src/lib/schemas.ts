import { z } from "zod";

export const DiagnosisResultSchema = z.object({
  category: z.enum([
    "BANK_TIMEOUT",
    "INSUFFICIENT_FUNDS",
    "CARD_DECLINED",
    "NETWORK_ERROR",
    "UPI_PSP_ERROR",
    "OTP_EXPIRED",
    "LIMIT_EXCEEDED",
    "FRAUD_BLOCK",
    "MANDATE_EXPIRED",
    "CHECKOUT_ABANDONED",
    "SUBSCRIPTION_FAILED",
    "UNKNOWN",
  ]),
  confidence: z.number().min(0).max(1),
  isRecoverable: z.boolean(),
  rootCause: z.string(),
  signals: z.array(
    z.object({
      name: z.string(),
      value: z.coerce.string(),
      weight: z.number(),
    })
  ),
});

export type DiagnosisResultParsed = z.infer<typeof DiagnosisResultSchema>;
