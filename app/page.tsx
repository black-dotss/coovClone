import React from "react";
import Image from "next/image";
import { HeroAuditCard } from "@/components/landing/hero-audit-card";
import { PricingSection } from "@/components/landing/pricing-section";

export default function HomePage() {
  return (
    <div className="flex flex-col w-full relative">
      {/* Hero Section */}
      <section className="relative pt-12 pb-16 lg:pt-18 lg:pb-20 px-4 sm:px-6 lg:px-8 border-b border-border">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            {/* Left Column (Desktop): Frameless Mascot with Surrounding Capability Badges - Made Bigger */}
            <div className="lg:col-span-5 order-2 lg:order-1 flex flex-col items-center justify-center relative">
              <div className="relative w-full max-w-lg mx-auto flex items-center justify-center py-6 sm:py-8">
                {/* Floating Badge Top-Left */}
                <div className="absolute -top-2 left-0 sm:-left-4 z-20 px-3 py-1.5 rounded-lg border border-border bg-surface shadow-xs flex items-center gap-2">
                  <span className="h-2 w-2 rounded-sm bg-purple-500" />
                  <span className="font-mono text-[11px] font-semibold text-text uppercase tracking-wider">
                    Official Mascot
                  </span>
                </div>

                {/* Floating Badge Top-Right */}
                <div className="absolute top-4 right-0 sm:-right-4 z-20 px-3 py-1.5 rounded-lg border border-border bg-surface shadow-xs flex items-center gap-2">
                  <span className="font-mono text-[11px] text-purple-400 font-semibold">6 Evaluators Active</span>
                </div>

                {/* Frameless Mascot Centerpiece - Made Bigger */}
                <div className="relative w-80 h-80 sm:w-96 sm:h-96 lg:w-[430px] lg:h-[430px] z-10 transition-transform duration-300 hover:scale-102">
                  <Image
                    src="/doll/Dreamy%20Purple%20Furry%20Mascot%20(1).png"
                    alt="CookMyCV Dreamy Purple Furry Mascot"
                    width={500}
                    height={500}
                    priority
                    className="w-full h-full object-contain drop-shadow-[0_20px_45px_rgba(168,85,247,0.25)] rounded-2xl"
                  />
                </div>

                {/* Floating Card Bottom-Left */}
                <div className="absolute -bottom-4 -left-2 sm:-left-6 z-20 p-2.5 sm:p-3 rounded-xl border border-border bg-surface/95 backdrop-blur-md shadow-xs max-w-[210px] text-left">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-mono font-bold text-text">
                      Zero Hallucination
                    </span>
                    <span className="text-[9px] font-mono text-purple-400 font-semibold px-1 py-0.2 rounded bg-purple-500/10">
                      100% Truth
                    </span>
                  </div>
                  <p className="text-[10px] sm:text-[11px] text-text-secondary leading-snug">
                    Tough on buzzwords. Verified directly against CV source facts.
                  </p>
                </div>

                {/* Floating Card Bottom-Right */}
                <div className="absolute bottom-2 -right-2 sm:-right-6 z-20 p-2.5 sm:p-3 rounded-xl border border-border bg-surface/95 backdrop-blur-md shadow-xs max-w-[200px] text-left">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-mono font-bold text-text">
                      STAR Prep
                    </span>
                    <span className="text-[9px] font-mono text-purple-300 font-semibold px-1.5 py-0.5 rounded-md bg-purple-500/15 border border-purple-500/30">
                      Active
                    </span>
                  </div>
                  <p className="text-[10px] sm:text-[11px] text-text-secondary leading-snug">
                    Practice committee questions tailored to your resume gaps.
                  </p>
                </div>
              </div>
            </div>

            {/* Right Column (Desktop): Headline, subline, quick audit */}
            <div className="lg:col-span-7 order-1 lg:order-2 flex flex-col items-start text-left lg:pl-4">
              {/* Eyebrow Label */}
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md border border-border bg-surface-elevated text-[11px] font-mono text-text-muted mb-5">
                <span>Hiring Committee Screening</span>
                <span className="text-border">/</span>
                <span className="text-purple-600 dark:text-purple-400 font-medium">Ground Truth Verification</span>
              </div>

              {/* Hero Headline */}
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-text leading-[1.08]">
                Screen your CV against AI Hiring Agents on Solana.
              </h1>

              {/* Subline */}
              <p className="mt-4 text-sm sm:text-base text-text-secondary max-w-xl leading-relaxed">
                Algorithmic ATS analysis, ground-truth bullet rewrites, and technical interview simulations. Evaluated across 6 independent recruitment rubrics.
              </p>

              {/* Minimal Quick-Audit Component */}
              <div className="w-full">
                <HeroAuditCard />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3 Core Capabilities - Larger, highly visible cards */}
      <section className="py-20 sm:py-24 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto w-full">
        <div className="max-w-2xl mx-auto text-center mb-14">
          <span className="inline-block font-mono text-xs text-text-muted px-2.5 py-1 rounded-md bg-surface-elevated border border-border mb-3">
            System Workflow
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-text">
            Three Steps to Offer Readiness
          </h2>
          <p className="mt-2 text-sm sm:text-base text-text-secondary">
            Structured screening without boilerplate summaries or AI hallucinated metrics.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
          {/* Capability 1 */}
          <div className="rounded-xl border border-border bg-surface p-7 sm:p-8 hover:border-text-secondary transition-all flex flex-col justify-between shadow-xs">
            <div>
              <span className="inline-block font-mono text-xs font-semibold text-text-muted px-2 py-0.5 rounded bg-surface-elevated border border-border">
                01 / AUDIT
              </span>
              <h3 className="text-xl sm:text-2xl font-bold mt-4 text-text">
                Multi-Rubric Screening
              </h3>
              <p className="text-sm text-text-secondary leading-relaxed mt-3">
                Independent parallel evaluation across ATS parsers, hiring managers, and tech leads. Disagreements are debated in bounded rounds to prevent groupthink.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-border/70 text-xs font-mono text-text-muted">
              6 independent rubrics · 0 groupthink
            </div>
          </div>

          {/* Capability 2 */}
          <div className="rounded-xl border border-border bg-surface p-7 sm:p-8 hover:border-text-secondary transition-all flex flex-col justify-between shadow-xs">
            <div>
              <span className="inline-block font-mono text-xs font-semibold text-text-muted px-2 py-0.5 rounded bg-surface-elevated border border-border">
                02 / REWRITE
              </span>
              <h3 className="text-xl sm:text-2xl font-bold mt-4 text-text">
                Truthful Metric Rewrites
              </h3>
              <p className="text-sm text-text-secondary leading-relaxed mt-3">
                Transforms passive bullets into quantified business outcomes. Every claim is anchored directly to your verified source text with zero invented responsibilities.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-border/70 text-xs font-mono text-text-muted">
              100% source-anchored · 0 invented facts
            </div>
          </div>

          {/* Capability 3 */}
          <div className="rounded-xl border border-border bg-surface p-7 sm:p-8 hover:border-text-secondary transition-all flex flex-col justify-between shadow-xs">
            <div>
              <span className="inline-block font-mono text-xs font-semibold text-text-muted px-2 py-0.5 rounded bg-surface-elevated border border-border">
                03 / DEFEND
              </span>
              <h3 className="text-xl sm:text-2xl font-bold mt-4 text-text">
                Defense & Mock Room
              </h3>
              <p className="text-sm text-text-secondary leading-relaxed mt-3">
                Submit evidence to contest scoring deductions with bounded score reassessments, then rehearse STAR-format technical questions derived from your CV gaps.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-border/70 text-xs font-mono text-text-muted">
              Evidence-based appeals · Mock interview room
            </div>
          </div>
        </div>
      </section>

      {/* Transparent Pricing with Currency Switcher (USD via Polar.sh / ETB via Verify.ET) */}
      <PricingSection />

    </div>
  );
}
