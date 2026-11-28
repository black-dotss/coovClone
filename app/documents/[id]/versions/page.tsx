"use client";

import React, { useEffect, useState, use } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { ErrorPopup } from "@/components/ui/error-popup";
import { FullPageLoading } from "@/components/ui/loading-spinner";
import { AppShell } from "@/components/layout/app-shell";
import type { CvVersionItem, CvVersionComparisonResult } from "@/lib/documents/versions";

export default function DocumentVersionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [versions, setVersions] = useState<CvVersionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Comparator state
  const [baseVersionId, setBaseVersionId] = useState<string>("");
  const [targetVersionId, setTargetVersionId] = useState<string>("");
  const [comparing, setComparing] = useState(false);
  const [comparisonResult, setComparisonResult] = useState<CvVersionComparisonResult | null>(null);

  // New Version Modal state
  const [showNewModal, setShowNewModal] = useState(false);
  const [newVersionText, setNewVersionText] = useState("");
  const [creatingVersion, setCreatingVersion] = useState(false);

  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function loadVersions() {
      try {
        const data = await apiFetch<CvVersionItem[]>(
          `/api/cv/versions?documentId=${id}`
        );
        if (!ignore) {
          setVersions(data);
          if (data.length >= 2) {
            setBaseVersionId(data[data.length - 1].id); // oldest
            setTargetVersionId(data[0].id); // newest
          } else if (data.length === 1) {
            setBaseVersionId(data[0].id);
            setTargetVersionId(data[0].id);
          }
        }
      } catch (err: unknown) {
        if (!ignore) {
          const message =
            err instanceof Error ? err.message : "Failed to load CV versions";
          setError(message);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadVersions();
    return () => {
      ignore = true;
    };
  }, [id, refreshKey]);

  const handleRunComparison = async () => {
    if (!baseVersionId || !targetVersionId) {
      setError("Please select both a base version and target version to compare.");
      return;
    }

    setComparing(true);
    setError(null);
    try {
      const res = await apiFetch<CvVersionComparisonResult>(
        "/api/cv/versions/compare",
        {
          method: "POST",
          body: JSON.stringify({
            baseVersionId,
            targetVersionId,
          }),
        }
      );
      setComparisonResult(res);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Version comparison failed";
      setError(message);
    } finally {
      setComparing(false);
    }
  };

  const handleCreateNewVersion = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (newVersionText.trim().length < 10) {
      setError("CV text must be at least 10 characters long.");
      return;
    }

    setCreatingVersion(true);
    setError(null);
    try {
      await apiFetch<CvVersionItem>("/api/cv/versions", {
        method: "POST",
        body: JSON.stringify({
          sourceDocumentId: id,
          extractedText: newVersionText.trim(),
        }),
      });

      setShowNewModal(false);
      setNewVersionText("");
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to create new CV version";
      setError(message);
    } finally {
      setCreatingVersion(false);
    }
  };

  if (loading) {
    return <FullPageLoading />;
  }

  return (
    <AppShell
      title="CV Version History"
      description="Track revisions, bullet improvements, and score evolution across multiple versions of your resume."
      action={
        <Button
          variant="primary"
          size="sm"
          onClick={() => setShowNewModal(true)}
          className="text-xs font-semibold"
        >
          + Save New Version
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Breadcrumb Navigation */}
        <div className="flex items-center gap-2 text-xs font-medium text-text-muted">
          <Link href="/profile" className="hover:text-text transition-colors">
            Profile
          </Link>
          <span>/</span>
          <span className="text-text font-semibold">Version History</span>
        </div>

        <ErrorPopup
          title="Version Notice"
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
              className="text-xs"
            >
              Retry
            </Button>
          }
        />

        {versions.length === 0 ? (
          <Card className="text-center py-16 bg-surface border-border">
            <CardContent className="space-y-3">
              <div className="w-12 h-12 rounded-xl bg-surface-elevated border border-border flex items-center justify-center mx-auto text-text-muted">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </div>
              <h3 className="text-sm font-bold text-text">No Versions Found</h3>
              <p className="text-xs text-text-secondary max-w-sm mx-auto">
                No versions have been snapshotted for this document yet. Click below to save your first revision.
              </p>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setShowNewModal(true)}
                className="text-xs font-semibold"
              >
                + Snapshot First Version
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Versions List */}
            <Card className="bg-surface border-border">
              <CardHeader className="border-b border-border pb-3">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-text font-mono">
                  Saved CV Versions ({versions.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="divide-y divide-border">
                  {versions.map((ver) => (
                    <div
                      key={ver.id}
                      className="py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 rounded-lg bg-surface-elevated border border-border text-text flex items-center justify-center font-mono text-xs font-bold">
                          v{ver.versionNumber}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-xs sm:text-sm text-text">
                              Version {ver.versionNumber}
                            </span>
                            <span className="text-[11px] text-text-muted font-mono">
                              {new Date(ver.createdAt).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-xs text-text-secondary mt-0.5">
                            {ver.extractedText.length.toLocaleString()} characters •{" "}
                            {ver.extractedText.split(/\s+/).length.toLocaleString()} words
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {ver.latestEvaluation ? (
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-text">
                              Score: {ver.latestEvaluation.overallScore ?? "—"}/100
                            </span>
                            {ver.latestEvaluation.verdict && (
                              <Badge variant="neutral" size="sm">
                                {ver.latestEvaluation.verdict}
                              </Badge>
                            )}
                            <Link
                              href={`/evaluations/${ver.latestEvaluation.id}/report`}
                            >
                              <Button variant="ghost" size="sm" className="text-xs">
                                View Report →
                              </Button>
                            </Link>
                          </div>
                        ) : (
                          <Badge variant="neutral" size="sm">Not evaluated</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Version Comparator */}
            <Card className="border-border bg-surface shadow-xs">
              <CardHeader className="border-b border-border pb-3">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-text font-mono">
                  Compare Two CV Versions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-text mb-1.5">
                      Base Version (Before)
                    </label>
                    <select
                      value={baseVersionId}
                      onChange={(e) => setBaseVersionId(e.target.value)}
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs sm:text-sm text-text focus:outline-hidden focus:border-text"
                    >
                      {versions.map((v) => (
                        <option key={v.id} value={v.id}>
                          Version {v.versionNumber} ({new Date(v.createdAt).toLocaleDateString()})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-text mb-1.5">
                      Target Version (After)
                    </label>
                    <select
                      value={targetVersionId}
                      onChange={(e) => setTargetVersionId(e.target.value)}
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs sm:text-sm text-text focus:outline-hidden focus:border-text"
                    >
                      {versions.map((v) => (
                        <option key={v.id} value={v.id}>
                          Version {v.versionNumber} ({new Date(v.createdAt).toLocaleDateString()})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleRunComparison}
                    isLoading={comparing}
                    className="text-xs font-semibold"
                  >
                    Analyze Score Progression
                  </Button>
                </div>

                {/* Comparison Results Card */}
                {comparisonResult && (
                  <div className="pt-4 border-t border-border space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-lg bg-surface-elevated border border-border">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                          </svg>
                        </div>
                        <div>
                          <span className="text-[11px] font-mono text-text-muted block">
                            Version {comparisonResult.baseVersion.versionNumber} → Version{" "}
                            {comparisonResult.targetVersion.versionNumber}
                          </span>
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-lg font-mono font-bold ${
                                comparisonResult.scoreDelta >= 0
                                  ? "text-purple-600 dark:text-purple-400"
                                  : "text-red-600 dark:text-red-400"
                              }`}
                            >
                              {comparisonResult.scoreDelta >= 0 ? "+" : ""}
                              {comparisonResult.scoreDelta} Points
                            </span>
                            {comparisonResult.verdictChanged && (
                              <Badge variant="purple" size="sm">Verdict Improved</Badge>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="text-xs text-text-muted font-mono space-y-0.5">
                        <div>Base Score: {comparisonResult.baseVersion.score ?? "N/A"}/100</div>
                        <div>Target Score: {comparisonResult.targetVersion.score ?? "N/A"}/100</div>
                      </div>
                    </div>

                    {/* Dimension Deltas */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center pt-2">
                      <div className="p-2.5 rounded-lg bg-surface border border-border">
                        <span className="text-[10px] text-text-muted block">Role Fit</span>
                        <span
                          className={`font-mono text-xs font-bold ${
                            comparisonResult.dimensionDeltas.roleFit >= 0
                              ? "text-purple-600 dark:text-purple-400"
                              : "text-red-600 dark:text-red-400"
                          }`}
                        >
                          {comparisonResult.dimensionDeltas.roleFit >= 0 ? "+" : ""}
                          {comparisonResult.dimensionDeltas.roleFit}
                        </span>
                      </div>

                      <div className="p-2.5 rounded-lg bg-surface border border-border">
                        <span className="text-[10px] text-text-muted block">Skills</span>
                        <span
                          className={`font-mono text-xs font-bold ${
                            comparisonResult.dimensionDeltas.skillsAndEvidence >= 0
                              ? "text-purple-600 dark:text-purple-400"
                              : "text-red-600 dark:text-red-400"
                          }`}
                        >
                          {comparisonResult.dimensionDeltas.skillsAndEvidence >= 0 ? "+" : ""}
                          {comparisonResult.dimensionDeltas.skillsAndEvidence}
                        </span>
                      </div>

                      <div className="p-2.5 rounded-lg bg-surface border border-border">
                        <span className="text-[10px] text-text-muted block">ATS Match</span>
                        <span
                          className={`font-mono text-xs font-bold ${
                            comparisonResult.dimensionDeltas.atsAlignment >= 0
                              ? "text-purple-600 dark:text-purple-400"
                              : "text-red-600 dark:text-red-400"
                          }`}
                        >
                          {comparisonResult.dimensionDeltas.atsAlignment >= 0 ? "+" : ""}
                          {comparisonResult.dimensionDeltas.atsAlignment}
                        </span>
                      </div>

                      <div className="p-2.5 rounded-lg bg-surface border border-border">
                        <span className="text-[10px] text-text-muted block">Impact</span>
                        <span
                          className={`font-mono text-xs font-bold ${
                            comparisonResult.dimensionDeltas.impactAndClarity >= 0
                              ? "text-purple-600 dark:text-purple-400"
                              : "text-red-600 dark:text-red-400"
                          }`}
                        >
                          {comparisonResult.dimensionDeltas.impactAndClarity >= 0 ? "+" : ""}
                          {comparisonResult.dimensionDeltas.impactAndClarity}
                        </span>
                      </div>

                      <div className="p-2.5 rounded-lg bg-surface border border-border">
                        <span className="text-[10px] text-text-muted block">Presentation</span>
                        <span
                          className={`font-mono text-xs font-bold ${
                            comparisonResult.dimensionDeltas.professionalPresentation >= 0
                              ? "text-purple-600 dark:text-purple-400"
                              : "text-red-600 dark:text-red-400"
                          }`}
                        >
                          {comparisonResult.dimensionDeltas.professionalPresentation >= 0 ? "+" : ""}
                          {comparisonResult.dimensionDeltas.professionalPresentation}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Save New Version Modal */}
        <Modal
          isOpen={showNewModal}
          onClose={() => setShowNewModal(false)}
          title="Save New CV Version"
        >
          <form onSubmit={handleCreateNewVersion} className="space-y-4">
            <p className="text-xs text-text-secondary">
              Paste your revised CV content with incorporated AI rewrites to snapshot a new
              version and track score improvements.
            </p>

            <Textarea
              label="Updated CV Text"
              placeholder="Paste your full updated CV text here..."
              value={newVersionText}
              onChange={(e) => setNewVersionText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && newVersionText.trim().length >= 10 && !creatingVersion) {
                  e.preventDefault();
                  handleCreateNewVersion();
                }
              }}
              rows={8}
              required
              helperText="Press Cmd+Enter (or Ctrl+Enter) to save"
            />

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button
                variant="ghost"
                type="button"
                onClick={() => setShowNewModal(false)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                isLoading={creatingVersion}
                disabled={newVersionText.trim().length < 10}
                className="text-xs font-semibold"
              >
                Save Version
              </Button>
            </div>
          </form>
        </Modal>
      </div>
    </AppShell>
  );
}
