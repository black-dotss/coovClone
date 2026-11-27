import {
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  getTokenMetadata,
} from "@solana/spl-token";
import {
  confirmSignatureViaPolling,
  getExplorerAddressUrl,
  getExplorerTxUrl,
  getOracleKeypair,
  getProgramId,
  getSolanaCluster,
  getSolanaConnection,
  getUsdcMint,
} from "./config";
import {
  buildClaimBountyIx,
  buildCreateBountyEscrowIx,
  buildInitProfileIx,
  buildInitializeConfigIx,
  buildMintCredentialIx,
  buildRecordEvaluationIx,
  buildUpdateEvaluationAfterDefenseIx,
  buildWithdrawExpiredEscrowIx,
  decodeBountyClaim,
  decodeBountyEscrow,
  decodeCandidateProfile,
  decodeEvaluationRecord,
  decodeProgramConfig,
  deriveClaimReceiptPda,
  deriveConfigPda,
  deriveEscrowPda,
  deriveEscrowVaultPda,
  deriveEvaluationPda,
  deriveProfilePda,
  type DecodedBountyClaim,
  type DecodedBountyEscrow,
  type DecodedCandidateProfile,
  type DecodedEvaluationRecord,
  type DecodedProgramConfig,
} from "./codec";
import { bytesToBase64 } from "./signature";

const utf8Encoder = new TextEncoder();

function clampUtf8(input: string, maxBytes: number): string {
  let str = input.trim();
  while (utf8Encoder.encode(str).length > maxBytes && str.length > 0) {
    str = str.slice(0, -1);
  }
  return str.trim();
}

export interface WalletSoulboundCredential {
  mint: string;
  tokenAccount: string;
  name: string;
  symbol: string;
  uri: string;
  roleTitle: string | null;
  scoreTier: string | null;
  evalId: string | null;
  reportHash: string | null;
  issuedAt: string | null;
  updateAuthority: string | null;
  isCoovCredential: boolean;
  explorerUrl: string;
}

export async function fetchOnChainConfig(): Promise<{
  initialized: boolean;
  configPda: string;
  config: DecodedProgramConfig | null;
}> {
  const connection = getSolanaConnection();
  const programId = getProgramId();
  const [configPda] = deriveConfigPda(programId);
  const info = await connection.getAccountInfo(configPda, "confirmed");
  if (!info) {
    return {
      initialized: false,
      configPda: configPda.toBase58(),
      config: null,
    };
  }
  return {
    initialized: true,
    configPda: configPda.toBase58(),
    config: decodeProgramConfig(info.data),
  };
}

/**
 * One-time initialization of ProgramConfig PDA on Solana using COOV_ORACLE_PRIVATE_KEY
 * as both payer/admin and oracle_authority.
 */
