import { z } from "zod";

export const CreatePaymentOrderSchema = z.object({
  planTier: z.enum(
    [
      "pro_monthly",
      "pro_plus_monthly",
      "pro_yearly",
      "pro_plus_yearly",
      "unlimited_yearly",
    ],
    {
      message: "Must select a valid plan tier",
    }
  ),
  preferredProvider: z.enum(["telebirr", "cbe", "awash", "boa"]).optional(),
});

export const SubmitPaymentVerificationSchema = z
  .object({
    orderId: z.string().optional(),
    orderReference: z.string().optional(),
    transactionReference: z
      .string()
      .min(1, "Transaction reference or SMS text is required")
      .max(10000, "SMS text cannot exceed 10000 characters")
      .optional(),
    smsText: z.string().max(10000).optional(),
    provider: z.enum(["telebirr", "cbe", "awash", "boa"]).optional(),
    bank: z.enum(["telebirr", "cbe", "awash", "boa"]).optional(),
    senderIdentifier: z.string().max(100).optional(),
  })
  .refine(
    (data) => Boolean(data.orderId || data.orderReference),
    {
      message: "Either orderId or orderReference is required",
      path: ["orderId"],
    }
  )
  .refine(
    (data) => Boolean(data.transactionReference?.trim() || data.smsText?.trim()),
    {
      message: "Transaction reference code or SMS confirmation text is required",
      path: ["transactionReference"],
    }
  );

export const VerifyEtNestedPaymentWebhookSchema = z.object({
  id: z.string().optional(),
  event: z.string().min(1),
  requestId: z.string().min(1),
  timestamp: z.string().optional(),
  data: z.object({
    processingStatus: z.string().optional(),
    status: z.string().optional(),
    verified: z.boolean().optional(),
    bank: z.string().optional(),
    amount: z.union([z.number(), z.string()]).transform((val) => Number(val)),
    currency: z.string().default("ETB").optional(),
    senderName: z.string().optional(),
    receiverName: z.string().optional(),
    referenceNumber: z.string().optional(),
    receiptNumber: z.string().optional(),
    transactionNumber: z.string().optional(),
    durationMs: z.number().optional(),
    completedAt: z.string().optional(),
    error: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const VerifyEtFlatPaymentWebhookSchema = z.object({
  event: z.string().min(1),
  requestId: z.string().min(1),
  transactionReference: z.string().min(1),
  status: z.string().min(1),
  amount: z.coerce.number().positive(),
  currency: z.string().default("ETB"),
  receiver: z.string().optional(),
  sender: z.string().optional(),
  timestamp: z.string(),
  rawMetadata: z.record(z.string(), z.unknown()).optional(),
});

export const VerifyEtPingWebhookSchema = z.object({
  id: z.string().optional(),
  event: z.string().optional(),
  ping: z.boolean().optional(),
  test: z.boolean().optional(),
  type: z.string().optional(),
  action: z.string().optional(),
  status: z.string().optional(),
  message: z.string().optional(),
  timestamp: z.string().optional(),
});

export const VerifyEtPaymentWebhookSchema = z.union([
  VerifyEtNestedPaymentWebhookSchema,
  VerifyEtFlatPaymentWebhookSchema,
]);

export const VerifyEtWebhookSchema = z.union([
  VerifyEtNestedPaymentWebhookSchema,
  VerifyEtFlatPaymentWebhookSchema,
  VerifyEtPingWebhookSchema,
]);
