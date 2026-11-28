import { describe, expect, it, vi, beforeEach } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  DEFAULT_DEVNET_RPC,
  DEFAULT_SOLANA_PROGRAM_ID,
  EVENT_DISCRIMINATORS,
  deriveConfigPda,
  deriveEscrowPda,
  deriveEscrowVaultPda,
  getCoovAnchorProgram,
  normalizeIdlForAnchor,
} from "@/lib/solana";
import { Connection } from "@solana/web3.js";
import { GET as getActionsJson, OPTIONS as optionsActionsJson } from "@/app/actions.json/route";

describe("Anchor Client Adapter & Solana Actions (Blinks) Discovery", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes legacy Anchor IDL into Anchor 0.32 spec with matching discriminators", () => {
    const programId = new PublicKey(DEFAULT_SOLANA_PROGRAM_ID);
    const normalized = normalizeIdlForAnchor(programId);

    expect(normalized.address).toBe(DEFAULT_SOLANA_PROGRAM_ID);
    expect(normalized.events?.length).toBe(Object.keys(EVENT_DISCRIMINATORS).length);

    const program = getCoovAnchorProgram(
      new Connection(DEFAULT_DEVNET_RPC, "confirmed"),
      programId
    );
    expect(program.programId.toBase58()).toBe(DEFAULT_SOLANA_PROGRAM_ID);
    const accounts = program.account as Record<string, { fetchNullable?: unknown }>;
    expect(typeof accounts.bountyEscrow?.fetchNullable).toBe("function");
    expect(typeof accounts.evaluationRecord?.fetchNullable).toBe("function");
  });

  it("serves compliant Solana Actions rules and CORS headers at /actions.json", async () => {
    const res = await getActionsJson();
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const json = (await res.json()) as { rules: Array<{ pathPattern: string; apiPath: string }> };
    expect(json.rules.some((r) => r.pathPattern === "/bounties/*" && r.apiPath === "/api/actions/bounty/*")).toBe(
      true
    );

    const optRes = await optionsActionsJson();
    expect(optRes.status).toBe(204);
    expect(optRes.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("returns 400 ActionError on malformed jobId UUID at /api/actions/bounty/[jobId]", async () => {
    const { GET, POST, OPTIONS } = await import("@/app/api/actions/bounty/[jobId]/route");

    const optRes = await OPTIONS();
    expect(optRes.status).toBe(204);
    expect(optRes.headers.get("X-Action-Version")).toBe("2.2");

    const badGet = await GET(new Request("https://coov.app/api/actions/bounty/not-a-uuid"), {
      params: Promise.resolve({ jobId: "not-a-uuid" }),
    });
    expect(badGet.status).toBe(400);
    expect(badGet.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const getBody = (await badGet.json()) as { message: string };
    expect(getBody.message).toMatch(/UUID/i);

    const wallet = Keypair.generate().publicKey.toBase58();
    const badPost = await POST(
      new Request("https://coov.app/api/actions/bounty/not-a-uuid", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: wallet }),
      }),
      { params: Promise.resolve({ jobId: "not-a-uuid" }) }
    );
    expect(badPost.status).toBe(400);
  });

  it("derives Escrow and Vault PDAs deterministically across SDK modules", () => {
    const jobId = "550e8400-e29b-41d4-a716-446655440000";
    const [configPda] = deriveConfigPda();
    const [escrowPda] = deriveEscrowPda(jobId);
    const [vaultPda] = deriveEscrowVaultPda(escrowPda);

    expect(configPda.toBase58()).toHaveLength(44);
    expect(escrowPda.toBase58()).not.toBe(vaultPda.toBase58());
  });
});