export async function initializeProgramConfig(): Promise<{
  alreadyInitialized: boolean;
  configPda: string;
  oracleAuthority: string;
  admin: string;
  signature: string | null;
  explorerUrl: string;
  cluster: string;
}> {
  const connection = getSolanaConnection();
  const programId = getProgramId();
  const oracleKeypair = getOracleKeypair();
  const cluster = getSolanaCluster();
  const [configPda] = deriveConfigPda(programId);

  const existingInfo = await connection.getAccountInfo(configPda, "confirmed");
  if (existingInfo) {
    const decoded = decodeProgramConfig(existingInfo.data);
    if (decoded.oracleAuthority !== oracleKeypair.publicKey.toBase58()) {
      throw new Error(
        `ProgramConfig already initialized at ${configPda.toBase58()} with different oracleAuthority (${decoded.oracleAuthority} vs ${oracleKeypair.publicKey.toBase58()})`
      );
    }
    return {
      alreadyInitialized: true,
      configPda: configPda.toBase58(),
      oracleAuthority: decoded.oracleAuthority,
      admin: decoded.admin,
      signature: null,
      explorerUrl: getExplorerAddressUrl(configPda.toBase58(), cluster),
      cluster,
    };
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({
    feePayer: oracleKeypair.publicKey,
    blockhash,
    lastValidBlockHeight,
  }).add(
    buildInitializeConfigIx({
      admin: oracleKeypair.publicKey,
      oracleAuthority: oracleKeypair.publicKey,
      programId,
    })
  );

  tx.sign(oracleKeypair);
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  const confirmed = await confirmSignatureViaPolling(connection, signature, 60_000);
  if (!confirmed.confirmed) {
    throw new Error(
      `initialize_config tx ${signature} did not confirm: ${JSON.stringify(confirmed.err)}`
    );
  }

  return {
    alreadyInitialized: false,
    configPda: configPda.toBase58(),
    oracleAuthority: oracleKeypair.publicKey.toBase58(),
    admin: oracleKeypair.publicKey.toBase58(),
    signature,
    explorerUrl: getExplorerTxUrl(signature, cluster),
    cluster,
  };
}

/**
 * Prepares an unsigned `initialize_config` transaction paid by an admin wallet
 * (e.g., Phantom) while binding `oracle_authority` to COOV_ORACLE_PRIVATE_KEY.
 */
export async function prepareAdminInitializeConfigTx(adminWallet: string): Promise<{
  alreadyInitialized: boolean;
  serializedTxBase64: string | null;
  configPda: string;
  oracleAuthority: string;
}> {
  const connection = getSolanaConnection();
  const programId = getProgramId();
  const oracleKeypair = getOracleKeypair();
  const [configPda] = deriveConfigPda(programId);

  const existingInfo = await connection.getAccountInfo(configPda, "confirmed");
  if (existingInfo) {
    const decoded = decodeProgramConfig(existingInfo.data);
    return {
      alreadyInitialized: true,
      serializedTxBase64: null,
      configPda: configPda.toBase58(),
      oracleAuthority: decoded.oracleAuthority,
    };
  }

  const adminPubkey = new PublicKey(adminWallet);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({
    feePayer: adminPubkey,
    blockhash,
    lastValidBlockHeight,
  }).add(
    buildInitializeConfigIx({
      admin: adminPubkey,
      oracleAuthority: oracleKeypair.publicKey,
      programId,
    })
  );

  const serialized = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });

  return {
    alreadyInitialized: false,
    serializedTxBase64: bytesToBase64(serialized),
    configPda: configPda.toBase58(),
    oracleAuthority: oracleKeypair.publicKey.toBase58(),
  };
}

async function assertInitializedOracle(): Promise<{
  oracleKeypair: Keypair;
  programId: PublicKey;
  configPda: PublicKey;
}> {
  const connection = getSolanaConnection();
  const programId = getProgramId();
  const oracleKeypair = getOracleKeypair();
  const [configPda] = deriveConfigPda(programId);

  const info = await connection.getAccountInfo(configPda, "confirmed");
  if (!info) {
    throw new Error(
      `COOV ProgramConfig PDA (${configPda.toBase58()}) is not initialized yet. Run scripts/init-solana-config.ts first.`
    );
  }
  const config = decodeProgramConfig(info.data);
  if (config.paused) {
    throw new Error("COOV Solana protocol is currently paused in ProgramConfig.");
  }
  if (config.oracleAuthority !== oracleKeypair.publicKey.toBase58()) {
    throw new Error(
      `Configured COOV_ORACLE_PRIVATE_KEY (${oracleKeypair.publicKey.toBase58()}) does not match on-chain oracle_authority (${config.oracleAuthority}).`
    );
  }

  return { oracleKeypair, programId, configPda };
}

/**
 * Prepares a partially oracle-signed transaction to initialize the candidate's
 * profile PDA (if needed) and record the evaluation proof PDA on-chain.
 * The candidate wallet signs and pays tx fees + PDA rent via Wallet Standard.
 */
