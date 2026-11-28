import { PublicKey } from "@solana/web3.js";

const GLOBAL_SCOUT_REF_KEY = "coov_scout_referrer_global";
const BOUNTY_SCOUT_REF_PREFIX = "coov_scout_referrer:";

export function normalizeValidSolanaWallet(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length < 32 || trimmed.length > 64) return null;
  try {
    return new PublicKey(trimmed).toBase58();
  } catch {
    return null;
  }
}

export function captureScoutReferralFromSearch(
  search: string | URLSearchParams,
  bountyOrJobIds: string[] = []
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const params =
      typeof search === "string" ? new URLSearchParams(search) : search;
    const rawRef = params.get("ref") ?? params.get("referrer");
    const valid = normalizeValidSolanaWallet(rawRef);
    if (!valid) return null;

    window.localStorage.setItem(GLOBAL_SCOUT_REF_KEY, valid);
    for (const id of bountyOrJobIds) {
      if (id) {
        window.localStorage.setItem(`${BOUNTY_SCOUT_REF_PREFIX}${id}`, valid);
      }
    }
    return valid;
  } catch {
    return null;
  }
}

export function getStoredScoutReferral(
  bountyOrJobIds: string[] = [],
  candidateWallet?: string | null
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const urlRef = captureScoutReferralFromSearch(
      window.location.search,
      bountyOrJobIds
    );
    let resolved: string | null = urlRef;

    if (!resolved) {
      for (const id of bountyOrJobIds) {
        if (!id) continue;
        const stored = normalizeValidSolanaWallet(
          window.localStorage.getItem(`${BOUNTY_SCOUT_REF_PREFIX}${id}`)
        );
        if (stored) {
          resolved = stored;
          break;
        }
      }
    }

    if (!resolved) {
      resolved = normalizeValidSolanaWallet(
        window.localStorage.getItem(GLOBAL_SCOUT_REF_KEY)
      );
    }

    const cleanCandidate = normalizeValidSolanaWallet(candidateWallet);
    if (resolved && cleanCandidate && resolved === cleanCandidate) {
      return null;
    }
    return resolved;
  } catch {
    return null;
  }
}
