"use client";

import React, { useEffect, useState, use } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ErrorPopup } from "@/components/ui/error-popup";
import { Textarea } from "@/components/ui/textarea";
import { FullPageLoading } from "@/components/ui/loading-spinner";
import { AppShell } from "@/components/layout/app-shell";
import type { RewriteSuggestionRecord } from "@/lib/reports/types";

export default function BulletRewritesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [rewrites, setRewrites] = useState<RewriteSuggestionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  // Custom bullet generation input
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customBulletText, setCustomBulletText] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function fetchRewrites() {
      try {
        const data = await apiFetch<RewriteSuggestionRecord[]>(
          `/api/evaluations/${id}/rewrites`
        );
        if (!ignore) {
          setRewrites(data);
        }
      } catch (err: unknown) {
        if (!ignore) {
          const message =
            err instanceof Error ? err.message : "Failed to load rewrites";
          setError(message);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    fetchRewrites();
    return () => {
      ignore = true;
    };
  }, [id, reloadKey]);

  const handleGenerate = async (customBullets?: string[]) => {
    setGenerating(true);
    setError(null);
    try {
      const body = customBullets && customBullets.length > 0 ? { customBullets } : {};
      const newItems = await apiFetch<RewriteSuggestionRecord[]>(
        `/api/evaluations/${id}/rewrites`,
        {
          method: "POST",
          body: JSON.stringify(body),
        }
      );
      setRewrites(newItems);
      setShowCustomInput(false);
      setCustomBulletText("");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to generate rewrites";
      setError(message);
    } finally {
      setGenerating(false);
    }
  };

  const handleToggleAccept = async (rewriteId: string, currentAccepted: boolean) => {
    setUpdatingId(rewriteId);
    try {
      const updated = await apiFetch<RewriteSuggestionRecord>(
        `/api/evaluations/${id}/rewrites/${rewriteId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ isAccepted: !currentAccepted }),
        }
      );
      setRewrites((prev) =>
        prev.map((item) => (item.id === rewriteId ? updated : item))
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to update rewrite status";
      setError(message);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleCopy = (text: string, rewriteId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(rewriteId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopyAllAccepted = () => {
    const accepted = rewrites.filter((r) => r.isAccepted);
    if (accepted.length === 0) return;
    const text = accepted.map((r) => `• ${r.suggestedText}`).join("\n");
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2500);
  };

  const handleDownloadAccepted = () => {
    const accepted = rewrites.filter((r) => r.isAccepted);
    if (accepted.length === 0) return;
    const text = accepted.map((r) => `• ${r.suggestedText}`).join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `coov-rewritten-cv-bullets-${id.slice(0, 8)}.txt`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const acceptedRewrites = rewrites.filter((r) => r.isAccepted);

  if (loading) {
    return <FullPageLoading />;
  }

  return (
    <AppShell
      title="Truthful Bullet Point Rewrites"
      description="Transform weak CV bullets into high-impact STAR statements."
      action={
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCustomInput(!showCustomInput)}
            className="text-xs font-semibold whitespace-nowrap"
            aria-expanded={showCustomInput}
          >
            {showCustomInput ? "Hide Custom Input" : "+ Custom Bullet"}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => handleGenerate()}
            isLoading={generating}
            className="text-xs font-semibold shadow-xs whitespace-nowrap"
          >
            {rewrites.length > 0 ? "Regenerate All" : "Generate Rewrites"}
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Navigation Breadcrumbs */}
        <div className="flex items-center gap-2 text-xs sm:text-sm font-medium text-text-muted">
          <Link href="/profile" className="hover:text-text transition-colors">
            Profile
          </Link>
          <span>/</span>
          <Link href={`/evaluations/${id}/report`} className="hover:text-text transition-colors">
            Report ({id.slice(0, 8)})
          </Link>
          <span>/</span>
          <span className="text-text font-bold">Bullet Rewrites</span>
        </div>

        <ErrorPopup
          title="Rewrite Notice"
          message={error}
          onDismiss={() => setError(null)}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoading(true);
                setError(null);
                setReloadKey((k) => k + 1);
              }}
              className="text-xs"
            >
              Retry
            </Button>
          }
        />

        {/* Custom Bullet Input Panel */}
        {showCustomInput && (
          <Card className="border-border bg-surface-elevated/70 backdrop-blur-xs shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-extrabold text-text">
                Target a Specific Bullet Point
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                label="Paste a bullet from your CV you want improved"
                placeholder="e.g. Worked on the backend APIs and helped with database performance improvements."
                value={customBulletText}
                onChange={(e) => setCustomBulletText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && customBulletText.trim()) {
                    e.preventDefault();
                    handleGenerate([customBulletText.trim()]);
                  } else if (e.key === "Escape") {
                    setShowCustomInput(false);
                  }
                }}
                rows={3}
                helperText="Press Cmd+Enter (or Ctrl+Enter) to submit, Esc to cancel"
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCustomInput(false)}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!customBulletText.trim()}
                  isLoading={generating}
                  onClick={() => handleGenerate([customBulletText.trim()])}
                  className="text-xs font-semibold"
                >
                  Rewrite This Bullet
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {rewrites.length === 0 ? (
          <Card className="text-center py-16 bg-surface border-border shadow-sm">
            <CardContent className="space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-surface-elevated border border-border flex items-center justify-center mx-auto text-text-muted shadow-xs">
                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.75}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-extrabold text-text">No Bullet Rewrites Generated Yet</h3>
              <p className="text-sm text-text-secondary max-w-md mx-auto leading-relaxed">
                Click below to have the hiring panel evaluate weak bullets from your CV
                and transform them into impactful, high-converting statements.
              </p>
              <Button
                variant="primary"
                onClick={() => handleGenerate()}
                isLoading={generating}
                className="text-sm font-bold shadow-md px-5 py-2.5"
              >
                Generate Truthful Rewrites
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Header Stats Bar */}
            <div className="flex items-center justify-between text-xs sm:text-sm text-text-muted border-b border-border pb-3">
              <span className="font-mono font-medium">
                <strong className="text-text font-bold">{rewrites.length}</strong> suggestions generated
              </span>
              <span className="font-mono">
                <strong className="text-purple-600 dark:text-purple-400 font-bold">
                  {acceptedRewrites.length}
                </strong>{" "}
                of {rewrites.length} accepted
              </span>
            </div>

            {/* Accepted CV Bullets Export Section */}
            {acceptedRewrites.length > 0 && (
              <Card className="border-purple-500/60 bg-surface border-2 shadow-md">
                <CardHeader className="pb-3 border-b border-border">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-base sm:text-lg font-extrabold text-text flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-purple-600 dark:bg-purple-500 shrink-0" />
                        <span>Ready For Your CV ({acceptedRewrites.length} Accepted)</span>
                      </CardTitle>
                      <p className="text-xs sm:text-sm text-text-secondary mt-0.5">
                        Copy these tailored bullets directly into your resume&apos;s experience section.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={handleCopyAllAccepted}
                        className="text-xs font-bold shadow-xs"
                      >
                        {copiedAll ? "Copied All!" : "Copy All Accepted"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleDownloadAccepted}
                        className="text-xs font-semibold"
                      >
                        Download .txt
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-3">
                  <div className="p-4 bg-surface-elevated border border-border rounded-xl space-y-2 font-mono text-xs sm:text-sm text-text">
                    {acceptedRewrites.map((r, idx) => (
                      <div key={idx} className="flex items-start gap-2.5">
                        <span className="text-purple-600 dark:text-purple-400 font-bold">•</span>
                        <span className="font-medium leading-relaxed">{r.suggestedText}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 2-COLUMN GRID OF REWRITE SUGGESTIONS */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
              {rewrites.map((item, index) => (
                <Card
                  key={item.id}
                  className={`transition-all bg-surface shadow-xs flex flex-col justify-between ${
                    item.isAccepted
                      ? "border-purple-500 bg-surface shadow-sm ring-1 ring-purple-500/40"
                      : "border-border hover:border-purple-300 dark:hover:border-purple-700/50"
                  }`}
                >
                  <CardContent className="p-5 sm:p-6 space-y-4 flex flex-col justify-between h-full">
                    {/* Top Status & Actions Row */}
                    <div className="space-y-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs sm:text-sm font-extrabold px-2.5 py-0.5 rounded-lg bg-surface-elevated border border-border text-text">
                            #{index + 1}
                          </span>
                          {item.isAccepted ? (
                            <Badge variant="purple" className="text-xs font-bold">
                              Accepted
                            </Badge>
                          ) : (
                            <Badge variant="neutral" className="text-xs font-semibold">
                              Draft
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant={item.isAccepted ? "secondary" : "primary"}
                            onClick={() => handleToggleAccept(item.id, item.isAccepted)}
                            isLoading={updatingId === item.id}
                            className="text-xs font-bold"
                          >
                            {item.isAccepted ? "Undo" : "Accept Rewrite"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleCopy(item.suggestedText, item.id)}
                            className="text-xs font-semibold"
                            aria-label={`Copy rewrite number ${index + 1}`}
                          >
                            {copiedId === item.id ? "Copied!" : "Copy"}
                          </Button>
                        </div>
                      </div>

                      {/* Main Rewritten Bullet: BOLD & EYE-CATCHING */}
                      <div className="rounded-xl bg-surface-elevated/70 border border-border p-4 space-y-2">
                        <p className="text-base sm:text-lg font-bold text-text leading-snug">
                          {item.suggestedText}
                        </p>

                        {/* Original Bullet for Comparison */}
                        {item.originalText &&
                          item.originalText.trim().toLowerCase() !==
                            item.suggestedText.trim().toLowerCase() && (
                            <div className="text-xs sm:text-sm text-text-muted pt-2 border-t border-border/50 leading-relaxed">
                              <span className="font-bold text-text-muted/90">Original: </span>
                              <span className="italic line-through opacity-75">{item.originalText}</span>
                            </div>
                          )}
                      </div>
                    </div>

                    {/* Recruiter Rationale Callout */}
                    <div className="rounded-xl bg-surface-elevated/40 border border-border/70 p-3.5 space-y-1">
                      <div className="text-xs font-bold font-mono uppercase tracking-wider text-purple-600 dark:text-purple-400">
                        Why this works:
                      </div>
                      <p className="text-xs sm:text-sm font-medium text-text-secondary leading-relaxed">
                        {item.explanation}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Bottom Navigation */}
            <div className="pt-4 flex flex-col sm:flex-row justify-between items-center gap-3">
              <Link href={`/evaluations/${id}/report`} className="w-full sm:w-auto">
                <Button variant="outline" size="sm" className="w-full sm:w-auto text-xs font-semibold">
                  ← Back to Full Report
                </Button>
              </Link>
              <Link href={`/evaluations/${id}/defense`} className="w-full sm:w-auto">
                <Button variant="secondary" size="sm" className="w-full sm:w-auto text-xs font-semibold">
                  Defend Yourself Room →
                </Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}