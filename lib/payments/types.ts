import { PlanTier } from "../billing/types";

export type PaymentStatus =
  | "pending"
  | "verified"
  | "failed"
  | "expired"
  | "duplicate"
  | "ambiguous";

export type PaymentProvider = "telebirr" | "cbe" | "awash" | "boa";

export interface ReceivingAccount {
  provider: PaymentProvider;
  displayName: string;
  accountName: string;
  accountNumber: string;
  instructions: string;
}

export interface CreatePaymentOrderInput {
  planTier:
    | "pro_monthly"
    | "pro_plus_monthly"
    | "pro_yearly"
    | "pro_plus_yearly"
    | "unlimited_yearly";
  preferredProvider?: PaymentProvider;
}

export interface PaymentVerificationRecord {
  id: string;
  orderId: string;
  providerRequestId?: string | null;
  transactionReference: string;
  verifiedAmount?: number | null;
  verifiedCurrency?: string | null;
  status: string;
  responseMetadata?: Record<string, unknown> | null;
  createdAt: Date;
}

export interface PaymentOrderDetails {
  id: string;
  userId: string;
  planId: string;
  planTier: PlanTier;
  planName: string;
  amountEtb: number;
  currency: string;
  orderReference: string;
  expectedReceiver: string;
  receivingAccounts: ReceivingAccount[];
  status: PaymentStatus;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  verification?: PaymentVerificationRecord | null;
  message?: string;
}

export interface SubmitPaymentVerificationInput {
  orderId?: string;
  orderReference?: string;
  transactionReference?: string;
  smsText?: string;
  provider?: PaymentProvider;
  bank?: PaymentProvider;
  senderIdentifier?: string;
}

export interface VerifyEtVerifyRequest {
  transactionReference: string;
  provider: string;
  bank?: string;
  expectedAmount: number;
  expectedReceiver?: string;
  senderIdentifier?: string;
  accountNumber?: string;
  accountSuffix?: string;
  phoneNumber?: string;
}

export interface VerifyEtVerifyResponse {
  status: "verified" | "pending" | "failed" | "rejected";
  requestId: string;
  transactionReference: string;
  amount: number;
  currency: string;
  receiver?: string;
  receiverAccount?: string;
  sender?: string;
  verifiedAt?: string;
  rawMetadata?: Record<string, unknown>;
}

export interface VerifyEtWebhookPayload {
  event: "verification.completed" | "payment.verified" | "verification.failed";
  requestId: string;
  transactionReference: string;
  status: "verified" | "failed" | "rejected";
  amount: number;
  currency: string;
  receiver?: string;
  receiverAccount?: string;
  sender?: string;
  timestamp: string;
  rawMetadata?: Record<string, unknown>;
}
