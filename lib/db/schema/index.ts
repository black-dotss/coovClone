import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ==============================================================================
// 1. Better Auth Core Tables (Identity & Session Management)
// ==============================================================================

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_idx").on(table.email),
  ]
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sessions_token_idx").on(table.token),
    index("sessions_user_id_idx").on(table.userId),
  ]
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("accounts_user_id_idx").on(table.userId),
    uniqueIndex("accounts_provider_account_idx").on(table.providerId, table.accountId),
  ]
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("verifications_identifier_idx").on(table.identifier),
  ]
);

// ==============================================================================
// 2. User Profiles & Settings
// ==============================================================================

export const userProfiles = pgTable(
  "user_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    timezone: text("timezone").notNull().default("Africa/Addis_Ababa"),
    preferences: jsonb("preferences").$type<Record<string, unknown>>().default({}),
    accountStatus: text("account_status").notNull().default("active"), // active, suspended, pending_deletion
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_profiles_user_id_idx").on(table.userId),
  ]
);

// ==============================================================================
// 3. Plans, Subscriptions, and Usage Ledger
// ==============================================================================

export const plans = pgTable(
  "plans",
  {
    id: text("id").primaryKey(), // plan_free_trial, plan_pro_monthly, plan_pro_yearly
    name: text("name").notNull(),
    tier: text("tier").notNull().unique(), // free_trial, pro_monthly, pro_yearly
    priceEtb: integer("price_etb").notNull().default(0),
    billingPeriodDays: integer("billing_period_days").notNull().default(0),
    dailyLimit: integer("daily_limit").notNull().default(5),
    monthlyLimit: integer("monthly_limit").notNull().default(150),
    trialAllowance: integer("trial_allowance").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("plans_tier_idx").on(table.tier),
  ]
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id),
    status: text("status").notNull().default("active"), // active, cancelled, expired
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).notNull().defaultNow(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
    renewalDate: timestamp("renewal_date", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("subscriptions_user_id_idx").on(table.userId),
    index("subscriptions_status_idx").on(table.status),
  ]
);

export const usageCounters = pgTable(
  "usage_counters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    periodKey: text("period_key").notNull(), // e.g. "2026-11-16" for daily or "2026-11" for monthly
    evaluationsUsed: integer("evaluations_used").notNull().default(0),
    evaluationsReserved: integer("evaluations_reserved").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("usage_counters_user_period_idx").on(table.userId, table.periodKey),
    index("usage_counters_user_id_idx").on(table.userId),
  ]
);

export const usageLedger = pgTable(
  "usage_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    evaluationId: uuid("evaluation_id"),
    eventType: text("event_type").notNull(), // reserved, settled, released
    credits: integer("credits").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("usage_ledger_user_id_idx").on(table.userId),
    index("usage_ledger_evaluation_id_idx").on(table.evaluationId),
  ]
);

// ==============================================================================
// 4. Documents & CV Versions
// ==============================================================================

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // cv, cover_letter
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    checksum: text("checksum").notNull(),
    privateStorageKey: text("private_storage_key").notNull(),
    extractedText: text("extracted_text"),
    extractedTextStatus: text("extracted_text_status").notNull().default("pending"), // pending, completed, ocr_required, failed
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("documents_owner_user_id_idx").on(table.ownerUserId),
    index("documents_status_idx").on(table.extractedTextStatus),
  ]
);

export const cvVersions = pgTable(
  "cv_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceDocumentId: uuid("source_document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull().default(1),
    extractedText: text("extracted_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("cv_versions_user_doc_idx").on(table.userId, table.sourceDocumentId),
  ]
);

// ==============================================================================
// 5. Job Descriptions & Normalized Requirements
// ==============================================================================

export const jobDescriptions = pgTable(
  "job_descriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
    company: text("company"),
    rawText: text("raw_text").notNull(),
    normalizedRequirements: jsonb("normalized_requirements").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("job_descriptions_user_id_idx").on(table.userId),
  ]
);

// ==============================================================================
// 6. Evaluations, Agent Runs, Debate Messages, and Reports
// ==============================================================================

