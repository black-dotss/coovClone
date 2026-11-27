import { getSession } from "./session";
import { getEnv } from "@/lib/env";

export * from "./types";
export * from "./session";
export * from "./policies";

/**
 * Neon Managed Better Auth configuration and server reference.
 */
export const auth = {
  api: {
    getSession: async (options?: { headers?: Headers }) => {
      const session = await getSession(options?.headers);
      if (!session) return null;
      return {
        user: session.user,
        session: {
          token: session.sessionToken,
          expiresAt: session.expiresAt.toISOString(),
          userId: session.user.id,
        },
      };
    },
  },
  options: {
    get baseURL() {
      try {
        return getEnv().NEON_AUTH_BASE_URL;
      } catch {
        return process.env.NEON_AUTH_BASE_URL || "https://ep-curly-dawn-bebv64a0.neonauth.c-9.us-east-2.aws.neon.tech/neondb/auth";
      }
    },
  },
};
