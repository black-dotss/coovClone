import { apiFetch } from "@/lib/client/api";

/**
 * Anchors an evaluation proof PDA on-chain (if not already anchored) and claims
 * the approved/unlocked Devnet USDC payout from a BountyEscrow PDA.
 */
export async function executeBountyClaimFlow(params: {
  bountyId: string;
  evaluationId: string;
  walletAddress: string;
  isEvalAnchored: boolean;
  signAndSubmitTx: (serializedTxBase64: string) => Promise<string>;
}): Promise<{ amountPaidUsdc: number; claimTxSignature: string }> {
  if (!params.isEvalAnchored) {
    const anchorPrep = await apiFetch<{ serializedTxBase64: string }>(
      `/api/solana/evaluations/${params.evaluationId}`,
      {
        method: "POST",
        body: JSON.stringify({
          walletAddress: params.walletAddress,
          action: "anchor",
        }),
      }
    );

    const anchorSig = await params.signAndSubmitTx(anchorPrep.serializedTxBase64);

    await apiFetch(`/api/solana/evaluations/${params.evaluationId}`, {
      method: "PATCH",
      body: JSON.stringify({
        walletAddress: params.walletAddress,
        txSignature: anchorSig,
      }),
    });
  }

  const claimPrep = await apiFetch<{ serializedTxBase64: string }>(
    `/api/solana/bounties/${params.bountyId}/claim`,
    {
      method: "POST",
      body: JSON.stringify({
        walletAddress: params.walletAddress,
        evaluationId: params.evaluationId,
      }),
    }
  );

  const claimTxSignature = await params.signAndSubmitTx(claimPrep.serializedTxBase64);

  const confirmed = await apiFetch<{ amountPaidUsdc: number }>(
    `/api/solana/bounties/${params.bountyId}/claim`,
    {
      method: "PATCH",
      body: JSON.stringify({
        walletAddress: params.walletAddress,
        evaluationId: params.evaluationId,
        txSignature: claimTxSignature,
      }),
    }
  );

  return {
    amountPaidUsdc: confirmed.amountPaidUsdc,
    claimTxSignature,
  };
}