export const evaluations = pgTable(
  "evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cvVersionId: uuid("cv_version_id")
      .notNull()
      .references(() => cvVersions.id, { onDelete: "cascade" }),
    jobDescriptionId: uuid("job_description_id")
      .notNull()
      .references(() => jobDescriptions.id, { onDelete: "cascade" }),
    tone: text("tone").notNull().default("strict"), // friendly, strict, brutal_roast
    status: text("status").notNull().default("queued"), // queued, processing, completed, failed, cancelled
    overallScore: integer("overall_score"),
    verdict: text("verdict"), // Strong fit, Potential fit, Significant gaps, Weak fit
    workflowState: jsonb("workflow_state").$type<Record<string, unknown>>(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("evaluations_owner_idx").on(table.ownerUserId),
    index("evaluations_status_idx").on(table.status),
  ]
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evaluationId: uuid("evaluation_id")
      .notNull()
      .references(() => evaluations.id, { onDelete: "cascade" }),
    agentRole: text("agent_role").notNull(), // hr_recruiter, technical_interviewer, etc.
    status: text("status").notNull().default("pending"), // pending, running, completed, failed
    structuredResult: jsonb("structured_result").$type<Record<string, unknown>>(),
    scoreContribution: integer("score_contribution"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("agent_runs_evaluation_id_idx").on(table.evaluationId),
  ]
);

export const debateMessages = pgTable(
  "debate_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evaluationId: uuid("evaluation_id")
      .notNull()
      .references(() => evaluations.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    agentRole: text("agent_role").notNull(),
    content: text("content").notNull(),
    evidenceReferences: jsonb("evidence_references").$type<unknown[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("debate_messages_eval_seq_idx").on(table.evaluationId, table.sequence),
  ]
);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evaluationId: uuid("evaluation_id")
      .notNull()
      .unique()
      .references(() => evaluations.id, { onDelete: "cascade" }),
    structuredReport: jsonb("structured_report").$type<Record<string, unknown>>().notNull(),
    pdfStorageKey: text("pdf_storage_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("reports_evaluation_id_idx").on(table.evaluationId),
  ]
);

export const rewriteSuggestions = pgTable(
  "rewrite_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evaluationId: uuid("evaluation_id")
      .notNull()
      .references(() => evaluations.id, { onDelete: "cascade" }),
    originalText: text("original_text").notNull(),
    suggestedText: text("suggested_text").notNull(),
    explanation: text("explanation").notNull(),
    isAccepted: boolean("is_accepted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("rewrite_suggestions_eval_idx").on(table.evaluationId),
  ]
);

// ==============================================================================
// 7. Mock Interviews & Rubrics
// ==============================================================================

export const interviewSessions = pgTable(
  "interview_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    evaluationId: uuid("evaluation_id")
      .notNull()
      .references(() => evaluations.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("in_progress"), // in_progress, completed
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("interview_sessions_user_id_idx").on(table.userId),
    index("interview_sessions_eval_id_idx").on(table.evaluationId),
  ]
);

export const interviewAnswers = pgTable(
  "interview_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => interviewSessions.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    questionText: text("question_text").notNull(),
    userAnswer: text("user_answer").notNull(),
    rubricScores: jsonb("rubric_scores").$type<Record<string, unknown>>(),
    feedback: text("feedback"),
    improvementTip: text("improvement_tip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("interview_answers_session_id_idx").on(table.sessionId),
  ]
);

// ==============================================================================
// 8. Payment Orders & Verify.ET Verifications
// ==============================================================================

export const paymentOrders = pgTable(
  "payment_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id),
    amountEtb: integer("amount_etb").notNull(),
    currency: text("currency").notNull().default("ETB"),
    orderReference: text("order_reference").notNull().unique(),
    expectedReceiver: text("expected_receiver").notNull(),
    status: text("status").notNull().default("pending"), // pending, verified, failed, expired
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payment_orders_reference_idx").on(table.orderReference),
    index("payment_orders_user_id_idx").on(table.userId),
  ]
);

