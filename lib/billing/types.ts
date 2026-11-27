export type PlanTier =
  | "free_trial"
  | "pro_monthly"
  | "pro_plus_monthly"
  | "pro_yearly"
  | "pro_plus_yearly"
  | "unlimited_yearly";

export interface PlanRecord {
  id: string;
  name: string;
  tier: PlanTier;
  priceEtb: number;
  billingPeriodDays: number;
  dailyLimit: number;
  monthlyLimit: number;
  trialAllowance: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type SubscriptionStatus = "active" | "cancelled" | "expired";

export interface SubscriptionRecord {
  id: string;
  userId: string;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  renewalDate?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreditReservation {
  reservationId: string;
  userId: string;
  evaluationId?: string;
  dailyPeriodKey?: string;
  monthlyPeriodKey?: string;
  credits: number;
  reservedAt: Date;
}

export interface QuotaWindow {
  used: number;
  reserved: number;
  limit: number;
  remaining: number;
  resetsAt: string;
}

export interface TrialQuota {
  isTrial: boolean;
  used: number;
  limit: number;
  remaining: number;
  eligible: boolean;
  ineligibilityReason?: string;
  deviceClaimed?: boolean;
  bonusCredits?: number;
}

export interface DeviceQuotaInfo {
  deviceId: string | null;
  isRegistered: boolean;
  trialClaimedOnDevice: boolean;
  status: string | null;
  riskOutcome?: "allowed" | "flagged_for_review" | "blocked";
  riskReason?: string | null;
}

export interface UsageSummary {
  plan: {
    id: string;
    name: string;
    tier: PlanTier;
    priceEtb: number;
  };
  subscription?: {
    id: string;
    status: SubscriptionStatus;
    currentPeriodStart?: string;
    currentPeriodEnd: string;
    createdAt?: string;
    renewalDate?: string | null;
  };
  quotas: {
    timezone: string;
    daily: QuotaWindow;
    monthly: QuotaWindow;
    trial: TrialQuota;
    device?: DeviceQuotaInfo;
    canEvaluate: boolean;
  };
}
