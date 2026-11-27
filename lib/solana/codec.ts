import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { getProgramId } from "./config";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// Precomputed Anchor 8-byte discriminators verified against solana/idl/coov_solana.json
export const IX_DISCRIMINATORS = {
  initializeConfig: Uint8Array.from([208, 127, 21, 1, 194, 190, 196, 70]),
  updateConfig: Uint8Array.from([29, 158, 252, 191, 10, 83, 219, 99]),
  initProfile: Uint8Array.from([210, 162, 212, 95, 95, 186, 89, 119]),
  recordEvaluation: Uint8Array.from([6, 188, 15, 253, 99, 31, 113, 216]),
  updateEvaluationAfterDefense: Uint8Array.from([191, 136, 98, 216, 89, 15, 151, 184]),
  mintCredential: Uint8Array.from([136, 108, 131, 240, 163, 102, 204, 13]),
  createBountyEscrow: Uint8Array.from([2, 150, 71, 243, 196, 17, 75, 107]),
  claimBounty: Uint8Array.from([225, 157, 163, 238, 239, 169, 75, 226]),
  withdrawExpiredEscrow: Uint8Array.from([186, 176, 202, 176, 129, 180, 61, 69]),
} as const;

export const ACCOUNT_DISCRIMINATORS = {
  ProgramConfig: Uint8Array.from([196, 210, 90, 231, 144, 149, 140, 63]),
  CandidateProfile: Uint8Array.from([49, 166, 124, 251, 136, 193, 223, 251]),
  EvaluationRecord: Uint8Array.from([11, 75, 86, 83, 213, 40, 43, 130]),
  BountyEscrow: Uint8Array.from([59, 18, 13, 80, 225, 187, 6, 16]),
  BountyClaim: Uint8Array.from([130, 113, 6, 57, 79, 54, 78, 205]),
} as const;

// ============================================================================
// UUID / Bytes Helpers
// ============================================================================

export function uuidToBytes16(id: string): Uint8Array {
  const clean = id.replace(/-/g, "").toLowerCase();
  if (/^[0-9a-f]{32}$/.test(clean)) {
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }

  // Deterministic 16-byte fallback for non-UUID test strings
  const raw = textEncoder.encode(id);
  const out = new Uint8Array(16);
  for (let i = 0; i < raw.length; i++) {
    out[i % 16] = (out[i % 16] ^ raw[i] ^ ((i * 31) & 0xff)) & 0xff;
  }
  return out;
}

export function bytes16ToUuid(bytes: Uint8Array): string {
  const hex = bytesToHex(bytes.slice(0, 16));
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function hexToBytes32(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error("Expected 64-char hex SHA-256 string");
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

// ============================================================================
// PDA Derivations
// ============================================================================

export function deriveConfigPda(programId: PublicKey = getProgramId()): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([textEncoder.encode("config")], programId);
}

export function deriveProfilePda(
  candidate: PublicKey,
  programId: PublicKey = getProgramId()
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [textEncoder.encode("profile"), candidate.toBytes()],
    programId
  );
}

export function deriveEvaluationPda(
  candidate: PublicKey,
  evalId: string | Uint8Array,
  programId: PublicKey = getProgramId()
): [PublicKey, number] {
  const evalBytes = typeof evalId === "string" ? uuidToBytes16(evalId) : evalId;
  return PublicKey.findProgramAddressSync(
    [textEncoder.encode("eval"), candidate.toBytes(), evalBytes],
    programId
  );
}

export function deriveEscrowPda(
  jobId: string | Uint8Array,
  programId: PublicKey = getProgramId()
): [PublicKey, number] {
  const jobBytes = typeof jobId === "string" ? uuidToBytes16(jobId) : jobId;
  return PublicKey.findProgramAddressSync(
    [textEncoder.encode("escrow"), jobBytes],
    programId
  );
}

export function deriveEscrowVaultPda(
  escrow: PublicKey,
  programId: PublicKey = getProgramId()
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [textEncoder.encode("escrow_vault"), escrow.toBytes()],
    programId
  );
}

export function deriveClaimReceiptPda(
  escrow: PublicKey,
  candidate: PublicKey,
  programId: PublicKey = getProgramId()
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [textEncoder.encode("claim"), escrow.toBytes(), candidate.toBytes()],
    programId
  );
}

// ============================================================================
// Borsh Writer & Reader
// ============================================================================

