"use client";

import React, { Suspense, useState, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import { ProgressBar } from "@/components/ui/progress-bar";
import { LoadingSpinner, FullPageLoading } from "@/components/ui/loading-spinner";
import { authClient, useSession, signOut } from "@/lib/auth/auth-client";
import { apiFetch } from "@/lib/client/api";
import { ProfileOnChainPanel } from "@/components/solana/profile-onchain-panel";
import type { UsageSummary } from "@/lib/billing/types";

export type ProfileTab =
  | "general"
  | "password"
  | "devices"
  | "subscription"
  | "referrals"
  | "solana"
  | "theme";

interface UserDevice {
  id: string;
  deviceId: string;
  label?: string | null;
  status: "active" | "revoked";
  firstSeenAt: string;
  lastSeenAt: string;
  isCurrentDevice?: boolean;
}

function subscribeToTheme(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getThemeSnapshot(): "dark" | "light" {
  if (typeof window === "undefined") return "dark";
  const stored = localStorage.getItem("theme");
  if (stored === "light") return "light";
  if (stored === "dark") return "dark";
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

function getThemeServerSnapshot(): "dark" | "light" {
  return "dark";
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<FullPageLoading />}>
      <ProfilePageContent />
    </Suspense>
  );
}

function ProfilePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending } = useSession();

  const tabFromUrl = searchParams.get("tab");
  const isValidTab = (v: string | null): v is ProfileTab =>
    Boolean(
      v &&
        ["general", "password", "devices", "subscription", "referrals", "solana", "theme"].includes(
          v
        )
    );

  // Active section tab: general | solana | password | devices | subscription | referrals | theme
  const [activeTab, setActiveTab] = useState<ProfileTab>(() =>
    isValidTab(tabFromUrl) ? tabFromUrl : "general"
  );
  const [prevTabFromUrl, setPrevTabFromUrl] = useState<string | null>(tabFromUrl);
  if (tabFromUrl !== prevTabFromUrl) {
    setPrevTabFromUrl(tabFromUrl);
    if (isValidTab(tabFromUrl)) {
      setActiveTab(tabFromUrl);
    }
  }

  // Theme store
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getThemeServerSnapshot
  );

  const applyTheme = (nextTheme: "dark" | "light") => {
    try {
      localStorage.setItem("theme", nextTheme);
    } catch (_) {}
    if (nextTheme === "dark") {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.classList.add("light");
    }
    window.dispatchEvent(new Event("storage"));
  };

  // If user is not logged in, redirect immediately to /auth
  useEffect(() => {
    if (!isPending && !session?.user) {
      router.replace("/auth");
    }
  }, [isPending, session, router]);

  // Personal details state
  const [name, setName] = useState(session?.user?.name || "");
  const [prevSessionName, setPrevSessionName] = useState(session?.user?.name);
  if (session?.user?.name && session.user.name !== prevSessionName) {
    setPrevSessionName(session.user.name);
    setName(session.user.name);
  }
  const [isUpdatingName, setIsUpdatingName] = useState(false);
  const [avatarError, setAvatarError] = useState(false);

  // Change password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [revokeOtherSessions, setRevokeOtherSessions] = useState(true);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Registered devices state
  const [devices, setDevices] = useState<UserDevice[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [revokeTargetDevice, setRevokeTargetDevice] = useState<UserDevice | null>(
    null
  );
  const [isRevokingDevice, setIsRevokingDevice] = useState(false);

  // Subscription and portal state
  const [usageData, setUsageData] = useState<UsageSummary | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);

  // Referral state
  const [referralStats, setReferralStats] = useState<{
    referralCount: number;
    bonusReviews: number;
    referralLink: string;
  } | null>(null);
  const [copiedReferral, setCopiedReferral] = useState(false);

  // Delete account state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  // Notification feedback
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Load real devices and subscription usage
  useEffect(() => {
    if (!session?.user) return;
    let ignore = false;

    async function loadData() {
      try {
        setLoadingDevices(true);
        setLoadingUsage(true);
        const [devRes, usageRes, refRes] = await Promise.allSettled([
          apiFetch<{ devices: UserDevice[] }>("/api/devices"),
          apiFetch<UsageSummary>("/api/usage"),
          apiFetch<{ referralCount: number; bonusReviews: number; referralLink: string }>("/api/referrals/stats"),
        ]);
        if (!ignore) {
          if (devRes.status === "fulfilled" && devRes.value?.devices) {
            setDevices(devRes.value.devices);
          }
          if (usageRes.status === "fulfilled" && usageRes.value) {
            setUsageData(usageRes.value);
          }
          if (refRes.status === "fulfilled" && refRes.value) {
            setReferralStats(refRes.value);
          }
        }
      } catch {
        // fail silently without mock data
      } finally {
        if (!ignore) {
          setLoadingDevices(false);
          setLoadingUsage(false);
        }
      }
    }

    loadData();
    return () => {
      ignore = true;
    };
  }, [session]);

  // Handle personal details update
  const handleUpdateName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name cannot be empty.");
      return;
    }

    try {
      setIsUpdatingName(true);
      setError(null);
      setSuccessMessage(null);

      const res = await authClient.updateUser({
        name: name.trim(),
      });

      if (res?.error) {
        throw new Error(res.error.message || "Failed to update profile name.");
      }

      setSuccessMessage("Your name has been updated successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update profile.");
    } finally {
      setIsUpdatingName(false);
    }
  };

  // Handle password change
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!currentPassword) {
      setError("Please provide your current password.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    try {
      setIsChangingPassword(true);

      const res = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions,
      });

      if (res?.error) {
        throw new Error(
          res.error.message ||
            "Failed to change password. Please verify your current password."
        );
      }

      setSuccessMessage("Password changed successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password.");
    } finally {
      setIsChangingPassword(false);
    }
  };

  // Handle device revocation
  const handleRevokeDevice = async () => {
    if (!revokeTargetDevice) return;
    try {
      setIsRevokingDevice(true);
      setError(null);
      setSuccessMessage(null);

      await apiFetch(`/api/devices/${revokeTargetDevice.id}`, {
        method: "DELETE",
      });

      setSuccessMessage(
        `Device ${
          revokeTargetDevice.label || revokeTargetDevice.deviceId
        } was successfully revoked.`
      );
      setDevices((prev) => prev.filter((d) => d.id !== revokeTargetDevice.id));
      setRevokeTargetDevice(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke device.");
    } finally {
      setIsRevokingDevice(false);
    }
  };

  // Handle Customer Portal launch
  const handleOpenCustomerPortal = async () => {
    try {
      setOpeningPortal(true);
      setError(null);
      const res = await apiFetch<{ portalUrl: string }>(
        "/api/payments/polar/portal",
        {
          method: "POST",
        }
      );
      if (res.portalUrl) {
        window.location.href = res.portalUrl;
        return;
      }
      router.push("/billing");
    } catch {
      router.push("/billing");
    } finally {
      setOpeningPortal(false);
    }
  };

  // Handle account deletion
  const handleDeleteAccount = async () => {
    try {
      setIsDeletingAccount(true);
      setError(null);

      await apiFetch("/api/admin/retention/cleanup", {
        method: "POST",
      });
      await signOut();
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete account.");
      setIsDeletingAccount(false);
      setShowDeleteModal(false);
    }
  };

  if (isPending) {
    return <FullPageLoading />;
  }

  if (!session?.user) {
    return null;
  }

  const user = session.user;
  const initial = user.name?.[0] || user.email?.[0] || "U";
  const activeDevices = devices.filter((d) => d.status === "active");
  const isPro = Boolean(
    usageData?.subscription?.status === "active" &&
      usageData?.plan?.tier !== "free_trial"
  );

  const navItems: {
    id: ProfileTab;
    label: string;
    icon: React.ReactNode;
    badge?: string | number;
  }[] = [
    {
      id: "general",
      label: "General",
      icon: (
        <svg
          className="w-4 h-4 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
          />
        </svg>
      ),
    },
    {
      id: "solana",
      label: "On-Chain & SBT",
      badge: "Solana",
      icon: (
        <svg
          className="w-4 h-4 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
          />
        </svg>
      ),
    },
    {
      id: "password",
      label: "Change Password",
      icon: (
        <svg
          className="w-4 h-4 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
          />
        </svg>
      ),
    },
    {
      id: "devices",
      label: "Registered Devices",
      badge: activeDevices.length,
      icon: (
        <svg
          className="w-4 h-4 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
      ),
    },
    {
      id: "subscription",
      label: "Subscription Info",
      badge: isPro ? "Pro" : "Trial",
      icon: (
        <svg
          className="w-4 h-4 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
          />
        </svg>
      ),
    },
    {
      id: "referrals",
      label: "Referrals & Rewards",
      badge: referralStats?.bonusReviews ? `+${referralStats.bonusReviews} Free` : undefined,
      icon: (
        <svg
          className="w-4 h-4 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
      ),
    },
    {
      id: "theme",
      label: "Theme & Appearance",
      badge: theme === "dark" ? "Dark" : "Light",
      icon: (
        <svg
          className="w-4 h-4 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
          />
        </svg>
      ),
    },
  ];

  return (
    <div className="w-full max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-10 py-8 sm:py-10 space-y-6">
      {/* Feedback alerts */}
      {error && (
        <Alert variant="danger" title="Account Notice">
          {error}
        </Alert>
      )}

      {successMessage && (
        <Alert variant="success" title="Success">
          {successMessage}
        </Alert>
      )}

      {/* Mobile Horizontal Pill Bar */}
      <div className="lg:hidden flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-none border-b border-border">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActiveTab(item.id);
                setError(null);
                setSuccessMessage(null);
                router.replace(
                  item.id === "general" ? "/profile" : `/profile?tab=${item.id}`,
                  { scroll: false }
                );
              }}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                isActive
                  ? "bg-purple-600 text-white shadow-xs"
                  : "bg-surface border border-border text-text-secondary hover:text-text hover:bg-surface-elevated"
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.badge !== undefined && (
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-md ${
                    isActive
                      ? "bg-white/20 text-white"
                      : "bg-surface-elevated text-text-muted"
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Main Two-Column Layout (Sidebar + Content Panel) */}
      <div className="flex flex-col lg:flex-row gap-8 items-start">
        {/* Little Left Sidebar */}
        <aside className="w-full lg:w-80 shrink-0 space-y-4">
          {/* User Profile Mini Header */}
          <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs space-y-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-12 h-12 rounded-full overflow-hidden flex items-center justify-center shrink-0 ${
                  isPro
                    ? "p-0.5 bg-gradient-to-tr from-purple-600 via-fuchsia-500 to-purple-400"
                    : "border-2 border-border bg-purple-950/60"
                }`}
              >
                <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center bg-surface">
                  {!avatarError && user.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={user.image}
                      alt={user.name || user.email || "Profile"}
                      onError={() => setAvatarError(true)}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-lg font-extrabold text-purple-300 uppercase select-none">
                      {initial}
                    </span>
                  )}
                </div>
              </div>

              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-bold text-text truncate">
                  {user.name || "COOV User"}
                </h2>
                <p className="text-xs font-mono text-text-muted truncate">
                  {user.email}
                </p>
                <div className="mt-1">
                  <Badge variant={isPro ? "purple" : "neutral"} size="sm">
                    {usageData?.plan?.name || (isPro ? "Pro Plan" : "Free Trial")}
                  </Badge>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar Navigation Menu */}
          <nav className="hidden lg:block rounded-2xl border border-border bg-surface p-2 shadow-xs space-y-1">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
                    setError(null);
                    setSuccessMessage(null);
                    router.replace(
                      item.id === "general" ? "/profile" : `/profile?tab=${item.id}`,
                      { scroll: false }
                    );
                  }}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                    isActive
                      ? "bg-purple-600/15 text-purple-300 border border-purple-500/30 font-semibold shadow-xs"
                      : "text-text-secondary hover:text-text hover:bg-surface-elevated/70 border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={
                        isActive ? "text-purple-400" : "text-text-muted"
                      }
                    >
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </div>

                  {item.badge !== undefined && (
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-md font-mono ${
                        isActive
                          ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                          : "bg-surface-elevated text-text-muted border border-border"
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Sidebar Sign Out */}
          <div className="hidden lg:block rounded-2xl border border-border bg-surface p-2 shadow-xs">
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await signOut();
                router.push("/");
              }}
              className="w-full text-xs text-text-muted hover:text-red-400 hover:bg-red-500/10 justify-center h-9 font-medium"
            >
              Sign Out
            </Button>
          </div>
        </aside>

        {/* Right Content Area */}
        <main className="flex-1 w-full min-w-0 space-y-6">
          {/* TAB 1: GENERAL INFORMATION */}
          {activeTab === "general" && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8 space-y-6">
                <div>
                  <h2 className="text-lg font-bold text-text">
                    General Settings
                  </h2>
                  <p className="text-xs text-text-secondary mt-1">
                    Manage your personal account profile and contact details.
                  </p>
                </div>

                <form onSubmit={handleUpdateName} className="space-y-4 max-w-xl">
                  <div>
                    <label className="block text-xs font-semibold text-text mb-1.5">
                      Display Name
                    </label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your full name"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-text mb-1.5">
                      Email Address
                    </label>
                    <Input
                      value={user.email}
                      disabled
                      className="opacity-70 bg-surface-elevated cursor-not-allowed font-mono"
                    />
                    <p className="text-[11px] text-text-muted mt-1">
                      Email address is managed by your authentication provider.
                    </p>
                  </div>

                  {user.id && (
                    <div>
                      <label className="block text-xs font-semibold text-text mb-1.5">
                        Account ID
                      </label>
                      <div className="font-mono text-xs text-text-muted p-2.5 rounded-xl bg-surface-elevated border border-border select-all">
                        {user.id}
                      </div>
                    </div>
                  )}

                  <div className="pt-2">
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      isLoading={isUpdatingName}
                      className="h-10 px-5 text-xs font-semibold"
                    >
                      Save Profile
                    </Button>
                  </div>
                </form>
              </div>

              {/* On-Chain & SBT Quick Access Card */}
              <div className="rounded-xl border border-border bg-surface p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-extrabold text-text">
                      Solana On-Chain Profile & Soulbound SBT
                    </h3>
                    <span className="px-2 py-0.5 text-[10px] font-mono rounded-md bg-surface-elevated border border-border text-purple-400">
                      Devnet
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary">
                    Link Phantom or Solflare to inspect your verified on-chain skills and minted Token-2022 credentials.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => {
                    setActiveTab("solana");
                    router.replace("/profile?tab=solana", { scroll: false });
                  }}
                >
                  Open On-Chain & SBT →
                </Button>
              </div>

              {/* Danger Zone */}
              <div className="rounded-2xl border border-red-500/20 bg-surface p-6 sm:p-8 space-y-3">
                <h3 className="text-sm font-bold text-red-400">Danger Zone</h3>
                <p className="text-xs text-text-secondary">
                  Permanently delete your account, evaluation records, and
                  associated CVs. This operation cannot be reversed.
                </p>
                <div className="pt-1">
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setShowDeleteModal(true)}
                    className="text-xs h-9 px-4"
                  >
                    Delete Account
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CHANGE PASSWORD */}
          {activeTab === "password" && (
            <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8 space-y-6">
              <div>
                <h2 className="text-lg font-bold text-text">Change Password</h2>
                <p className="text-xs text-text-secondary mt-1">
                  Protect your account with a secure password of at least 8
                  characters.
                </p>
              </div>

              <form
                onSubmit={handleChangePassword}
                className="space-y-4 max-w-xl"
              >
                <div>
                  <label className="block text-xs font-semibold text-text mb-1.5">
                    Current Password
                  </label>
                  <Input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-text mb-1.5">
                    New Password
                  </label>
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-text mb-1.5">
                    Confirm New Password
                  </label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm your new password"
                    required
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="revoke-sessions"
                    checked={revokeOtherSessions}
                    onChange={(e) => setRevokeOtherSessions(e.target.checked)}
                    className="rounded border-border text-purple-600 focus:ring-purple-500 cursor-pointer"
                  />
                  <label
                    htmlFor="revoke-sessions"
                    className="text-xs text-text-secondary cursor-pointer select-none"
                  >
                    Sign out of other active sessions
                  </label>
                </div>

                <div className="pt-2">
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    isLoading={isChangingPassword}
                    className="h-10 px-5 text-xs font-semibold"
                  >
                    Update Password
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 3: REGISTERED DEVICES */}
          {activeTab === "devices" && (
            <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8 space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-text">
                    Registered Devices
                  </h2>
                  <p className="text-xs text-text-secondary mt-1">
                    Manage hardware devices and browser sessions registered to
                    your account.
                  </p>
                </div>
                <Badge variant="purple" size="sm">
                  {activeDevices.length} Active
                </Badge>
              </div>

              {loadingDevices ? (
                <div className="py-12 flex justify-center">
                  <LoadingSpinner size="md" label="Loading devices..." />
                </div>
              ) : devices.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-border rounded-xl">
                  <p className="text-sm text-text-muted">
                    No external devices recorded. Current session is verified.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {devices.map((device) => (
                    <div
                      key={device.id}
                      className="p-5 rounded-xl border border-border bg-surface-elevated/40 flex items-center justify-between gap-4"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-text truncate">
                            {device.label || "Browser Device"}
                          </span>
                          {device.isCurrentDevice && (
                            <Badge variant="purple" size="sm">
                              Current
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs font-mono text-text-muted truncate max-w-[200px]">
                          {device.deviceId}
                        </p>
                        <p className="text-[11px] text-text-muted font-mono">
                          Last seen:{" "}
                          {new Date(device.lastSeenAt).toLocaleDateString()}
                        </p>
                      </div>

                      {device.status === "active" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRevokeTargetDevice(device)}
                          className="text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 shrink-0"
                        >
                          Revoke
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: YOUR SUBSCRIPTION INFO */}
          {activeTab === "subscription" && (
            loadingUsage && !usageData ? (
              <div className="py-20 flex justify-center rounded-2xl border border-border bg-surface">
                <LoadingSpinner size="md" label="Loading subscription details..." />
              </div>
            ) : (
            <div className="space-y-6">
              {/* Primary Plan Card */}
              <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8 shadow-xs space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5">
                  <div className="flex items-center gap-3.5">
                    <div
                      className={`w-12 h-12 rounded-xl border flex items-center justify-center shrink-0 ${
                        isPro
                          ? "bg-purple-600/15 border-purple-500/40 text-purple-300"
                          : "bg-surface-elevated border-border text-text-muted"
                      }`}
                    >
                      <svg
                        className="w-6 h-6"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                        />
                      </svg>
                    </div>

                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-lg sm:text-xl font-bold text-text">
                          {usageData?.plan?.name ||
                            (isPro ? "Pro Plan" : "Free Trial")}
                        </h2>
                        <Badge variant={isPro ? "purple" : "neutral"} size="sm">
                          {isPro ? "Active Subscription" : "Trial Allowance"}
                        </Badge>
                      </div>
                      <p className="text-xs text-text-secondary mt-0.5">
                        {isPro
                          ? "Multi-agent panel simulation, ATS compliance checks, and unlimited comparisons."
                          : "Evaluation trial allowance on your verified device."}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link href="/billing">
                      <Button
                        variant="primary"
                        size="sm"
                        className="text-xs font-semibold px-4 h-9"
                      >
                        Upgrade / Switch Plan
                      </Button>
                    </Link>

                    {isPro && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleOpenCustomerPortal}
                        isLoading={openingPortal}
                        className="text-xs font-semibold h-9"
                      >
                        Customer Portal
                      </Button>
                    )}
                  </div>
                </div>

                {/* Period & Dates Details */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-1">
                  <div className="p-3.5 rounded-xl bg-surface-elevated/50 border border-border">
                    <span className="text-[11px] font-mono text-text-muted block">
                      Billing Period
                    </span>
                    <span className="text-sm font-semibold text-text mt-0.5 block">
                      {isPro
                        ? usageData?.plan?.tier.includes("yearly")
                          ? "Annual"
                          : "Monthly"
                        : "Lifetime Trial"}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-surface-elevated/50 border border-border">
                    <span className="text-[11px] font-mono text-text-muted block">
                      Status
                    </span>
                    <span className="text-sm font-semibold text-text mt-0.5 block capitalize">
                      {usageData?.subscription?.status || "Active"}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-surface-elevated/50 border border-border">
                    <span className="text-[11px] font-mono text-text-muted block">
                      Start Date
                    </span>
                    <span className="text-sm font-semibold text-text mt-0.5 block">
                      {usageData?.subscription?.createdAt ||
                      usageData?.subscription?.currentPeriodStart
                        ? new Date(
                            (usageData.subscription.createdAt ||
                              usageData.subscription.currentPeriodStart)!
                          ).toLocaleDateString()
                        : "N/A"}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-surface-elevated/50 border border-border">
                    <span className="text-[11px] font-mono text-text-muted block">
                      Renewal / Expiration
                    </span>
                    <span className="text-sm font-semibold text-text mt-0.5 block">
                      {usageData?.subscription?.currentPeriodEnd
                        ? new Date(
                            usageData.subscription.currentPeriodEnd
                          ).toLocaleDateString()
                        : "No Expiration"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Usage Quota Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Daily Quota Card */}
                <div className="rounded-2xl border border-border bg-surface p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono uppercase tracking-wider text-text-muted">
                      Daily Review Limit
                    </span>
                    <span className="text-xs font-mono text-purple-400">
                      Resets 00:00 EAT
                    </span>
                  </div>

                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-extrabold font-mono text-text">
                      {usageData?.quotas?.daily?.remaining ??
                        (isPro ? 30 : 3)}
                    </span>
                    <span className="text-xs font-mono text-text-muted">
                      / {usageData?.quotas?.daily?.limit ?? (isPro ? 30 : 3)} today
                    </span>
                  </div>

                  <ProgressBar
                    value={
                      usageData?.quotas?.daily?.limit
                        ? (usageData.quotas.daily.remaining /
                            usageData.quotas.daily.limit) *
                          100
                        : 100
                    }
                    color="purple"
                    size="sm"
                  />

                  <p className="text-[11px] text-text-muted font-mono">
                    Timezone: {usageData?.quotas?.timezone || "Africa/Addis_Ababa"}
                  </p>
                </div>

                {/* Monthly / Lifetime Quota Card */}
                <div className="rounded-2xl border border-border bg-surface p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono uppercase tracking-wider text-text-muted">
                      {isPro ? "Monthly Quota" : "Trial Quota"}
                    </span>
                    <span className="text-xs font-mono text-purple-400">
                      {isPro ? "Billing Cycle" : "Lifetime"}
                    </span>
                  </div>

                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-extrabold font-mono text-text">
                      {isPro
                        ? usageData?.quotas?.monthly?.remaining ?? 150
                        : usageData?.quotas?.trial?.remaining ?? 3}
                    </span>
                    <span className="text-xs font-mono text-text-muted">
                      /{" "}
                      {isPro
                        ? usageData?.quotas?.monthly?.limit ?? 150
                        : usageData?.quotas?.trial?.limit ?? 3}{" "}
                      total
                    </span>
                  </div>

                  <ProgressBar
                    value={
                      isPro
                        ? usageData?.quotas?.monthly?.limit
                          ? (usageData.quotas.monthly.remaining /
                              usageData.quotas.monthly.limit) *
                            100
                          : 100
                        : usageData?.quotas?.trial?.limit
                        ? (usageData.quotas.trial.remaining /
                            usageData.quotas.trial.limit) *
                          100
                        : 100
                    }
                    color="purple"
                    size="sm"
                  />

                  <p className="text-[11px] text-text-muted font-mono">
                    {isPro
                      ? `${
                          usageData?.quotas?.monthly?.used ?? 0
                        } reviews used this monthly cycle`
                      : `${
                          usageData?.quotas?.trial?.used ?? 0
                        } trial assessments claimed`}
                  </p>
                </div>
              </div>
            </div>
            )
          )}

          {/* TAB 4.5: REFERRALS & REWARDS */}
          {activeTab === "referrals" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">
                  Referral Program & Free Reviews
                </h2>
                <p className="text-xs text-text-secondary mt-1">
                  Invite friends and colleagues to Cook My Cv. You receive 1 free review for every person who signs up using your link.
                </p>
              </div>

              {/* Stats Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-5 rounded-2xl bg-surface border border-border space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Friends Invited
                  </div>
                  <div className="text-3xl font-extrabold text-white">
                    {referralStats?.referralCount ?? 0}
                  </div>
                  <p className="text-xs text-text-secondary">
                    Registered users who signed up with your invite link
                  </p>
                </div>

                <div className="p-5 rounded-2xl bg-surface border border-purple-500/30 space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-purple-300">
                    Free Reviews Earned
                  </div>
                  <div className="text-3xl font-extrabold text-purple-400">
                    +{referralStats?.bonusReviews ?? 0}
                  </div>
                  <p className="text-xs text-text-secondary">
                    Bonus review credits automatically added to your allowance
                  </p>
                </div>
              </div>

              {/* Share Link Card */}
              <div className="p-6 rounded-2xl bg-surface border border-border space-y-4">
                <h3 className="text-sm font-bold text-white">Your Unique Referral Link</h3>
                <p className="text-xs text-text-secondary leading-relaxed">
                  Share this link with anyone. When they create an account, 1 free review credit is instantly applied to your account.
                </p>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={referralStats?.referralLink || `https://coov.space/auth?ref=${session?.user?.id || ""}`}
                    className="flex-1 bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-xs text-text font-mono focus:outline-none select-all"
                  />
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      const link = referralStats?.referralLink || `https://coov.space/auth?ref=${session?.user?.id || ""}`;
                      navigator.clipboard.writeText(link);
                      setCopiedReferral(true);
                      setTimeout(() => setCopiedReferral(false), 2000);
                    }}
                    className="shrink-0"
                  >
                    {copiedReferral ? "Copied!" : "Copy Link"}
                  </Button>
                </div>
              </div>

              {/* How It Works */}
              <div className="p-6 rounded-2xl bg-surface border border-border space-y-3">
                <h3 className="text-sm font-bold text-white">How It Works</h3>
                <ul className="list-disc pl-5 space-y-2 text-xs text-text-secondary">
                  <li>
                    <strong className="text-white">Share your link:</strong> Copy your referral link above and send it to friends, classmates, or colleagues.
                  </li>
                  <li>
                    <strong className="text-white">They sign up:</strong> When they visit your link and register an account, the referral is automatically registered.
                  </li>
                  <li>
                    <strong className="text-white">Get free reviews:</strong> You receive 1 free CV evaluation review for each verified signup with no limit on how many friends you can invite.
                  </li>
                </ul>
              </div>
            </div>
          )}

          {/* TAB 5: THEME & APPEARANCE */}
          {activeTab === "theme" && (
            <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8 space-y-6">
              <div>
                <h2 className="text-lg font-bold text-text">
                  Theme & Appearance
                </h2>
                <p className="text-xs text-text-secondary mt-1">
                  Choose your interface theme. Dark theme is active by default.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
                {/* Dark Theme Option (Default) */}
                <div
                  onClick={() => applyTheme("dark")}
                  className={`p-5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between gap-4 ${
                    theme === "dark"
                      ? "border-purple-500 bg-purple-950/20 ring-2 ring-purple-500/30 shadow-md"
                      : "border-border bg-surface-elevated/40 hover:border-text-secondary"
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-8 h-8 rounded-lg bg-[#0e0819] border border-purple-500/40 flex items-center justify-center text-purple-400">
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                            />
                          </svg>
                        </span>
                        <span className="text-sm font-bold text-text">
                          Dark Theme
                        </span>
                      </div>
                      <Badge variant="purple" size="sm">
                        Default
                      </Badge>
                    </div>

                    <p className="text-xs text-text-muted leading-relaxed">
                      Deep purple obsidian contrast. Tailored for focused review
                      sessions and reduced eye strain.
                    </p>

                    {/* Dark Preview Swatch */}
                    <div className="rounded-xl border border-purple-900/50 bg-[#0e0819] p-3 space-y-2">
                      <div className="h-2 w-2/3 rounded-sm bg-purple-900/60" />
                      <div className="h-2 w-1/2 rounded-sm bg-purple-900/40" />
                      <div className="flex gap-1.5 pt-1">
                        <div className="h-4 w-12 rounded-sm bg-purple-600" />
                        <div className="h-4 w-8 rounded-sm bg-purple-950 border border-purple-800" />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-border/60">
                    <div
                      className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                        theme === "dark"
                          ? "border-purple-500 bg-purple-600"
                          : "border-border"
                      }`}
                    >
                      {theme === "dark" && (
                        <div className="w-1.5 h-1.5 rounded-full bg-white" />
                      )}
                    </div>
                    <span className="text-xs font-semibold text-text">
                      {theme === "dark" ? "Active" : "Select Dark Theme"}
                    </span>
                  </div>
                </div>

                {/* White / Light Theme Option */}
                <div
                  onClick={() => applyTheme("light")}
                  className={`p-5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between gap-4 ${
                    theme === "light"
                      ? "border-purple-500 bg-purple-50/50 dark:bg-purple-950/20 ring-2 ring-purple-500/30 shadow-md"
                      : "border-border bg-surface-elevated/40 hover:border-text-secondary"
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-8 h-8 rounded-lg bg-white border border-slate-300 flex items-center justify-center text-purple-600">
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                            />
                          </svg>
                        </span>
                        <span className="text-sm font-bold text-text">
                          White Theme
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-text-muted leading-relaxed">
                      Clean white surface with crisp typography and subtle
                      borders for well-lit rooms.
                    </p>

                    {/* Light Preview Swatch */}
                    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                      <div className="h-2 w-2/3 rounded-sm bg-slate-200" />
                      <div className="h-2 w-1/2 rounded-sm bg-slate-100" />
                      <div className="flex gap-1.5 pt-1">
                        <div className="h-4 w-12 rounded-sm bg-purple-600" />
                        <div className="h-4 w-8 rounded-sm bg-slate-100 border border-slate-300" />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-border/60">
                    <div
                      className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                        theme === "light"
                          ? "border-purple-500 bg-purple-600"
                          : "border-border"
                      }`}
                    >
                      {theme === "light" && (
                        <div className="w-1.5 h-1.5 rounded-full bg-white" />
                      )}
                    </div>
                    <span className="text-xs font-semibold text-text">
                      {theme === "light" ? "Active" : "Select White Theme"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: SOLANA ON-CHAIN & SBT */}
          {activeTab === "solana" && <ProfileOnChainPanel />}
        </main>
      </div>

      {/* Revoke Device Modal */}
      <Modal
        isOpen={!!revokeTargetDevice}
        onClose={() => setRevokeTargetDevice(null)}
        title="Revoke Registered Device"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Are you sure you want to revoke access for{" "}
            <span className="font-semibold text-text">
              {revokeTargetDevice?.label || revokeTargetDevice?.deviceId}
            </span>
            ? This device will be unlinked from your account.
          </p>
          <div className="flex justify-end gap-2.5 pt-3 border-t border-border">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRevokeTargetDevice(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              isLoading={isRevokingDevice}
              onClick={handleRevokeDevice}
            >
              Confirm Revoke
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Account Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Delete Account & Data"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            This permanently deletes your account and all associated evaluations.
            This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2.5 pt-3 border-t border-border">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDeleteModal(false)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              isLoading={isDeletingAccount}
              onClick={handleDeleteAccount}
            >
              Delete Everything
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