export async function prepareAnchorEvaluationTx(params: {
  candidateWallet: string;
  evalId: string;
  jobId: string;
  reportHashHex: string;
  compositeScore: number;
  agentScores: [number, number, number, number, number, number];
  modelVersion: string;
  roleTitle: string;
  verifiedSkills: string[];
}): Promise<{
  serializedTxBase64: string;
  profilePda: string;
  evalPda: string;
  includesInitProfile: boolean;
  oraclePublicKey: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}> {
  const connection = getSolanaConnection();
  const { oracleKeypair, programId } = await assertInitializedOracle();
  const candidatePubkey = new PublicKey(params.candidateWallet);

  const [profilePda] = deriveProfilePda(candidatePubkey, programId);
  const [evalPda] = deriveEvaluationPda(candidatePubkey, params.evalId, programId);

  const [profileInfo, evalInfo] = await Promise.all([
    connection.getAccountInfo(profilePda, "confirmed"),
    connection.getAccountInfo(evalPda, "confirmed"),
  ]);

  if (evalInfo) {
    throw new Error(
      `Evaluation proof PDA (${evalPda.toBase58()}) is already anchored on-chain.`
    );
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({
    feePayer: candidatePubkey,
    blockhash,
    lastValidBlockHeight,
  });

  if (!profileInfo) {
    tx.add(
      buildInitProfileIx({
        candidate: candidatePubkey,
        programId,
      })
    );
  }

  tx.add(
    buildRecordEvaluationIx({
      oracleAuthority: oracleKeypair.publicKey,
      candidate: candidatePubkey,
      evalId: params.evalId,
      jobId: params.jobId,
      reportHashHex: params.reportHashHex,
      compositeScore: params.compositeScore,
      agentScores: params.agentScores,
      modelVersion: clampUtf8(params.modelVersion || "gemini-3.5-flash", 48),
      roleTitle: clampUtf8(params.roleTitle || "Candidate Role", 64),
      verifiedSkills: params.verifiedSkills
        .map((s) => clampUtf8(s, 24))
        .filter(Boolean)
        .slice(0, 8),
      programId,
    })
  );

  tx.partialSign(oracleKeypair);
  const serialized = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });

  return {
    serializedTxBase64: bytesToBase64(serialized),
    profilePda: profilePda.toBase58(),
    evalPda: evalPda.toBase58(),
    includesInitProfile: !profileInfo,
    oraclePublicKey: oracleKeypair.publicKey.toBase58(),
    recentBlockhash: blockhash,
    lastValidBlockHeight,
  };
}

/**
 * Prepares a partially oracle-signed transaction to update an already-anchored
 * EvaluationRecord PDA after a Defense reassessment changes score/hash.
 */
export async function prepareDefenseUpdateTx(params: {
  candidateWallet: string;
  evalId: string;
  newReportHashHex: string;
  newCompositeScore: number;
}): Promise<{
  serializedTxBase64: string;
  profilePda: string;
  evalPda: string;
  oraclePublicKey: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}> {
  const connection = getSolanaConnection();
  const { oracleKeypair, programId } = await assertInitializedOracle();
  const candidatePubkey = new PublicKey(params.candidateWallet);

  const [profilePda] = deriveProfilePda(candidatePubkey, programId);
  const [evalPda] = deriveEvaluationPda(candidatePubkey, params.evalId, programId);

  const evalInfo = await connection.getAccountInfo(evalPda, "confirmed");
  if (!evalInfo) {
    throw new Error(
      `Evaluation proof PDA (${evalPda.toBase58()}) has not been anchored on-chain yet.`
    );
  }
  const existingEval = decodeEvaluationRecord(evalInfo.data);
  if (
    existingEval.currentReportHash === params.newReportHashHex.toLowerCase() &&
    existingEval.compositeScore === Math.round(params.newCompositeScore)
  ) {
    throw new Error("On-chain evaluation proof is already up to date with this Defense score and hash.");
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({
    feePayer: candidatePubkey,
    blockhash,
    lastValidBlockHeight,
  }).add(
    buildUpdateEvaluationAfterDefenseIx({
      oracleAuthority: oracleKeypair.publicKey,
      candidate: candidatePubkey,
      evalId: params.evalId,
      newReportHashHex: params.newReportHashHex,
      newCompositeScore: params.newCompositeScore,
      programId,
    })
  );

  tx.partialSign(oracleKeypair);
  const serialized = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });

  return {
    serializedTxBase64: bytesToBase64(serialized),
    profilePda: profilePda.toBase58(),
    evalPda: evalPda.toBase58(),
    oraclePublicKey: oracleKeypair.publicKey.toBase58(),
    recentBlockhash: blockhash,
    lastValidBlockHeight,
  };
}

