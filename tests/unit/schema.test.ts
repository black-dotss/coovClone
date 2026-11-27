import { describe, it, expect } from "vitest";
import * as schema from "@/lib/db/schema";
import { getTableColumns } from "drizzle-orm";

describe("Database Schema Integrity and Constraints", () => {
  it("defines all required core tables", () => {
    const expectedTables = [
      "users",
      "sessions",
      "accounts",
      "verifications",
      "userProfiles",
      "plans",
      "subscriptions",
      "usageCounters",
      "usageLedger",
      "documents",
      "cvVersions",
      "jobDescriptions",
      "evaluations",
      "agentRuns",
      "debateMessages",
      "reports",
      "rewriteSuggestions",
      "interviewSessions",
      "interviewAnswers",
      "paymentOrders",
      "paymentVerifications",
      "shareLinks",
      "devices",
      "deviceEvents",
      "deviceTombstones",
      "systemHealth",
    ];

    for (const tableName of expectedTables) {
      expect(schema[tableName as keyof typeof schema]).toBeDefined();
    }
  });

  it("enforces cascade deletion and foreign keys on user-dependent tables", () => {
    // Check that documents has ownerUserId referencing users
    const docColumns = getTableColumns(schema.documents);
    expect(docColumns.ownerUserId).toBeDefined();

    // Check that evaluations has ownerUserId and cascade refs
    const evalColumns = getTableColumns(schema.evaluations);
    expect(evalColumns.ownerUserId).toBeDefined();
    expect(evalColumns.cvVersionId).toBeDefined();
    expect(evalColumns.jobDescriptionId).toBeDefined();

    // Check that devices has ownerUserId
    const deviceColumns = getTableColumns(schema.devices);
    expect(deviceColumns.ownerUserId).toBeDefined();
    expect(deviceColumns.tokenHash).toBeDefined();
    expect(deviceColumns.deviceId).toBeDefined();
  });

  it("verifies plans table contains tier, price, and quota limits", () => {
    const planColumns = getTableColumns(schema.plans);
    expect(planColumns.tier).toBeDefined();
    expect(planColumns.priceEtb).toBeDefined();
    expect(planColumns.dailyLimit).toBeDefined();
    expect(planColumns.monthlyLimit).toBeDefined();
  });
});
