export type DeviceStatus = "active" | "revoked";

export interface DeviceRecord {
  id: string;
  ownerUserId: string;
  deviceId: string;
  tokenHash: string;
  fingerprintHash?: string | null;
  label?: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  status: DeviceStatus;
  trialClaimedAt?: Date | null;
  createdAt: Date;
  revokedAt?: Date | null;
}

export interface PublicDeviceDto {
  id: string;
  deviceId: string;
  label?: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  status: DeviceStatus;
  isCurrentDevice?: boolean;
  trialClaimed?: boolean;
}

export interface DeviceTrialClaimRecord {
  id: string;
  deviceId: string;
  userId: string;
  claimedAt: Date;
  ipAddress?: string | null;
  riskScore: number;
  riskOutcome: "allowed" | "flagged_for_review" | "blocked";
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
}

export type TrialIneligibilityCode =
  | "DEVICE_TRIAL_ALREADY_CLAIMED"
  | "DEVICE_NOT_REGISTERED"
  | "DEVICE_NOT_OWNED"
  | "DEVICE_REVOKED"
  | "TRIAL_LIMIT_EXCEEDED"
  | "ACCOUNT_INELIGIBLE";

export interface DeviceTrialEligibilityResult {
  eligible: boolean;
  code?: TrialIneligibilityCode;
  reason?: string;
  riskScore: number;
  riskOutcome: "allowed" | "flagged_for_review" | "blocked";
  riskReason?: string;
  device?: DeviceRecord | null;
  deviceTrialClaimed?: boolean;
  claimedByUserId?: string | null;
}

export interface DeviceTombstoneRecord {
  id: string;
  deviceId: string;
  tokenHash: string;
  fingerprintHash?: string | null;
  originalOwnerUserId?: string | null;
  reason: string;
  trialConsumed: boolean;
  tombstonedAt: Date;
  createdAt: Date;
}

export interface DeviceEventRecord {
  id: string;
  deviceId: string;
  userId: string;
  eventType: string;
  riskOutcome: string;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
}

export interface DeviceClaimResult {
  allowed: boolean;
  deviceId: string;
  rawToken?: string;
  device?: DeviceRecord;
  reason?: string;
  isNewDevice?: boolean;
}

export interface ClaimDeviceParams {
  userId: string;
  rawToken?: string | null;
  fingerprintHash?: string | null;
  label?: string | null;
  ipAddress?: string | null;
  isSignUp?: boolean;
}

export interface RevokeDeviceOptions {
  confirmationCode?: string;
  ipAddress?: string;
}

export interface DeviceRecoveryRequestParams {
  email?: string;
  userId?: string;
  reason?: string;
  ipAddress?: string;
}

export interface DeviceRecoveryConfirmParams {
  email?: string;
  userId?: string;
  code: string;
  targetDeviceIdToRevoke?: string;
  label?: string;
  ipAddress?: string;
}

export interface DeviceRecoveryResult {
  success: boolean;
  message: string;
  deviceId: string;
  rawToken: string;
  revokedDeviceIds: string[];
  device: DeviceRecord;
}
