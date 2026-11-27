import { describe, it, expect } from "vitest";
import { createHash, createPrivateKey, sign as nodeSign } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import {
  ACCOUNT_DISCRIMINATORS,
  IX_DISCRIMINATORS,
  buildClaimBountyIx,
  buildCreateBountyEscrowIx,
  buildInitProfileIx,
  buildInitializeConfigIx,
  buildMintCredentialIx,
  buildRecordEvaluationIx,
  buildUpdateEvaluationAfterDefenseIx,
  buildWithdrawExpiredEscrowIx,
  bytes16ToUuid,
  deriveClaimReceiptPda,
  deriveConfigPda,
  deriveEscrowPda,
  deriveEscrowVaultPda,
  deriveEvaluationPda,
  deriveProfilePda,
  uuidToBytes16,
} from "@/lib/solana/codec";
import {
  buildCanonicalReportPayload,
  canonicalizeJson,
  computeCanonicalReportHash,
  extractCanonicalAgentScoresFromRuns,
  extractVerifiedSkills,
  getScoreTierLabel,
} from "@/lib/solana/canonical-hash";
import {
  buildWalletLinkMessage,
  bytesToBase64,
  parseWalletLinkMessage,
  verifySolanaWalletSignature,
} from "@/lib/solana/signature";
import { validateEnv } from "@/lib/env";
import { bounties, bountyClaims, evaluations, userProfiles } from "@/lib/db/schema";

interface IdlEntry {
  name: string;
  accounts?: unknown[];
}

function toSnakeCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