/**
 * Prepares a partially signed transaction to mint a Token-2022 Non-Transferable
 * Soulbound Credential (SBT) directly to the candidate's wallet for scores >= 85.
 * Server partial-signs with oracleKeypair + fresh ephemeral mintKeypair.
 */
export async function prepareMintCredentialTx(params: {
  candidateWallet: string;
  evalId: string;
  name: string;
  symbol?: string;
  uri: string;
  roleTitle: string;
  scoreTier: string;
}): Promise<{
  serializedTxBase64: string;
  sbtMintAddress: string;
  evalPda: string;
  oraclePublicKey: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}> {
  const connection = getSolanaConnection();
  const { oracleKeypair, programId } = await assertInitializedOracle();
  const candidatePubkey = new PublicKey(params.candidateWallet);

  const [evalPda] = deriveEvaluationPda(candidatePubkey, params.evalId, programId);
  const evalInfo = await connection.getAccountInfo(evalPda, "confirmed");
  if (!evalInfo) {
    throw new Error(
      "Evaluation must be anchored on-chain before minting its Soulbound Credential."
    );
  }
  const decodedEval = decodeEvaluationRecord(evalInfo.data);
  if (decodedEval.sbtMinted) {
    throw new Error(
      `Soulbound Credential already minted for this evaluation (${decodedEval.sbtMint}).`
    );
  }
  if (decodedEval.compositeScore < 85) {
    throw new Error(
      `Score ${decodedEval.compositeScore}/100 does not meet the 85/100 Soulbound threshold.`
    );
  }

  const mintKeypair = Keypair.generate();
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

  const tx = new Transaction({
    feePayer: candidatePubkey,
    blockhash,
    lastValidBlockHeight,
  }).add(
    buildMintCredentialIx({
      oracleAuthority: oracleKeypair.publicKey,
      candidate: candidatePubkey,
      evalId: params.evalId,
      mint: mintKeypair.publicKey,
      name: clampUtf8(params.name, 64),
      symbol: clampUtf8(params.symbol || "COOV-SBT", 12),
      uri: clampUtf8(params.uri, 200),
      roleTitle: clampUtf8(params.roleTitle, 64),
      scoreTier: clampUtf8(params.scoreTier, 24),
      programId,
    })
  );

  tx.partialSign(oracleKeypair, mintKeypair);
  const serialized = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });

  return {
    serializedTxBase64: bytesToBase64(serialized),
    sbtMintAddress: mintKeypair.publicKey.toBase58(),
    evalPda: evalPda.toBase58(),
    oraclePublicKey: oracleKeypair.publicKey.toBase58(),
    recentBlockhash: blockhash,
    lastValidBlockHeight,
  };
}

async function resolveUsdcTokenProgram(usdcMint: PublicKey): Promise<PublicKey> {
  const connection = getSolanaConnection();
  const mintInfo = await connection.getAccountInfo(usdcMint, "confirmed");
  if (!mintInfo) {
    throw new Error(`USDC mint account (${usdcMint.toBase58()}) not found on cluster.`);
  }
  return mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
}

/**
 * Prepares an unsigned transaction for a recruiter to fund a multi-winner Devnet USDC bounty escrow.
 */
