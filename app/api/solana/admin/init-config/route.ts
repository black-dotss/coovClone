import { z } from "zod";
import { createApiHandler, successResponse, BadRequestError } from "@/lib/shared";
import { requireAuth } from "@/lib/auth";
import { assertAdmin } from "@/lib/operations/admin";
import {
  confirmSubmittedSignature,
  fetchOnChainConfig,
  getOracleKeypair,
  initializeProgramConfig,
  prepareAdminInitializeConfigTx,
} from "@/lib/solana";

const AdminInitSchema = z
  .object({
    adminWallet: z.string().min(32).max(64).optional(),
    txSignature: z.string().min(32).max(128).optional(),
  })
  .optional();

export const GET = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  assertAdmin(session.user);
  const status = await fetchOnChainConfig();
  let expectedOracleAuthority: string | null = null;
  try {
    expectedOracleAuthority = getOracleKeypair().publicKey.toBase58();
  } catch {
    expectedOracleAuthority = null;
  }
  return successResponse({
    ...status,
    expectedOracleAuthority,
  });
});

export const POST = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  assertAdmin(session.user);

  const rawBody = await req.json().catch(() => ({}));
  const parsed = AdminInitSchema.parse(rawBody);

  if (parsed?.adminWallet) {
    const prepared = await prepareAdminInitializeConfigTx(parsed.adminWallet);
    return successResponse(prepared);
  }

  const result = await initializeProgramConfig();
  return successResponse(result, {
    status: result.alreadyInitialized ? 200 : 201,
  });
});

export const PATCH = createApiHandler(async (req: Request) => {
  const session = await requireAuth(req.headers);
  assertAdmin(session.user);

  const body = await req.json();
  const parsed = z
    .object({ txSignature: z.string().min(32).max(128) })
    .parse(body);

  await confirmSubmittedSignature(parsed.txSignature);
  const config = await fetchOnChainConfig();
  if (!config.initialized) {
    throw new BadRequestError("ProgramConfig PDA was not found on-chain after transaction.");
  }

  return successResponse(config);
});