class BorshWriter {
  private chunks: Uint8Array[] = [];

  writeBytes(bytes: Uint8Array): this {
    this.chunks.push(bytes);
    return this;
  }

  writeU8(v: number): this {
    this.chunks.push(Uint8Array.of(v & 0xff));
    return this;
  }

  writeU16(v: number): this {
    const buf = new Uint8Array(2);
    new DataView(buf.buffer).setUint16(0, v, true);
    this.chunks.push(buf);
    return this;
  }

  writeU32(v: number): this {
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, v, true);
    this.chunks.push(buf);
    return this;
  }

  writeU64(v: bigint | number): this {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setBigUint64(0, BigInt(v), true);
    this.chunks.push(buf);
    return this;
  }

  writeI64(v: bigint | number): this {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setBigInt64(0, BigInt(v), true);
    this.chunks.push(buf);
    return this;
  }

  writeString(s: string): this {
    const utf8 = textEncoder.encode(s);
    this.writeU32(utf8.length);
    this.chunks.push(utf8);
    return this;
  }

  writeStringVec(items: string[]): this {
    this.writeU32(items.length);
    for (const item of items) {
      this.writeString(item);
    }
    return this;
  }

  toBuffer(): Buffer {
    const total = this.chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return Buffer.from(out);
  }
}

class BorshReader {
  private view: DataView;
  private offset = 0;

  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  assertDiscriminator(expected: Uint8Array, label: string): void {
    if (this.data.length < 8) {
      throw new Error(`${label} account data too short`);
    }
    for (let i = 0; i < 8; i++) {
      if (this.data[i] !== expected[i]) {
        throw new Error(`${label} discriminator mismatch`);
      }
    }
    this.offset = 8;
  }

  readBytes(len: number): Uint8Array {
    const slice = this.data.subarray(this.offset, this.offset + len);
    this.offset += len;
    return slice;
  }

  readPubkey(): string {
    return new PublicKey(this.readBytes(32)).toBase58();
  }

  readBool(): boolean {
    const v = this.data[this.offset];
    this.offset += 1;
    return v !== 0;
  }

  readU8(): number {
    const v = this.data[this.offset];
    this.offset += 1;
    return v;
  }

