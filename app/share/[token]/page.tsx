"use client";

import React, { useEffect, useState, use } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ScoreRing } from "@/components/ui/score-ring";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Alert } from "@/components/ui/alert";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ShareVerificationBadge } from "@/components/solana/share-verification-badge";
import type { SharedReportResult } from "@/lib/reports/share";

export default function PublicSharedReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);

  const [data, setData] = useState<SharedReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSharedReport() {
      try {
        const result = await apiFetch<SharedReportResult>(
          `/api/reports/share/${token}`
        );
        setData(result);
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "This share link is invalid, expired, or has been revoked.";
        setError(message);
      } finally {
        setLoading(false);
      }
    }
    loadSharedReport();
  }, [token]);

  const getVerdictVariant = (
    verdict: string
  ): "success" | "warning" | "danger" | "neutral" => {
    switch (verdict) {
      case "Strong fit":
      case "Strong hire":
        return "success";
      case "Potential fit":
      case "Consider":
        return "warning";
      case "Significant gaps":
      case "Weak fit":
      case "Reject":
        return "danger";
      default:
        return "neutral";
    }
  };

  if (loading) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-4">
        <LoadingSpinner size="lg" label="Loading shared evaluation report..." />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center space-y-6">
        <div className="w-16 h-16 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-text">Link Inactive or Expired</h1>
        <p className="text-sm text-text-secondary">
          {error || "This shared evaluation link is no longer valid or has been revoked by the owner."}
        </p>
        <Link href="/">
          <Button variant="primary" size="md">Go to CookMyCV Homepage</Button>
        </Link>
      </div>
    );
  }

  const { report, shareLink, onChainProof } = data;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Privacy Notice Banner */}
      <div className="p-3.5 rounded-lg bg-surface-elevated border border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 text-text-secondary">
          <svg className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <span>
            <strong>Verified Public Report:</strong> Personal contact details (phone, email, home address) are automatically redacted for candidate privacy.
          </span>
        </div>
        <span className="text-text-muted font-mono text-[11px] shrink-0">
          Views: {shareLink.accessCount}
        </span>
      </div>

      {/* Live Browser SHA-256 & Solana On-Chain Proof Verification */}
      {onChainProof && <ShareVerificationBadge report={report} proof={onChainProof} />}

      {/* Report Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-6">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted font-mono">
            Candidate Assessment
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-text mt-0.5">
            Recruitment Committee Report
          </h1>
          <p className="text-xs text-text-muted mt-1 font-mono">
            Simulated by CookMyCV Recruitment Panel
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={getVerdictVariant(report.verdict)} size="md">
            {report.verdict}
          </Badge>
        </div>
      </div>

      {/* Main Score & Consensus */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1 flex flex-col items-center justify-center p-6 text-center bg-surface border-border">
          <ScoreRing score={report.overallScore} size={150} strokeWidth={12} />
          <div className="mt-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-muted block">
              Overall Candidate Score
            </span>
            <div className="mt-1 flex items-center justify-center gap-2">
              <Badge variant={getVerdictVariant(report.verdict)} size="sm">
                {report.verdict}
              </Badge>
            </div>
            <p className="text-xs text-text-muted mt-2 font-mono">
              Confidence: {Math.round(report.confidence * 100)}%
            </p>
          </div>
        </Card>

        <Card className="lg:col-span-2 bg-surface border-border">
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="text-sm font-bold text-text">Committee Assessment Synthesis</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 pt-4">
            <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
              {report.explanation}
            </p>

            <div className="space-y-3 pt-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted block font-mono">
                Dimension Ratings
              </span>
              <div className="space-y-2.5">
                <div className="flex justify-between text-xs">
                  <span className="text-text font-medium">Role Fit</span>
                  <span className="font-mono text-text-muted">{report.dimensions.roleFit}/100</span>
                </div>
                <ProgressBar value={report.dimensions.roleFit} color="purple" size="sm" />

                <div className="flex justify-between text-xs">
                  <span className="text-text font-medium">Skills & Evidence</span>
                  <span className="font-mono text-text-muted">{report.dimensions.skillsAndEvidence}/100</span>
                </div>
                <ProgressBar value={report.dimensions.skillsAndEvidence} color="purple" size="sm" />

                <div className="flex justify-between text-xs">
                  <span className="text-text font-medium">ATS Alignment</span>
                  <span className="font-mono text-text-muted">{report.dimensions.atsAlignment}/100</span>
                </div>
                <ProgressBar value={report.dimensions.atsAlignment} color="purple" size="sm" />

                <div className="flex justify-between text-xs">
                  <span className="text-text font-medium">Impact & Metrics</span>
                  <span className="font-mono text-text-muted">{report.dimensions.impactAndClarity}/100</span>
                </div>
                <ProgressBar value={report.dimensions.impactAndClarity} color="purple" size="sm" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Strengths & Weaknesses */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-surface border-border">
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 font-mono">
              Key Strengths
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <ul className="space-y-2.5 text-xs text-text-secondary">
              {report.strengths.map((str, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-purple-600 dark:text-purple-400 font-bold">•</span>
                  <span className="leading-relaxed">{str}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="bg-surface border-border">
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 font-mono">
              Identified Weaknesses
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <ul className="space-y-2.5 text-xs text-text-secondary">
              {report.weaknesses.map((weak, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-amber-600 dark:text-amber-400 font-bold">•</span>
                  <span className="leading-relaxed">{weak}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* ATS Alignment Summary */}
      <Card className="bg-surface border-border">
        <CardHeader className="border-b border-border pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-text font-mono">
              ATS Keyword Match: {report.atsSummary.keywordCoverage}%
            </CardTitle>
            <span className="text-xs text-text-muted font-mono">
              {report.atsSummary.matched.length} Matched / {report.atsSummary.missing.length} Missing
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <ProgressBar value={report.atsSummary.keywordCoverage} color="purple" size="sm" />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div className="p-3 rounded-lg bg-surface-elevated border border-border">
              <span className="text-[11px] font-semibold text-purple-600 dark:text-purple-400 block mb-1 font-mono">
                Matched ({report.atsSummary.matched.length})
              </span>
              <div className="flex flex-wrap gap-1">
                {report.atsSummary.matched.map((term, i) => (
                  <Badge key={i} variant="purple" size="sm">
                    {term}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-surface-elevated border border-border">
              <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 block mb-1 font-mono">
                Partial ({report.atsSummary.partial.length})
              </span>
              <div className="flex flex-wrap gap-1">
                {report.atsSummary.partial.map((term, i) => (
                  <Badge key={i} variant="warning" size="sm">
                    {term}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-surface-elevated border border-border">
              <span className="text-[11px] font-semibold text-red-600 dark:text-red-400 block mb-1 font-mono">
                Missing ({report.atsSummary.missing.length})
              </span>
              <div className="flex flex-wrap gap-1">
                {report.atsSummary.missing.map((term, i) => (
                  <Badge key={i} variant="danger" size="sm">
                    {term}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Simulation Disclaimer */}
      <Alert variant="info" title="Evaluation Disclaimer">
        {report.disclaimer}
      </Alert>

      {/* Call to action for public viewers */}
      <Card className="border-border bg-surface-elevated text-center py-8">
        <CardContent className="space-y-4">
          <h2 className="text-xl font-bold text-text">
            Test your own CV against 6 AI Recruitment Evaluators
          </h2>
          <p className="text-xs sm:text-sm text-text-secondary max-w-md mx-auto leading-relaxed">
            Get instant feedback on ATS keywords, recruiter red flags, truthful bullet rewrites,
            and custom mock interview questions.
          </p>
          <Link href="/auth">
            <Button variant="primary" size="md" className="font-semibold">
              Start Free Trial (3 Free Lifetime Reviews)
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
