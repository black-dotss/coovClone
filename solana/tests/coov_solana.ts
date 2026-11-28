import { BN, BorshInstructionCoder } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getMintLen,
  unpackMint,
} from "@solana/spl-token";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DISCRIMINATORS,
  COOV_PDAS,
  DEFAULT_DEVNET_RPC,
  DEFAULT_DEVNET_USDC_MINT,
  DEFAULT_SOLANA_PROGRAM_ID,
  buildClaimBountyIx,
  buildCreateBountyEscrowIx,
  decodeBountyEscrow,
  getCoovAnchorProgram,
  normalizeIdlForAnchor,
  uuidToBytes16,
} from "../../lib/solana";

const PROGRAM_ID = new PublicKey(DEFAULT_SOLANA_PROGRAM_ID);
const DEVNET_USDC_MINT = new PublicKey(DEFAULT_DEVNET_USDC_MINT);

describe("COOV Anchor Program & Multi-SDK Integration", () => {
  it("normalizes Anchor IDL and binds to live Devnet Program ID", () => {
    const idl = normalizeIdlForAnchor(PROGRAM_ID);
    const connection = new Connection(DEFAULT_DEVNET_RPC, "confirmed");
    const program = getCoovAnchorProgram(connection, PROGRAM_ID);

    expect(program.programId.equals(PROGRAM_ID)).toBe(true);
    expect(idl.address).toBe(DEFAULT_SOLANA_PROGRAM_ID);
    expect(program.account).toHaveProperty("programConfig");
    expect(program.account).toHaveProperty("candidateProfile");
    expect(program.account).toHaveProperty("evaluationRecord");
    expect(program.account).toHaveProperty("bountyEscrow");
    expect(program.account).toHaveProperty("bountyClaim");
  });

  it("derives deterministic Anchor PDAs for Config, CandidateProfile, EvaluationRecord, and BountyEscrow", () => {
    const candidate = Keypair.generate().publicKey;
    const evalId = "550e8400-e29b-41d4-a716-446655440000";
    const jobId = "770e8400-e29b-41d4-a716-446655440099";

    const [configPda, configBump] = COOV_PDAS.deriveConfigPda(PROGRAM_ID);
    const [expectedConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      PROGRAM_ID
    );
    expect(configPda.equals(expectedConfigPda)).toBe(true);
    expect(configBump).toBeGreaterThanOrEqual(0);

    const [profilePda] = COOV_PDAS.deriveProfilePda(candidate, PROGRAM_ID);
    const [expectedProfilePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("profile"), candidate.toBuffer()],
      PROGRAM_ID
    );
    expect(profilePda.equals(expectedProfilePda)).toBe(true);

    const [evaluationPda] = COOV_PDAS.deriveEvaluationPda(candidate, evalId, PROGRAM_ID);
    const [expectedEvalPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("eval"), candidate.toBuffer(), Buffer.from(uuidToBytes16(evalId))],
      PROGRAM_ID
    );
    expect(evaluationPda.equals(expectedEvalPda)).toBe(true);

    const [escrowPda] = COOV_PDAS.deriveEscrowPda(jobId, PROGRAM_ID);
    const [vaultPda] = COOV_PDAS.deriveEscrowVaultPda(escrowPda, PROGRAM_ID);
    const [claimPda] = COOV_PDAS.deriveClaimReceiptPda(escrowPda, candidate, PROGRAM_ID);

    expect(
      escrowPda.equals(
        PublicKey.findProgramAddressSync(
          [Buffer.from("escrow"), Buffer.from(uuidToBytes16(jobId))],
          PROGRAM_ID
        )[0]
      )
    ).toBe(true);
    expect(
      vaultPda.equals(
        PublicKey.findProgramAddressSync(
          [Buffer.from("escrow_vault"), escrowPda.toBuffer()],
          PROGRAM_ID
        )[0]
      )
    ).toBe(true);
    expect(
      claimPda.equals(
        PublicKey.findProgramAddressSync(
          [Buffer.from("claim"), escrowPda.toBuffer(), candidate.toBuffer()],
          PROGRAM_ID
        )[0]
      )
    ).toBe(true);
  });

  it("verifies Token-2022 Non-Transferable SBT extension sizing & ATA ownership", () => {
    const sbtMint = Keypair.generate().publicKey;
    const candidate = Keypair.generate().publicKey;

    const minMintLenWithSbtExtensions = getMintLen([
      ExtensionType.NonTransferable,
      ExtensionType.MetadataPointer,
    ]);
    // 82-byte base mint + 84-byte AccountType/padding + TLV extension headers
    expect(minMintLenWithSbtExtensions).toBeGreaterThan(166);

    const candidateSbtAta = getAssociatedTokenAddressSync(
      sbtMint,
      candidate,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const [candidateSbtAtaExpected] = PublicKey.findProgramAddressSync(
      [candidate.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), sbtMint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    expect(candidateSbtAta.equals(candidateSbtAtaExpected)).toBe(true);
  });

  it("validates Devnet USDC escrow Borsh accounting and instruction parity via Anchor Coder", () => {
    const recruiter = Keypair.generate().publicKey;
    const candidate = Keypair.generate().publicKey;
    const jobId = "123e4567-e89b-12d3-a456-426614174000";
    const evalId = "987e6543-e21b-12d3-a456-426614174111";

    const rewardPerWinnerMicros = BigInt(4_000_000); // 4.00 USDC (6 decimals)
    const maxWinners = 5;
    const totalPoolMicros = rewardPerWinnerMicros * BigInt(maxWinners);
    expect(totalPoolMicros).toBe(BigInt(20_000_000)); // 20.00 USDC locked in EscrowVault PDA

    const createIx = buildCreateBountyEscrowIx({
      recruiter,
      usdcMint: DEVNET_USDC_MINT,
      jobId,
      minScore: 85,
      rewardPerWinnerMicros,
      maxWinners,
      expiresAtUnix: Math.floor(Date.now() / 1000) + 30 * 86_400,
      tokenProgramId: TOKEN_PROGRAM_ID,
      programId: PROGRAM_ID,
    });

    const program = getCoovAnchorProgram(
      new Connection(DEFAULT_DEVNET_RPC, "confirmed"),
      PROGRAM_ID
    );
    const ixCoder = program.coder.instruction as BorshInstructionCoder;
    const decodedCreate = ixCoder.decode(Buffer.from(createIx.data));
    expect(decodedCreate?.name).toBe("createBountyEscrow");
    const encodedViaAnchor = program.coder.instruction.encode("createBountyEscrow", {
      jobId: Array.from(uuidToBytes16(jobId)),
      minScore: 85,
      rewardPerWinner: new BN(rewardPerWinnerMicros.toString()),
      maxWinners,
      expiresAt: new BN((decodedCreate?.data as { expiresAt: BN }).expiresAt.toString()),
    });
    expect(Buffer.from(createIx.data).equals(encodedViaAnchor)).toBe(true);

    // Build synthetic BountyEscrow account buffer and cross-verify Anchor coder vs codec.ts decoder
    const [escrowPda] = COOV_PDAS.deriveEscrowPda(jobId, PROGRAM_ID);
    const [vaultPda, vaultBump] = COOV_PDAS.deriveEscrowVaultPda(escrowPda, PROGRAM_ID);

    const exactEscrowBuf = Buffer.concat([
      Buffer.from(ACCOUNT_DISCRIMINATORS.BountyEscrow),
      recruiter.toBuffer(),
      Buffer.from(uuidToBytes16(jobId)),
      DEVNET_USDC_MINT.toBuffer(),
      vaultPda.toBuffer(),
      Buffer.from(new BN(rewardPerWinnerMicros.toString()).toArray("le", 8)),
      Buffer.from(new Uint8Array([maxWinners & 0xff, (maxWinners >> 8) & 0xff])),
      Buffer.from(new Uint8Array([1, 0])), // claimsCount = 1
      Buffer.from([85]), // minScore
      Buffer.from(new BN(1_800_000_000).toArray("le", 8)),
      Buffer.from([0]), // isClosed = false
      Buffer.from([254]), // bump
      Buffer.from([vaultBump]),
    ]);

    const decodedCodec = decodeBountyEscrow(exactEscrowBuf);
    const decodedAnchor = program.coder.accounts.decode<{
      recruiter: PublicKey;
      minScore: number;
      maxWinners: number;
      claimsCount: number;
      rewardPerWinner: BN;
    }>("bountyEscrow", exactEscrowBuf);

    expect(decodedAnchor.recruiter.toBase58()).toBe(decodedCodec.recruiter);
    expect(decodedAnchor.minScore).toBe(decodedCodec.minScore);
    expect(decodedAnchor.maxWinners).toBe(decodedCodec.maxWinners);
    expect(decodedAnchor.claimsCount).toBe(decodedCodec.claimsCount);
    expect(decodedAnchor.rewardPerWinner.toString()).toBe(decodedCodec.rewardPerWinnerMicros);

    const claimIx = buildClaimBountyIx({
      candidate,
      usdcMint: DEVNET_USDC_MINT,
      jobId,
      evalId,
      tokenProgramId: TOKEN_PROGRAM_ID,
      programId: PROGRAM_ID,
    });
    expect(claimIx.keys[2].pubkey.equals(escrowPda)).toBe(true);
    expect(claimIx.keys[3].pubkey.equals(vaultPda)).toBe(true);
  });

  it("inspects live Solana Devnet program, USDC mint (6 decimals), and ProgramConfig PDA", async () => {
    const rpcUrl = process.env.SOLANA_RPC_URL || DEFAULT_DEVNET_RPC;
    const connection = new Connection(rpcUrl, "confirmed");
    const program = getCoovAnchorProgram(connection, PROGRAM_ID);

    try {
      const [programInfo, usdcInfo] = await Promise.all([
        connection.getAccountInfo(PROGRAM_ID, "confirmed"),
        connection.getAccountInfo(DEVNET_USDC_MINT, "confirmed"),
      ]);

      expect(programInfo).not.toBeNull();
      expect(programInfo?.executable).toBe(true);

      expect(usdcInfo).not.toBeNull();
      if (usdcInfo) {
        const parsedUsdc = unpackMint(DEVNET_USDC_MINT, usdcInfo, usdcInfo.owner);
        expect(parsedUsdc.decimals).toBe(6);
      }

      const [configPda] = COOV_PDAS.deriveConfigPda(PROGRAM_ID);
      const ns = program.account as Record<
        string,
        { fetchNullable: (addr: PublicKey) => Promise<Record<string, unknown> | null> }
      >;
      const configAcc = await ns.programConfig.fetchNullable(configPda);
      if (configAcc) {
        expect(configAcc).toHaveProperty("oracleAuthority");
      }
    } catch (err) {
      // Skip network flakiness gracefully in offline CI sandboxes
      const msg = err instanceof Error ? err.message : String(err);
      if (!/fetch|ETIMEDOUT|ECONN|ENOTFOUND|429/i.test(msg)) {
        throw err;
      }
    }
  });
});