  readU16(): number {
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  readU32(): number {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readU64(): bigint {
    const v = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return v;
  }

  readI64(): number {
    const v = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return Number(v);
  }

  readString(): string {
    const len = this.readU32();
    const bytes = this.readBytes(len);
    return textDecoder.decode(bytes);
  }

  readStringVec(): string[] {
    const count = this.readU32();
    const items: string[] = [];
    for (let i = 0; i < count; i++) {
      items.push(this.readString());
    }
    return items;
  }
}

// ============================================================================
// Instruction Builders
// ============================================================================

export function buildInitializeConfigIx(params: {
  admin: PublicKey;
  oracleAuthority: PublicKey;
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = params.programId ?? getProgramId();
  const [config] = deriveConfigPda(programId);

  const data = new BorshWriter()
    .writeBytes(IX_DISCRIMINATORS.initializeConfig)
    .writeBytes(params.oracleAuthority.toBytes())
    .toBuffer();

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.admin, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function buildInitProfileIx(params: {
  candidate: PublicKey;
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = params.programId ?? getProgramId();
  const [profile] = deriveProfilePda(params.candidate, programId);

  const data = new BorshWriter()
    .writeBytes(IX_DISCRIMINATORS.initProfile)
    .toBuffer();

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.candidate, isSigner: true, isWritable: true },
      { pubkey: profile, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function buildRecordEvaluationIx(params: {
  oracleAuthority: PublicKey;
  candidate: PublicKey;
  evalId: string;
  jobId: string;
  reportHashHex: string;
  compositeScore: number;
  agentScores: [number, number, number, number, number, number];
  modelVersion: string;
  roleTitle: string;
  verifiedSkills: string[];
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = params.programId ?? getProgramId();
  const evalBytes = uuidToBytes16(params.evalId);
  const jobBytes = uuidToBytes16(params.jobId);
  const reportHashBytes = hexToBytes32(params.reportHashHex);

  const [config] = deriveConfigPda(programId);
  const [profile] = deriveProfilePda(params.candidate, programId);
  const [evaluation] = deriveEvaluationPda(params.candidate, evalBytes, programId);

  const writer = new BorshWriter()
    .writeBytes(IX_DISCRIMINATORS.recordEvaluation)
    .writeBytes(evalBytes)
    .writeBytes(jobBytes)
    .writeBytes(reportHashBytes)
    .writeU8(Math.min(100, Math.max(0, Math.round(params.compositeScore))));

  for (const score of params.agentScores) {
    writer.writeU8(Math.min(100, Math.max(0, Math.round(score))));
  }

  writer
    .writeString(params.modelVersion.slice(0, 48))
    .writeString(params.roleTitle.slice(0, 64))
    .writeStringVec(params.verifiedSkills.slice(0, 8).map((s) => s.slice(0, 24)));

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: params.oracleAuthority, isSigner: true, isWritable: false },
      { pubkey: params.candidate, isSigner: true, isWritable: true },
      { pubkey: profile, isSigner: false, isWritable: true },
      { pubkey: evaluation, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: writer.toBuffer(),
  });
}

export function buildUpdateEvaluationAfterDefenseIx(params: {
  oracleAuthority: PublicKey;
  candidate: PublicKey;
  evalId: string;
  newReportHashHex: string;
  newCompositeScore: number;
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = params.programId ?? getProgramId();
  const evalBytes = uuidToBytes16(params.evalId);

  const [config] = deriveConfigPda(programId);
  const [profile] = deriveProfilePda(params.candidate, programId);
  const [evaluation] = deriveEvaluationPda(params.candidate, evalBytes, programId);

  const data = new BorshWriter()
    .writeBytes(IX_DISCRIMINATORS.updateEvaluationAfterDefense)
    .writeBytes(hexToBytes32(params.newReportHashHex))
    .writeU8(Math.min(100, Math.max(0, Math.round(params.newCompositeScore))))
    .toBuffer();

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: params.oracleAuthority, isSigner: true, isWritable: false },
      { pubkey: params.candidate, isSigner: true, isWritable: false },
      { pubkey: profile, isSigner: false, isWritable: true },
      { pubkey: evaluation, isSigner: false, isWritable: true },
    ],
    data,
  });
}

export function buildMintCredentialIx(params: {
  oracleAuthority: PublicKey;
  candidate: PublicKey;
  evalId: string;
  mint: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  roleTitle: string;
  scoreTier: string;
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = params.programId ?? getProgramId();
  const evalBytes = uuidToBytes16(params.evalId);

  const [config] = deriveConfigPda(programId);
  const [evaluation] = deriveEvaluationPda(params.candidate, evalBytes, programId);
  const candidateAta = getAssociatedTokenAddressSync(
    params.mint,
    params.candidate,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const data = new BorshWriter()
    .writeBytes(IX_DISCRIMINATORS.mintCredential)
    .writeString(params.name.slice(0, 64))
    .writeString(params.symbol.slice(0, 12))
    .writeString(params.uri.slice(0, 200))
    .writeString(params.roleTitle.slice(0, 64))
    .writeString(params.scoreTier.slice(0, 24))
    .toBuffer();

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: params.oracleAuthority, isSigner: true, isWritable: false },
      { pubkey: params.candidate, isSigner: true, isWritable: true },
      { pubkey: evaluation, isSigner: false, isWritable: true },
      { pubkey: params.mint, isSigner: true, isWritable: true },
      { pubkey: candidateAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function buildCreateBountyEscrowIx(params: {
  recruiter: PublicKey;
  usdcMint: PublicKey;
  jobId: string;
  minScore: number;
  rewardPerWinnerMicros: bigint | number;
  maxWinners: number;
  expiresAtUnix: number;
  tokenProgramId?: PublicKey;
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = params.programId ?? getProgramId();
  const tokenProgramId = params.tokenProgramId ?? TOKEN_PROGRAM_ID;
  const jobBytes = uuidToBytes16(params.jobId);

  const [config] = deriveConfigPda(programId);
  const [escrow] = deriveEscrowPda(jobBytes, programId);
  const [vault] = deriveEscrowVaultPda(escrow, programId);
  const recruiterTokenAccount = getAssociatedTokenAddressSync(
    params.usdcMint,
    params.recruiter,
    false,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const data = new BorshWriter()
    .writeBytes(IX_DISCRIMINATORS.createBountyEscrow)
    .writeBytes(jobBytes)
    .writeU8(params.minScore)
    .writeU64(params.rewardPerWinnerMicros)
    .writeU16(params.maxWinners)
    .writeI64(params.expiresAtUnix)
    .toBuffer();

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: params.recruiter, isSigner: true, isWritable: true },
      { pubkey: params.usdcMint, isSigner: false, isWritable: false },
      { pubkey: recruiterTokenAccount, isSigner: false, isWritable: true },
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function buildClaimBountyIx(params: {
  candidate: PublicKey;
  usdcMint: PublicKey;
  jobId: string;
  evalId: string;
  tokenProgramId?: PublicKey;
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = params.programId ?? getProgramId();
  const tokenProgramId = params.tokenProgramId ?? TOKEN_PROGRAM_ID;
  const jobBytes = uuidToBytes16(params.jobId);
  const evalBytes = uuidToBytes16(params.evalId);

  const [escrow] = deriveEscrowPda(jobBytes, programId);
  const [vault] = deriveEscrowVaultPda(escrow, programId);
  const candidateTokenAccount = getAssociatedTokenAddressSync(
    params.usdcMint,
    params.candidate,
    false,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const [evaluation] = deriveEvaluationPda(params.candidate, evalBytes, programId);
  const [claimReceipt] = deriveClaimReceiptPda(escrow, params.candidate, programId);

  const data = new BorshWriter()
    .writeBytes(IX_DISCRIMINATORS.claimBounty)
    .toBuffer();

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.candidate, isSigner: true, isWritable: true },
      { pubkey: params.usdcMint, isSigner: false, isWritable: false },
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: candidateTokenAccount, isSigner: false, isWritable: true },
      { pubkey: evaluation, isSigner: false, isWritable: false },
      { pubkey: claimReceipt, isSigner: false, isWritable: true },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function buildWithdrawExpiredEscrowIx(params: {
  recruiter: PublicKey;
  usdcMint: PublicKey;
  jobId: string;
  tokenProgramId?: PublicKey;
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = params.programId ?? getProgramId();
  const tokenProgramId = params.tokenProgramId ?? TOKEN_PROGRAM_ID;
  const jobBytes = uuidToBytes16(params.jobId);

  const [escrow] = deriveEscrowPda(jobBytes, programId);
  const [vault] = deriveEscrowVaultPda(escrow, programId);
  const recruiterTokenAccount = getAssociatedTokenAddressSync(
    params.usdcMint,
    params.recruiter,
    false,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const data = new BorshWriter()
    .writeBytes(IX_DISCRIMINATORS.withdrawExpiredEscrow)
    .toBuffer();

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.recruiter, isSigner: true, isWritable: true },
      { pubkey: params.usdcMint, isSigner: false, isWritable: false },
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: recruiterTokenAccount, isSigner: false, isWritable: true },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ============================================================================
// Account Decoders
// ============================================================================

export interface DecodedProgramConfig {
  admin: string;
  oracleAuthority: string;
  paused: boolean;
  bump: number;
}

export function decodeProgramConfig(data: Uint8Array): DecodedProgramConfig {
  const r = new BorshReader(data);
  r.assertDiscriminator(ACCOUNT_DISCRIMINATORS.ProgramConfig, "ProgramConfig");
  return {
    admin: r.readPubkey(),
    oracleAuthority: r.readPubkey(),
    paused: r.readBool(),
    bump: r.readU8(),
  };
}

export interface DecodedCandidateProfile {
  wallet: string;
  evalCount: number;
  highestScore: number;
  topSkills: string[];
  lastRoleTitle: string;
  updatedAt: number;
  bump: number;
}

export function decodeCandidateProfile(data: Uint8Array): DecodedCandidateProfile {
  const r = new BorshReader(data);
  r.assertDiscriminator(ACCOUNT_DISCRIMINATORS.CandidateProfile, "CandidateProfile");
  return {
    wallet: r.readPubkey(),
    evalCount: r.readU32(),
    highestScore: r.readU8(),
    topSkills: r.readStringVec(),
    lastRoleTitle: r.readString(),
    updatedAt: r.readI64(),
    bump: r.readU8(),
  };
}

export interface DecodedEvaluationRecord {
  candidate: string;
  evalIdHex: string;
  evalIdUuid: string;
  jobIdHex: string;
  jobIdUuid: string;
  initialReportHash: string;
  currentReportHash: string;
  initialScore: number;
  compositeScore: number;
  agentScores: {
    hr_recruiter: number;
    technical_interviewer: number;
    ats_scanner: number;
    hiring_manager: number;
    career_strategist: number;
    red_flag_analyst: number;
  };
  defenseCount: number;
  sbtMinted: boolean;
  sbtMint: string;
  modelVersion: string;
  roleTitle: string;
  createdAt: number;
  updatedAt: number;
  bump: number;
}

export function decodeEvaluationRecord(data: Uint8Array): DecodedEvaluationRecord {
  const r = new BorshReader(data);
  r.assertDiscriminator(ACCOUNT_DISCRIMINATORS.EvaluationRecord, "EvaluationRecord");
  const candidate = r.readPubkey();
  const evalBytes = r.readBytes(16);
  const jobBytes = r.readBytes(16);
  const initialReportHash = bytesToHex(r.readBytes(32));
  const currentReportHash = bytesToHex(r.readBytes(32));
  const initialScore = r.readU8();
  const compositeScore = r.readU8();
  const rawAgentScores = r.readBytes(6);
  const defenseCount = r.readU8();
  const sbtMinted = r.readBool();
  const sbtMint = r.readPubkey();
  const modelVersion = r.readString();
  const roleTitle = r.readString();
  const createdAt = r.readI64();
  const updatedAt = r.readI64();
  const bump = r.readU8();

  return {
    candidate,
    evalIdHex: bytesToHex(evalBytes),
    evalIdUuid: bytes16ToUuid(evalBytes),
    jobIdHex: bytesToHex(jobBytes),
    jobIdUuid: bytes16ToUuid(jobBytes),
    initialReportHash,
    currentReportHash,
    initialScore,
    compositeScore,
    agentScores: {
      hr_recruiter: rawAgentScores[0],
      technical_interviewer: rawAgentScores[1],
      ats_scanner: rawAgentScores[2],
      hiring_manager: rawAgentScores[3],
      career_strategist: rawAgentScores[4],
      red_flag_analyst: rawAgentScores[5],
    },
    defenseCount,
    sbtMinted,
    sbtMint,
    modelVersion,
    roleTitle,
    createdAt,
    updatedAt,
    bump,
  };
}

export interface DecodedBountyEscrow {
  recruiter: string;
  jobIdHex: string;
  jobIdUuid: string;
  usdcMint: string;
  vault: string;
  rewardPerWinnerMicros: string;
  maxWinners: number;
  claimsCount: number;
  minScore: number;
  expiresAt: number;
  isClosed: boolean;
  bump: number;
  vaultBump: number;
}

export function decodeBountyEscrow(data: Uint8Array): DecodedBountyEscrow {
  const r = new BorshReader(data);
  r.assertDiscriminator(ACCOUNT_DISCRIMINATORS.BountyEscrow, "BountyEscrow");
  const recruiter = r.readPubkey();
  const jobBytes = r.readBytes(16);
  const usdcMint = r.readPubkey();
  const vault = r.readPubkey();
  const rewardPerWinnerMicros = r.readU64().toString();
  const maxWinners = r.readU16();
  const claimsCount = r.readU16();
  const minScore = r.readU8();
  const expiresAt = r.readI64();
  const isClosed = r.readBool();
  const bump = r.readU8();
  const vaultBump = r.readU8();

  return {
    recruiter,
    jobIdHex: bytesToHex(jobBytes),
    jobIdUuid: bytes16ToUuid(jobBytes),
    usdcMint,
    vault,
    rewardPerWinnerMicros,
    maxWinners,
    claimsCount,
    minScore,
    expiresAt,
    isClosed,
    bump,
    vaultBump,
  };
}

export interface DecodedBountyClaim {
  escrow: string;
  candidate: string;
  evaluation: string;
  amountPaidMicros: string;
  claimedAt: number;
  bump: number;
}

export function decodeBountyClaim(data: Uint8Array): DecodedBountyClaim {
  const r = new BorshReader(data);
  r.assertDiscriminator(ACCOUNT_DISCRIMINATORS.BountyClaim, "BountyClaim");
  return {
    escrow: r.readPubkey(),
    candidate: r.readPubkey(),
    evaluation: r.readPubkey(),
    amountPaidMicros: r.readU64().toString(),
    claimedAt: r.readI64(),
    bump: r.readU8(),
  };
}
