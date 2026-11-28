"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { ErrorPopup } from "@/components/ui/error-popup";
import { Modal } from "@/components/ui/modal";
import { FullPageLoading } from "@/components/ui/loading-spinner";
import { useSolanaWallet } from "@/components/providers/solana-wallet-provider";

interface UsageData {
  plan: {
    tier: string;
    name: string;
    priceEth: number;
    dailyAllowance: number | null;
    monthlyAllowance: number | null;
  };
  usage: {
    dailyUsed: number;
    dailyRemaining: number;
    monthlyUsed: number;
    monthlyRemaining: number;
    lifetimeTrialUsed?: number;
    lifetimeTrialRemaining?: number;
  };
  timeZone: string;
  nextDailyResetAt: string;
  nextMonthlyResetAt: string;
}

interface RawUsageResponse {
  plan?: {
    id?: string;
    tier?: string;
    name?: string;
    priceEtb?: number;
    priceEth?: number;
    dailyAllowance?: number | null;
    monthlyAllowance?: number | null;
  };
  quotas?: {
    timezone: string;
    daily: {
      used: number;
      limit: number;
      remaining: number;
      resetsAt: string;
    };
    monthly: {
      used: number;
      limit: number;
      remaining: number;
      resetsAt: string;
    };
    trial: {
      isTrial: boolean;
      used: number;
      limit: number;
      remaining: number;
      eligible: boolean;
    };
    device?: {
      deviceId: string | null;
      isRegistered: boolean;
      trialClaimedOnDevice: boolean;
    };
  };
  usage?: {
    dailyUsed: number;
    dailyRemaining: number;
    monthlyUsed: number;
    monthlyRemaining: number;
    lifetimeTrialUsed?: number;
    lifetimeTrialRemaining?: number;
  };
  timeZone?: string;
  nextDailyResetAt?: string;
  nextMonthlyResetAt?: string;
}

interface PaymentOrder {
  id: string;
  orderReference: string;
  planTier: string;
  amount?: number;
  amountEtb?: number;
  currency: string;
  status: "pending" | "verified" | "failed" | "expired";
  preferredProvider?: string;
  paymentInstructions?: {
    receivingAccount?: string;
    accountName?: string;
    bankName?: string;
    instructions?: string;
  };
  expiresAt: string;
  createdAt: string;
}

type ProviderType = "telebirr" | "cbe";