describe("Solana Protocol Integration & Crypto Primitives", () => {
  it("matches all Anchor IDL instruction & account SHA-256 discriminators", () => {
    const idlPath = path.resolve(process.cwd(), "solana/idl/coov_solana.json");
    const idl = JSON.parse(readFileSync(idlPath, "utf8")) as {
      name: string;
      instructions: IdlEntry[];
      accounts: IdlEntry[];
    };

    expect(idl.name).toBe("coov_protocol");

    for (const ix of idl.instructions) {
      const preimage = `global:${toSnakeCase(ix.name)}`;
      const expectedDisc = createHash("sha256").update(preimage).digest().subarray(0, 8);
      const actual = IX_DISCRIMINATORS[ix.name as keyof typeof IX_DISCRIMINATORS];
      expect(actual, `Missing IX_DISCRIMINATORS.${ix.name}`).toBeDefined();
      expect(Array.from(actual)).toEqual(Array.from(expectedDisc));
    }

    for (const acc of idl.accounts) {
      const preimage = `account:${acc.name}`;
      const expectedDisc = createHash("sha256").update(preimage).digest().subarray(0, 8);
      const actual = ACCOUNT_DISCRIMINATORS[acc.name as keyof typeof ACCOUNT_DISCRIMINATORS];
      expect(actual, `Missing ACCOUNT_DISCRIMINATORS.${acc.name}`).toBeDefined();
      expect(Array.from(actual)).toEqual(Array.from(expectedDisc));
    }
  });

  it("round-trips 128-bit UUIDs and derives deterministic PDAs matching program seeds", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const bytes = uuidToBytes16(uuid);
    expect(bytes).toHaveLength(16);
    expect(bytes16ToUuid(bytes)).toBe(uuid);

    const candidate = Keypair.generate().publicKey;
    const [cfgPda] = deriveConfigPda();
    const [profilePda] = deriveProfilePda(candidate);
    const [evalPda] = deriveEvaluationPda(candidate, uuid);
    const [escrowPda] = deriveEscrowPda(uuid);
    const [vaultPda] = deriveEscrowVaultPda(escrowPda);
    const [claimPda] = deriveClaimReceiptPda(escrowPda, candidate);

    expect(cfgPda.toBase58()).toHaveLength(44);
    expect(profilePda.equals(deriveProfilePda(candidate)[0])).toBe(true);
    expect(evalPda.equals(deriveEvaluationPda(candidate, bytes)[0])).toBe(true);
    expect(escrowPda.equals(deriveEscrowPda(bytes)[0])).toBe(true);
    expect(vaultPda).not.toEqual(escrowPda);
    expect(claimPda).not.toEqual(escrowPda);
  });

  it("constructs valid Borsh instruction buffers for every Anchor instruction", () => {
    const admin = Keypair.generate().publicKey;
    const oracle = Keypair.generate().publicKey;
    const candidate = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const usdcMint = Keypair.generate().publicKey;
    const evalId = "550e8400-e29b-41d4-a716-446655440000";
    const jobId = "123e4567-e89b-12d3-a456-426614174000";
    const hashHex = "ab".repeat(32);

    const initCfg = buildInitializeConfigIx({ admin, oracleAuthority: oracle });
    expect(initCfg.data.subarray(0, 8)).toEqual(Buffer.from(IX_DISCRIMINATORS.initializeConfig));
    expect(initCfg.data.length).toBe(8 + 32);

    const initProf = buildInitProfileIx({ candidate });
    expect(initProf.data).toEqual(Buffer.from(IX_DISCRIMINATORS.initProfile));

    const recordIx = buildRecordEvaluationIx({
      oracleAuthority: oracle,
      candidate,
      evalId,
      jobId,
      reportHashHex: hashHex,
      compositeScore: 91,
      agentScores: [90, 94, 88, 92, 89, 93],
      modelVersion: "gemini-2.5-flash",
      roleTitle: "Senior Rust Engineer",
      verifiedSkills: ["Rust", "Solana", "TypeScript"],
    });
    expect(recordIx.data.subarray(0, 8)).toEqual(Buffer.from(IX_DISCRIMINATORS.recordEvaluation));
    expect(recordIx.keys).toHaveLength(6);

    const defenseIx = buildUpdateEvaluationAfterDefenseIx({
      oracleAuthority: oracle,
      candidate,
      evalId,
      newReportHashHex: "cd".repeat(32),
      newCompositeScore: 96,
    });
    expect(defenseIx.data.subarray(0, 8)).toEqual(
      Buffer.from(IX_DISCRIMINATORS.updateEvaluationAfterDefense)
    );
    expect(defenseIx.data.length).toBe(8 + 32 + 1);

    const mintIx = buildMintCredentialIx({
      oracleAuthority: oracle,
      candidate,
      evalId,
      mint,
      name: "COOV · Senior Rust Engineer",
      symbol: "COOV-SBT",
      uri: "https://coov.app/verify/test",
      roleTitle: "Senior Rust Engineer",
      scoreTier: "Tier S (96/100)",
    });
    expect(mintIx.data.subarray(0, 8)).toEqual(Buffer.from(IX_DISCRIMINATORS.mintCredential));
    expect(mintIx.keys).toHaveLength(9);

    const escrowIx = buildCreateBountyEscrowIx({
      recruiter: admin,
      usdcMint,
      jobId,
      minScore: 85,
      rewardPerWinnerMicros: 20_000_000,
      maxWinners: 5,
      expiresAtUnix: 1_900_000_000,
    });
    expect(escrowIx.data.subarray(0, 8)).toEqual(
      Buffer.from(IX_DISCRIMINATORS.createBountyEscrow)
    );
    expect(escrowIx.data.length).toBe(8 + 16 + 1 + 8 + 2 + 8);

    const claimIx = buildClaimBountyIx({ candidate, usdcMint, jobId, evalId });
    expect(claimIx.data).toEqual(Buffer.from(IX_DISCRIMINATORS.claimBounty));
    expect(claimIx.keys).toHaveLength(9);

    const withdrawIx = buildWithdrawExpiredEscrowIx({ recruiter: admin, usdcMint, jobId });
    expect(withdrawIx.data).toEqual(Buffer.from(IX_DISCRIMINATORS.withdrawExpiredEscrow));
    expect(withdrawIx.keys).toHaveLength(6);
  });

  it("computes deterministic PII-redacted canonical SHA-256 report hashes", async () => {
    const a = canonicalizeJson({ z: 1, a: { c: 3, b: 2 }, skip: undefined });
    const b = canonicalizeJson({ a: { b: 2, c: 3 }, z: 1 });
    expect(a).toBe(b);

    const agentScores = extractCanonicalAgentScoresFromRuns([
      { agentRole: "hr_recruiter", scoreContribution: 88 },
      { agentRole: "technical_interviewer", scoreContribution: 92 },
      { agentRole: "ats_scanner", scoreContribution: 85 },
      { agentRole: "hiring_manager", scoreContribution: 90 },
      { agentRole: "career_strategist", scoreContribution: 87 },
      { agentRole: "red_flag_analyst", scoreContribution: 89 },
    ]);

    const payload1 = buildCanonicalReportPayload({
      evaluationId: "eval-1",
      jobDescriptionId: "jd-1",
      overallScore: 89,
      verdict: "Strong fit",
      confidence: 0.91,
      dimensions: {
        roleFit: 90,
        skillsAndEvidence: 91,
        atsAlignment: 85,
        impactAndClarity: 88,
        professionalPresentation: 89,
      },
      explanation: "Contact candidate@example.com for architecture details.",
      strengths: ["Rust & Anchor"],
      weaknesses: ["None"],
      prioritizedFixes: [],
      redFlags: [],
      atsSummary: { keywordCoverage: 85, matched: ["Rust", "Solana"], partial: [], missing: [] },
      agentScores,
      modelVersion: "gemini-2.5-flash",
      defenseRevisionsCount: 0,
    });

    const payload2 = buildCanonicalReportPayload({
      evaluationId: "eval-1",
      jobDescriptionId: "jd-1",
      overallScore: 89,
      verdict: "Strong fit",
      confidence: 0.91,
      dimensions: {
        roleFit: 90,
        skillsAndEvidence: 91,
        atsAlignment: 85,
        impactAndClarity: 88,
        professionalPresentation: 89,
      },
      explanation: "Contact other@example.com for architecture details.",
      strengths: ["Rust & Anchor"],
      weaknesses: ["None"],
      prioritizedFixes: [],
      redFlags: [],
      atsSummary: { keywordCoverage: 85, matched: ["Rust", "Solana"], partial: [], missing: [] },
      agentScores,
      modelVersion: "gemini-2.5-flash",
      defenseRevisionsCount: 0,
    });

    // Both PII emails redact to [EMAIL_REDACTED], yielding the exact same canonical hash!
    const h1 = await computeCanonicalReportHash(payload1);
    const h2 = await computeCanonicalReportHash(payload2);
    expect(h1.hashHex).toHaveLength(64);
    expect(h1.hashHex).toBe(h2.hashHex);
    expect(payload1.explanation).not.toContain("candidate@example.com");

    expect(getScoreTierLabel(95)).toBe("Tier S (95/100)");
    expect(getScoreTierLabel(85)).toBe("Tier A (85/100)");
    expect(
      extractVerifiedSkills(["Rust", "rust", "A".repeat(30), "TypeScript"])
    ).toEqual(["Rust", "A".repeat(24), "TypeScript"]);
  });

  it("verifies real Ed25519 Solana wallet link signatures using WebCrypto", async () => {
    const kp = Keypair.generate();
    const walletAddress = kp.publicKey.toBase58();
    const message = buildWalletLinkMessage({
      userId: "user-test-123",
      walletAddress,
      issuedAt: "2026-11-27T20:00:00.000Z",
      nonce: "nonce-abc",
    });

    const parsed = parseWalletLinkMessage(message);
    expect(parsed).toEqual({
      userId: "user-test-123",
      walletAddress,
      issuedAt: "2026-11-27T20:00:00.000Z",
      nonce: "nonce-abc",
    });

    // Derive Node PKCS8 Ed25519 private key from the 32-byte seed of Keypair
    const seed = kp.secretKey.subarray(0, 32);
    const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
    const privKey = createPrivateKey({
      key: Buffer.concat([pkcs8Prefix, Buffer.from(seed)]),
      format: "der",
      type: "pkcs8",
    });

    const sig = nodeSign(null, Buffer.from(message, "utf8"), privKey);
    const valid = await verifySolanaWalletSignature({
      walletAddress,
      message,
      signatureBase64: bytesToBase64(new Uint8Array(sig)),
    });
    expect(valid).toBe(true);

    const tampered = await verifySolanaWalletSignature({
      walletAddress,
      message: `${message}\nTampered`,
      signatureBase64: bytesToBase64(new Uint8Array(sig)),
    });
    expect(tampered).toBe(false);
  });

  it("exposes expected Drizzle columns & Solana env defaults", () => {
    expect(userProfiles.walletAddress.name).toBe("wallet_address");
    expect(userProfiles.profilePdaAddress.name).toBe("profile_pda_address");
    expect(evaluations.evalPdaAddress.name).toBe("eval_pda_address");
    expect(evaluations.sbtMintAddress.name).toBe("sbt_mint_address");
    expect(evaluations.canonicalReportHash.name).toBe("canonical_report_hash");
    expect(bounties.escrowPdaAddress.name).toBe("escrow_pda_address");
    expect(bountyClaims.claimReceiptPda.name).toBe("claim_receipt_pda");

    const env = validateEnv({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/coov",
      AI_PROVIDER: "mock",
    });
    expect(env.SOLANA_CLUSTER).toBe("devnet");
    expect(env.NEXT_PUBLIC_SOLANA_USDC_MINT).toBe(
      "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
    );
  });
});
