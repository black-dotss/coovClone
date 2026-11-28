"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useSession } from "@/lib/auth/auth-client";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { ErrorPopup } from "@/components/ui/error-popup";
import { FullPageLoading, LoadingSpinner } from "@/components/ui/loading-spinner";
import { Modal } from "@/components/ui/modal";

const SUPER_ADMIN_EMAIL = "israelashenafi29@gmail.com";

const PLAN_OPTIONS = [
  { id: "pro_monthly", name: "Pro Monthly" },
  { id: "pro_plus_monthly", name: "Pro Plus Monthly" },
  { id: "pro_yearly", name: "Pro Yearly" },
  { id: "pro_plus_yearly", name: "Pro Plus Yearly" },
  { id: "unlimited_yearly", name: "Unlimited Yearly" },
];

interface CrmOverview {
  totalUsers: number;
  totalActiveSubscriptions: number;
  totalEvaluations: number;
  completedEvaluations: number;
  failedEvaluations: number;
  processingEvaluations: number;
  totalDevices: number;
  activeDevices: number;
  ambiguousPayments: number;
  recentAuditEvents: Array<{
    id: string;
    userId: string | null;
    action: string;
    targetId: string | null;
    createdAt: string;
  }>;
}

interface CrmUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  accountStatus: string;
  subscription: {
    planId: string | null;
    planName: string | null;
    status: string | null;
    currentPeriodEnd: string | null;
  } | null;
  evaluationsCount: number;
  devicesCount: number;
  usage: {
    evaluationsUsed: number;
    evaluationsReserved: number;
  } | null;
}

interface UserDetailPayload {
  user: {
    id: string;
    name: string;
    email: string;
    createdAt: string;
  };
  profile: {
    accountStatus: string;
  };
  subscriptions: Array<{
    id: string;
    planId: string;
    planName: string | null;
    status: string;
    currentPeriodEnd: string;
  }>;
  devices: Array<{
    id: string;
    deviceId: string;
    status: string;
    lastSeenAt: string;
  }>;
  usage: {
    evaluationsUsed: number;
    evaluationsReserved: number;
  };
}

interface CrmDevice {
  id: string;
  deviceId: string;
  ownerEmail?: string | null;
  status: string;
  lastSeenAt: string;
  isTombstoned: boolean;
}

interface CrmEvaluation {
  id: string;
  ownerEmail?: string | null;
  status: string;
  overallScore: number | null;
  verdict: string | null;
  errorMessage: string | null;
  createdAt: string;
}

interface AmbiguousPayment {
  id: string;
  orderReference: string;
  planId: string;
  amountEtb: number;
  createdAt: string;
}

type NavTab = "overview" | "users" | "devices" | "reviews" | "payments" | "grant";

