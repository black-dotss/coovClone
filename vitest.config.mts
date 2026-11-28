import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts", "solana/tests/*.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./"),
      "@polar-sh/sdk/webhooks": path.resolve(import.meta.dirname, "./lib/payments/polar-webhooks.ts"),
    },
  },
});
