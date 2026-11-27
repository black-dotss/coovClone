import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/admin/grant-subscription/route";

let mockSessionUser: { id: string; email: string; name?: string } | null = {
  id: "admin-1",
  email: "israelashenafi29@gmail.com",
  name: "Israel Admin",
};

let inMemoryUsers: Record<string, unknown>[] = [];
let inMemorySubscriptions: Record<string, unknown>[] = [];

function createMockQuery<T>(data: T[]) {
  const promise = Promise.resolve(data);
  return Object.assign(promise, {
    limit: (n: number) => Promise.resolve(data.slice(0, n)),
    where: () => createMockQuery(data),
  });
}

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => {
    if (!mockSessionUser) {
      throw new Error("Authentication required");
    }
    return {
      user: mockSessionUser,
      sessionToken: "mock-token",
      expiresAt: new Date(Date.now() + 86400000),
    };
  }),
}));

vi.mock("@/lib/db", () => {
  const usersTable = { _name: "users" };
  const subsTable = { _name: "subscriptions" };

  return {
    db: {
      select: () => ({
        from: (table: unknown) => {
          if (table === usersTable) return createMockQuery(inMemoryUsers);
          if (table === subsTable) return createMockQuery(inMemorySubscriptions);
          return createMockQuery([]);
        },
      }),
      insert: (table: unknown) => ({
        values: (val: Record<string, unknown>) => {
          const record = { id: val.id || `id-${Date.now()}`, ...val, createdAt: new Date() };
          if (table === usersTable) {
            inMemoryUsers.push(record);
          } else if (table === subsTable) {
            inMemorySubscriptions.push(record);
          }
          const promise = Promise.resolve([record]);
          return Object.assign(promise, {
            returning: () => Promise.resolve([record]),
          });
        },
      }),
      update: (table: unknown) => ({
        set: (updates: Record<string, unknown>) => ({
          where: () => {
            if (table === subsTable && inMemorySubscriptions.length > 0) {
              Object.assign(inMemorySubscriptions[0], updates);
            }
            return Promise.resolve();
          },
        }),
      }),
    },
    users: usersTable,
    subscriptions: subsTable,
  };
});

describe("Admin Grant Subscription API", () => {
  beforeEach(() => {
    mockSessionUser = {
      id: "admin-1",
      email: "israelashenafi29@gmail.com",
      name: "Israel Admin",
    };
    inMemoryUsers = [];
    inMemorySubscriptions = [];
    vi.clearAllMocks();
  });

  it("rejects request if caller is not israelashenafi29@gmail.com", async () => {
    mockSessionUser = {
      id: "other-user",
      email: "other@gmail.com",
    };

    const req = new Request("http://localhost/api/admin/grant-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "student@example.com",
        planTier: "pro_monthly",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error.message).toContain("Only israelashenafi29@gmail.com can grant subscriptions");
  });

  it("successfully grants Pro Monthly subscription to a new user email", async () => {
    const req = new Request("http://localhost/api/admin/grant-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "reward@example.com",
        planTier: "pro_monthly",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.message).toBe('Successfully gave a Pro Monthly sub for "reward@example.com"');
    expect(inMemorySubscriptions).toHaveLength(1);
    expect(inMemorySubscriptions[0].status).toBe("active");
    expect(inMemorySubscriptions[0].planId).toBe("plan_pro_monthly");
  });

  it("successfully grants Pro Yearly subscription with 365 days duration", async () => {
    const req = new Request("http://localhost/api/admin/grant-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "yearly_user@example.com",
        planTier: "pro_yearly",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.message).toBe('Successfully gave a Pro Yearly sub for "yearly_user@example.com"');
    expect(inMemorySubscriptions[0].planId).toBe("plan_pro_yearly");
  });
});
