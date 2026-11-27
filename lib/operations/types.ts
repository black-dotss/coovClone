export interface AuditEventRecord {
  id: string;
  userId?: string | null;
  action: string;
  targetId?: string | null;
  targetType?: string | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
}

export interface AuditEventInput {
  userId?: string | null;
  action: string;
  targetId?: string | null;
  targetType?: string | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AuditQueryFilter {
  userId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  limit?: number;
  offset?: number;
  since?: Date;
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  strikeThreshold?: number;
  blockDurationMs?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds?: number;
  isBlocked?: boolean;
}

export type RateLimitCategory = "api" | "evaluation" | "auth" | "share_access" | "admin";

export interface ErrorReport {
  id: string;
  name: string;
  message: string;
  code?: string;
  statusCode?: number;
  stack?: string;
  context?: Record<string, unknown>;
  timestamp: Date;
}

export interface SystemMetrics {
  timestamp: Date;
  documents: {
    total: number;
    active: number;
    softDeleted: number;
  };
  evaluations: {
    total: number;
    completed: number;
    queued: number;
    processing: number;
    failed: number;
    cancelled: number;
  };
  subscriptions: {
    total: number;
    active: number;
    byTier: Record<string, number>;
  };
  payments: {
    totalOrders: number;
    verified: number;
    pending: number;
    ambiguous: number;
    failed: number;
  };
  abuseProtection: {
    activeBlocks: number;
    totalStrikes: number;
  };
}

export interface PlanUpdateInput {
  name?: string;
  priceEtb?: number;
  billingPeriodDays?: number;
  dailyLimit?: number;
  monthlyLimit?: number;
  trialAllowance?: number;
  active?: boolean;
}

export interface FailedJobItem {
  id: string;
  ownerUserId: string;
  tone: string;
  status: string;
  errorMessage?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