export async function prepareCreateBountyEscrowTx(params: {
  recruiterWallet: string;
  jobId: string;
  minScore: number;
  rewardPerWinnerMicros: bigint | number;
  maxWinners: number;
  expiresAtUnix: number;
}): Promise<{
  serializedTxBase64: string;
  escrowPda: string;
  vaultPda: string;
  usdcMint: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}> {
  const connection = getSolanaConnection();
  const programId = getProgramId();
  const usdcMint = getUsdcMint();
  const recruiterPubkey = new PublicKey(params.recruiterWallet);
  const tokenProgramId = await resolveUsdcTokenProgram(usdcMint);

  const [escrowPda] = deriveEscrowPda(params.jobId, programId);
  const [vaultPda] = deriveEscrowVaultPda(escrowPda, programId);

  const existingEscrow = await connection.getAccountInfo(escrowPda, "confirmed");
  if (existingEscrow) {
    throw new Error(`Bounty escrow PDA (${escrowPda.toBase58()}) already exists for this job.`);
  }

  const recruiterAta = getAssociatedTokenAddressSync(
    usdcMint,
    recruiterPubkey,
    false,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const ataInfo = await connection.getAccountInfo(recruiterAta, "confirmed");
  if (!ataInfo) {
    throw new Error(
      `Your wallet (${params.recruiterWallet}) has no Devnet USDC token account (${usdcMint.toBase58()}).`
    );
  }
  const balance = await connection.getTokenAccountBalance(recruiterAta, "confirmed");
  const availableMicros = BigInt(balance.value.amount || "0");
  const requiredMicros = BigInt(params.rewardPerWinnerMicros) * BigInt(params.maxWinners);
  if (availableMicros < requiredMicros) {
    const reqUsdc = (Number(requiredMicros) / 1_000_000).toFixed(2);
    const haveUsdc = (Number(availableMicros) / 1_000_000).toFixed(2);
    throw new Error(
      `Insufficient Devnet USDC balance: need ${reqUsdc} USDC to fund pool, wallet has ${haveUsdc} USDC.`
    );
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({
    feePayer: recruiterPubkey,
    blockhash,
    lastValidBlockHeight,
  }).add(
    buildCreateBountyEscrowIx({
      recruiter: recruiterPubkey,
      usdcMint,
      jobId: params.jobId,
      minScore: params.minScore,
      rewardPerWinnerMicros: params.rewardPerWinnerMicros,
      maxWinners: params.maxWinners,
      expiresAtUnix: params.expiresAtUnix,
      tokenProgramId,
      programId,
    })
  );

  const serialized = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });

  return {
    serializedTxBase64: bytesToBase64(serialized),
    escrowPda: escrowPda.toBase58(),
    vaultPda: vaultPda.toBase58(),
    usdcMint: usdcMint.toBase58(),
    recentBlockhash: blockhash,
    lastValidBlockHeight,
  };
}

/**
 * Prepares an unsigned transaction for a qualified candidate to claim their USDC payout
 * from the bounty escrow PDA (idempotently creates candidate's USDC ATA if missing).
 */
export async function prepareClaimBountyTx(params: {
  candidateWallet: string;
  jobId: string;
  evalId: string;
}): Promise<{
  serializedTxBase64: string;
  escrowPda: string;
  claimReceiptPda: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}> {
  const connection = getSolanaConnection();
  const programId = getProgramId();
  const usdcMint = getUsdcMint();
  const candidatePubkey = new PublicKey(params.candidateWallet);
  const tokenProgramId = await resolveUsdcTokenProgram(usdcMint);

  const [escrowPda] = deriveEscrowPda(params.jobId, programId);
  const [evalPda] = deriveEvaluationPda(candidatePubkey, params.evalId, programId);
  const [claimReceiptPda] = deriveClaimReceiptPda(escrowPda, candidatePubkey, programId);

  const [escrowInfo, evalInfo, existingClaim] = await Promise.all([
    connection.getAccountInfo(escrowPda, "confirmed"),
    connection.getAccountInfo(evalPda, "confirmed"),
    connection.getAccountInfo(claimReceiptPda, "confirmed"),
  ]);

  if (!escrowInfo) {
    throw new Error("On-chain bounty escrow account was not found.");
  }
  const escrow = decodeBountyEscrow(escrowInfo.data);
  if (escrow.isClosed) {
    throw new Error("This bounty escrow has already been closed.");
  }
  if (escrow.claimsCount >= escrow.maxWinners) {
    throw new Error("All winner slots for this bounty have already been claimed.");
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec > escrow.expiresAt) {
    throw new Error("This bounty has expired and can no longer be claimed.");
  }

  if (!evalInfo) {
    throw new Error(
      "Your evaluation must be anchored on-chain before you can claim a USDC bounty."
    );
  }
  const decodedEval = decodeEvaluationRecord(evalInfo.data);
  if (decodedEval.compositeScore < escrow.minScore) {
    throw new Error(
      `Your on-chain score (${decodedEval.compositeScore}/100) is below the bounty minimum (${escrow.minScore}/100).`
    );
  }
  if (existingClaim) {
    throw new Error("This wallet has already claimed its USDC payout for this bounty.");
  }

  const candidateAta = getAssociatedTokenAddressSync(
    usdcMint,
    candidatePubkey,
    false,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({
    feePayer: candidatePubkey,
    blockhash,
    lastValidBlockHeight,
  })
    .add(
      createAssociatedTokenAccountIdempotentInstruction(
        candidatePubkey,
        candidateAta,
        candidatePubkey,
        usdcMint,
        tokenProgramId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    )
    .add(
      buildClaimBountyIx({
        candidate: candidatePubkey,
        usdcMint,
        jobId: params.jobId,
        evalId: params.evalId,
        tokenProgramId,
        programId,
      })
    );

  const serialized = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });

  return {
    serializedTxBase64: bytesToBase64(serialized),
    escrowPda: escrowPda.toBase58(),
    claimReceiptPda: claimReceiptPda.toBase58(),
    recentBlockhash: blockhash,
    lastValidBlockHeight,
  };
}

