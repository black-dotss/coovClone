"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export function PricingSection() {
  const [currency, setCurrency] = useState<"USD" | "ETB">("ETB");

  return (
    <section className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto w-full border-t border-border">
      <div className="max-w-xl mx-auto text-center mb-10">
        <Badge variant="neutral" size="sm" className="mb-2.5 font-mono">
          Pricing & Subscriptions
        </Badge>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-text">
          Simple, Transparent Plans
        </h2>
        <p className="mt-1.5 text-xs sm:text-sm text-text-secondary">
          {currency === "USD"
            ? "Global checkout with credit card, Apple Pay, or Google Pay via Polar.sh."
            : "Instant activation via Telebirr and CBE bank transfer with zero recurring surprises."}
        </p>

        {/* Currency Switcher */}
        <div className="flex items-center justify-center mt-5">
          <div className="flex items-center p-1 bg-surface-elevated border border-border rounded-xl">
            <button
              type="button"
              onClick={() => setCurrency("USD")}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold font-mono transition-all cursor-pointer whitespace-nowrap ${
                currency === "USD"
                  ? "bg-purple-600 text-white shadow-sm shadow-purple-950/40"
                  : "text-text-muted hover:text-text"
              }`}
            >
              USD ($)
            </button>
            <button
              type="button"
              onClick={() => setCurrency("ETB")}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold font-mono transition-all cursor-pointer whitespace-nowrap ${
                currency === "ETB"
                  ? "bg-purple-600 text-white shadow-sm shadow-purple-950/40"
                  : "text-text-muted hover:text-text"
              }`}
            >
              ETB
            </button>
          </div>
        </div>
      </div>

      {/* Top Section: 3 Monthly & Trial Offers */}
      <div id="monthly-plans" className="scroll-mt-24 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono text-text-muted uppercase tracking-wider">
            Monthly & Trial Offers
          </span>
          <span className="text-xs text-text-muted font-mono">3 Plans</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Plan 1: Free Trial */}
          <Card className="rounded-2xl border border-border bg-surface flex flex-col justify-between shadow-xs">
            <CardHeader className="border-b border-border pb-4">
              <div className="flex items-center justify-between mb-3">
                <Badge variant="neutral" size="sm">Trial</Badge>
                <span className="text-[10px] font-mono text-text-muted">1 claim per device</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl sm:text-4xl font-extrabold font-mono text-text">0</span>
                <span className="text-base font-bold font-mono text-purple-600 dark:text-purple-400">{currency}</span>
                <span className="text-xs font-mono text-text-muted ml-1">/ lifetime</span>
              </div>
              <CardTitle className="text-base font-bold text-text mt-2">Free Trial</CardTitle>
              <p className="text-xs text-text-secondary mt-0.5 font-medium">
                Test the hiring committee evaluation on your actual CV.
              </p>
            </CardHeader>
            <CardContent className="space-y-4 pt-4 flex-1 flex flex-col justify-between">
              <ul className="text-xs space-y-2 text-text-secondary font-medium">
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
              <div className="pt-2">
                <Link href="/auth?register=true">
                  <Button variant="outline" className="w-full text-xs h-9 font-bold">
                    Start Free Trial
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Plan 2: Pro Monthly */}
          <Card className="rounded-2xl border border-border bg-surface flex flex-col justify-between shadow-xs">
            <CardHeader className="border-b border-border pb-4">
              <div className="flex items-center justify-between mb-3">
                <Badge variant="neutral" size="sm">Monthly</Badge>
                <span className="text-[10px] font-mono text-text-muted">Active Search</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl sm:text-4xl font-extrabold font-mono text-text">
                  {currency === "USD" ? "5" : "150"}
                </span>
                <span className="text-base font-bold font-mono text-purple-600 dark:text-purple-400">{currency}</span>
                <span className="text-xs font-mono text-text-muted ml-1">/ mo</span>
              </div>
              <CardTitle className="text-base font-bold text-text mt-2">Pro Monthly</CardTitle>
              <p className="text-xs text-text-secondary mt-0.5 font-medium">
                5 reviews daily allowance
              </p>
            </CardHeader>
            <CardContent className="space-y-4 pt-4 flex-1 flex flex-col justify-between">
              <ul className="text-xs space-y-2 text-text-secondary font-medium">
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
              <div className="pt-2">
                <Link href="/billing">
                  <Button variant="outline" className="w-full text-xs h-9 font-bold">
                    {currency === "USD" ? "Select $5 USD" : "Select 150 ETB"}
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Plan 3: Pro Plus Monthly - Priority Subscription (Purple Accent with High Contrast in Light & Dark) */}
          <Card className="border-2 border-purple-600 dark:border-purple-500 bg-surface dark:bg-gradient-to-b dark:from-purple-900/70 dark:via-purple-950/80 dark:to-[#130924] flex flex-col justify-between relative shadow-xl shadow-purple-500/10 dark:shadow-purple-950/60 rounded-2xl overflow-hidden ring-1 ring-purple-500/30">
            <CardHeader className="border-b border-border dark:border-purple-500/30 pb-4">
              <div className="flex items-center justify-between mb-3">
                <Badge variant="purple" size="sm">Priority Sub</Badge>
                <span className="text-[10px] font-mono font-bold text-text-muted dark:text-purple-200">High Volume</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl sm:text-4xl font-extrabold font-mono text-text dark:text-white">
                  {currency === "USD" ? "9" : "300"}
                </span>
                <span className="text-base font-bold font-mono text-purple-600 dark:text-purple-300">{currency}</span>
                <span className="text-xs font-mono text-text-muted dark:text-purple-200 ml-1">/ mo</span>
              </div>
              <CardTitle className="text-base font-bold text-text dark:text-white mt-2">Pro Plus Monthly</CardTitle>
              <p className="text-xs font-medium text-text-secondary dark:text-purple-200 mt-0.5">
                12 reviews daily allowance
              </p>
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
              <div className="pt-2">
                <Link href="/billing">
                  <Button variant="primary" className="w-full text-xs h-9 font-bold bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-600/30 dark:shadow-purple-900/50">
                    {currency === "USD" ? "Select $9 USD" : "Select 300 ETB"}
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Bottom Section: 2 Annual & Unlimited Offers Placed Below Others */}
      <div id="annual-plans" className="mt-14 pt-8 border-t border-border scroll-mt-24 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-text">Annual & Unlimited Plans</h3>
              <Badge variant="success" size="sm" className="font-mono">
                {currency === "USD" ? "Save 55%" : "Save 1,600 ETB"}
              </Badge>
            </div>
            <p className="text-xs text-text-secondary mt-0.5">
              Full-year access with massive savings, continuous interview prep, and priority review queues.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {/* Plan 4: Pro Plus Yearly */}
          <Card className="rounded-2xl border border-border bg-surface flex flex-col justify-between">
            <CardHeader className="border-b border-border pb-4">
              <div className="flex items-center justify-between mb-3">
                <Badge variant="success" size="sm">
                  {currency === "USD" ? "Save 55%" : "Save 1,600 ETB"}
                </Badge>
                <span className="text-[10px] font-mono text-text-muted">Annual Access</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl sm:text-4xl font-extrabold font-mono text-text">
                  {currency === "USD" ? "49" : "2,000"}
                </span>
                <span className="text-base font-bold font-mono text-purple-600 dark:text-purple-300">{currency}</span>
                <span className="text-xs font-mono text-text-muted ml-1">/ yr</span>
              </div>
              <CardTitle className="text-base font-bold text-text mt-2">Pro Plus Yearly</CardTitle>
              <p className="text-xs text-text-secondary mt-0.5">
                365 days full access
              </p>
            </CardHeader>
            <CardContent className="space-y-4 pt-4 flex-1 flex flex-col justify-between">
              <ul className="text-xs space-y-2 text-text-secondary">
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
              <div className="pt-2">
                <Link href="/billing">
                  <Button variant="outline" className="w-full text-xs h-9 font-semibold">
                    {currency === "USD" ? "Select $49 USD" : "Select 2,000 ETB"}
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Plan 5: Executive VIP (Unlimited) - Priority Subscription */}
          <Card className="border-2 border-purple-600 dark:border-purple-500 bg-surface dark:bg-gradient-to-b dark:from-purple-900/70 dark:via-purple-950/80 dark:to-[#130924] flex flex-col justify-between relative shadow-xl shadow-purple-500/10 dark:shadow-purple-950/60 rounded-2xl overflow-hidden ring-1 ring-purple-500/30">
            <CardHeader className="border-b border-border dark:border-purple-500/30 pb-4">
              <div className="flex items-center justify-between mb-3">
                <Badge variant="purple" size="sm">Priority Sub</Badge>
                <span className="text-[10px] font-mono font-bold text-text-muted dark:text-purple-200">Zero Caps</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl sm:text-4xl font-extrabold font-mono text-text dark:text-white">
                  {currency === "USD" ? "99" : "4,000"}
                </span>
                <span className="text-base font-bold font-mono text-purple-600 dark:text-purple-300">{currency}</span>
                <span className="text-xs font-mono text-text-muted dark:text-purple-200 ml-1">/ 1-yr</span>
              </div>
              <CardTitle className="text-base font-bold text-text dark:text-white mt-2">Executive Unlimited</CardTitle>
              <p className="text-xs font-medium text-text-secondary dark:text-purple-200 mt-0.5">
                Zero caps & VIP priority
              </p>
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
              <div className="pt-2">
                <Link href="/billing">
                  <Button variant="primary" className="w-full text-xs h-9 font-bold bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-600/30 dark:shadow-purple-900/50">
                    {currency === "USD" ? "Get Unlimited ($99 USD)" : "Get Unlimited (4,000 ETB)"}
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