export default function BillingPage() {
  const { publicKey, openConnectModal, signAndSubmitTx, clusterLabel } =
    useSolanaWallet();

  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [rawQuotas, setRawQuotas] = useState<RawUsageResponse["quotas"] | null>(null);
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Currency selection: "USDC" (default Solana Devnet) | "USD" (Polar.sh) | "ETB" (Verify.ET)
  const [currency, setCurrency] = useState<"USDC" | "USD" | "ETB">("USDC");
  const [polarLoadingTier, setPolarLoadingTier] = useState<string | null>(null);
  const [usdcLoadingTier, setUsdcLoadingTier] = useState<string | null>(null);

  // Order modal state
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [selectedPlanTier, setSelectedPlanTier] = useState<
    "pro_monthly" | "pro_plus_monthly" | "pro_yearly" | "pro_plus_yearly" | "unlimited_yearly"
  >("pro_monthly");
  const [selectedProvider, setSelectedProvider] = useState<ProviderType>("telebirr");
  const [activeOrder, setActiveOrder] = useState<PaymentOrder | null>(null);

  // Verification state
  const [transactionRef, setTransactionRef] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    status: string;
    message: string;
  } | null>(null);
  const [copiedAccount, setCopiedAccount] = useState<string | null>(null);

  const getPlanPriceEtb = (tier: string) => {
    switch (tier) {
      case "pro_monthly":
        return 150;
      case "pro_plus_monthly":
        return 300;
      case "pro_yearly":
        return 1000;
      case "pro_plus_yearly":
        return 2000;
      case "unlimited_yearly":
      case "executive_unlimited":
        return 4000;
      default:
        return 150;
    }
  };

  const getPlanDisplayName = (tier: string) => {
    switch (tier) {
      case "pro_monthly":
        return "Pro Monthly";
      case "pro_plus_monthly":
        return "Pro Plus Monthly";
      case "pro_yearly":
        return "Pro Yearly";
      case "pro_plus_yearly":
        return "Pro Plus Yearly";
      case "unlimited_yearly":
      case "executive_unlimited":
        return "Executive Unlimited";
      default:
        return "Pro Plan";
    }
  };

  const openEtbModal = (tier: string) => {
    setSelectedPlanTier(
      tier as "pro_monthly" | "pro_plus_monthly" | "pro_yearly" | "pro_plus_yearly" | "unlimited_yearly"
    );
    setTransactionRef("");
    setVerifyResult(null);
    setError(null);
    setShowOrderModal(true);
  };

  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function loadBilling() {
      try {
        const [usageRes, ordersRes] = await Promise.allSettled([
          apiFetch<RawUsageResponse>("/api/usage"),
          apiFetch<PaymentOrder[]>("/api/payments/orders"),
        ]);

        if (!ignore) {
          if (usageRes.status === "fulfilled" && usageRes.value) {
            const val = usageRes.value;
            if (val.quotas) {
              setRawQuotas(val.quotas);
            }
            const normalized: UsageData = {
              plan: {
                tier: val.plan?.tier || "free_trial",
                name: val.plan?.name || "Free Trial",
                priceEth: val.plan?.priceEtb || val.plan?.priceEth || 0,
                dailyAllowance: val.quotas?.daily?.limit ?? val.plan?.dailyAllowance ?? 5,
                monthlyAllowance: val.quotas?.monthly?.limit ?? val.plan?.monthlyAllowance ?? 150,
              },
              usage: {
                dailyUsed: val.quotas?.daily?.used ?? val.usage?.dailyUsed ?? 0,
                dailyRemaining: val.quotas?.daily?.remaining ?? val.usage?.dailyRemaining ?? 5,
                monthlyUsed: val.quotas?.monthly?.used ?? val.usage?.monthlyUsed ?? 0,
                monthlyRemaining: val.quotas?.monthly?.remaining ?? val.usage?.monthlyRemaining ?? 150,
                lifetimeTrialUsed: val.quotas?.trial?.used ?? val.usage?.lifetimeTrialUsed ?? 0,
                lifetimeTrialRemaining: val.quotas?.trial?.remaining ?? val.usage?.lifetimeTrialRemaining ?? 3,
              },
              timeZone: val.quotas?.timezone || val.timeZone || "Africa/Addis_Ababa",
              nextDailyResetAt: val.quotas?.daily?.resetsAt || val.nextDailyResetAt || new Date().toISOString(),
              nextMonthlyResetAt: val.quotas?.monthly?.resetsAt || val.nextMonthlyResetAt || new Date().toISOString(),
            };
            setUsageData(normalized);
          }
          if (ordersRes.status === "fulfilled") {
            setOrders(ordersRes.value);
          }
        }
      } catch (err: unknown) {
        if (!ignore) {
          const message =
            err instanceof Error ? err.message : "Failed to load billing information";
          setError(message);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadBilling();
    return () => {
      ignore = true;
    };
  }, [refreshKey]);

  const handleDirectVerify = async () => {
    const raw = transactionRef.trim();
    if (!raw) {
      setError("Please paste the confirmation SMS text or receipt link received on your phone.");
      return;
    }

    // Auto-detect CBE if the user pasted a CBE receipt URL or CBE SMS
    const isCbeContent =
      raw.includes("cbe.com.et") ||
      raw.includes("Banking with CBE") ||
      raw.includes("1000596935234") ||
      raw.toLowerCase().includes("commercial bank");
    const activeProvider = isCbeContent ? "cbe" : selectedProvider;
    if (isCbeContent && selectedProvider !== "cbe") {
      setSelectedProvider("cbe");
    }

    setVerifying(true);
    setError(null);
    setVerifyResult(null);

    try {
      // 1. Ensure an active order exists for this plan tier
      let currentOrder = activeOrder;
      if (!currentOrder || currentOrder.planTier !== selectedPlanTier || currentOrder.status !== "pending") {
        currentOrder = await apiFetch<PaymentOrder>("/api/payments/orders", {
          method: "POST",
          body: JSON.stringify({
            planTier: selectedPlanTier,
            preferredProvider: activeProvider,
          }),
        });
        setActiveOrder(currentOrder);
      }

      // 2. Submit SMS for verification
      const res = await apiFetch<PaymentOrder & { message?: string }>("/api/payments/verify", {
        method: "POST",
        body: JSON.stringify({
          orderId: currentOrder.id,
          orderReference: currentOrder.orderReference,
          transactionReference: raw,
          smsText: raw,
          provider: activeProvider,
          bank: activeProvider,
        }),
      });

      const orderStatus = (res?.status || "failed") as string;
      let resultMsg = res?.message || "";
      if (!resultMsg) {
        if (orderStatus === "verified") {
          resultMsg = `Payment verified successfully! You are now subscribed to ${getPlanDisplayName(selectedPlanTier)}.`;
        } else if (orderStatus === "pending") {
          resultMsg = "Payment submitted and pending bank confirmation. Your account will automatically update.";
        } else if (orderStatus === "ambiguous" || orderStatus === "duplicate") {
          resultMsg = "This transaction reference was already recorded or could not be matched. Please contact support if you were debited.";
        } else {
          resultMsg = "Verification could not confirm this transaction. Please ensure the payment was sent to our account and the SMS or CBE receipt link is correct.";
        }
      }

      setVerifyResult({ status: orderStatus, message: resultMsg });
      if (orderStatus === "verified") {
        setError(null);
        const planName = getPlanDisplayName(selectedPlanTier);
        setWelcomeBanner({
          tierName: planName,
          tierKey: selectedPlanTier,
        });
        setRefreshKey((k) => k + 1);
      } else {
        setError(resultMsg);
      }
    } catch (err: unknown) {
      let msg = "Verification failed. Please check your network connection and try again.";
      if (err instanceof Error && err.message?.trim()) {
        const rawMsg = err.message.trim();
        const jsonMatch = rawMsg.match(/\{.*"message"\s*:\s*"([^"]+)".*\}/);
        if (jsonMatch && jsonMatch[1]) {
          msg = jsonMatch[1];
        } else {
          msg = rawMsg;
        }
      }
      setError(msg);
      setVerifyResult({ status: "failed", message: msg });
    } finally {
      setVerifying(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedAccount(text);
    setTimeout(() => {
      setCopiedAccount(null);
    }, 2000);
  };

  const handlePolarCheckout = async (planTier: string) => {
    setPolarLoadingTier(planTier);
    setError(null);
    try {
      const res = await apiFetch<{ checkoutUrl: string }>("/api/payments/polar/checkout", {
        method: "POST",
        body: JSON.stringify({ planTier }),
      });
      if (res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
      } else {
        throw new Error("No checkout URL returned by Polar.");
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to launch Polar checkout";
      setError(message);
      setPolarLoadingTier(null);
    }
  };

  const handleUsdcCheckout = async (planTier: string) => {
    if (!publicKey) {
      openConnectModal();
      return;
    }

    setUsdcLoadingTier(planTier);
    setError(null);
    try {
      const prepared = await apiFetch<{
        orderId: string;
        planTier: string;
        serializedTxBase64: string;
        amountUsdc: number;
      }>("/api/solana/payments", {
        method: "POST",
        body: JSON.stringify({
          planTier,
          walletAddress: publicKey,
        }),
      });

      const txSignature = await signAndSubmitTx(prepared.serializedTxBase64);

      await apiFetch("/api/solana/payments", {
        method: "PATCH",
        body: JSON.stringify({
          orderId: prepared.orderId,
          planTier,
          walletAddress: publicKey,
          txSignature,
        }),
      });

      const displayName = getPlanDisplayName(planTier);
      setWelcomeBanner({
        tierName: displayName,
        tierKey: planTier,
      });
      setVerifyResult({
        status: "verified",
        message: `Paid ${prepared.amountUsdc} USDC on Solana ${clusterLabel}! ${displayName} is now active.`,
      });
      setRefreshKey((k) => k + 1);
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to complete Solana USDC checkout.";
      setError(message);
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } finally {
      setUsdcLoadingTier(null);
    }
  };

  const [welcomeBanner, setWelcomeBanner] = useState<{
    tierName: string;
    tierKey: string;
  } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("success") === "true") {
      const tierParam = urlParams.get("tier") || "pro_plus_monthly";
      const displayName = getPlanDisplayName(tierParam);
      try {
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch {}

      const timer = setTimeout(() => {
        setWelcomeBanner({
          tierName: displayName,
          tierKey: tierParam,
        });
        setVerifyResult({
          status: "verified",
          message: `Welcome to ${displayName}! Your payment was confirmed and your subscription is active.`,
        });
        setRefreshKey((k) => k + 1);
      }, 0);

      return () => clearTimeout(timer);
    }
  }, []);

  const isDeviceRestricted =
    rawQuotas?.trial?.isTrial &&
    !rawQuotas?.trial?.eligible &&
    rawQuotas?.device?.trialClaimedOnDevice;

  if (loading) {
    return <FullPageLoading />;
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        {/* Welcome Celebration Banner on Successful Payment */}
        {welcomeBanner && (
          <div className="p-6 rounded-2xl bg-gradient-to-r from-purple-900/60 via-purple-950/50 to-fuchsia-950/40 border-2 border-purple-500/70 shadow-2xl shadow-purple-950/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-purple-500 text-white flex items-center justify-center text-2xl font-black shadow-lg shadow-purple-500/40 shrink-0">
                ✓
              </div>
              <div>
                <h2 className="text-xl sm:text-2xl font-black text-white">
                  Welcome to {welcomeBanner.tierName}!
                </h2>
                <p className="text-xs sm:text-sm text-purple-200 mt-1">
                  Your payment has been successfully confirmed. Your subscription is active and all features and quotas are now unlocked.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link href="/evaluations/new">
                <Button size="sm" className="bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold px-4 py-2">
                  Start CV Review →
                </Button>
              </Link>
            </div>
          </div>
        )}

        {/* Device Restriction Alert */}
        {isDeviceRestricted && (
          <Alert
            variant="warning"
            title="Trial Allowance Restricted on this Device"
            action={
              <Link href="/profile">
                <Button variant="outline" size="sm" className="text-xs">
                  Device Recovery →
                </Button>
              </Link>
            }
          >
            This device and account have reached their shared limit of 3 free recruitment reviews.
            To evaluate more CVs without waiting, upgrade to Pro below with USD, Solana USDC, or ETB.
          </Alert>
        )}

        <ErrorPopup
          title="Billing Notice"
          message={error}
          onDismiss={() => setError(null)}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoading(true);
                setError(null);
                setRefreshKey((k) => k + 1);
              }}
            >
              Retry
            </Button>
          }
        />

        <div className="space-y-8">
            {/* Plans List */}
            <div className="space-y-6">

              {/* Currency Toggle Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-surface border border-border">
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-white">Select Currency & Payment Method</h2>
                  <p className="text-xs text-text-secondary mt-0.5">
                    {currency === "USD"
                      ? "Pay internationally with Credit Card / Apple Pay / Google Pay via Polar.sh"
                      : currency === "USDC"
                      ? `Pay directly on Solana ${clusterLabel} with USDC (${
                          publicKey
                            ? `Connected: ${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`
                            : "Phantom or Solflare wallet"
                        })`
                      : "Pay locally in Ethiopia via Telebirr or CBE bank transfer"}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {currency === "USDC" && !publicKey && (
                    <Button variant="outline" size="sm" onClick={openConnectModal}>
                      Connect Wallet
                    </Button>
                  )}
                  <div className="flex items-center p-1 bg-surface-elevated border border-border rounded-lg shrink-0 self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={() => setCurrency("USDC")}
                      className={`px-3.5 py-1.5 rounded-md text-xs font-bold font-mono transition-all cursor-pointer ${
                        currency === "USDC"
                          ? "bg-surface border border-border text-purple-400"
                          : "text-text-muted hover:text-text border border-transparent"
                      }`}
                    >
                      USDC (Solana)
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrency("USD")}
                      className={`px-3.5 py-1.5 rounded-md text-xs font-bold font-mono transition-all cursor-pointer ${
                        currency === "USD"
                          ? "bg-surface border border-border text-purple-400"
                          : "text-text-muted hover:text-text border border-transparent"
                      }`}
                    >
                      USD ($)
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrency("ETB")}
                      className={`px-3.5 py-1.5 rounded-md text-xs font-bold font-mono transition-all cursor-pointer ${
                        currency === "ETB"
                          ? "bg-surface border border-border text-purple-400"
                          : "text-text-muted hover:text-text border border-transparent"
                      }`}
                    >
                      ETB
                    </button>
                  </div>
                </div>
              </div>

              {/* Top Row: 3 Monthly & Trial Offers */}
              <div id="billing-monthly-plans" className="scroll-mt-20 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-text-muted uppercase tracking-wider">
                    Monthly & Trial Plans
                  </span>
                  <span className="text-xs text-text-muted font-mono">3 Plans</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Free Trial Tier */}
                  <Card className="border-border bg-surface flex flex-col justify-between rounded-2xl">
                    <CardHeader className="border-b border-border pb-4">
                      <div className="flex items-center justify-between mb-3">
                        <Badge variant="neutral" size="sm">Trial</Badge>
                        <span className="text-[10px] font-mono text-text-muted">3 shared trial reviews</span>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl sm:text-4xl font-extrabold font-mono text-text">0</span>
                        <span className="text-base font-bold font-mono text-purple-600 dark:text-purple-300">{currency}</span>
                        <span className="text-xs font-mono text-text-muted ml-1">/ lifetime</span>
                      </div>
                      <CardTitle className="text-base font-bold text-text mt-2">Free Trial</CardTitle>
                      <p className="text-xs text-text-secondary mt-0.5">Test the hiring committee evaluation</p>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-4 flex-1 flex flex-col justify-between">
                      <ul className="space-y-2 text-xs text-text-secondary">
                        <li className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>3 Lifetime CV audits</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>6 Evaluator personas</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>ATS keyword breakdown</span>
                        </li>
                      </ul>
                      <Button
                        variant="outline"
                        className="w-full text-xs font-semibold"
                        disabled={usageData?.plan.tier === "free_trial"}
                      >
                        {usageData?.plan.tier === "free_trial" ? "Current Plan" : "Included"}
                      </Button>
                    </CardContent>
                  </Card>

                  {/* Pro Monthly */}
                  <Card className="border-border bg-surface flex flex-col justify-between rounded-2xl">
                    <CardHeader className="border-b border-border pb-4">
                      <div className="flex items-center justify-between mb-3">
                        <Badge variant="neutral" size="sm">Monthly</Badge>
                        <span className="text-[10px] font-mono text-text-muted">Active Search</span>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl sm:text-4xl font-extrabold font-mono text-text">
                          {currency === "ETB" ? "150" : "5"}
                        </span>
                        <span className="text-base font-bold font-mono text-purple-600 dark:text-purple-300">{currency}</span>
                        <span className="text-xs font-mono text-text-muted ml-1">/ mo</span>
                      </div>
                      <CardTitle className="text-base font-bold text-text mt-2">Pro Monthly</CardTitle>
                      <p className="text-xs text-text-secondary mt-0.5">5 reviews daily allowance</p>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-4 flex-1 flex flex-col justify-between">
                      <ul className="space-y-2 text-xs text-text-secondary">
                        <li className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>150 reviews monthly quota</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>Truthful bullet rewrites</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>Score defense appeals</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>Mock interview room</span>
                        </li>
                      </ul>
                      <Button
                        variant={usageData?.plan.tier === "pro_monthly" ? "outline" : "outline"}
                        className={`w-full text-xs font-semibold ${
                          usageData?.plan.tier === "pro_monthly"
                            ? "bg-surface-elevated text-purple-300 border-purple-500/40 cursor-default opacity-90"
                            : ""
                        }`}
                        disabled={usageData?.plan.tier === "pro_monthly"}
                        isLoading={
                          polarLoadingTier === "pro_monthly" ||
                          usdcLoadingTier === "pro_monthly"
                        }
                        onClick={() => {
                          if (currency === "USD") {
                            handlePolarCheckout("pro_monthly");
                          } else if (currency === "USDC") {
                            void handleUsdcCheckout("pro_monthly");
                          } else {
                            openEtbModal("pro_monthly");
                          }
                        }}
                      >
                        {usageData?.plan.tier === "pro_monthly"
                          ? "Current Plan"
                          : usageData?.plan.tier && usageData.plan.tier !== "free_trial"
                          ? `Switch to Pro Monthly (${
                              currency === "USD"
                                ? "$5 USD"
                                : currency === "USDC"
                                ? "5 USDC"
                                : "150 ETB"
                            })`
                          : currency === "USD"
                          ? "Upgrade ($5 USD)"
                          : currency === "USDC"
                          ? publicKey
                            ? "Pay 5 USDC (Solana)"
                            : "Connect Wallet · 5 USDC"
                          : "Upgrade (150 ETB)"}
                      </Button>
                    </CardContent>
                  </Card>

                  {/* Pro Plus Monthly - Priority Subscription (Purple Accent with High Contrast in Light & Dark) */}
                  <Card className="border-2 border-purple-600 dark:border-purple-500 bg-surface dark:bg-gradient-to-b dark:from-purple-900/70 dark:via-purple-950/80 dark:to-[#130924] flex flex-col justify-between relative shadow-xl shadow-purple-500/10 dark:shadow-purple-950/60 rounded-2xl overflow-hidden ring-1 ring-purple-500/30">
                    <CardHeader className="border-b border-border dark:border-purple-500/30 pb-4">
                      <div className="flex items-center justify-between mb-3">
                        <Badge variant="purple" size="sm">Priority Sub</Badge>
                        <span className="text-[10px] font-mono font-bold text-text-muted dark:text-purple-200">High Volume</span>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl sm:text-4xl font-extrabold font-mono text-text dark:text-white">
                          {currency === "ETB" ? "300" : "9"}
                        </span>
                        <span className="text-base font-bold font-mono text-purple-600 dark:text-purple-300">{currency}</span>
                        <span className="text-xs font-mono text-text-muted dark:text-purple-200 ml-1">/ mo</span>
                      </div>
                      <CardTitle className="text-base font-bold text-text dark:text-white mt-2">Pro Plus Monthly</CardTitle>
                      <p className="text-xs font-medium text-text-secondary dark:text-purple-200 mt-0.5">12 reviews daily allowance</p>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-4 flex-1 flex flex-col justify-between">
                      <ul className="space-y-2 text-xs font-medium text-text-secondary dark:text-purple-100">
                        <li className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 text-purple-600 dark:text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>350 reviews monthly quota</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 text-purple-600 dark:text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>Priority committee queue</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 text-purple-600 dark:text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>Unlimited mock practice</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 text-purple-600 dark:text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>Multi-JD match & ranking</span>
                        </li>
                      </ul>
                      <Button
                        variant="primary"
                        className={`w-full text-xs font-bold ${
                          usageData?.plan.tier === "pro_plus_monthly"
                            ? "bg-surface-elevated text-purple-300 border border-purple-500/40 cursor-default opacity-90 shadow-none"
                            : "bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-600/30 dark:shadow-purple-900/50"
                        }`}
                        disabled={usageData?.plan.tier === "pro_plus_monthly"}
                        isLoading={
                          polarLoadingTier === "pro_plus_monthly" ||
                          usdcLoadingTier === "pro_plus_monthly"
                        }
                        onClick={() => {
                          if (currency === "USD") {
                            handlePolarCheckout("pro_plus_monthly");
                          } else if (currency === "USDC") {
                            void handleUsdcCheckout("pro_plus_monthly");
                          } else {
                            openEtbModal("pro_plus_monthly");
                          }
                        }}
                      >
                        {usageData?.plan.tier === "pro_plus_monthly"
                          ? "Current Plan"
                          : usageData?.plan.tier && usageData.plan.tier !== "free_trial"
                          ? `Switch to Pro Plus (${
                              currency === "USD"
                                ? "$9 USD"
                                : currency === "USDC"
                                ? "9 USDC"
                                : "300 ETB"
                            })`
                          : currency === "USD"
                          ? "Select $9 USD"
                          : currency === "USDC"
                          ? publicKey
                            ? "Pay 9 USDC (Solana)"
                            : "Connect Wallet · 9 USDC"
                          : "Select 300 ETB"}
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </div>

              {/* Bottom Row: 2 Annual & Unlimited Offers Placed Below Others */}
              <div id="billing-annual-plans" className="mt-8 pt-6 border-t border-border scroll-mt-20 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-text">Annual & Unlimited Plans</h3>
                      <Badge variant="success" size="sm">
                        {currency === "ETB" ? "Save 1,600 ETB" : "Save 55%"}
                      </Badge>
                    </div>
                    <p className="text-xs text-text-secondary mt-0.5">
                      Save up to 50% with annual billing and unlock continuous coaching with priority queues.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
                  {/* Pro Plus Yearly */}
                  <Card className="border-border bg-surface flex flex-col justify-between rounded-2xl">
                    <CardHeader className="border-b border-border pb-4">
                      <div className="flex items-center justify-between mb-3">
                        <Badge variant="success" size="sm">
                          {currency === "ETB" ? "Save 1,600 ETB" : "Save 55%"}
                        </Badge>
                        <span className="text-[10px] font-mono text-text-muted">Annual Access</span>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl sm:text-4xl font-extrabold font-mono text-text">
                          {currency === "ETB" ? "2,000" : "49"}
                        </span>
                        <span className="text-base font-bold font-mono text-purple-600 dark:text-purple-300">{currency}</span>
                        <span className="text-xs font-mono text-text-muted ml-1">/ yr</span>
                      </div>
                      <CardTitle className="text-base font-bold text-text mt-2">Pro Plus Yearly</CardTitle>
                      <p className="text-xs text-text-secondary mt-0.5">365 days full access</p>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-4 flex-1 flex flex-col justify-between">
                      <ul className="space-y-2 text-xs text-text-secondary">
                        <li className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>All Pro Plus features for 1 yr</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>4,200 reviews annual quota</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>Unlimited version diffing</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>Priority LLM queue</span>
                        </li>
                      </ul>
                      <Button
                        variant={usageData?.plan.tier === "pro_plus_yearly" ? "outline" : "outline"}
                        className={`w-full text-xs font-semibold ${
                          usageData?.plan.tier === "pro_plus_yearly"
                            ? "bg-surface-elevated text-purple-300 border-purple-500/40 cursor-default opacity-90"
                            : ""
                        }`}
                        disabled={usageData?.plan.tier === "pro_plus_yearly"}
                        isLoading={
                          polarLoadingTier === "pro_plus_yearly" ||
                          usdcLoadingTier === "pro_plus_yearly"
                        }
                        onClick={() => {
                          if (currency === "USD") {
                            handlePolarCheckout("pro_plus_yearly");
                          } else if (currency === "USDC") {
                            void handleUsdcCheckout("pro_plus_yearly");
                          } else {
                            openEtbModal("pro_plus_yearly");
                          }
                        }}
                      >
                        {usageData?.plan.tier === "pro_plus_yearly"
                          ? "Current Plan"
                          : usageData?.plan.tier && usageData.plan.tier !== "free_trial"
                          ? `Switch to Pro Plus Yearly (${
                              currency === "USD"
                                ? "$49 USD"
                                : currency === "USDC"
                                ? "49 USDC"
                                : "2,000 ETB"
                            })`
                          : currency === "USD"
                          ? "Select $49 USD"
                          : currency === "USDC"
                          ? publicKey
                            ? "Pay 49 USDC (Solana)"
                            : "Connect Wallet · 49 USDC"
                          : "Select 2,000 ETB"}
                      </Button>
                    </CardContent>
                  </Card>

                  {/* Executive VIP (Unlimited) - Priority Subscription */}
                  <Card className="border-2 border-purple-600 dark:border-purple-500 bg-surface dark:bg-gradient-to-b dark:from-purple-900/70 dark:via-purple-950/80 dark:to-[#130924] flex flex-col justify-between relative shadow-xl shadow-purple-500/10 dark:shadow-purple-950/60 rounded-2xl overflow-hidden ring-1 ring-purple-500/30">
                    <CardHeader className="border-b border-border dark:border-purple-500/30 pb-4">
                      <div className="flex items-center justify-between mb-3">
                        <Badge variant="purple" size="sm">Priority Sub</Badge>
                        <span className="text-[10px] font-mono font-bold text-text-muted dark:text-purple-200">Zero Caps</span>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl sm:text-4xl font-extrabold font-mono text-text dark:text-white">
                          {currency === "ETB" ? "4,000" : "99"}
                        </span>
                        <span className="text-base font-bold font-mono text-purple-600 dark:text-purple-300">{currency}</span>
                        <span className="text-xs font-mono text-text-muted dark:text-purple-200 ml-1">/ 1-yr</span>
                      </div>
                      <CardTitle className="text-base font-bold text-text dark:text-white mt-2">Executive Unlimited</CardTitle>
                      <p className="text-xs font-medium text-text-secondary dark:text-purple-200 mt-0.5">Zero caps & VIP priority</p>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-4 flex-1 flex flex-col justify-between">
                      <ul className="space-y-2 text-xs font-medium text-text-secondary dark:text-purple-100">
                        <li className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 text-purple-600 dark:text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          <span className="font-semibold text-text dark:text-white">Unlimited evaluations</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 text-purple-600 dark:text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>Unlimited mock interviews</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 text-purple-600 dark:text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>Unlimited role comparisons</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 text-purple-600 dark:text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>Dedicated 24/7 review queue</span>
                        </li>
                      </ul>
                      <Button
                        variant="primary"
                        className={`w-full text-xs font-bold ${
                          usageData?.plan.tier === "unlimited_yearly"
                            ? "bg-surface-elevated text-purple-300 border border-purple-500/40 cursor-default opacity-90 shadow-none"
                            : "bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-600/30 dark:shadow-purple-900/50"
                        }`}
                        disabled={usageData?.plan.tier === "unlimited_yearly"}
                        isLoading={
                          polarLoadingTier === "unlimited_yearly" ||
                          usdcLoadingTier === "unlimited_yearly"
                        }
                        onClick={() => {
                          if (currency === "USD") {
                            handlePolarCheckout("executive_unlimited");
                          } else if (currency === "USDC") {
                            void handleUsdcCheckout("unlimited_yearly");
                          } else {
                            openEtbModal("unlimited_yearly");
                          }
                        }}
                      >
                        {usageData?.plan.tier === "unlimited_yearly"
                          ? "Current Plan"
                          : usageData?.plan.tier && usageData.plan.tier !== "free_trial"
                          ? `Switch to Unlimited (${
                              currency === "USD"
                                ? "$99 USD"
                                : currency === "USDC"
                                ? "99 USDC"
                                : "4,000 ETB"
                            })`
                          : currency === "USD"
                          ? "Get Unlimited ($99 USD)"
                          : currency === "USDC"
                          ? publicKey
                            ? "Pay 99 USDC (Solana)"
                            : "Connect Wallet · 99 USDC"
                          : "Get Unlimited (4,000 ETB)"}
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>

            {/* Payment Orders History */}
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <h2 className="text-sm font-bold tracking-tight text-text">
                  Payment History & Orders ({orders.length})
                </h2>
                <span className="text-xs text-text-muted font-mono">
                  Automated Verify.ET reconciliation
                </span>
              </div>

              {orders.length === 0 ? (
                <Card className="text-center py-8 bg-surface border-border">
                  <CardContent>
                    <p className="text-xs text-text-muted">No payment orders created yet.</p>
                  </CardContent>
                </Card>
              ) : (
                <Card className="bg-surface border-border overflow-hidden">
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-surface-elevated border-b border-border text-text-muted uppercase tracking-wider font-mono">
                          <tr>
                            <th className="px-4 py-3">Order Ref</th>
                            <th className="px-4 py-3">Plan</th>
                            <th className="px-4 py-3">Amount</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3">Date</th>
                            <th className="px-4 py-3 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {orders.map((ord) => (
                            <tr key={ord.id} className="hover:bg-surface-elevated/50 transition-colors">
                              <td className="px-4 py-3 font-mono font-bold text-text">
                                {ord.orderReference}
                              </td>
                              <td className="px-4 py-3 capitalize text-text-secondary">
                                {ord.planTier.replace("_", " ")}
                              </td>
                              <td className="px-4 py-3 font-mono font-medium text-text">
                                {ord.amountEtb ?? ord.amount} {ord.currency}
                              </td>
                              <td className="px-4 py-3">
                                <Badge
                                  variant={
                                    ord.status === "verified"
                                      ? "success"
                                      : ord.status === "pending"
                                      ? "warning"
                                      : "danger"
                                  }
                                  size="sm"
                                >
                                  {ord.status.toUpperCase()}
                                </Badge>
                              </td>
                              <td className="px-4 py-3 text-text-muted font-mono">
                                {new Date(ord.createdAt).toLocaleDateString()}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {ord.status === "pending" && ord.currency !== "USDC" && (
                                  <button
                                    onClick={() => {
                                      openEtbModal(ord.planTier);
                                      setActiveOrder(ord);
                                    }}
                                    className="text-purple-400 hover:text-purple-300 hover:underline font-semibold cursor-pointer"
                                  >
                                    Verify Now →
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Legal Text Links for Polar Merchant of Record & Refund Assurance */}
            <div className="pt-4 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-text-muted text-center sm:text-left">
              <span>Subscriptions processed via Polar.sh (Merchant of Record)</span>
              <div className="flex flex-wrap items-center justify-center gap-3 font-mono">
                <Link href="/terms" className="text-text-secondary hover:text-text underline transition-colors whitespace-nowrap">
                  Terms of Service
                </Link>
                <span>·</span>
                <Link href="/refund" className="text-text-secondary hover:text-text underline transition-colors whitespace-nowrap">
                  Refund Policy
                </Link>
                <span>·</span>
                <Link href="/privacy" className="text-text-secondary hover:text-text underline transition-colors whitespace-nowrap">
                  Privacy Policy
                </Link>
              </div>
            </div>
          </div>

        {/* Simple & Direct ETB Payment Modal */}
        <Modal
          isOpen={showOrderModal}
          onClose={() => {
            setShowOrderModal(false);
            setVerifyResult(null);
            setError(null);
          }}
          title={`Pay for ${getPlanDisplayName(selectedPlanTier)}`}
        >
          <div className="space-y-5 py-1">
            {/* Amount and Recipient Header */}
            <div className="flex items-center justify-between pb-3.5 border-b border-border">
              <div>
                <span className="text-xs text-text-muted block">Amount to Pay</span>
                <span className="text-2xl font-bold font-mono text-white">
                  {getPlanPriceEtb(selectedPlanTier)} ETB
                </span>
              </div>
              <div className="text-right">
                <span className="text-xs text-text-muted block">Recipient</span>
                <span className="text-sm font-semibold text-white">
                  Esrael Ashenafi
                </span>
              </div>
            </div>

            {!error &&
              verifyResult &&
              verifyResult.message &&
              verifyResult.message.trim().length > 0 && (
              <Alert
                variant={
                  verifyResult.status === "verified"
                    ? "success"
                    : verifyResult.status === "pending"
                    ? "warning"
                    : "danger"
                }
              >
                {verifyResult.message}
              </Alert>
            )}

            {/* Clickable Account Cards (Click to Copy & Select) */}
            <div className="space-y-2">
              <span className="text-xs text-text-muted block">
                Transfer to either account (click to copy):
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Telebirr Card */}
                <div
                  onClick={() => {
                    setSelectedProvider("telebirr");
                    handleCopy("0992013392");
                  }}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer select-none ${
                    selectedProvider === "telebirr"
                      ? "border-purple-500 bg-purple-950/25"
                      : "border-border bg-surface-elevated hover:border-border-hover"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-white">Telebirr</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/payments/telebirr.jpg" alt="Telebirr" className="h-5 w-auto object-contain rounded-xs" />
                  </div>
                  <div className="font-mono text-base font-bold text-white tracking-wide">
                    0992013392
                  </div>
                  <div className="flex items-center justify-between mt-1 text-[11px]">
                    <span className="text-text-muted">Esrael Ashenafi</span>
                    <span className={copiedAccount === "0992013392" ? "text-emerald-400 font-medium" : "text-text-muted"}>
                      {copiedAccount === "0992013392" ? "Copied!" : "Click to copy"}
                    </span>
                  </div>
                </div>

                {/* CBE Card */}
                <div
                  onClick={() => {
                    setSelectedProvider("cbe");
                    handleCopy("1000596935234");
                  }}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer select-none ${
                    selectedProvider === "cbe"
                      ? "border-purple-500 bg-purple-950/25"
                      : "border-border bg-surface-elevated hover:border-border-hover"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-white">Commercial Bank (CBE)</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/payments/cbe.jpg" alt="CBE" className="h-5 w-auto object-contain rounded-xs" />
                  </div>
                  <div className="font-mono text-base font-bold text-white tracking-wide">
                    1000596935234
                  </div>
                  <div className="flex items-center justify-between mt-1 text-[11px]">
                    <span className="text-text-muted">Esrael Ashenafi Bekele</span>
                    <span className={copiedAccount === "1000596935234" ? "text-emerald-400 font-medium" : "text-text-muted"}>
                      {copiedAccount === "1000596935234" ? "Copied!" : "Click to copy"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Confirmation SMS / Link Input */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-text-secondary">
                Confirmation SMS or CBE Receipt Link
              </label>
              <textarea
                rows={3}
                className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-border bg-surface text-white placeholder:text-text-muted focus:outline-hidden focus:border-purple-500 transition-colors"
                placeholder="Paste your confirmation SMS or CBE receipt link (e.g. https://mbreciept.cbe.com.et/...)"
                value={transactionRef}
                onChange={(e) => setTransactionRef(e.target.value)}
              />
            </div>

            <Button
              variant="primary"
              size="lg"
              onClick={handleDirectVerify}
              isLoading={verifying}
              disabled={!transactionRef.trim()}
              className="w-full text-sm font-semibold py-2.5"
            >
              Verify Payment
            </Button>
          </div>
        </Modal>
    </div>
  );
}