/**
 * Prepares an unsigned transaction for the bounty creator to withdraw remaining
 * USDC and close the escrow vault after `expiresAt`.
 */
export async function prepareWithdrawExpiredEscrowTx(params: {
  recruiterWallet: string;
  jobId: string;
}): Promise<{
  serializedTxBase64: string;
  escrowPda: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}> {
  const connection = getSolanaConnection();
  const programId = getProgramId();
  const usdcMint = getUsdcMint();
  const recruiterPubkey = new PublicKey(params.recruiterWallet);
  const tokenProgramId = await resolveUsdcTokenProgram(usdcMint);

  const [escrowPda] = deriveEscrowPda(params.jobId, programId);
  const escrowInfo = await connection.getAccountInfo(escrowPda, "confirmed");
  if (!escrowInfo) {
    throw new Error("On-chain bounty escrow account was not found.");
  }
  const escrow = decodeBountyEscrow(escrowInfo.data);
  if (escrow.isClosed) {
    throw new Error("This bounty escrow is already closed.");
  }
  if (escrow.recruiter !== recruiterPubkey.toBase58()) {
    throw new Error("Only the original recruiter wallet can refund this bounty escrow.");
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec <= escrow.expiresAt) {
    throw new Error("Bounty escrow cannot be refunded until after its expiration timestamp.");
  }

  const recruiterAta = getAssociatedTokenAddressSync(
    usdcMint,
    recruiterPubkey,
    false,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({
    feePayer: recruiterPubkey,
    blockhash,
    lastValidBlockHeight,
  })
    .add(
      createAssociatedTokenAccountIdempotentInstruction(
        recruiterPubkey,
        recruiterAta,
        recruiterPubkey,
        usdcMint,
        tokenProgramId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    )
    .add(
      buildWithdrawExpiredEscrowIx({
        recruiter: recruiterPubkey,
        usdcMint,
        jobId: params.jobId,
        tokenProgramId,
        programId,
      })
    );

  const serialized = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });

  return {
    serializedTxBase64: bytesToBase64(serialized),
    escrowPda: escrowPda.toBase58(),
    recentBlockhash: blockhash,
    lastValidBlockHeight,
  };
}

// ============================================================================
// On-Chain State Readers & Confirm Helpers
// ============================================================================

export async function confirmSubmittedSignature(signature: string): Promise<{
  slot?: number;
}> {
  const connection = getSolanaConnection();
  const result = await confirmSignatureViaPolling(connection, signature, 50_000);
  if (!result.confirmed) {
    throw new Error(
      `Solana transaction ${signature} failed to confirm: ${JSON.stringify(result.err ?? "timeout")}`
    );
  }
  return { slot: result.slot };
}

export async function fetchOnChainProfile(walletAddress: string): Promise<{
  profilePda: string;
  profile: DecodedCandidateProfile | null;
}> {
  const connection = getSolanaConnection();
  const programId = getProgramId();
  const [profilePda] = deriveProfilePda(new PublicKey(walletAddress), programId);
  const info = await connection.getAccountInfo(profilePda, "confirmed");
  return {
    profilePda: profilePda.toBase58(),
    profile: info ? decodeCandidateProfile(info.data) : null,
  };
}

