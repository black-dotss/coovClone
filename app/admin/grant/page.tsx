"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useSession } from "@/lib/auth/auth-client";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { ErrorPopup, SuccessPopup } from "@/components/ui/error-popup";
import { FullPageLoading } from "@/components/ui/loading-spinner";

const SUPER_ADMIN_EMAIL = "israelashenafi29@gmail.com";

const PLAN_OPTIONS = [
  { id: "pro_monthly", name: "Pro Monthly", duration: "30 days" },
  { id: "pro_plus_monthly", name: "Pro Plus Monthly", duration: "30 days" },
  { id: "pro_yearly", name: "Pro Yearly", duration: "365 days" },
  { id: "pro_plus_yearly", name: "Pro Plus Yearly", duration: "365 days" },
  { id: "unlimited_yearly", name: "Unlimited Yearly", duration: "365 days" },
];

export default function AdminGrantSubscriptionPage() {
  const { data: session, isPending } = useSession();
  const [email, setEmail] = useState("");
  const [selectedPlan, setSelectedPlan] = useState("pro_monthly");
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (isPending) {
    return <FullPageLoading />;
  }

  const currentUserEmail = (session?.user?.email || "").toLowerCase().trim();
  const isAuthorized = currentUserEmail === SUPER_ADMIN_EMAIL;

  if (!session || !isAuthorized) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center space-y-4">
        <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto text-lg font-bold">
          !
        </div>
        <h1 className="text-xl font-bold text-white">Access Restricted</h1>
        <p className="text-xs sm:text-sm text-text-muted">
          This administration tool is exclusively available for {SUPER_ADMIN_EMAIL}.
        </p>
        <div className="pt-2">
          <Link href="/">
            <Button variant="secondary" size="sm">
              Return to Home
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setErrorMessage("Please enter a valid recipient email address.");
      return;
    }

    setSubmitting(true);
    setSuccessMessage(null);
    setErrorMessage(null);

    try {
      const res = await apiFetch<{
        email: string;
        planTier: string;
        planName: string;
        message: string;
      }>("/api/admin/grant-subscription", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim(),
          planTier: selectedPlan,
        }),
      });

      setSuccessMessage(res.message);
      setEmail("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to grant subscription";
      setErrorMessage(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-12 space-y-6">
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono uppercase tracking-wider text-purple-400 font-bold">
              Admin Rewards Panel
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-300 font-mono">
              {SUPER_ADMIN_EMAIL}
            </span>
          </div>
          <Link href="/admin">
            <Button variant="outline" size="sm">
              Open Admin CRM
            </Button>
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-white">Grant Free Subscription</h1>
        <p className="text-xs sm:text-sm text-text-muted">
          Assign a full subscription plan directly to any user by email as a gift or reward.
        </p>
      </div>

      <SuccessPopup
        title="Plan Granted"
        message={successMessage}
        onDismiss={() => setSuccessMessage(null)}
      />

      <ErrorPopup
        title="Grant Plan Notice"
        message={errorMessage}
        onDismiss={() => setErrorMessage(null)}
      />

      <form onSubmit={handleGrant} className="p-6 rounded-2xl border border-border bg-surface space-y-5">
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-text-secondary">
            Recipient Email Address
          </label>
          <input
            type="email"
            required
            placeholder="example@gmail.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-border bg-surface-elevated text-white placeholder:text-text-muted focus:outline-hidden focus:border-purple-500 transition-colors"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-semibold text-text-secondary">
            Select Subscription Plan
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {PLAN_OPTIONS.map((plan) => {
              const isSelected = selectedPlan === plan.id;
              return (
                <div
                  key={plan.id}
                  onClick={() => setSelectedPlan(plan.id)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer select-none ${
                    isSelected
                      ? "border-purple-500 bg-purple-950/30"
                      : "border-border bg-surface-elevated hover:border-border-hover"
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-semibold text-white">
                    <span>{plan.name}</span>
                    {isSelected && (
                      <span className="text-[10px] text-purple-400 font-mono">Active</span>
                    )}
                  </div>
                  <div className="text-[11px] text-text-muted mt-0.5">
                    Duration: {plan.duration}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          isLoading={submitting}
          className="w-full text-sm font-semibold py-2.5 mt-2"
        >
          Apply Subscription Reward
        </Button>
      </form>
    </div>
  );
}