export const paymentVerifications = pgTable(
  "payment_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => paymentOrders.id, { onDelete: "cascade" }),
    providerRequestId: text("provider_request_id"),
    transactionReference: text("transaction_reference").notNull(),
    verifiedAmount: integer("verified_amount"),
    verifiedCurrency: text("verified_currency"),
    status: text("status").notNull(), // verified, failed, rejected
    responseMetadata: jsonb("response_metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("payment_verifications_order_id_idx").on(table.orderId),
    index("payment_verifications_tx_ref_idx").on(table.transactionReference),
  ]
);

// ==============================================================================
// 9. Share Links (Revocable & Expiring Public Reports)
// ==============================================================================

export const shareLinks = pgTable(
  "share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    accessCount: integer("access_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("share_links_token_hash_idx").on(table.tokenHash),
    index("share_links_report_id_idx").on(table.reportId),
  ]
);

// ==============================================================================
// 10. Devices & One-Device-One-Account Enforcement
// ==============================================================================

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull().unique(),
    tokenHash: text("token_hash").notNull().unique(),
    fingerprintHash: text("fingerprint_hash"),
    label: text("label"),
    status: text("status").notNull().default("active"), // active, revoked
    trialClaimedAt: timestamp("trial_claimed_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("devices_device_id_idx").on(table.deviceId),
    uniqueIndex("devices_token_hash_idx").on(table.tokenHash),
    index("devices_owner_user_id_idx").on(table.ownerUserId),
  ]
);

export const deviceTrialClaims = pgTable(
  "device_trial_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: text("device_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    riskScore: integer("risk_score").notNull().default(0),
    riskOutcome: text("risk_outcome").notNull().default("allowed"), // allowed, flagged_for_review, blocked
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("device_trial_claims_device_id_idx").on(table.deviceId),
    index("device_trial_claims_user_id_idx").on(table.userId),
  ]
);

export const deviceEvents = pgTable(
  "device_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: text("device_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(), // registered, authenticated, revoked, recovery_attempted, recovery_confirmed
    riskOutcome: text("risk_outcome").notNull().default("allowed"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("device_events_device_id_idx").on(table.deviceId),
    index("device_events_user_id_idx").on(table.userId),
  ]
);

export const deviceTombstones = pgTable(
  "device_tombstones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: text("device_id").notNull().unique(),
    tokenHash: text("token_hash").notNull(),
    fingerprintHash: text("fingerprint_hash"),
    originalOwnerUserId: text("original_owner_user_id"),
    reason: text("reason").notNull().default("account_deleted"), // account_deleted, revoked_abandoned, abuse_block
    trialConsumed: boolean("trial_consumed").notNull().default(true),
    tombstonedAt: timestamp("tombstoned_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("device_tombstones_device_id_idx").on(table.deviceId),
    index("device_tombstones_token_hash_idx").on(table.tokenHash),
    index("device_tombstones_fingerprint_hash_idx").on(table.fingerprintHash),
  ]
);

// ==============================================================================
// 11. System Health & Infrastructure
// ==============================================================================

export const systemHealth = pgTable("system_health", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: text("status").notNull().default("healthy"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
});

// ==============================================================================
// 12. Audit Events & Operational Telemetry
// ==============================================================================

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id"),
    action: text("action").notNull(), // report.exported_pdf, share.created, share.revoked, share.accessed, document.purged, admin.plan_updated, etc.
    targetId: text("target_id"),
    targetType: text("target_type"), // report, share_link, document, evaluation, payment_order, plan
    ipAddress: text("ip_address"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_events_user_id_idx").on(table.userId),
    index("audit_events_action_idx").on(table.action),
    index("audit_events_created_at_idx").on(table.createdAt),
  ]
);

// ==============================================================================
// 13. Referrals & Invite Credits
// ==============================================================================

export const referrals = pgTable(
  "referrals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referrerId: text("referrer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    referredUserId: text("referred_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("referrals_referrer_id_idx").on(table.referrerId),
    uniqueIndex("referrals_referred_user_id_idx").on(table.referredUserId),
  ]
);
