import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCreatePolar = vi.fn();
vi.mock("@polar-sh/sdk/2026-10", () => ({
  createPolar: (...args: unknown[]) => mockCreatePolar(...args),
}));

describe("Polar Client Configuration & Resolution", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/cookmycv_test",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("initializes Polar client with sandbox environment when POLAR_SERVER is sandbox", async () => {
    process.env.POLAR_ACCESS_TOKEN = "polar_oat_test_sandbox_token";
    process.env.POLAR_SERVER = "sandbox";

    const { getPolarClient } = await import("@/lib/payments/polar-client");
    getPolarClient();

    expect(mockCreatePolar).toHaveBeenCalledWith({
      accessToken: "polar_oat_test_sandbox_token",
      environment: "sandbox",
    });
  });

  it("initializes Polar client with production environment when POLAR_SERVER is production", async () => {
    process.env.POLAR_ACCESS_TOKEN = "polar_oat_test_prod_token";
    process.env.POLAR_SERVER = "production";

    const { getPolarClient } = await import("@/lib/payments/polar-client");
    getPolarClient();

    expect(mockCreatePolar).toHaveBeenCalledWith({
      accessToken: "polar_oat_test_prod_token",
      environment: "production",
    });
  });

  it("defaults to sandbox environment when POLAR_SERVER is omitted", async () => {
    process.env.POLAR_ACCESS_TOKEN = "polar_oat_test_default_token";
    delete process.env.POLAR_SERVER;

    const { getPolarClient } = await import("@/lib/payments/polar-client");
    getPolarClient();

    expect(mockCreatePolar).toHaveBeenCalledWith({
      accessToken: "polar_oat_test_default_token",
      environment: "sandbox",
    });
  });

  it("throws an error when POLAR_ACCESS_TOKEN is missing", async () => {
    process.env.POLAR_ACCESS_TOKEN = "";

    const { getPolarClient } = await import("@/lib/payments/polar-client");
    expect(() => getPolarClient()).toThrow("POLAR_ACCESS_TOKEN is not configured");
  });

  it("resolves tier product IDs correctly", async () => {
    process.env.POLAR_PRODUCT_ID_PRO_MONTHLY = "prod_pro_m";
    process.env.POLAR_PRODUCT_ID_PRO_PLUS_MONTHLY = "prod_plus_m";
    process.env.POLAR_PRODUCT_ID_PRO_PLUS_YEARLY = "prod_plus_y";
    process.env.POLAR_PRODUCT_ID_EXECUTIVE_UNLIMITED = "prod_exec_u";

    const { getPolarProductIdForTier } = await import("@/lib/payments/polar-client");

    expect(getPolarProductIdForTier("pro_monthly")).toBe("prod_pro_m");
    expect(getPolarProductIdForTier("pro_plus_monthly")).toBe("prod_plus_m");
    expect(getPolarProductIdForTier("pro_plus_yearly")).toBe("prod_plus_y");
    expect(getPolarProductIdForTier("executive_unlimited")).toBe("prod_exec_u");
    expect(getPolarProductIdForTier("unlimited_yearly")).toBe("prod_exec_u");
  });
});
