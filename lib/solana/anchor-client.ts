import { AnchorProvider, type Idl, Program, type Wallet } from "@coral-xyz/anchor";
import { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import rawLegacyIdl from "@/solana/idl/coov_solana.json";
import {
  ACCOUNT_DISCRIMINATORS,
  IX_DISCRIMINATORS,
  deriveClaimReceiptPda,
  deriveConfigPda,
  deriveConvictionStakePda,
  deriveEscrowPda,
  deriveEscrowVaultPda,
  deriveEvaluationPda,
  deriveProfilePda,
  uuidToBytes16,
} from "./codec";
import { getProgramId, getSolanaConnection, withSolanaConnection } from "./config";

/**
 * Anchor 8-byte event discriminators: sha256("event:<EventName>")[0..8]
 */
export const EVENT_DISCRIMINATORS = {
  ProfileInitialized: [1, 31, 122, 19, 193, 205, 23, 27],
  EvaluationRecorded: [153, 179, 229, 190, 87, 53, 206, 178],
  EvaluationDefended: [208, 144, 25, 154, 179, 206, 176, 223],
  CredentialMinted: [13, 15, 67, 163, 30, 92, 149, 213],
  BountyCreated: [68, 252, 247, 196, 154, 247, 130, 49],
  BountyClaimed: [140, 202, 21, 51, 211, 65, 142, 21],
  BountyWithdrawn: [20, 146, 119, 119, 163, 30, 47, 147],
  ConvictionStakeLocked: [23, 107, 39, 3, 104, 61, 80, 2],
  ConvictionStakeApproved: [200, 162, 19, 134, 144, 162, 130, 112],
  FraudStakeSlashed: [40, 239, 240, 23, 60, 143, 226, 40],
  ConvictionStakeRefunded: [143, 215, 48, 4, 230, 22, 182, 136],
} as const;

type LegacyIdlType =
  | string
  | { option: LegacyIdlType }
  | { vec: LegacyIdlType }
  | { array: [LegacyIdlType, number] }
  | { defined: string };

interface LegacyIdlField {
  name: string;
  type: LegacyIdlType;
}

interface LegacyIdlAccountItem {
  name: string;
  isMut?: boolean;
  isSigner?: boolean;
  isOptional?: boolean;
}

interface LegacyIdl {
  version: string;
  name: string;
  instructions: Array<{
    name: string;
    accounts: LegacyIdlAccountItem[];
    args: LegacyIdlField[];
  }>;
  accounts: Array<{
    name: string;
    type: {
      kind: "struct";
      fields: LegacyIdlField[];
    };
  }>;
  events?: Array<{
    name: string;
    fields: Array<{
      name: string;
      type: LegacyIdlType;
      index?: boolean;
    }>;
  }>;
  types?: Array<{
    name: string;
    type:
      | {
          kind: "struct";
          fields: LegacyIdlField[];
        }
      | {
          kind: "enum";
          variants: Array<{ name: string }>;
        };
  }>;
  errors?: Array<{
    code: number;
    name: string;
    msg: string;
  }>;
}

function normalizeLegacyType(type: LegacyIdlType): Record<string, unknown> | string {
  if (typeof type === "string") {
    return type === "publicKey" ? "pubkey" : type;
  }
  if ("option" in type) {
    return { option: normalizeLegacyType(type.option) };
  }
  if ("vec" in type) {
    return { vec: normalizeLegacyType(type.vec) };
  }
  if ("array" in type) {
    return { array: [normalizeLegacyType(type.array[0]), type.array[1]] };
  }
  if ("defined" in type) {
    return { defined: { name: type.defined } };
  }
  return type as unknown as Record<string, unknown>;
}

/**
 * Converts our Anchor 0.29 `solana/idl/coov_solana.json` artifact into the Anchor v0.30+ IDL schema
 * expected by `@coral-xyz/anchor` (`^0.32.x`), preserving identical discriminators and Borsh layouts.
 */
export function normalizeIdlForAnchor(programId: PublicKey = getProgramId()): Idl {
  const legacy = rawLegacyIdl as unknown as LegacyIdl;

  const instructions = legacy.instructions.map((ix) => {
    const disc = IX_DISCRIMINATORS[ix.name as keyof typeof IX_DISCRIMINATORS];
    if (!disc) {
      throw new Error(`Missing instruction discriminator for ${ix.name}`);
    }
    return {
      name: ix.name,
      discriminator: Array.from(disc),
      accounts: ix.accounts.map((acc) => ({
        name: acc.name,
        writable: Boolean(acc.isMut),
        signer: Boolean(acc.isSigner),
        optional: Boolean(acc.isOptional),
      })),
      args: ix.args.map((arg) => ({
        name: arg.name,
        type: normalizeLegacyType(arg.type),
      })),
    };
  });

  const accounts = legacy.accounts.map((acc) => {
    const disc = ACCOUNT_DISCRIMINATORS[acc.name as keyof typeof ACCOUNT_DISCRIMINATORS];
    if (!disc) {
      throw new Error(`Missing account discriminator for ${acc.name}`);
    }
    return {
      name: acc.name,
      discriminator: Array.from(disc),
    };
  });

  const events = (legacy.events ?? []).map((ev) => {
    const disc = EVENT_DISCRIMINATORS[ev.name as keyof typeof EVENT_DISCRIMINATORS];
    if (!disc) {
      throw new Error(`Missing event discriminator for ${ev.name}`);
    }
    return {
      name: ev.name,
      discriminator: Array.from(disc),
    };
  });

  const types = [
    ...legacy.accounts.map((acc) => ({
      name: acc.name,
      type: {
        kind: "struct" as const,
        fields: acc.type.fields.map((f) => ({
          name: f.name,
          type: normalizeLegacyType(f.type),
        })),
      },
    })),
    ...(legacy.events ?? []).map((ev) => ({
      name: ev.name,
      type: {
        kind: "struct" as const,
        fields: ev.fields.map((f) => ({
          name: f.name,
          type: normalizeLegacyType(f.type),
        })),
      },
    })),
    ...(legacy.types ?? []).map((t) =>
      t.type.kind === "enum"
        ? {
            name: t.name,
            type: {
              kind: "enum" as const,
              variants: t.type.variants,
            },
          }
        : {
            name: t.name,
            type: {
              kind: "struct" as const,
              fields: t.type.fields.map((f) => ({
                name: f.name,
                type: normalizeLegacyType(f.type),
              })),
            },
          }
    ),
  ];

  return {
    address: programId.toBase58(),
    metadata: {
      name: legacy.name,
      version: legacy.version,
      spec: "0.1.0",
      description: "COOV Verified Hiring & Anti-Fraud Escrow Protocol",
    },
    instructions,
    accounts,
    types,
    events,
    errors: legacy.errors ?? [],
  } as unknown as Idl;
}

class ReadOnlyAnchorWallet implements Wallet {
  readonly payer = undefined as unknown as Wallet["payer"];
  constructor(readonly publicKey: PublicKey) {}

  async signTransaction<T extends Transaction | VersionedTransaction>(_tx: T): Promise<T> {
    throw new Error(`ReadOnlyAnchorWallet (${this.publicKey.toBase58()}) cannot sign transactions.`);
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    throw new Error(
      `ReadOnlyAnchorWallet (${this.publicKey.toBase58()}) cannot sign ${txs.length} transactions.`
    );
  }
}

export function createReadOnlyAnchorProvider(
  connection: Connection = getSolanaConnection(),
  publicKey: PublicKey = getProgramId()
): AnchorProvider {
  return new AnchorProvider(connection, new ReadOnlyAnchorWallet(publicKey), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
}

export function getCoovAnchorProgram(
  connection: Connection = getSolanaConnection(),
  programId: PublicKey = getProgramId()
): Program<Idl> {
  const idl = normalizeIdlForAnchor(programId);
  const provider = createReadOnlyAnchorProvider(connection, programId);
  return new Program(idl, provider);
}

/**
 * Fetches and deserializes global `ProgramConfig` PDA via `program.account.programConfig.fetchNullable`.
 */
export async function fetchConfigViaAnchor(programId: PublicKey = getProgramId()) {
  const [configPda] = deriveConfigPda(programId);
  const account = await withSolanaConnection(async (connection) => {
    const program = getCoovAnchorProgram(connection, programId);
    const ns = program.account as Record<
      string,
      { fetchNullable: (addr: PublicKey) => Promise<Record<string, unknown> | null> }
    >;
    return ns.programConfig.fetchNullable(configPda);
  });
  return { configPda: configPda.toBase58(), account };
}

/**
 * Fetches and deserializes a candidate's `CandidateProfile` PDA via Anchor IDL coder.
 */
export async function fetchProfileViaAnchor(
  candidateWallet: string | PublicKey,
  programId: PublicKey = getProgramId()
) {
  const candidatePubkey =
    typeof candidateWallet === "string" ? new PublicKey(candidateWallet) : candidateWallet;
  const [profilePda] = deriveProfilePda(candidatePubkey, programId);
  const account = await withSolanaConnection(async (connection) => {
    const program = getCoovAnchorProgram(connection, programId);
    const ns = program.account as Record<
      string,
      { fetchNullable: (addr: PublicKey) => Promise<Record<string, unknown> | null> }
    >;
    return ns.candidateProfile.fetchNullable(profilePda);
  });
  return { profilePda: profilePda.toBase58(), account };
}

/**
 * Fetches and deserializes an `EvaluationRecord` Proof PDA (`[b"eval", candidate, eval_id]`) via Anchor.
 */
export async function fetchEvaluationProofViaAnchor(
  candidateWallet: string | PublicKey,
  evalId: string,
  programId: PublicKey = getProgramId()
) {
  const candidatePubkey =
    typeof candidateWallet === "string" ? new PublicKey(candidateWallet) : candidateWallet;
  const [evaluationPda] = deriveEvaluationPda(candidatePubkey, uuidToBytes16(evalId), programId);
  const account = await withSolanaConnection(async (connection) => {
    const program = getCoovAnchorProgram(connection, programId);
    const ns = program.account as Record<
      string,
      { fetchNullable: (addr: PublicKey) => Promise<Record<string, unknown> | null> }
    >;
    return ns.evaluationRecord.fetchNullable(evaluationPda);
  });
  return { evaluationPda: evaluationPda.toBase58(), account };
}

/**
 * Fetches and deserializes a `BountyEscrow` PDA + derives its USDC vault PDA via Anchor.
 */
export async function fetchBountyEscrowViaAnchor(
  jobId: string,
  programId: PublicKey = getProgramId()
) {
  const [escrowPda] = deriveEscrowPda(uuidToBytes16(jobId), programId);
  const [vaultPda] = deriveEscrowVaultPda(escrowPda, programId);
  const account = await withSolanaConnection(async (connection) => {
    const program = getCoovAnchorProgram(connection, programId);
    const ns = program.account as Record<
      string,
      { fetchNullable: (addr: PublicKey) => Promise<Record<string, unknown> | null> }
    >;
    return ns.bountyEscrow.fetchNullable(escrowPda);
  });
  return {
    escrowPda: escrowPda.toBase58(),
    vaultPda: vaultPda.toBase58(),
    account,
  };
}

/**
 * Fetches and deserializes a `ConvictionStake` PDA (`["conviction_stake", escrow, candidate]`) via Anchor.
 */
export async function fetchConvictionStakeViaAnchor(
  jobId: string,
  candidateWallet: string | PublicKey,
  programId: PublicKey = getProgramId()
) {
  const candidatePubkey =
    typeof candidateWallet === "string" ? new PublicKey(candidateWallet) : candidateWallet;
  const [escrowPda] = deriveEscrowPda(uuidToBytes16(jobId), programId);
  const [stakePda] = deriveConvictionStakePda(escrowPda, candidatePubkey, programId);
  const account = await withSolanaConnection(async (connection) => {
    const program = getCoovAnchorProgram(connection, programId);
    const ns = program.account as Record<
      string,
      { fetchNullable: (addr: PublicKey) => Promise<Record<string, unknown> | null> }
    >;
    return ns.convictionStake.fetchNullable(stakePda);
  });
  return {
    escrowPda: escrowPda.toBase58(),
    stakePda: stakePda.toBase58(),
    account,
  };
}

/**
 * Convenience re-exports grouping PDA derivation helpers alongside Anchor deserialization.
 */
export const COOV_PDAS = {
  deriveConfigPda,
  deriveProfilePda,
  deriveEvaluationPda,
  deriveEscrowPda,
  deriveEscrowVaultPda,
  deriveClaimReceiptPda,
  deriveConvictionStakePda,
} as const;