export async function fetchOnChainEvaluation(
  candidateWallet: string,
  evalId: string
): Promise<{
  evalPda: string;
  record: DecodedEvaluationRecord | null;
}> {
  const connection = getSolanaConnection();
  const programId = getProgramId();
  const [evalPda] = deriveEvaluationPda(new PublicKey(candidateWallet), evalId, programId);
  const info = await connection.getAccountInfo(evalPda, "confirmed");
  return {
    evalPda: evalPda.toBase58(),
    record: info ? decodeEvaluationRecord(info.data) : null,
  };
}

export async function fetchOnChainEscrow(jobId: string): Promise<{
  escrowPda: string;
  vaultPda: string;
  escrow: DecodedBountyEscrow | null;
}> {
  const connection = getSolanaConnection();
  const programId = getProgramId();
  const [escrowPda] = deriveEscrowPda(jobId, programId);
  const [vaultPda] = deriveEscrowVaultPda(escrowPda, programId);
  const info = await connection.getAccountInfo(escrowPda, "confirmed");
  return {
    escrowPda: escrowPda.toBase58(),
    vaultPda: vaultPda.toBase58(),
    escrow: info ? decodeBountyEscrow(info.data) : null,
  };
}

export async function fetchOnChainClaimReceipt(
  jobId: string,
  candidateWallet: string
): Promise<{
  claimReceiptPda: string;
  claim: DecodedBountyClaim | null;
}> {
  const connection = getSolanaConnection();
  const programId = getProgramId();
  const [escrowPda] = deriveEscrowPda(jobId, programId);
  const [claimReceiptPda] = deriveClaimReceiptPda(
    escrowPda,
    new PublicKey(candidateWallet),
    programId
  );
  const info = await connection.getAccountInfo(claimReceiptPda, "confirmed");
  return {
    claimReceiptPda: claimReceiptPda.toBase58(),
    claim: info ? decodeBountyClaim(info.data) : null,
  };
}

/**
 * Fetches Token-2022 Non-Transferable Soulbound Credentials held in a candidate wallet.
 */
export async function fetchWalletCredentials(
  walletAddress: string
): Promise<WalletSoulboundCredential[]> {
  const connection = getSolanaConnection();
  const programId = getProgramId();
  const cluster = getSolanaCluster();
  const [configPda] = deriveConfigPda(programId);
  const owner = new PublicKey(walletAddress);

  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
    owner,
    { programId: TOKEN_2022_PROGRAM_ID },
    "confirmed"
  );

  const nfts = tokenAccounts.value.filter((entry) => {
    const info = entry.account.data.parsed?.info;
    const tokenAmount = info?.tokenAmount;
    return (
      tokenAmount &&
      Number(tokenAmount.decimals) === 0 &&
      Number(tokenAmount.amount) >= 1 &&
      typeof info?.mint === "string"
    );
  });

  const resolved = await Promise.all(
    nfts.map(async (entry): Promise<WalletSoulboundCredential | null> => {
      const mintStr = entry.account.data.parsed.info.mint as string;
      const mintPubkey = new PublicKey(mintStr);
      try {
        const meta = await getTokenMetadata(
          connection,
          mintPubkey,
          "confirmed",
          TOKEN_2022_PROGRAM_ID
        );
        if (!meta) return null;

        const additionalMap = new Map<string, string>(
          (meta.additionalMetadata || []).map(([k, v]) => [k, v])
        );
        const updateAuthority = meta.updateAuthority?.toBase58() ?? null;
        const isCoovCredential =
          updateAuthority === configPda.toBase58() ||
          additionalMap.has("role_title") ||
          meta.symbol === "COOV-SBT";

        return {
          mint: mintStr,
          tokenAccount: entry.pubkey.toBase58(),
          name: meta.name,
          symbol: meta.symbol,
          uri: meta.uri,
          roleTitle: additionalMap.get("role_title") ?? null,
          scoreTier: additionalMap.get("score_tier") ?? null,
          evalId: additionalMap.get("eval_id") ?? null,
          reportHash: additionalMap.get("report_hash") ?? null,
          issuedAt: additionalMap.get("issued_at") ?? null,
          updateAuthority,
          isCoovCredential,
          explorerUrl: getExplorerAddressUrl(mintStr, cluster),
        };
      } catch {
        return null;
      }
    })
  );

  return resolved.filter((item): item is WalletSoulboundCredential => item !== null && item.isCoovCredential);
}
