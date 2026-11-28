import {
  type Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import { BadRequestError, formatErrorWithCause } from "@/lib/shared/errors";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getTokenMetadata,
  unpackAccount,
} from "@solana/spl-token";
import {
  confirmSignatureViaPolling,
  getExplorerAddressUrl,
  getExplorerTxUrl,
  getOracleKeypair,
  getProgramId,
  getSolanaCluster,
  getUsdcMint,
  withSolanaConnection,
} from "./config";
import {
  buildApproveAndPayoutIx,
  buildCastJuryVoteIx,
  buildClaimBountyIx,
  buildCreateBountyEscrowIx,
  buildInitProfileIx,
  buildInitReputationIx,
  buildInitializeConfigIx,
  buildMigrateEscrowIx,
  buildMintCredentialIx,
  buildOpenDisputeIx,
  buildRecordEvaluationIx,
  buildRefundConvictionStakeIx,
  buildSlashFraudStakeIx,
  buildSubmitWithConvictionStakeIx,
  buildUpdateEvaluationAfterDefenseIx,
  buildWithdrawExpiredEscrowIx,
  computeConvictionStakeMicros,
  computeScoutSplitMicros,
  decodeBountyClaim,
  decodeBountyEscrow,
  decodeCandidateProfile,
  decodeConvictionStake,
  decodeDisputeTicket,
  decodeEvaluationRecord,
  decodeProgramConfig,
  decodeReputationState,
  DEFAULT_STAKE_BPS,
  DISPUTE_MIN_SCORE,
  deriveClaimReceiptPda,
  deriveConfigPda,
  deriveConvictionStakePda,
  deriveDisputeTicketPda,
  deriveEscrowPda,
  deriveEscrowVaultPda,
  deriveEvaluationPda,
  deriveProfilePda,
  deriveReputationPda,
  V4_ESCROW_SPACE,
  type DecodedBountyClaim,
  type DecodedBountyEscrow,
  type DecodedCandidateProfile,
  type DecodedConvictionStake,
  type DecodedDisputeTicket,
  type DecodedEvaluationRecord,
  type DecodedProgramConfig,
  type DecodedReputationState,
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
  const programId = getProgramId();
  const [configPda] = deriveConfigPda(programId);
  const info = await withSolanaConnection((connection) =>
    connection.getAccountInfo(configPda, "confirmed")
  );
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
  return withSolanaConnection(async (connection) => {
    const programId = getProgramId();
    const oracleKeypair = getOracleKeypair();
    const cluster = getSolanaCluster();
    const [configPda] = deriveConfigPda(programId);

    const existingInfo = await connection.getAccountInfo(configPda, "confirmed");
    if (existingInfo) {
      const decoded = decodeProgramConfig(existingInfo.data);
      if (decoded.oracleAuthority !== oracleKeypair.publicKey.toBase58()) {
        throw new BadRequestError(
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

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
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
      throw new BadRequestError(
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
  });
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
  return withSolanaConnection(async (connection) => {
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
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
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
  });
}

async function assertInitializedOracle(connection: Connection): Promise<{
  oracleKeypair: Keypair;
  programId: PublicKey;
  configPda: PublicKey;
}> {
  const programId = getProgramId();
  const oracleKeypair = getOracleKeypair();
  const [configPda] = deriveConfigPda(programId);

  const info = await connection.getAccountInfo(configPda, "confirmed");
  if (!info) {
    throw new BadRequestError(
      `COOV ProgramConfig PDA (${configPda.toBase58()}) is not initialized yet.`
    );
  }
  const config = decodeProgramConfig(info.data);
  if (config.paused) {
    throw new BadRequestError("COOV Solana protocol is currently paused in ProgramConfig.");
  }
  if (config.oracleAuthority !== oracleKeypair.publicKey.toBase58()) {
    throw new BadRequestError(
      `Configured oracle authority does not match on-chain ProgramConfig.`
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
  reputationPda: string;
  evalPda: string;
  includesInitProfile: boolean;
  includesInitReputation: boolean;
  oraclePublicKey: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}> {
  try {
    return await withSolanaConnection(async (connection) => {
      const { oracleKeypair, programId } = await assertInitializedOracle(connection);
      const candidatePubkey = new PublicKey(params.candidateWallet);

      const [profilePda] = deriveProfilePda(candidatePubkey, programId);
      const [reputationPda] = deriveReputationPda(candidatePubkey, programId);
      const [evalPda] = deriveEvaluationPda(candidatePubkey, params.evalId, programId);

      const [profileInfo, reputationInfo, evalInfo] = await Promise.all([
        connection.getAccountInfo(profilePda, "confirmed"),
        connection.getAccountInfo(reputationPda, "confirmed"),
        connection.getAccountInfo(evalPda, "confirmed"),
      ]);

      if (evalInfo) {
        throw new BadRequestError(
          `Evaluation proof PDA (${evalPda.toBase58()}) is already anchored on-chain.`
        );
      }

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
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

      if (!reputationInfo) {
        tx.add(
          buildInitReputationIx({
            payer: candidatePubkey,
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
          includeReputation: true,
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
        reputationPda: reputationPda.toBase58(),
        evalPda: evalPda.toBase58(),
        includesInitProfile: !profileInfo,
        includesInitReputation: !reputationInfo,
        oraclePublicKey: oracleKeypair.publicKey.toBase58(),
        recentBlockhash: blockhash,
        lastValidBlockHeight,
      };
    });
  } catch (err) {
    throw wrapSolanaRpcError(err, "Unable to prepare evaluation proof transaction");
  }
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
  reputationPda: string;
  evalPda: string;
  oraclePublicKey: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}> {
  try {
    return await withSolanaConnection(async (connection) => {
      const { oracleKeypair, programId } = await assertInitializedOracle(connection);
      const candidatePubkey = new PublicKey(params.candidateWallet);

      const [profilePda] = deriveProfilePda(candidatePubkey, programId);
      const [reputationPda] = deriveReputationPda(candidatePubkey, programId);
      const [evalPda] = deriveEvaluationPda(candidatePubkey, params.evalId, programId);

      const [evalInfo, reputationInfo] = await Promise.all([
        connection.getAccountInfo(evalPda, "confirmed"),
        connection.getAccountInfo(reputationPda, "confirmed"),
      ]);
      if (!evalInfo) {
        throw new BadRequestError(
          `Evaluation proof PDA (${evalPda.toBase58()}) has not been anchored on-chain yet.`
        );
      }
      const existingEval = decodeEvaluationRecord(evalInfo.data);
      if (
        existingEval.currentReportHash === params.newReportHashHex.toLowerCase() &&
        existingEval.compositeScore === Math.round(params.newCompositeScore)
      ) {
        throw new BadRequestError("On-chain evaluation proof is already up to date with this Defense score and hash.");
      }

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
      const tx = new Transaction({
        feePayer: candidatePubkey,
        blockhash,
        lastValidBlockHeight,
      });

      if (!reputationInfo) {
        tx.add(
          buildInitReputationIx({
            payer: candidatePubkey,
            candidate: candidatePubkey,
            programId,
          })
        );
      }

      tx.add(
        buildUpdateEvaluationAfterDefenseIx({
          oracleAuthority: oracleKeypair.publicKey,
          candidate: candidatePubkey,
          evalId: params.evalId,
          newReportHashHex: params.newReportHashHex,
          newCompositeScore: params.newCompositeScore,
          includeReputation: true,
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
        reputationPda: reputationPda.toBase58(),
        evalPda: evalPda.toBase58(),
        oraclePublicKey: oracleKeypair.publicKey.toBase58(),
        recentBlockhash: blockhash,
        lastValidBlockHeight,
      };
    });
  } catch (err) {
    throw wrapSolanaRpcError(err, "Unable to prepare defense update transaction");
  }
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
  try {
    return await withSolanaConnection(async (connection) => {
      const { oracleKeypair, programId } = await assertInitializedOracle(connection);
      const candidatePubkey = new PublicKey(params.candidateWallet);

      const [evalPda] = deriveEvaluationPda(candidatePubkey, params.evalId, programId);
      const evalInfo = await connection.getAccountInfo(evalPda, "confirmed");
      if (!evalInfo) {
        throw new BadRequestError(
          "Evaluation must be anchored on-chain before minting its Soulbound Credential."
        );
      }
      const decodedEval = decodeEvaluationRecord(evalInfo.data);
      if (decodedEval.sbtMinted) {
        throw new BadRequestError(
          `Soulbound Credential already minted for this evaluation (${decodedEval.sbtMint}).`
        );
      }
      if (decodedEval.compositeScore < 85) {
        throw new BadRequestError(
          `Score ${decodedEval.compositeScore}/100 does not meet the 85/100 Soulbound threshold.`
        );
      }

      const mintKeypair = Keypair.generate();
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");

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
    });
  } catch (err) {
    throw wrapSolanaRpcError(err, "Unable to prepare Soulbound Credential transaction");
  }
}

const usdcTokenProgramCache = new Map<string, PublicKey>();

async function resolveUsdcTokenProgram(
  connection: Connection,
  usdcMint: PublicKey
): Promise<PublicKey> {
  const cacheKey = `${connection.rpcEndpoint}:${usdcMint.toBase58()}`;
  const cached = usdcTokenProgramCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const mintInfo = await connection.getAccountInfo(usdcMint, "confirmed");
  if (!mintInfo) {
    throw new BadRequestError(
      `USDC mint account (${usdcMint.toBase58()}) was not found on Solana Devnet.`
    );
  }
  const resolved = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
  usdcTokenProgramCache.set(cacheKey, resolved);
  return resolved;
}

function wrapSolanaRpcError(err: unknown, contextLabel: string): BadRequestError {
  if (err instanceof BadRequestError) return err;
  const raw = formatErrorWithCause(err);
  if (/COOV_ORACLE_PRIVATE_KEY/i.test(raw)) {
    return new BadRequestError("Solana server oracle configuration is missing on the server.");
  }
  if (/429|Too Many Requests/i.test(raw)) {
    return new BadRequestError("Solana Devnet RPC is temporarily rate-limited. Please retry in a few seconds.");
  }
  if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN/i.test(raw)) {
    return new BadRequestError(
      `${contextLabel}: Could not reach Solana Devnet RPC (${raw}). Please retry in a few seconds.`
    );
  }
  return new BadRequestError(`${contextLabel}: ${raw}`);
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
  stakeBps?: number;
  minStreak?: number;
}): Promise<{
  serializedTxBase64: string;
  escrowPda: string;
  vaultPda: string;
  usdcMint: string;
  stakeBps: number;
  minStreak: number;
  stakePerWinnerMicros: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}> {
  try {
    return await withSolanaConnection(async (connection) => {
      const programId = getProgramId();
      const usdcMint = getUsdcMint();
      const recruiterPubkey = new PublicKey(params.recruiterWallet);
      const tokenProgramId = await resolveUsdcTokenProgram(connection, usdcMint);
      const stakeBps =
        params.stakeBps && params.stakeBps > 0
          ? Math.min(10_000, Math.round(params.stakeBps))
          : DEFAULT_STAKE_BPS;
      const minStreak = Math.max(0, Math.min(255, Math.round(params.minStreak ?? 0)));
      const stakePerWinnerMicros = computeConvictionStakeMicros(
        params.rewardPerWinnerMicros,
        stakeBps
      );

      const [escrowPda] = deriveEscrowPda(params.jobId, programId);
      const [vaultPda] = deriveEscrowVaultPda(escrowPda, programId);

      const existingEscrow = await connection.getAccountInfo(escrowPda, "confirmed");
      if (existingEscrow) {
        throw new BadRequestError(`Bounty escrow PDA (${escrowPda.toBase58()}) already exists for this job.`);
      }

      const solBalance = await connection.getBalance(recruiterPubkey, "confirmed");
      if (solBalance < 2_500_000) {
        throw new BadRequestError(
          `Insufficient Devnet SOL (${(solBalance / 1_000_000_000).toFixed(4)} SOL) for escrow rent and network fees. Fund at least 0.003 SOL.`
        );
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
        throw new BadRequestError(
          `Your connected wallet (${params.recruiterWallet.slice(0, 6)}...${params.recruiterWallet.slice(-4)}) has 0 Devnet USDC (${usdcMint.toBase58()}).`
        );
      }
      const balance = await connection.getTokenAccountBalance(recruiterAta, "confirmed");
      const availableMicros = BigInt(balance.value.amount || "0");
      const requiredMicros = BigInt(params.rewardPerWinnerMicros) * BigInt(params.maxWinners);
      if (availableMicros < requiredMicros) {
        const reqUsdc = (Number(requiredMicros) / 1_000_000).toFixed(2);
        const haveUsdc = (Number(availableMicros) / 1_000_000).toFixed(2);
        throw new BadRequestError(
          `Insufficient Devnet USDC balance: funding this pool requires ${reqUsdc} USDC, but your wallet only holds ${haveUsdc} USDC.`
        );
      }

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
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
          stakeBps,
          minStreak,
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
        stakeBps,
        minStreak,
        stakePerWinnerMicros: stakePerWinnerMicros.toString(),
        recentBlockhash: blockhash,
        lastValidBlockHeight,
      };
    });
  } catch (err) {
    throw wrapSolanaRpcError(err, "Unable to prepare bounty escrow transaction on Solana Devnet");
  }
}

/**
 * Prepares `submit_with_conviction_stake` for a candidate entering a bounty:
 * - Enforces `escrow.min_streak` if configured
 * - Waives USDC transfer when `verified_streak >= 2`, `fraud_flags == 0`, active <= 30d
 * - Records optional Scout/Referrer wallet (90/10 split) preventing self-referral
 */
export async function prepareSubmitWithConvictionStakeTx(params: {
  candidateWallet: string;
  jobId: string;
  referrerWallet?: string | null;
}): Promise<{
  serializedTxBase64: string;
  escrowPda: string;
  stakePda: string;
  reputationPda: string;
  usdcMint: string;
  stakeBps: number;
  stakeMicros: string;
  isZeroStakeVip: boolean;
  referrerWallet: string | null;
  verifiedStreak: number;
  minStreak: number;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}> {
  try {
    return await withSolanaConnection(async (connection) => {
      const programId = getProgramId();
      const usdcMint = getUsdcMint();
      const candidatePubkey = new PublicKey(params.candidateWallet);
      const tokenProgramId = await resolveUsdcTokenProgram(connection, usdcMint);

      let referrerPubkey: PublicKey | null = null;
      if (params.referrerWallet && params.referrerWallet.trim()) {
        try {
          referrerPubkey = new PublicKey(params.referrerWallet.trim());
        } catch {
          throw new BadRequestError("Invalid Scout referrer Solana wallet address.");
        }
        if (referrerPubkey.equals(candidatePubkey)) {
          // Strip accidental self-referrals cleanly rather than failing
          referrerPubkey = null;
        }
      }

      const [escrowPda] = deriveEscrowPda(params.jobId, programId);
      const [stakePda] = deriveConvictionStakePda(escrowPda, candidatePubkey, programId);
      const [reputationPda] = deriveReputationPda(candidatePubkey, programId);
      const candidateAta = getAssociatedTokenAddressSync(
        usdcMint,
        candidatePubkey,
        false,
        tokenProgramId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      // Batch all required PDA accounts, SOL balance, ATA balance, and blockhash into one RPC wave
      const [accountInfos, solBalance, latestBlockhash] = await Promise.all([
        connection.getMultipleAccountsInfo(
          [escrowPda, stakePda, reputationPda, candidateAta],
          "confirmed"
        ),
        connection.getBalance(candidatePubkey, "confirmed"),
        connection.getLatestBlockhash("confirmed"),
      ]);

      const [escrowInfo, existingStake, reputationInfo, ataInfo] = accountInfos;

      if (!escrowInfo) {
        throw new BadRequestError("On-chain bounty escrow account was not found.");
      }

      const escrow = decodeBountyEscrow(escrowInfo.data);
      if (escrow.isClosed) {
        throw new BadRequestError("This bounty escrow is already closed.");
      }
      if (escrow.claimsCount >= escrow.maxWinners) {
        throw new BadRequestError("All winner slots for this bounty have already been claimed.");
      }
      if (Math.floor(Date.now() / 1000) > escrow.expiresAt) {
        throw new BadRequestError("This bounty has expired and cannot accept new stakes.");
      }
      if (existingStake) {
        const decodedStake = decodeConvictionStake(existingStake.data);
        throw new BadRequestError(
          `Wallet has already locked a Conviction Stake (${decodedStake.status}) for this bounty.`
        );
      }

      const reputation = reputationInfo ? decodeReputationState(reputationInfo.data) : null;
      const isCleanFresh = Boolean(reputation && reputation.fraudFlags === 0 && reputation.isFresh);
      const activeStreak = isCleanFresh && reputation ? reputation.verifiedStreak : 0;

      if ((escrow.minStreak ?? 0) > 0 && (!isCleanFresh || activeStreak < escrow.minStreak)) {
        throw new BadRequestError(
          `This bounty requires an active verified streak of at least ${escrow.minStreak} (within 30 days, 0 fraud flags). Your current active streak is ${activeStreak}.`
        );
      }

      const isZeroStakeVip = Boolean(reputation && reputation.isZeroStakeVip);
      const stakeMicros = isZeroStakeVip
        ? BigInt(0)
        : computeConvictionStakeMicros(escrow.rewardPerWinnerMicros, escrow.stakeBps);

      if (solBalance < 2_500_000) {
        throw new BadRequestError(
          `Insufficient Devnet SOL (${(solBalance / 1_000_000_000).toFixed(4)} SOL) for stake PDA rent and fees. Need at least 0.003 SOL.`
        );
      }

      if (!isZeroStakeVip) {
        const stakeUsdcLabel = (Number(stakeMicros) / 1_000_000).toFixed(2);
        if (!ataInfo) {
          throw new BadRequestError(
            `Your wallet (${params.candidateWallet.slice(0, 6)}...${params.candidateWallet.slice(-4)}) has 0 Devnet USDC. You need ${stakeUsdcLabel} USDC for the refundable Conviction Stake.`
          );
        }

        const decodedAta = unpackAccount(candidateAta, ataInfo, tokenProgramId);
        const availableMicros = decodedAta.amount;
        if (availableMicros < stakeMicros) {
          const haveUsdc = (Number(availableMicros) / 1_000_000).toFixed(2);
          throw new BadRequestError(
            `Insufficient Devnet USDC: locking the Conviction Stake requires ${stakeUsdcLabel} USDC, but your wallet only holds ${haveUsdc} USDC.`
          );
        }
      }

      const { blockhash, lastValidBlockHeight } = latestBlockhash;
      const tx = new Transaction({
        feePayer: candidatePubkey,
        blockhash,
        lastValidBlockHeight,
      });

      if (escrowInfo.data.length < V4_ESCROW_SPACE) {
        tx.add(
          buildMigrateEscrowIx({
            payer: candidatePubkey,
            jobId: params.jobId,
            programId,
          })
        );
      }

      if (!reputationInfo) {
        tx.add(
          buildInitReputationIx({
            payer: candidatePubkey,
            candidate: candidatePubkey,
            programId,
          })
        );
      }

      tx.add(
        buildSubmitWithConvictionStakeIx({
          candidate: candidatePubkey,
          usdcMint,
          jobId: params.jobId,
          referrer: referrerPubkey,
          candidateTokenAccount: isZeroStakeVip ? null : candidateAta,
          includeReputation: true,
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
        stakePda: stakePda.toBase58(),
        reputationPda: reputationPda.toBase58(),
        usdcMint: usdcMint.toBase58(),
        stakeBps: escrow.stakeBps,
        stakeMicros: stakeMicros.toString(),
        isZeroStakeVip,
        referrerWallet: referrerPubkey ? referrerPubkey.toBase58() : null,
        verifiedStreak: activeStreak,
        minStreak: escrow.minStreak ?? 0,
        recentBlockhash: blockhash,
        lastValidBlockHeight,
      };
    });
  } catch (err) {
    throw wrapSolanaRpcError(err, "Unable to prepare Conviction Stake transaction");
  }
}

/**
 * Prepares `approve_and_payout` for either Recruiter or 24h Timeout Oracle Auto-Claim.
 * Executes atomic 90/10 Scout Split when `conviction_stake.referrer` is set,
 * auto-creating referrer's USDC ATA idempotently so split payouts never fail.
 */
export async function prepareApproveAndPayoutTx(params: {
  payerWallet: string;
  candidateWallet: string;
  jobId: string;
  evalId: string;
  oracleCosign?: boolean;
}): Promise<{
  serializedTxBase64: string;
  escrowPda: string;
  stakePda: string;
  claimReceiptPda: string;
  referrerWallet: string | null;
  expectedCandidateRewardMicros: string;
  expectedScoutCutMicros: string;
  expectedTotalPayoutMicros: string;
  expectedBonusShareMicros: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}> {
  try {
    return await withSolanaConnection(async (connection) => {
      const programId = getProgramId();
      const usdcMint = getUsdcMint();
      const payerPubkey = new PublicKey(params.payerWallet);
      const candidatePubkey = new PublicKey(params.candidateWallet);
      const tokenProgramId = await resolveUsdcTokenProgram(connection, usdcMint);

      const [escrowPda] = deriveEscrowPda(params.jobId, programId);
      const [stakePda] = deriveConvictionStakePda(escrowPda, candidatePubkey, programId);
      const [claimReceiptPda] = deriveClaimReceiptPda(escrowPda, candidatePubkey, programId);
      const [evalPda] = deriveEvaluationPda(candidatePubkey, params.evalId, programId);
      const [reputationPda] = deriveReputationPda(candidatePubkey, programId);

      const [escrowInfo, stakeInfo, claimInfo, reputationInfo] = await Promise.all([
        connection.getAccountInfo(escrowPda, "confirmed"),
        connection.getAccountInfo(stakePda, "confirmed"),
        connection.getAccountInfo(claimReceiptPda, "confirmed"),
        connection.getAccountInfo(reputationPda, "confirmed"),
      ]);

      if (!escrowInfo) {
        throw new BadRequestError("On-chain bounty escrow account was not found.");
      }
      const escrow = decodeBountyEscrow(escrowInfo.data);
      if (escrow.isClosed) {
        throw new BadRequestError("This bounty escrow is already closed.");
      }
      if (escrow.claimsCount >= escrow.maxWinners) {
        throw new BadRequestError("All bounty winner slots have already been claimed.");
      }
      if (Math.floor(Date.now() / 1000) > escrow.expiresAt) {
        throw new BadRequestError("This bounty escrow has expired.");
      }
      if (!stakeInfo) {
        throw new BadRequestError(
          `ConvictionStake PDA (${stakePda.toBase58()}) was not found on-chain for candidate ${params.candidateWallet.slice(0, 6)}...`
        );
      }
      const stake = decodeConvictionStake(stakeInfo.data);
      if (stake.status !== "pending") {
        throw new BadRequestError(
          `Conviction stake has already been resolved (${stake.status}).`
        );
      }
      if (claimInfo) {
        throw new BadRequestError("Candidate has already claimed a payout receipt on this bounty.");
      }

      const referrerPubkey = stake.referrer ? new PublicKey(stake.referrer) : null;
      const { candidateRewardMicros, scoutCutMicros } = computeScoutSplitMicros(
        escrow.rewardPerWinnerMicros,
        Boolean(referrerPubkey)
      );
      const remainingSlots = BigInt(Math.max(1, escrow.maxWinners - escrow.claimsCount));
      const bonusShare = BigInt(escrow.slashedPoolAmountMicros) / remainingSlots;
      const expectedTotal =
        candidateRewardMicros + BigInt(stake.amountStakedMicros) + bonusShare;

      let oracleKeypair: Keypair | null = null;
      if (params.oracleCosign) {
        const oracleCheck = await assertInitializedOracle(connection);
        oracleKeypair = oracleCheck.oracleKeypair;
      } else if (escrow.recruiter !== payerPubkey.toBase58()) {
        throw new BadRequestError(
          "Connected wallet does not match the original bounty recruiter wallet."
        );
      }

      const candidateAta = getAssociatedTokenAddressSync(
        usdcMint,
        candidatePubkey,
        false,
        tokenProgramId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
      const tx = new Transaction({
        feePayer: payerPubkey,
        blockhash,
        lastValidBlockHeight,
      });

      if (escrowInfo.data.length < V4_ESCROW_SPACE) {
        tx.add(
          buildMigrateEscrowIx({
            payer: payerPubkey,
            jobId: params.jobId,
            programId,
          })
        );
      }

      if (!reputationInfo) {
        tx.add(
          buildInitReputationIx({
            payer: payerPubkey,
            candidate: candidatePubkey,
            programId,
          })
        );
      }

      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          payerPubkey,
          candidateAta,
          candidatePubkey,
          usdcMint,
          tokenProgramId,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );

      if (referrerPubkey) {
        const referrerAta = getAssociatedTokenAddressSync(
          usdcMint,
          referrerPubkey,
          false,
          tokenProgramId,
          ASSOCIATED_TOKEN_PROGRAM_ID
        );
        tx.add(
          createAssociatedTokenAccountIdempotentInstruction(
            payerPubkey,
            referrerAta,
            referrerPubkey,
            usdcMint,
            tokenProgramId,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
      }

      tx.add(
        buildApproveAndPayoutIx({
          payer: payerPubkey,
          authority: oracleKeypair ? oracleKeypair.publicKey : payerPubkey,
          candidate: candidatePubkey,
          usdcMint,
          jobId: params.jobId,
          evaluationKey: evalPda,
          referrer: referrerPubkey,
          includeReputation: true,
          tokenProgramId,
          programId,
        })
      );

      if (oracleKeypair) {
        tx.partialSign(oracleKeypair);
      }

      const serialized = tx.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });

      return {
        serializedTxBase64: bytesToBase64(serialized),
        escrowPda: escrowPda.toBase58(),
        stakePda: stakePda.toBase58(),
        claimReceiptPda: claimReceiptPda.toBase58(),
        referrerWallet: stake.referrer,
        expectedCandidateRewardMicros: candidateRewardMicros.toString(),
        expectedScoutCutMicros: scoutCutMicros.toString(),
        expectedTotalPayoutMicros: expectedTotal.toString(),
        expectedBonusShareMicros: bonusShare.toString(),
        recentBlockhash: blockhash,
        lastValidBlockHeight,
      };
    });
  } catch (err) {
    throw wrapSolanaRpcError(err, "Unable to prepare approve_and_payout transaction");
  }
}

/**
 * Prepares an unsigned `slash_fraud_stake` transaction for the bounty publisher (recruiter)
 * when flagging/rejecting a fraudulent submission in the review panel.
 */
export async function prepareSlashFraudStakeTx(params: {
  authorityWallet: string;
  candidateWallet: string;
  jobId: string;
  reasonCode?: number;
}): Promise<{
  serializedTxBase64: string;
  escrowPda: string;
  stakePda: string;
  reputationPda: string;
  amountSlashedMicros: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}> {
  try {
    return await withSolanaConnection(async (connection) => {
      const programId = getProgramId();
      const authorityPubkey = new PublicKey(params.authorityWallet);
      const candidatePubkey = new PublicKey(params.candidateWallet);

      const [escrowPda] = deriveEscrowPda(params.jobId, programId);
      const [stakePda] = deriveConvictionStakePda(escrowPda, candidatePubkey, programId);
      const [reputationPda] = deriveReputationPda(candidatePubkey, programId);

      const [escrowInfo, stakeInfo, reputationInfo] = await Promise.all([
        connection.getAccountInfo(escrowPda, "confirmed"),
        connection.getAccountInfo(stakePda, "confirmed"),
        connection.getAccountInfo(reputationPda, "confirmed"),
      ]);

      if (!escrowInfo) {
        throw new BadRequestError("On-chain bounty escrow account was not found.");
      }
      const escrow = decodeBountyEscrow(escrowInfo.data);
      if (escrow.isClosed) {
        throw new BadRequestError("This bounty escrow is already closed.");
      }
      if (escrow.recruiter !== authorityPubkey.toBase58()) {
        throw new BadRequestError(
          "Connected wallet does not match the original bounty recruiter wallet."
        );
      }
      if (!stakeInfo) {
        throw new BadRequestError("No on-chain ConvictionStake PDA found for this candidate.");
      }
      const stake = decodeConvictionStake(stakeInfo.data);
      if (stake.status !== "pending") {
        throw new BadRequestError(
          `Conviction stake has already been resolved (${stake.status}).`
        );
      }

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
      const tx = new Transaction({
        feePayer: authorityPubkey,
        blockhash,
        lastValidBlockHeight,
      });

      if (escrowInfo.data.length < V4_ESCROW_SPACE) {
        tx.add(
          buildMigrateEscrowIx({
            payer: authorityPubkey,
            jobId: params.jobId,
            programId,
          })
        );
      }

      if (!reputationInfo) {
        tx.add(
          buildInitReputationIx({
            payer: authorityPubkey,
            candidate: candidatePubkey,
            programId,
          })
        );
      }

      tx.add(
        buildSlashFraudStakeIx({
          authority: authorityPubkey,
          candidate: candidatePubkey,
          jobId: params.jobId,
          reasonCode: params.reasonCode ?? 3,
          includeReputation: true,
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
        stakePda: stakePda.toBase58(),
        reputationPda: reputationPda.toBase58(),
        amountSlashedMicros: stake.amountStakedMicros,
        recentBlockhash: blockhash,
        lastValidBlockHeight,
      };
    });
  } catch (err) {
    throw wrapSolanaRpcError(err, "Unable to prepare slash_fraud_stake transaction");
  }
}

/**
 * Automated backend Oracle slash executed immediately when the Fake Resume Detector or
 * SHA-256 Duplicate Gate catches a submission that already locked a Pending stake on-chain.
 */
export async function executeOracleSlashFraudStake(params: {
  candidateWallet: string;
  jobId: string;
  reasonCode: 1 | 2;
}): Promise<{
  slashed: boolean;
  txSignature?: string;
  newSlashedPoolMicros?: string;
  amountSlashedMicros?: string;
  reason?: string;
}> {
  try {
    return await withSolanaConnection(async (connection) => {
      const { oracleKeypair, programId } = await assertInitializedOracle(connection);
      const candidatePubkey = new PublicKey(params.candidateWallet);

      const [escrowPda] = deriveEscrowPda(params.jobId, programId);
      const [stakePda] = deriveConvictionStakePda(escrowPda, candidatePubkey, programId);
      const [reputationPda] = deriveReputationPda(candidatePubkey, programId);

      const [escrowInfo, stakeInfo, reputationInfo] = await Promise.all([
        connection.getAccountInfo(escrowPda, "confirmed"),
        connection.getAccountInfo(stakePda, "confirmed"),
        connection.getAccountInfo(reputationPda, "confirmed"),
      ]);

      if (!escrowInfo || !stakeInfo) {
        return { slashed: false, reason: "Missing escrow or ConvictionStake PDA" };
      }

      const escrow = decodeBountyEscrow(escrowInfo.data);
      const stake = decodeConvictionStake(stakeInfo.data);
      if (escrow.isClosed || stake.status !== "pending") {
        return {
          slashed: stake.status === "slashed",
          newSlashedPoolMicros: escrow.slashedPoolAmountMicros,
          reason: `Stake status is ${stake.status}`,
        };
      }

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
      const tx = new Transaction({
        feePayer: oracleKeypair.publicKey,
        blockhash,
        lastValidBlockHeight,
      });

      if (escrowInfo.data.length < V4_ESCROW_SPACE) {
        tx.add(
          buildMigrateEscrowIx({
            payer: oracleKeypair.publicKey,
            jobId: params.jobId,
            programId,
          })
        );
      }

      if (!reputationInfo) {
        tx.add(
          buildInitReputationIx({
            payer: oracleKeypair.publicKey,
            candidate: candidatePubkey,
            programId,
          })
        );
      }

      tx.add(
        buildSlashFraudStakeIx({
          authority: oracleKeypair.publicKey,
          candidate: candidatePubkey,
          jobId: params.jobId,
          reasonCode: params.reasonCode,
          includeReputation: true,
          programId,
        })
      );

      tx.sign(oracleKeypair);
      const signature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });

      const confirmed = await confirmSignatureViaPolling(connection, signature, 50_000);
      if (!confirmed.confirmed) {
        return {
          slashed: false,
          reason: `Slash confirmation failed: ${JSON.stringify(confirmed.err)}`,
        };
      }

      const refreshedEscrow = await connection.getAccountInfo(escrowPda, "confirmed");
      const updatedDecoded = refreshedEscrow ? decodeBountyEscrow(refreshedEscrow.data) : escrow;

      return {
        slashed: true,
        txSignature: signature,
        amountSlashedMicros: stake.amountStakedMicros,
        newSlashedPoolMicros: updatedDecoded.slashedPoolAmountMicros,
      };
    });
  } catch (err) {
    return {
      slashed: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Prepares an Oracle co-signed `refund_conviction_stake` transaction so honest candidates
 * who scored below `min_score` (no fraud/duplicate) or missed full slots can reclaim 100% stake.
 */
export async function prepareRefundConvictionStakeTx(params: {
  candidateWallet: string;
  jobId: string;
}): Promise<{
  serializedTxBase64: string;
  escrowPda: string;
  stakePda: string;
  amountRefundedMicros: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}> {
  try {
    return await withSolanaConnection(async (connection) => {
      const programId = getProgramId();
      const usdcMint = getUsdcMint();
      const candidatePubkey = new PublicKey(params.candidateWallet);
      const tokenProgramId = await resolveUsdcTokenProgram(connection, usdcMint);

      const [escrowPda] = deriveEscrowPda(params.jobId, programId);
      const [stakePda] = deriveConvictionStakePda(escrowPda, candidatePubkey, programId);

      const [escrowInfo, stakeInfo] = await Promise.all([
        connection.getAccountInfo(escrowPda, "confirmed"),
        connection.getAccountInfo(stakePda, "confirmed"),
      ]);

      if (!escrowInfo || !stakeInfo) {
        throw new BadRequestError("Escrow or ConvictionStake PDA was not found on-chain.");
      }

      const stake = decodeConvictionStake(stakeInfo.data);
      if (stake.status !== "pending") {
        throw new BadRequestError(
          `Conviction stake cannot be refunded (status: ${stake.status}).`
        );
      }

      const isZeroStake = BigInt(stake.amountStakedMicros) === BigInt(0);
      const { oracleKeypair } = await assertInitializedOracle(connection);
      const candidateAta = getAssociatedTokenAddressSync(
        usdcMint,
        candidatePubkey,
        false,
        tokenProgramId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
      const tx = new Transaction({
        feePayer: candidatePubkey,
        blockhash,
        lastValidBlockHeight,
      });

      if (escrowInfo.data.length < V4_ESCROW_SPACE) {
        tx.add(
          buildMigrateEscrowIx({
            payer: candidatePubkey,
            jobId: params.jobId,
            programId,
          })
        );
      }

      if (!isZeroStake) {
        tx.add(
          createAssociatedTokenAccountIdempotentInstruction(
            candidatePubkey,
            candidateAta,
            candidatePubkey,
            usdcMint,
            tokenProgramId,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
      }

      tx.add(
        buildRefundConvictionStakeIx({
          authority: oracleKeypair.publicKey,
          candidate: candidatePubkey,
          usdcMint,
          jobId: params.jobId,
          candidateTokenAccount: isZeroStake ? null : candidateAta,
          tokenProgramId,
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
        escrowPda: escrowPda.toBase58(),
        stakePda: stakePda.toBase58(),
        amountRefundedMicros: stake.amountStakedMicros,
        recentBlockhash: blockhash,
        lastValidBlockHeight,
      };
    });
  } catch (err) {
    throw wrapSolanaRpcError(err, "Unable to prepare Conviction Stake refund transaction");
  }
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
  try {
    return await withSolanaConnection(async (connection) => {
      const programId = getProgramId();
      const usdcMint = getUsdcMint();
      const candidatePubkey = new PublicKey(params.candidateWallet);
      const tokenProgramId = await resolveUsdcTokenProgram(connection, usdcMint);

      const [escrowPda] = deriveEscrowPda(params.jobId, programId);
      const [evalPda] = deriveEvaluationPda(candidatePubkey, params.evalId, programId);
      const [claimReceiptPda] = deriveClaimReceiptPda(escrowPda, candidatePubkey, programId);
      const [reputationPda] = deriveReputationPda(candidatePubkey, programId);

      const [escrowInfo, evalInfo, existingClaim, reputationInfo] = await Promise.all([
        connection.getAccountInfo(escrowPda, "confirmed"),
        connection.getAccountInfo(evalPda, "confirmed"),
        connection.getAccountInfo(claimReceiptPda, "confirmed"),
        connection.getAccountInfo(reputationPda, "confirmed"),
      ]);

      if (!escrowInfo) {
        throw new BadRequestError("On-chain bounty escrow account was not found.");
      }
      const escrow = decodeBountyEscrow(escrowInfo.data);
      if (escrow.isClosed) {
        throw new BadRequestError("This bounty escrow has already been closed.");
      }
      if (escrow.claimsCount >= escrow.maxWinners) {
        throw new BadRequestError("All winner slots for this bounty have already been claimed.");
      }
      const nowSec = Math.floor(Date.now() / 1000);
      if (nowSec > escrow.expiresAt) {
        throw new BadRequestError("This bounty has expired and can no longer be claimed.");
      }

      if (!evalInfo) {
        throw new BadRequestError(
          "Your evaluation must be anchored on-chain before you can claim a USDC bounty."
        );
      }
      const decodedEval = decodeEvaluationRecord(evalInfo.data);
      if (decodedEval.compositeScore < escrow.minScore) {
        throw new BadRequestError(
          `Your on-chain score (${decodedEval.compositeScore}/100) is below the bounty minimum (${escrow.minScore}/100).`
        );
      }
      if (existingClaim) {
        throw new BadRequestError("This wallet has already claimed its USDC payout for this bounty.");
      }

      const candidateAta = getAssociatedTokenAddressSync(
        usdcMint,
        candidatePubkey,
        false,
        tokenProgramId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
      const tx = new Transaction({
        feePayer: candidatePubkey,
        blockhash,
        lastValidBlockHeight,
      });

      if (escrowInfo.data.length < V4_ESCROW_SPACE) {
        tx.add(
          buildMigrateEscrowIx({
            payer: candidatePubkey,
            jobId: params.jobId,
            programId,
          })
        );
      }

      if (!reputationInfo) {
        tx.add(
          buildInitReputationIx({
            payer: candidatePubkey,
            candidate: candidatePubkey,
            programId,
          })
        );
      }

      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          candidatePubkey,
          candidateAta,
          candidatePubkey,
          usdcMint,
          tokenProgramId,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      ).add(
        buildClaimBountyIx({
          candidate: candidatePubkey,
          usdcMint,
          jobId: params.jobId,
          evalId: params.evalId,
          includeReputation: true,
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
    });
  } catch (err) {
    throw wrapSolanaRpcError(err, "Unable to prepare bounty claim transaction");
  }
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
  try {
    return await withSolanaConnection(async (connection) => {
      const programId = getProgramId();
      const usdcMint = getUsdcMint();
      const recruiterPubkey = new PublicKey(params.recruiterWallet);
      const tokenProgramId = await resolveUsdcTokenProgram(connection, usdcMint);

      const [escrowPda] = deriveEscrowPda(params.jobId, programId);
      const escrowInfo = await connection.getAccountInfo(escrowPda, "confirmed");
      if (!escrowInfo) {
        throw new BadRequestError("On-chain bounty escrow account was not found.");
      }
      const escrow = decodeBountyEscrow(escrowInfo.data);
      if (escrow.isClosed) {
        throw new BadRequestError("This bounty escrow is already closed.");
      }
      if ((escrow.openDisputesCount ?? 0) > 0) {
        throw new BadRequestError(
          `Bounty escrow reclaim is frozen while ${escrow.openDisputesCount} DisputeTicket(s) remain Open for Jury resolution.`
        );
      }
      if (escrow.recruiter !== recruiterPubkey.toBase58()) {
        throw new BadRequestError("Only the original recruiter wallet can refund this bounty escrow.");
      }
      const nowSec = Math.floor(Date.now() / 1000);
      if (nowSec <= escrow.expiresAt) {
        throw new BadRequestError("Bounty escrow cannot be refunded until after its expiration timestamp.");
      }

      const solBalance = await connection.getBalance(recruiterPubkey, "confirmed");
      if (solBalance < 2_500_000) {
        throw new BadRequestError(
          `Insufficient Devnet SOL for escrow rent/fees (${(solBalance / 1_000_000_000).toFixed(4)} SOL). Ensure at least 0.003 SOL.`
        );
      }

      const recruiterAta = getAssociatedTokenAddressSync(
        usdcMint,
        recruiterPubkey,
        false,
        tokenProgramId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
      const tx = new Transaction({
        feePayer: recruiterPubkey,
        blockhash,
        lastValidBlockHeight,
      });

      if (escrowInfo.data.length < V4_ESCROW_SPACE) {
        tx.add(
          buildMigrateEscrowIx({
            payer: recruiterPubkey,
            jobId: params.jobId,
            programId,
          })
        );
      }

      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          recruiterPubkey,
          recruiterAta,
          recruiterPubkey,
          usdcMint,
          tokenProgramId,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      ).add(
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
    });
  } catch (err) {
    throw wrapSolanaRpcError(err, "Unable to prepare escrow refund transaction");
  }
}

// ============================================================================
// On-Chain State Readers & Confirm Helpers
// ============================================================================

export async function confirmSubmittedSignature(signature: string): Promise<{
  slot?: number;
}> {
  try {
    return await withSolanaConnection(async (connection) => {
      const result = await confirmSignatureViaPolling(connection, signature, 50_000);
      if (!result.confirmed) {
        throw new BadRequestError(
          `Solana transaction ${signature} failed to confirm: ${JSON.stringify(result.err ?? "timeout")}`
        );
      }
      return { slot: result.slot };
    });
  } catch (err) {
    throw wrapSolanaRpcError(err, "Unable to confirm Solana transaction");
  }
}

export async function fetchOnChainProfile(walletAddress: string): Promise<{
  profilePda: string;
  profile: DecodedCandidateProfile | null;
}> {
  const programId = getProgramId();
  const [profilePda] = deriveProfilePda(new PublicKey(walletAddress), programId);
  const info = await withSolanaConnection((connection) =>
    connection.getAccountInfo(profilePda, "confirmed")
  );
  return {
    profilePda: profilePda.toBase58(),
    profile: info ? decodeCandidateProfile(info.data) : null,
  };
}

export async function fetchOnChainReputation(walletAddress: string): Promise<{
  reputationPda: string;
  reputation: DecodedReputationState | null;
}> {
  const programId = getProgramId();
  const [reputationPda] = deriveReputationPda(new PublicKey(walletAddress), programId);
  const info = await withSolanaConnection((connection) =>
    connection.getAccountInfo(reputationPda, "confirmed")
  );
  return {
    reputationPda: reputationPda.toBase58(),
    reputation: info ? decodeReputationState(info.data) : null,
  };
}

export async function fetchOnChainEvaluation(
  candidateWallet: string,
  evalId: string
): Promise<{
  evalPda: string;
  record: DecodedEvaluationRecord | null;
}> {
  const programId = getProgramId();
  const [evalPda] = deriveEvaluationPda(new PublicKey(candidateWallet), evalId, programId);
  const info = await withSolanaConnection((connection) =>
    connection.getAccountInfo(evalPda, "confirmed")
  );
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
  const programId = getProgramId();
  const [escrowPda] = deriveEscrowPda(jobId, programId);
  const [vaultPda] = deriveEscrowVaultPda(escrowPda, programId);
  const info = await withSolanaConnection((connection) =>
    connection.getAccountInfo(escrowPda, "confirmed")
  );
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
  const programId = getProgramId();
  const [escrowPda] = deriveEscrowPda(jobId, programId);
  const [claimReceiptPda] = deriveClaimReceiptPda(
    escrowPda,
    new PublicKey(candidateWallet),
    programId
  );
  const info = await withSolanaConnection((connection) =>
    connection.getAccountInfo(claimReceiptPda, "confirmed")
  );
  return {
    claimReceiptPda: claimReceiptPda.toBase58(),
    claim: info ? decodeBountyClaim(info.data) : null,
  };
}

export async function fetchOnChainConvictionStake(
  jobId: string,
  candidateWallet: string
): Promise<{
  escrowPda: string;
  stakePda: string;
  stake: DecodedConvictionStake | null;
}> {
  const programId = getProgramId();
  const [escrowPda] = deriveEscrowPda(jobId, programId);
  const [stakePda] = deriveConvictionStakePda(
    escrowPda,
    new PublicKey(candidateWallet),
    programId
  );
  const info = await withSolanaConnection((connection) =>
    connection.getAccountInfo(stakePda, "confirmed")
  );
  return {
    escrowPda: escrowPda.toBase58(),
    stakePda: stakePda.toBase58(),
    stake: info ? decodeConvictionStake(info.data) : null,
  };
}

export async function fetchOnChainDisputeTicket(
  jobId: string,
  candidateWallet: string
): Promise<{
  escrowPda: string;
  disputeTicketPda: string;
  dispute: DecodedDisputeTicket | null;
}> {
  const programId = getProgramId();
  const [escrowPda] = deriveEscrowPda(jobId, programId);
  const [disputeTicketPda] = deriveDisputeTicketPda(
    escrowPda,
    new PublicKey(candidateWallet),
    programId
  );
  const info = await withSolanaConnection((connection) =>
    connection.getAccountInfo(disputeTicketPda, "confirmed")
  );
  return {
    escrowPda: escrowPda.toBase58(),
    disputeTicketPda: disputeTicketPda.toBase58(),
    dispute: info ? decodeDisputeTicket(info.data) : null,
  };
}

export interface WalletJurorEligibility {
  eligible: boolean;
  method: "sbt" | "streak" | "none";
  activeStreak: number;
  fraudFlags: number;
  sbtMint: string | null;
  sbtAta: string | null;
  sbtCount: number;
}

export async function checkWalletJurorEligibility(
  walletAddress: string
): Promise<WalletJurorEligibility> {
  const [profileRes, repRes, credentials] = await Promise.all([
    fetchOnChainProfile(walletAddress).catch(() => ({ profile: null })),
    fetchOnChainReputation(walletAddress).catch(() => ({ reputation: null })),
    fetchWalletCredentials(walletAddress).catch(() => []),
  ]);

  const activeStreak = repRes.reputation?.verifiedStreak ?? 0;
  const fraudFlags = repRes.reputation?.fraudFlags ?? 0;
  const firstSbt = credentials[0] ?? null;

  if (profileRes.profile && repRes.reputation && fraudFlags === 0 && activeStreak >= 1) {
    return {
      eligible: true,
      method: "streak",
      activeStreak,
      fraudFlags,
      sbtMint: firstSbt?.mint ?? null,
      sbtAta: firstSbt?.tokenAccount ?? null,
      sbtCount: credentials.length,
    };
  }

  if (firstSbt) {
    return {
      eligible: true,
      method: "sbt",
      activeStreak,
      fraudFlags,
      sbtMint: firstSbt.mint,
      sbtAta: firstSbt.tokenAccount,
      sbtCount: credentials.length,
    };
  }

  return {
    eligible: false,
    method: "none",
    activeStreak,
    fraudFlags,
    sbtMint: null,
    sbtAta: null,
    sbtCount: 0,
  };
}

/**
 * Prepares `open_dispute` for a rejected candidate holding a verified `EvaluationRecord`
 * PDA (`composite_score >= 90` and `fraud_flags == 0`) before `bounty.expires_at`.
 */
export async function prepareOpenDisputeTx(params: {
  candidateWallet: string;
  jobId: string;
  evalId: string;
}): Promise<{
  serializedTxBase64: string;
  escrowPda: string;
  disputeTicketPda: string;
  evaluationPda: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}> {
  try {
    return await withSolanaConnection(async (connection) => {
      const programId = getProgramId();
      const candidatePubkey = new PublicKey(params.candidateWallet);

      const [escrowPda] = deriveEscrowPda(params.jobId, programId);
      const [evalPda] = deriveEvaluationPda(candidatePubkey, params.evalId, programId);
      const [repPda] = deriveReputationPda(candidatePubkey, programId);
      const [disputeTicketPda] = deriveDisputeTicketPda(escrowPda, candidatePubkey, programId);

      const [escrowInfo, evalInfo, repInfo, ticketInfo] = await Promise.all([
        connection.getAccountInfo(escrowPda, "confirmed"),
        connection.getAccountInfo(evalPda, "confirmed"),
        connection.getAccountInfo(repPda, "confirmed"),
        connection.getAccountInfo(disputeTicketPda, "confirmed"),
      ]);

      if (!escrowInfo) {
        throw new BadRequestError("On-chain bounty escrow account was not found.");
      }
      const escrow = decodeBountyEscrow(escrowInfo.data);
      if (escrow.isClosed) {
        throw new BadRequestError("This bounty escrow is already closed.");
      }
      if (escrow.claimsCount >= escrow.maxWinners) {
        throw new BadRequestError("All bounty winner slots have already been claimed.");
      }
      if (Math.floor(Date.now() / 1000) > escrow.expiresAt) {
        throw new BadRequestError("This bounty has expired and can no longer open new disputes.");
      }
      if (ticketInfo) {
        throw new BadRequestError(
          `DisputeTicket PDA (${disputeTicketPda.toBase58()}) has already been opened for this candidate.`
        );
      }
      if (!evalInfo) {
        throw new BadRequestError(
          "Your evaluation must be anchored on-chain before opening a Dispute Jury ticket."
        );
      }
      const decodedEval = decodeEvaluationRecord(evalInfo.data);
      if (decodedEval.compositeScore < DISPUTE_MIN_SCORE) {
        throw new BadRequestError(
          `Your on-chain score (${decodedEval.compositeScore}/100) must be >= ${DISPUTE_MIN_SCORE}/100 to open a Dispute Jury ticket.`
        );
      }
      if (repInfo) {
        const decodedRep = decodeReputationState(repInfo.data);
        if (decodedRep.fraudFlags > 0) {
          throw new BadRequestError(
            "Candidates with confirmed fraud flags on-chain cannot open a Dispute Jury ticket."
          );
        }
      }

      const solBalance = await connection.getBalance(candidatePubkey, "confirmed");
      if (solBalance < 3_000_000) {
        throw new BadRequestError(
          `Insufficient Devnet SOL (${(solBalance / 1_000_000_000).toFixed(4)} SOL) for DisputeTicket PDA rent and network fees.`
        );
      }

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
      const tx = new Transaction({
        feePayer: candidatePubkey,
        blockhash,
        lastValidBlockHeight,
      });

      if (escrowInfo.data.length < V4_ESCROW_SPACE) {
        tx.add(
          buildMigrateEscrowIx({
            payer: candidatePubkey,
            jobId: params.jobId,
            programId,
          })
        );
      }

      tx.add(
        buildOpenDisputeIx({
          candidate: candidatePubkey,
          jobId: params.jobId,
          evalId: params.evalId,
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
        disputeTicketPda: disputeTicketPda.toBase58(),
        evaluationPda: evalPda.toBase58(),
        recentBlockhash: blockhash,
        lastValidBlockHeight,
      };
    });
  } catch (err) {
    throw wrapSolanaRpcError(err, "Unable to prepare open_dispute transaction");
  }
}

/**
 * Prepares `cast_jury_vote` for an independent SBT or Verified Streak >= 1 juror.
 * When `approveCandidate` reaches 2-of-3 consensus, idempotently creates Candidate
 * (and optional Scout Referrer) USDC ATAs so atomic CPI payout succeeds cleanly.
 */
export async function prepareCastJuryVoteTx(params: {
  jurorWallet: string;
  candidateWallet: string;
  jobId: string;
  approveCandidate: boolean;
}): Promise<{
  serializedTxBase64: string;
  escrowPda: string;
  disputeTicketPda: string;
  eligibilityMethod: "sbt" | "streak";
  willReachConsensus: boolean;
  approveCandidate: boolean;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}> {
  try {
    return await withSolanaConnection(async (connection) => {
      const programId = getProgramId();
      const usdcMint = getUsdcMint();
      const jurorPubkey = new PublicKey(params.jurorWallet);
      const candidatePubkey = new PublicKey(params.candidateWallet);
      const tokenProgramId = await resolveUsdcTokenProgram(connection, usdcMint);

      if (jurorPubkey.equals(candidatePubkey)) {
        throw new BadRequestError("The disputed candidate cannot vote on their own dispute.");
      }

      const [escrowPda] = deriveEscrowPda(params.jobId, programId);
      const [disputeTicketPda] = deriveDisputeTicketPda(escrowPda, candidatePubkey, programId);
      const [stakePda] = deriveConvictionStakePda(escrowPda, candidatePubkey, programId);

      const [escrowInfo, ticketInfo, stakeInfo, eligibility] = await Promise.all([
        connection.getAccountInfo(escrowPda, "confirmed"),
        connection.getAccountInfo(disputeTicketPda, "confirmed"),
        connection.getAccountInfo(stakePda, "confirmed"),
        checkWalletJurorEligibility(params.jurorWallet),
      ]);

      if (!escrowInfo || !ticketInfo) {
        throw new BadRequestError("On-chain BountyEscrow or DisputeTicket PDA was not found.");
      }
      const escrow = decodeBountyEscrow(escrowInfo.data);
      const ticket = decodeDisputeTicket(ticketInfo.data);

      if (escrow.recruiter === jurorPubkey.toBase58()) {
        throw new BadRequestError("The bounty creator cannot vote on a Jury Dispute for their own bounty.");
      }
      if (ticket.status !== "open") {
        throw new BadRequestError(`DisputeTicket is already resolved (${ticket.status}).`);
      }
      if (ticket.jurors.includes(jurorPubkey.toBase58())) {
        throw new BadRequestError("Your connected wallet has already cast a vote on this dispute.");
      }
      if (ticket.jurors.length >= 3) {
        throw new BadRequestError("All 3 jury seats have already voted on this dispute.");
      }
      if (!eligibility.eligible || eligibility.method === "none") {
        throw new BadRequestError(
          "Juror eligibility not met: wallet must hold a verified CandidateProfile with active streak >= 1 (0 fraud flags) or a COOV Token-2022 Soulbound Credential (SBT)."
        );
      }

      const willReachConsensus = params.approveCandidate
        ? ticket.votesForCandidate + 1 >= 2
        : ticket.votesForRecruiter + 1 >= 2;

      if (params.approveCandidate && willReachConsensus) {
        if (escrow.isClosed || escrow.claimsCount >= escrow.maxWinners) {
          throw new BadRequestError(
            "Escrow slots are already filled or closed; override payout cannot execute."
          );
        }
      }

      const solBalance = await connection.getBalance(jurorPubkey, "confirmed");
      if (solBalance < 3_000_000) {
        throw new BadRequestError(
          `Insufficient Devnet SOL (${(solBalance / 1_000_000_000).toFixed(4)} SOL) for jury transaction fees.`
        );
      }

      const stake = stakeInfo ? decodeConvictionStake(stakeInfo.data) : null;
      const referrerPubkey = stake?.referrer ? new PublicKey(stake.referrer) : null;
      const candidateAta = getAssociatedTokenAddressSync(
        usdcMint,
        candidatePubkey,
        false,
        tokenProgramId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
      const tx = new Transaction({
        feePayer: jurorPubkey,
        blockhash,
        lastValidBlockHeight,
      });

      if (escrowInfo.data.length < V4_ESCROW_SPACE) {
        tx.add(
          buildMigrateEscrowIx({
            payer: jurorPubkey,
            jobId: params.jobId,
            programId,
          })
        );
      }

      if (params.approveCandidate && willReachConsensus) {
        tx.add(
          createAssociatedTokenAccountIdempotentInstruction(
            jurorPubkey,
            candidateAta,
            candidatePubkey,
            usdcMint,
            tokenProgramId,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
        if (referrerPubkey) {
          const referrerAta = getAssociatedTokenAddressSync(
            usdcMint,
            referrerPubkey,
            false,
            tokenProgramId,
            ASSOCIATED_TOKEN_PROGRAM_ID
          );
          tx.add(
            createAssociatedTokenAccountIdempotentInstruction(
              jurorPubkey,
              referrerAta,
              referrerPubkey,
              usdcMint,
              tokenProgramId,
              ASSOCIATED_TOKEN_PROGRAM_ID
            )
          );
        }
      }

      tx.add(
        buildCastJuryVoteIx({
          juror: jurorPubkey,
          candidate: candidatePubkey,
          usdcMint,
          jobId: params.jobId,
          approveCandidate: params.approveCandidate,
          jurorSbtMint:
            eligibility.sbtMint && eligibility.method === "sbt"
              ? new PublicKey(eligibility.sbtMint)
              : null,
          jurorSbtAta:
            eligibility.sbtAta && eligibility.method === "sbt"
              ? new PublicKey(eligibility.sbtAta)
              : null,
          candidateTokenAccount:
            params.approveCandidate && willReachConsensus ? candidateAta : null,
          referrer:
            params.approveCandidate && willReachConsensus ? referrerPubkey : null,
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
        disputeTicketPda: disputeTicketPda.toBase58(),
        eligibilityMethod: eligibility.method,
        willReachConsensus,
        approveCandidate: params.approveCandidate,
        recentBlockhash: blockhash,
        lastValidBlockHeight,
      };
    });
  } catch (err) {
    throw wrapSolanaRpcError(err, "Unable to prepare cast_jury_vote transaction");
  }
}

/**
 * Fetches Token-2022 Non-Transferable Soulbound Credentials held in a candidate wallet.
 */
export async function fetchWalletCredentials(
  walletAddress: string
): Promise<WalletSoulboundCredential[]> {
  return withSolanaConnection(async (connection) => {
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
  });
}

// ============================================================================
// Subscription Plan USDC Payments (Solana Devnet)
// ============================================================================

export function getTreasuryWallet(): PublicKey {
  const configured = process.env.COOV_TREASURY_WALLET?.trim();
  if (configured) {
    return new PublicKey(configured);
  }
  return getOracleKeypair().publicKey;
}

export async function prepareUsdcPlanPaymentTx(params: {
  payerWallet: string;
  usdcAmount: number;
}): Promise<{
  serializedTxBase64: string;
  amountUsdc: number;
  amountMicros: string;
  treasuryWallet: string;
  treasuryAta: string;
  usdcMint: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}> {
  try {
    return await withSolanaConnection(async (connection) => {
      const payerPubkey = new PublicKey(params.payerWallet);
      const usdcMint = getUsdcMint();
      const treasuryPubkey = getTreasuryWallet();
      const tokenProgramId = await resolveUsdcTokenProgram(connection, usdcMint);

      const solBalance = await connection.getBalance(payerPubkey, "confirmed");
      if (solBalance < 2_500_000) {
        throw new BadRequestError(
          `Insufficient Devnet SOL (${(solBalance / 1_000_000_000).toFixed(4)} SOL) to pay network fees. Please fund your wallet with Devnet SOL.`
        );
      }

      const senderAta = getAssociatedTokenAddressSync(
        usdcMint,
        payerPubkey,
        false,
        tokenProgramId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      const treasuryAta = getAssociatedTokenAddressSync(
        usdcMint,
        treasuryPubkey,
        false,
        tokenProgramId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const senderAtaInfo = await connection.getAccountInfo(senderAta, "confirmed");
      if (!senderAtaInfo) {
        throw new BadRequestError(
          `Insufficient Devnet USDC balance: wallet ${params.payerWallet.slice(0, 6)}...${params.payerWallet.slice(-4)} holds 0.00 USDC (need ${params.usdcAmount} USDC).`
        );
      }

      const requiredMicros = BigInt(Math.round(params.usdcAmount * 1_000_000));
      const balance = await connection.getTokenAccountBalance(senderAta, "confirmed");
      const availableMicros = BigInt(balance.value.amount || "0");
      if (availableMicros < requiredMicros) {
        throw new BadRequestError(
          `Insufficient Devnet USDC balance: this plan costs ${params.usdcAmount} USDC, but your wallet only holds ${(Number(availableMicros) / 1_000_000).toFixed(2)} USDC.`
        );
      }

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
      const tx = new Transaction({
        feePayer: payerPubkey,
        blockhash,
        lastValidBlockHeight,
      })
        .add(
          createAssociatedTokenAccountIdempotentInstruction(
            payerPubkey,
            treasuryAta,
            treasuryPubkey,
            usdcMint,
            tokenProgramId,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        )
        .add(
          createTransferCheckedInstruction(
            senderAta,
            usdcMint,
            treasuryAta,
            payerPubkey,
            requiredMicros,
            6,
            [],
            tokenProgramId
          )
        );

      const serialized = tx.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });

      return {
        serializedTxBase64: bytesToBase64(serialized),
        amountUsdc: params.usdcAmount,
        amountMicros: requiredMicros.toString(),
        treasuryWallet: treasuryPubkey.toBase58(),
        treasuryAta: treasuryAta.toBase58(),
        usdcMint: usdcMint.toBase58(),
        recentBlockhash: blockhash,
        lastValidBlockHeight,
      };
    });
  } catch (err) {
    throw wrapSolanaRpcError(err, "Unable to prepare USDC plan checkout transaction");
  }
}

/**
 * Verifies a confirmed Devnet transaction transferred at least `expectedMicros`
 * of COOV's USDC mint into the treasury ATA.
 */
export async function verifyUsdcTransferTransaction(params: {
  signature: string;
  payerWallet: string;
  expectedMicros: bigint;
}): Promise<{
  verified: boolean;
  treasuryWallet: string;
  treasuryAta: string;
  receivedMicros: string;
}> {
  try {
    return await withSolanaConnection(async (connection) => {
      const usdcMint = getUsdcMint();
      const treasuryPubkey = getTreasuryWallet();
      const tokenProgramId = await resolveUsdcTokenProgram(connection, usdcMint);
      const treasuryAta = getAssociatedTokenAddressSync(
        usdcMint,
        treasuryPubkey,
        false,
        tokenProgramId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const confirmRes = await confirmSignatureViaPolling(connection, params.signature, 50_000);
      if (!confirmRes.confirmed) {
        throw new BadRequestError(
          `Solana transaction ${params.signature} failed to confirm: ${JSON.stringify(confirmRes.err ?? "timeout")}`
        );
      }

      const parsedTx = await connection.getParsedTransaction(params.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (!parsedTx || !parsedTx.meta || parsedTx.meta.err) {
        throw new BadRequestError("On-chain USDC payment transaction was not found or failed execution.");
      }

      const payerSigned = parsedTx.transaction.message.accountKeys.some(
        (k) => k.signer && k.pubkey.toBase58() === params.payerWallet
      );
      if (!payerSigned) {
        throw new BadRequestError("Connected wallet did not sign this USDC payment transaction.");
      }

      const treasuryAtaStr = treasuryAta.toBase58();
      const mintStr = usdcMint.toBase58();
      const accountKeys = parsedTx.transaction.message.accountKeys;
      const treasuryIdx = accountKeys.findIndex(
        (k) => k.pubkey.toBase58() === treasuryAtaStr
      );

      let receivedDelta = BigInt(0);
      if (treasuryIdx >= 0) {
        const preEntry = parsedTx.meta.preTokenBalances?.find(
          (b) => b.accountIndex === treasuryIdx && b.mint === mintStr
        );
        const postEntry = parsedTx.meta.postTokenBalances?.find(
          (b) => b.accountIndex === treasuryIdx && b.mint === mintStr
        );
        const preMicros = BigInt(preEntry?.uiTokenAmount?.amount || "0");
        const postMicros = BigInt(postEntry?.uiTokenAmount?.amount || "0");
        if (postMicros > preMicros) {
          receivedDelta = postMicros - preMicros;
        }
      }

      // Fallback check on parsed instructions if treasuryIdx token delta wasn't populated
      if (receivedDelta < params.expectedMicros) {
        for (const ix of parsedTx.transaction.message.instructions) {
          if ("parsed" in ix && ix.parsed && typeof ix.parsed === "object") {
            const parsed = ix.parsed as {
              type?: string;
              info?: {
                destination?: string;
                mint?: string;
                tokenAmount?: { amount?: string };
                amount?: string;
              };
            };
            if (
              (parsed.type === "transferChecked" || parsed.type === "transfer") &&
              parsed.info?.destination === treasuryAtaStr &&
              (!parsed.info.mint || parsed.info.mint === mintStr)
            ) {
              const amt = BigInt(
                parsed.info.tokenAmount?.amount || parsed.info.amount || "0"
              );
              if (amt > receivedDelta) receivedDelta = amt;
            }
          }
        }
      }

      if (receivedDelta < params.expectedMicros) {
        throw new BadRequestError(
          `USDC transfer amount mismatch: expected ${(Number(params.expectedMicros) / 1_000_000).toFixed(2)} USDC, verified ${(Number(receivedDelta) / 1_000_000).toFixed(2)} USDC.`
        );
      }

      return {
        verified: true,
        treasuryWallet: treasuryPubkey.toBase58(),
        treasuryAta: treasuryAtaStr,
        receivedMicros: receivedDelta.toString(),
      };
    });
  } catch (err) {
    throw wrapSolanaRpcError(err, "Unable to verify USDC transfer transaction");
  }
}
