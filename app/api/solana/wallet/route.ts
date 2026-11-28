import { PublicKey } from "@solana/web3.js";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { userProfiles } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import {
  BadRequestError,
  ConflictError,
  createApiHandler,
  successResponse,
} from "@/lib/shared";
import {
  buildWalletLinkMessage,
  deriveProfilePda,
  deriveReputationPda,
  fetchOnChainProfile,
  fetchOnChainReputation,
  fetchWalletCredentials,
  getExplorerAddressUrl,
  getSolanaCluster,
  parseWalletLinkMessage,
  verifySolanaWalletSignature,
} from "@/lib/solana";

const WalletPostSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("challenge"),
    walletAddress: z.string().min(32).max(64),
  }),
  z.object({
    action: z.literal("link"),
    walletAddress: z.string().min(32).max(64),
    message: z.string().min(20).max(512),
    signatureBase64: z.string().min(40).max(256),
  }),
]);

function assertValidPubkey(walletAddress: string): PublicKey {
  try {
    return new PublicKey(walletAddress);
  } catch {
    throw new BadRequestError("Invalid Solana wallet address");
  }
}

export const GET = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  const url = new URL(req.url);
  const previewWallet = url.searchParams.get("wallet")?.trim() || null;

  const [profile] = await db
    .select({
      walletAddress: userProfiles.walletAddress,
      walletVerifiedAt: userProfiles.walletVerifiedAt,
      profilePdaAddress: userProfiles.profilePdaAddress,
      profileTxSignature: userProfiles.profileTxSignature,
    })
    .from(userProfiles)
    .where(eq(userProfiles.userId, session.user.id))
    .limit(1);

  const targetWallet = previewWallet || profile?.walletAddress || null;
  let onChainProfile = null;
  let onChainReputation = null;
  let credentials: Awaited<ReturnType<typeof fetchWalletCredentials>> = [];
  let onChainError: string | null = null;
  let derivedProfilePda: string | null = null;
  let derivedReputationPda: string | null = null;

  if (targetWallet) {
    try {
      const pubkey = assertValidPubkey(targetWallet);
      derivedProfilePda = deriveProfilePda(pubkey)[0].toBase58();
      derivedReputationPda = deriveReputationPda(pubkey)[0].toBase58();
      const [profileRes, repRes, sbtRes] = await Promise.all([
        fetchOnChainProfile(targetWallet),
        fetchOnChainReputation(targetWallet),
        fetchWalletCredentials(targetWallet),
      ]);
      onChainProfile = profileRes.profile;
      derivedProfilePda = profileRes.profilePda;
      onChainReputation = repRes.reputation;
      derivedReputationPda = repRes.reputationPda;
      credentials = sbtRes;
    } catch (err) {
      onChainError =
        err instanceof Error ? err.message : "Failed to load Solana on-chain data";
    }
  }

  return successResponse({
    cluster: getSolanaCluster(),
    linkedWallet: profile?.walletAddress ?? null,
    walletVerifiedAt: profile?.walletVerifiedAt ?? null,
    profilePdaAddress: profile?.profilePdaAddress ?? derivedProfilePda,
    reputationPdaAddress: derivedReputationPda,
    profileTxSignature: profile?.profileTxSignature ?? null,
    explorerProfileUrl: (profile?.profilePdaAddress ?? derivedProfilePda)
      ? getExplorerAddressUrl((profile?.profilePdaAddress ?? derivedProfilePda)!)
      : null,
    onChainProfile,
    onChainReputation,
    credentials,
    onChainError,
  });
});

export const POST = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  const body = await req.json();
  const parsed = WalletPostSchema.parse(body);

  const pubkey = assertValidPubkey(parsed.walletAddress);
  const canonicalWallet = pubkey.toBase58();

  if (parsed.action === "challenge") {
    const message = buildWalletLinkMessage({
      userId: session.user.id,
      walletAddress: canonicalWallet,
      issuedAt: new Date().toISOString(),
      nonce: globalThis.crypto.randomUUID(),
    });
    return successResponse({
      walletAddress: canonicalWallet,
      message,
    });
  }

  const parsedMsg = parseWalletLinkMessage(parsed.message);
  if (!parsedMsg) {
    throw new BadRequestError("Malformed wallet verification challenge message");
  }
  if (parsedMsg.userId !== session.user.id) {
    throw new BadRequestError("Challenge belongs to a different user session");
  }
  if (parsedMsg.walletAddress !== canonicalWallet) {
    throw new BadRequestError("Challenge wallet address mismatch");
  }

  const issuedMs = Date.parse(parsedMsg.issuedAt);
  if (Number.isNaN(issuedMs) || Math.abs(Date.now() - issuedMs) > 10 * 60_000) {
    throw new BadRequestError("Wallet verification challenge expired. Please try again.");
  }

  const valid = await verifySolanaWalletSignature({
    walletAddress: canonicalWallet,
    message: parsed.message,
    signatureBase64: parsed.signatureBase64,
  });
  if (!valid) {
    throw new BadRequestError("Solana Ed25519 signature verification failed");
  }

  const [existingOwner] = await db
    .select({ userId: userProfiles.userId })
    .from(userProfiles)
    .where(
      and(
        eq(userProfiles.walletAddress, canonicalWallet),
        ne(userProfiles.userId, session.user.id)
      )
    )
    .limit(1);

  if (existingOwner) {
    throw new ConflictError("This Solana wallet is already linked to another COOV account.");
  }

  const [derivedProfilePda] = deriveProfilePda(pubkey);
  const [derivedReputationPda] = deriveReputationPda(pubkey);
  const profilePdaAddress = derivedProfilePda.toBase58();
  const reputationPdaAddress = derivedReputationPda.toBase58();
  const now = new Date();

  const [existingProfile] = await db
    .select({ id: userProfiles.id })
    .from(userProfiles)
    .where(eq(userProfiles.userId, session.user.id))
    .limit(1);

  if (existingProfile) {
    await db
      .update(userProfiles)
      .set({
        walletAddress: canonicalWallet,
        walletVerifiedAt: now,
        profilePdaAddress,
        updatedAt: now,
      })
      .where(eq(userProfiles.userId, session.user.id));
  } else {
    await db.insert(userProfiles).values({
      userId: session.user.id,
      displayName: session.user.name || "COOV Candidate",
      walletAddress: canonicalWallet,
      walletVerifiedAt: now,
      profilePdaAddress,
    });
  }

  let onChainProfile = null;
  let onChainReputation = null;
  let credentials: Awaited<ReturnType<typeof fetchWalletCredentials>> = [];
  try {
    const [profileRes, repRes, sbtRes] = await Promise.all([
      fetchOnChainProfile(canonicalWallet),
      fetchOnChainReputation(canonicalWallet),
      fetchWalletCredentials(canonicalWallet),
    ]);
    onChainProfile = profileRes.profile;
    onChainReputation = repRes.reputation;
    credentials = sbtRes;
  } catch {
    // Non-fatal on link
  }

  return successResponse({
    linkedWallet: canonicalWallet,
    walletVerifiedAt: now,
    profilePdaAddress,
    reputationPdaAddress,
    explorerProfileUrl: getExplorerAddressUrl(profilePdaAddress),
    onChainProfile,
    onChainReputation,
    credentials,
  });
});

export const DELETE = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);

  await db
    .update(userProfiles)
    .set({
      walletAddress: null,
      walletVerifiedAt: null,
      profilePdaAddress: null,
      profileTxSignature: null,
      updatedAt: new Date(),
    })
    .where(eq(userProfiles.userId, session.user.id));

  return successResponse({ unlinked: true });
});