export default function AdminPage() {
  const { data: session, isPending: sessionLoading } = useSession();
  const [tab, setTab] = useState<NavTab>("overview");

  const [message, setMessage] = useState<{ text: string; type: "success" | "danger" } | null>(null);

  // Quick Free Device
  const [freeInput, setFreeInput] = useState("");
  const [freeing, setFreeing] = useState(false);

  // Overview
  const [overview, setOverview] = useState<CrmOverview | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);

  // Users
  const [users, setUsers] = useState<CrmUser[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [userPage, setUserPage] = useState(1);
  const [userTotalPages, setUserTotalPages] = useState(1);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [inspectUser, setInspectUser] = useState<UserDetailPayload | null>(null);

  // Devices
  const [devices, setDevices] = useState<CrmDevice[]>([]);
  const [deviceSearch, setDeviceSearch] = useState("");
  const [devicePage, setDevicePage] = useState(1);
  const [deviceTotalPages, setDeviceTotalPages] = useState(1);
  const [loadingDevices, setLoadingDevices] = useState(false);

  // Reviews
  const [reviews, setReviews] = useState<CrmEvaluation[]>([]);
  const [reviewSearch, setReviewSearch] = useState("");
  const [reviewStatus, setReviewStatus] = useState("all");
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewTotalPages, setReviewTotalPages] = useState(1);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  // Payments
  const [payments, setPayments] = useState<AmbiguousPayment[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);

  // Grant
  const [grantEmail, setGrantEmail] = useState("");
  const [grantPlan, setGrantPlan] = useState("pro_monthly");
  const [granting, setGranting] = useState(false);

  const [refreshKey, setRefreshKey] = useState(0);

  const currentUserEmail = (session?.user?.email || "").toLowerCase().trim();
  const isAuthorized = currentUserEmail === SUPER_ADMIN_EMAIL;

  useEffect(() => {
    if (!isAuthorized) return;
    let ignore = false;

    async function loadData() {
      if (tab === "overview") {
        setLoadingOverview(true);
        try {
          const res = await apiFetch<CrmOverview>("/api/admin/crm/overview");
          if (!ignore) setOverview(res);
        } catch (err) {
          if (!ignore) setMessage({ text: err instanceof Error ? err.message : "Failed to load overview", type: "danger" });
        } finally {
          if (!ignore) setLoadingOverview(false);
        }
      } else if (tab === "users") {
        setLoadingUsers(true);
        try {
          const res = await apiFetch<{ users: CrmUser[]; totalCount: number; page: number; totalPages: number }>(
            `/api/admin/crm/users?page=${userPage}&limit=20${userSearch ? `&search=${encodeURIComponent(userSearch)}` : ""}`
          );
          if (!ignore) {
            setUsers(res.users);
            setUserTotalPages(res.totalPages);
          }
        } catch (err) {
          if (!ignore) setMessage({ text: err instanceof Error ? err.message : "Failed to load users", type: "danger" });
        } finally {
          if (!ignore) setLoadingUsers(false);
        }
      } else if (tab === "devices") {
        setLoadingDevices(true);
        try {
          const res = await apiFetch<{ devices: CrmDevice[]; totalCount: number; page: number; totalPages: number }>(
            `/api/admin/crm/devices?page=${devicePage}&limit=25${deviceSearch ? `&search=${encodeURIComponent(deviceSearch)}` : ""}`
          );
          if (!ignore) {
            setDevices(res.devices);
            setDeviceTotalPages(res.totalPages);
          }
        } catch (err) {
          if (!ignore) setMessage({ text: err instanceof Error ? err.message : "Failed to load devices", type: "danger" });
        } finally {
          if (!ignore) setLoadingDevices(false);
        }
      } else if (tab === "reviews") {
        setLoadingReviews(true);
        try {
          const res = await apiFetch<{ evaluations: CrmEvaluation[]; totalCount: number; page: number; totalPages: number }>(
            `/api/admin/crm/evaluations?page=${reviewPage}&limit=20&status=${reviewStatus}${reviewSearch ? `&search=${encodeURIComponent(reviewSearch)}` : ""}`
          );
          if (!ignore) {
            setReviews(res.evaluations);
            setReviewTotalPages(res.totalPages);
          }
        } catch (err) {
          if (!ignore) setMessage({ text: err instanceof Error ? err.message : "Failed to load reviews", type: "danger" });
        } finally {
          if (!ignore) setLoadingReviews(false);
        }
      } else if (tab === "payments") {
        setLoadingPayments(true);
        try {
          const res = await apiFetch<AmbiguousPayment[]>("/api/admin/payments");
          if (!ignore) setPayments(res);
        } catch (err) {
          if (!ignore) setMessage({ text: err instanceof Error ? err.message : "Failed to load payments", type: "danger" });
        } finally {
          if (!ignore) setLoadingPayments(false);
        }
      }
    }

    loadData();
    return () => {
      ignore = true;
    };
  }, [tab, isAuthorized, userPage, userSearch, devicePage, deviceSearch, reviewPage, reviewSearch, reviewStatus, refreshKey]);

  const handleFreeDevice = async (param: { deviceId?: string; userEmail?: string }) => {
    setFreeing(true);
    setMessage(null);
    try {
      const res = await apiFetch<{ message: string }>("/api/admin/crm/devices/free", {
        method: "POST",
        body: JSON.stringify(param),
      });
      setMessage({ text: res.message, type: "success" });
      setFreeInput("");
      setRefreshKey((k) => k + 1);
      if (inspectUser) fetchInspectUser(inspectUser.user.id);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to free device", type: "danger" });
    } finally {
      setFreeing(false);
    }
  };

  const fetchInspectUser = async (userId: string) => {
    try {
      const res = await apiFetch<UserDetailPayload>(`/api/admin/crm/users/${userId}`);
      setInspectUser(res);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to inspect user", type: "danger" });
    }
  };

  const handleToggleAccountStatus = async (userId: string, currentStatus: string) => {
    const nextStatus = currentStatus === "active" ? "suspended" : "active";
    try {
      await apiFetch(`/api/admin/crm/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "update_status", status: nextStatus }),
      });
      setMessage({ text: `Account status: ${nextStatus}`, type: "success" });
      fetchInspectUser(userId);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to update status", type: "danger" });
    }
  };

  const handleResetUsage = async (userId: string) => {
    try {
      await apiFetch(`/api/admin/crm/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "reset_usage" }),
      });
      setMessage({ text: "Quota reset to 0", type: "success" });
      fetchInspectUser(userId);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to reset usage", type: "danger" });
    }
  };

  const handleToggleDevice = async (deviceId: string, currentStatus: string) => {
    const nextStatus = currentStatus === "active" ? "revoked" : "active";
    try {
      await apiFetch(`/api/admin/crm/devices/${deviceId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      setMessage({ text: `Device: ${nextStatus}`, type: "success" });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to update device", type: "danger" });
    }
  };

  const handleRetryReview = async (id: string) => {
    setRetryingId(id);
    try {
      await apiFetch(`/api/admin/jobs/${id}/retry`, { method: "POST" });
      setMessage({ text: `Review ${id.slice(0, 8)} requeued`, type: "success" });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to retry review", type: "danger" });
    } finally {
      setRetryingId(null);
    }
  };

  const handleResolvePayment = async (orderId: string, action: "approve" | "reject") => {
    try {
      await apiFetch(`/api/admin/payments/${orderId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ action, notes: "Admin review" }),
      });
      setMessage({ text: `Payment ${action}d`, type: "success" });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to resolve payment", type: "danger" });
    }
  };

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!grantEmail.trim()) return;
    setGranting(true);
    try {
      const res = await apiFetch<{ message: string }>("/api/admin/grant-subscription", {
        method: "POST",
        body: JSON.stringify({ email: grantEmail.trim(), planTier: grantPlan }),
      });
      setMessage({ text: res.message, type: "success" });
      setGrantEmail("");
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to grant plan", type: "danger" });
    } finally {
      setGranting(false);
    }
  };

  if (sessionLoading) {
    return <FullPageLoading />;
  }

  if (!session || !isAuthorized) {
    return (
      <div className="max-w-sm mx-auto px-4 py-24 text-center space-y-3">
        <h1 className="text-lg font-bold text-text">Access Restricted</h1>
        <p className="text-xs text-text-muted">Available only for {SUPER_ADMIN_EMAIL}</p>
        <Link href="/">
          <Button variant="secondary" size="sm">
            Home
          </Button>
        </Link>
      </div>
    );
  }

  const navItems: { id: NavTab; label: string; badge?: number }[] = [
    { id: "overview", label: "Overview" },
    { id: "users", label: "Users" },
    { id: "devices", label: "Devices" },
    { id: "reviews", label: "Reviews" },
    { id: "payments", label: "Payments", badge: overview?.ambiguousPayments },
    { id: "grant", label: "Grant Plan" },
  ];

  return (
    <div className="w-full max-w-full min-h-[calc(100vh-4rem)] flex flex-col md:flex-row">
      {/* Mobile Top Horizontal Navigation */}
      <div className="md:hidden flex items-center gap-1.5 overflow-x-auto border-b border-border bg-surface p-2 text-xs">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap font-medium transition-colors cursor-pointer ${
              tab === item.id
                ? "bg-surface-elevated text-text border border-border font-semibold"
                : "text-text-muted hover:text-text"
            }`}
          >
            {item.label}
            {item.badge && item.badge > 0 ? (
              <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500/20 text-amber-400">
                {item.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Desktop Left Side Panel (Admin Only) */}
      <aside className="hidden md:flex md:w-60 lg:w-64 flex-col justify-between border-r border-border bg-surface/50 backdrop-blur-xs shrink-0 p-4 min-h-full">
        <div className="space-y-6">
          {/* Admin Header */}
          <div className="space-y-1 border-b border-border pb-4">
            <div className="flex items-center justify-between">
              <span className="text-base font-bold tracking-tight text-text">Admin</span>
              <Badge variant="purple" size="sm">
                Owner
              </Badge>
            </div>
            <p className="text-[11px] text-text-muted font-mono truncate">{SUPER_ADMIN_EMAIL}</p>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer text-left ${
                  tab === item.id
                    ? "bg-surface-elevated text-text border border-border font-semibold shadow-2xs"
                    : "text-text-muted hover:text-text hover:bg-surface-elevated/40"
                }`}
              >
                <span>{item.label}</span>
                {item.badge && item.badge > 0 ? (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500/20 text-amber-400 font-mono">
                    {item.badge}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>
        </div>

        {/* Left Side Quick Free Device Action */}
        <div className="pt-4 border-t border-border space-y-2">
          <div className="text-[11px] font-mono text-text-muted uppercase font-semibold">Free Device</div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!freeInput.trim()) return;
              if (freeInput.includes("@")) {
                handleFreeDevice({ userEmail: freeInput.trim() });
              } else {
                handleFreeDevice({ deviceId: freeInput.trim() });
              }
            }}
            className="space-y-2"
          >
            <input
              type="text"
              placeholder="Email or Device ID..."
              value={freeInput}
              onChange={(e) => setFreeInput(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg text-xs bg-surface border border-border text-text placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-border"
            />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              isLoading={freeing}
              disabled={!freeInput.trim()}
              className="w-full text-xs"
            >
              Free Device
            </Button>
          </form>
        </div>
      </aside>

      {/* Main Full-Screen Content Area */}
      <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 space-y-6 overflow-y-auto">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-text capitalize">{tab}</h2>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)}>
              Refresh
            </Button>
            <Link href="/evaluations/new">
              <Button variant="primary" size="sm">
                New Review
              </Button>
            </Link>
          </div>
        </div>

        {/* Error Popup + Success Message Alert */}
        <ErrorPopup
          title="Admin Notice"
          message={message?.type === "danger" ? message.text : null}
          onDismiss={() => setMessage(null)}
        />
        {message && message.type !== "danger" && (
          <Alert
            variant={message.type}
            action={
              <button
                onClick={() => setMessage(null)}
                className="text-xs font-semibold underline cursor-pointer"
              >
                Dismiss
              </button>
            }
          >
            {message.text}
          </Alert>
        )}

        {/* TAB: OVERVIEW */}
        {tab === "overview" && (
          <div className="space-y-6">
            {loadingOverview ? (
              <div className="py-12 flex justify-center">
                <LoadingSpinner size="md" />
              </div>
            ) : (
              <>
                {/* Stats Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
                  <div className="p-4 rounded-xl border border-border bg-surface">
                    <div className="text-[11px] text-text-muted font-mono uppercase">Users</div>
                    <div className="text-2xl font-bold text-text mt-1">{overview?.totalUsers ?? 0}</div>
                  </div>
                  <div className="p-4 rounded-xl border border-border bg-surface">
                    <div className="text-[11px] text-text-muted font-mono uppercase">Pro Plans</div>
                    <div className="text-2xl font-bold text-purple-400 mt-1">
                      {overview?.totalActiveSubscriptions ?? 0}
                    </div>
                  </div>
                  <div className="p-4 rounded-xl border border-border bg-surface">
                    <div className="text-[11px] text-text-muted font-mono uppercase">Reviews</div>
                    <div className="text-2xl font-bold text-text mt-1">{overview?.totalEvaluations ?? 0}</div>
                  </div>
                  <div className="p-4 rounded-xl border border-border bg-surface">
                    <div className="text-[11px] text-text-muted font-mono uppercase">Active Devices</div>
                    <div className="text-2xl font-bold text-text mt-1">{overview?.activeDevices ?? 0}</div>
                  </div>
                  <div className="p-4 rounded-xl border border-border bg-surface">
                    <div className="text-[11px] text-text-muted font-mono uppercase">Pending Orders</div>
                    <div className="text-2xl font-bold text-amber-400 mt-1">
                      {overview?.ambiguousPayments ?? 0}
                    </div>
                  </div>
                </div>

                {/* Recent Activity */}
                <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
                  <div className="text-xs font-semibold text-text uppercase font-mono">Recent Activity</div>
                  <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {overview?.recentAuditEvents && overview.recentAuditEvents.length > 0 ? (
                      overview.recentAuditEvents.map((evt) => (
                        <div
                          key={evt.id}
                          className="flex items-center justify-between text-xs p-2.5 rounded-lg bg-surface-elevated/40 border border-border/40 font-mono"
                        >
                          <span className="text-text font-medium">{evt.action}</span>
                          <span className="text-[11px] text-text-muted">
                            {new Date(evt.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-text-muted py-4 text-center">No recent activity.</div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* TAB: USERS */}
        {tab === "users" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 max-w-sm">
              <input
                type="text"
                placeholder="Search users by name or email..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setRefreshKey((k) => k + 1);
                }}
                className="w-full px-3 py-1.5 rounded-lg text-xs bg-surface border border-border text-text placeholder:text-text-muted focus:outline-none"
              />
              <Button variant="secondary" size="sm" onClick={() => setRefreshKey((k) => k + 1)}>
                Search
              </Button>
            </div>

            {loadingUsers ? (
              <div className="py-12 flex justify-center">
                <LoadingSpinner size="md" />
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-surface overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-surface-elevated/50 text-text-muted border-b border-border uppercase font-mono text-[10px]">
                      <tr>
                        <th className="px-4 py-2.5">User</th>
                        <th className="px-4 py-2.5">Plan</th>
                        <th className="px-4 py-2.5">Status</th>
                        <th className="px-4 py-2.5">Devices</th>
                        <th className="px-4 py-2.5">Reviews</th>
                        <th className="px-4 py-2.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {users.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-6 text-center text-text-muted">
                            No users found.
                          </td>
                        </tr>
                      ) : (
                        users.map((u) => (
                          <tr key={u.id} className="hover:bg-surface-elevated/30">
                            <td className="px-4 py-2.5">
                              <div className="font-semibold text-text">{u.name}</div>
                              <div className="text-[11px] text-text-muted font-mono">{u.email}</div>
                            </td>
                            <td className="px-4 py-2.5">
                              <Badge variant={u.subscription ? "purple" : "neutral"} size="sm">
                                {u.subscription?.planName || "Trial"}
                              </Badge>
                            </td>
                            <td className="px-4 py-2.5">
                              <Badge variant={u.accountStatus === "active" ? "success" : "danger"} size="sm">
                                {u.accountStatus}
                              </Badge>
                            </td>
                            <td className="px-4 py-2.5 font-mono">{u.devicesCount}</td>
                            <td className="px-4 py-2.5 font-mono">{u.evaluationsCount}</td>
                            <td className="px-4 py-2.5 text-right space-x-1.5 whitespace-nowrap">
                              <Button variant="outline" size="sm" onClick={() => fetchInspectUser(u.id)}>
                                Inspect
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleFreeDevice({ userEmail: u.email })}
                              >
                                Free Devices
                              </Button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {userTotalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-2.5 border-t border-border text-xs text-text-muted">
                    <div>Page {userPage} of {userTotalPages}</div>
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" disabled={userPage <= 1} onClick={() => setUserPage((p) => p - 1)}>
                        Prev
                      </Button>
                      <Button variant="outline" size="sm" disabled={userPage >= userTotalPages} onClick={() => setUserPage((p) => p + 1)}>
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Inspect Modal */}
            {inspectUser && (
              <Modal
                isOpen={Boolean(inspectUser)}
                onClose={() => setInspectUser(null)}
                title={inspectUser.user.name}
                maxWidth="lg"
              >
                <div className="space-y-4 text-xs">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated border border-border">
                    <div>
                      <div className="font-bold text-text">{inspectUser.user.email}</div>
                      <div className="text-text-muted font-mono text-[10px]">{inspectUser.user.id}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant={inspectUser.profile.accountStatus === "active" ? "danger" : "secondary"}
                        size="sm"
                        onClick={() => handleToggleAccountStatus(inspectUser.user.id, inspectUser.profile.accountStatus)}
                      >
                        {inspectUser.profile.accountStatus === "active" ? "Suspend" : "Activate"}
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleResetUsage(inspectUser.user.id)}>
                      Reset Quota ({inspectUser.usage.evaluationsUsed} used)
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleFreeDevice({ userEmail: inspectUser.user.email })}
                    >
                      Free All Devices
                    </Button>
                  </div>

                  {/* Devices */}
                  <div className="space-y-1.5">
                    <div className="font-bold text-text">Devices ({inspectUser.devices.length})</div>
                    {inspectUser.devices.map((d) => (
                      <div key={d.id} className="flex items-center justify-between p-2 rounded bg-surface-elevated border border-border">
                        <span className="font-mono text-text">{d.deviceId}</span>
                        <Button variant="secondary" size="sm" onClick={() => handleFreeDevice({ deviceId: d.deviceId })}>
                          Unlink
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </Modal>
            )}
          </div>
        )}

        {/* TAB: DEVICES */}
        {tab === "devices" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 max-w-sm">
              <input
                type="text"
                placeholder="Search device ID, owner email..."
                value={deviceSearch}
                onChange={(e) => setDeviceSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setRefreshKey((k) => k + 1);
                }}
                className="w-full px-3 py-1.5 rounded-lg text-xs bg-surface border border-border text-text placeholder:text-text-muted focus:outline-none"
              />
              <Button variant="secondary" size="sm" onClick={() => setRefreshKey((k) => k + 1)}>
                Search
              </Button>
            </div>

            {loadingDevices ? (
              <div className="py-12 flex justify-center">
                <LoadingSpinner size="md" />
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-surface overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-surface-elevated/50 text-text-muted border-b border-border uppercase font-mono text-[10px]">
                      <tr>
                        <th className="px-4 py-2.5">Device ID</th>
                        <th className="px-4 py-2.5">Owner</th>
                        <th className="px-4 py-2.5">Status</th>
                        <th className="px-4 py-2.5">Last Seen</th>
                        <th className="px-4 py-2.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {devices.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                            No devices found.
                          </td>
                        </tr>
                      ) : (
                        devices.map((dev) => (
                          <tr key={dev.id} className="hover:bg-surface-elevated/30">
                            <td className="px-4 py-2.5 font-mono text-text">{dev.deviceId}</td>
                            <td className="px-4 py-2.5 text-text font-mono">{dev.ownerEmail || "-"}</td>
                            <td className="px-4 py-2.5">
                              <Badge variant={dev.status === "active" ? "success" : "danger"} size="sm">
                                {dev.status}
                              </Badge>
                            </td>
                            <td className="px-4 py-2.5 text-text-muted font-mono">
                              {new Date(dev.lastSeenAt).toLocaleDateString()}
                            </td>
                            <td className="px-4 py-2.5 text-right space-x-1.5 whitespace-nowrap">
                              <Button variant="secondary" size="sm" onClick={() => handleFreeDevice({ deviceId: dev.deviceId })}>
                                Free
                              </Button>
                              <Button
                                variant={dev.status === "active" ? "danger" : "outline"}
                                size="sm"
                                onClick={() => handleToggleDevice(dev.deviceId, dev.status)}
                              >
                                {dev.status === "active" ? "Revoke" : "Activate"}
                              </Button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {deviceTotalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-2.5 border-t border-border text-xs text-text-muted">
                    <div>Page {devicePage} of {deviceTotalPages}</div>
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" disabled={devicePage <= 1} onClick={() => setDevicePage((p) => p - 1)}>
                        Prev
                      </Button>
                      <Button variant="outline" size="sm" disabled={devicePage >= deviceTotalPages} onClick={() => setDevicePage((p) => p + 1)}>
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB: REVIEWS */}
        {tab === "reviews" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <input
                type="text"
                placeholder="Search reviews..."
                value={reviewSearch}
                onChange={(e) => setReviewSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setRefreshKey((k) => k + 1);
                }}
                className="px-3 py-1.5 rounded-lg text-xs bg-surface border border-border text-text placeholder:text-text-muted focus:outline-none w-64"
              />
              <select
                value={reviewStatus}
                onChange={(e) => {
                  setReviewStatus(e.target.value);
                  setReviewPage(1);
                }}
                className="px-2.5 py-1.5 rounded-lg text-xs bg-surface border border-border text-text"
              >
                <option value="all">All</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="processing">Processing</option>
              </select>
            </div>

            {loadingReviews ? (
              <div className="py-12 flex justify-center">
                <LoadingSpinner size="md" />
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-surface overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-surface-elevated/50 text-text-muted border-b border-border uppercase font-mono text-[10px]">
                      <tr>
                        <th className="px-4 py-2.5">ID</th>
                        <th className="px-4 py-2.5">User</th>
                        <th className="px-4 py-2.5">Score</th>
                        <th className="px-4 py-2.5">Status</th>
                        <th className="px-4 py-2.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {reviews.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                            No reviews found.
                          </td>
                        </tr>
                      ) : (
                        reviews.map((rev) => (
                          <tr key={rev.id} className="hover:bg-surface-elevated/30">
                            <td className="px-4 py-2.5 font-mono text-text">{rev.id.slice(0, 8)}</td>
                            <td className="px-4 py-2.5 font-mono text-text">{rev.ownerEmail || "-"}</td>
                            <td className="px-4 py-2.5 font-mono">{rev.overallScore !== null ? `${rev.overallScore}/100` : "-"}</td>
                            <td className="px-4 py-2.5">
                              <Badge
                                variant={rev.status === "completed" ? "success" : rev.status === "failed" ? "danger" : "warning"}
                                size="sm"
                              >
                                {rev.status}
                              </Badge>
                            </td>
                            <td className="px-4 py-2.5 text-right space-x-1.5 whitespace-nowrap">
                              <Link href={`/evaluations/${rev.id}/report`}>
                                <Button variant="outline" size="sm">
                                  Report
                                </Button>
                              </Link>
                              {rev.status === "failed" && (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  isLoading={retryingId === rev.id}
                                  onClick={() => handleRetryReview(rev.id)}
                                >
                                  Retry
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {reviewTotalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-2.5 border-t border-border text-xs text-text-muted">
                    <div>Page {reviewPage} of {reviewTotalPages}</div>
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" disabled={reviewPage <= 1} onClick={() => setReviewPage((p) => p - 1)}>
                        Prev
                      </Button>
                      <Button variant="outline" size="sm" disabled={reviewPage >= reviewTotalPages} onClick={() => setReviewPage((p) => p + 1)}>
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB: PAYMENTS */}
        {tab === "payments" && (
          <div className="space-y-3">
            {loadingPayments ? (
              <div className="py-12 flex justify-center">
                <LoadingSpinner size="md" />
              </div>
            ) : payments.length === 0 ? (
              <div className="p-8 text-center rounded-xl border border-border bg-surface text-text-muted text-xs">
                No pending orders.
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-surface overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface-elevated/50 text-text-muted border-b border-border uppercase font-mono text-[10px]">
                    <tr>
                      <th className="px-4 py-2.5">Ref</th>
                      <th className="px-4 py-2.5">Plan</th>
                      <th className="px-4 py-2.5">Amount</th>
                      <th className="px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="px-4 py-2.5 font-mono text-text">{p.orderReference}</td>
                        <td className="px-4 py-2.5 font-mono">{p.planId}</td>
                        <td className="px-4 py-2.5 font-mono">{p.amountEtb} ETB</td>
                        <td className="px-4 py-2.5 text-right space-x-1.5 whitespace-nowrap">
                          <Button variant="primary" size="sm" onClick={() => handleResolvePayment(p.id, "approve")}>
                            Approve
                          </Button>
                          <Button variant="danger" size="sm" onClick={() => handleResolvePayment(p.id, "reject")}>
                            Reject
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB: GRANT */}
        {tab === "grant" && (
          <div className="max-w-md pt-2">
            <form onSubmit={handleGrant} className="rounded-xl border border-border bg-surface p-5 space-y-4">
              <div className="text-sm font-bold text-text">Grant Subscription</div>

              <div className="space-y-1">
                <label className="text-xs text-text-muted">User Email</label>
                <input
                  type="email"
                  required
                  placeholder="user@example.com"
                  value={grantEmail}
                  onChange={(e) => setGrantEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-xs bg-surface border border-border text-text focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-text-muted">Plan</label>
                <select
                  value={grantPlan}
                  onChange={(e) => setGrantPlan(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-xs bg-surface border border-border text-text focus:outline-none"
                >
                  {PLAN_OPTIONS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <Button type="submit" variant="primary" size="sm" isLoading={granting} className="w-full">
                Grant Plan
              </Button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
