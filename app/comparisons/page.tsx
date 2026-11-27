"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import { FullPageLoading } from "@/components/ui/loading-spinner";
import { getCompanyLogo } from "@/components/ui/company-logo";
import {
  FAMOUS_ROLE_PRESETS,
  isFamousPresetJd,
  type FamousRolePreset,
  type PresetCategory,
} from "@/lib/job-descriptions/presets";
import type { MultiJdComparisonResult } from "@/lib/reports/types";
import type { DocumentRecord } from "@/lib/documents/types";
import type { CvVersionItem } from "@/lib/documents/versions";
import { useSession } from "@/lib/auth/auth-client";

interface JobDescriptionItem {
  id: string;
  title?: string | null;
  company?: string | null;
  rawText: string;
}

export default function ComparisonsPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string>("");
  const [cvVersions, setCvVersions] = useState<CvVersionItem[]>([]);
  const [selectedCvVersionId, setSelectedCvVersionId] = useState<string>("");

  const [availableJds, setAvailableJds] = useState<JobDescriptionItem[]>([]);
  const [selectedJdIds, setSelectedJdIds] = useState<string[]>([]);

  // Presets filtering and expansion
  const [activeCategory, setActiveCategory] = useState<"all" | PresetCategory>("all");
  const [showAllPresets, setShowAllPresets] = useState(false);

  // New JD input modal / inline form state
  const [showAddJd, setShowAddJd] = useState(false);
  const [newJdTitle, setNewJdTitle] = useState("");
  const [newJdCompany, setNewJdCompany] = useState("");
  const [newJdText, setNewJdText] = useState("");
  const [savingJd, setSavingJd] = useState(false);

  // Comparison execution state
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [uploadingCv, setUploadingCv] = useState(false);
  const [cvDragOver, setCvDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    async function initData() {
      try {
        const [docsRes, jdsRes] = await Promise.allSettled([
          apiFetch<DocumentRecord[]>("/api/documents"),
          apiFetch<JobDescriptionItem[]>("/api/job-descriptions"),
        ]);

        if (!ignore) {
          if (docsRes.status === "fulfilled" && docsRes.value.length > 0) {
            const cvs = docsRes.value.filter((d) => d.type === "cv");
            setDocuments(cvs);
            if (cvs.length > 0) {
              setSelectedDocId(cvs[0].id);
            }
          }

          if (jdsRes.status === "fulfilled") {
            const unique: JobDescriptionItem[] = [];
            const seen = new Set<string>();
            for (const jd of jdsRes.value) {
              const key = `${(jd.company || "").trim().toLowerCase()}:::${(jd.title || "").trim().toLowerCase()}`;
              if (!seen.has(key)) {
                seen.add(key);
                unique.push(jd);
              }
            }
            setAvailableJds(unique);
            // Do not pre-select any roles; start clean
            setSelectedJdIds([]);
          }
        }
      } catch (err: unknown) {
        if (!ignore) {
          const message =
            err instanceof Error ? err.message : "Failed to load initial data";
          setError(message);
        }
      } finally {
        if (!ignore) {
          setLoadingInitial(false);
        }
      }
    }

    initData();
    return () => {
      ignore = true;
    };
  }, []);

  // Fetch CV versions when selectedDocId changes
  useEffect(() => {
    if (!selectedDocId) return;
    async function loadVersions() {
      try {
        const versions = await apiFetch<CvVersionItem[]>(
          `/api/cv/versions?documentId=${selectedDocId}`
        );
        if (versions && versions.length > 0) {
          setCvVersions(versions);
          setSelectedCvVersionId(versions[0].id);
        } else {
          const doc = documents.find((d) => d.id === selectedDocId);
          if (doc) {
            try {
              const created = await apiFetch<CvVersionItem>("/api/cv/versions", {
                method: "POST",
                body: JSON.stringify({
                  sourceDocumentId: doc.id,
                  extractedText: doc.extractedText || "Candidate CV profile and qualifications for role comparison.",
                }),
              });
              if (created?.id) {
                setCvVersions([created]);
                setSelectedCvVersionId(created.id);
                return;
              }
            } catch {
              // Ignore initial auto-creation error; fallback to empty
            }
          }
          setCvVersions([]);
          setSelectedCvVersionId("");
        }
      } catch {
        setCvVersions([]);
      }
    }
    loadVersions();
  }, [selectedDocId, documents]);

  const handleToggleJdSelection = (jdId: string) => {
    setSelectedJdIds((prev) => {
      if (prev.includes(jdId)) {
        return prev.filter((id) => id !== jdId);
      }
      if (prev.length >= 3) {
        setError("Maximum 3 roles can be selected for comparison.");
        return prev;
      }
      return [...prev, jdId];
    });
    setError(null);
  };

  const handleCreateNewJd = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (newJdText.trim().length < 50) {
      setError("Job description text must be at least 50 characters.");
      return;
    }

    setSavingJd(true);
    setError(null);
    try {
      const created = await apiFetch<JobDescriptionItem>("/api/job-descriptions", {
        method: "POST",
        body: JSON.stringify({
          title: newJdTitle.trim() || undefined,
          company: newJdCompany.trim() || undefined,
          rawText: newJdText.trim(),
        }),
      });

      setAvailableJds((prev) => [created, ...prev.filter((x) => x.id !== created.id)]);
      setSelectedJdIds((prev) => (prev.length >= 3 ? prev : [...prev, created.id]));
      setNewJdTitle("");
      setNewJdCompany("");
      setNewJdText("");
      setShowAddJd(false);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to save job description";
      setError(message);
    } finally {
      setSavingJd(false);
    }
  };

  const getPresetJdMatch = (preset: FamousRolePreset) => {
    return availableJds.find((j) => {
      const matchTitle = (j.title || "").trim().toLowerCase() === preset.title.trim().toLowerCase();
      const matchCompany = (j.company || "").trim().toLowerCase() === preset.company.trim().toLowerCase();
      return matchTitle && matchCompany;
    });
  };

  const isPresetSelected = (preset: FamousRolePreset) => {
    const matched = getPresetJdMatch(preset);
    if (matched && selectedJdIds.includes(matched.id)) return true;
    return selectedJdIds.includes(`preset:${preset.id}`);
  };

  const handleTogglePreset = (preset: FamousRolePreset) => {
    setError(null);
    const matched = getPresetJdMatch(preset);
    const targetKey = matched ? matched.id : `preset:${preset.id}`;
    const altKey = matched ? `preset:${preset.id}` : "";

    setSelectedJdIds((prev) => {
      if (prev.includes(targetKey) || (altKey && prev.includes(altKey))) {
        return prev.filter((id) => id !== targetKey && id !== altKey);
      }
      if (prev.length >= 3) {
        setError("Maximum 3 roles can be selected. Please deselect a role first.");
        return prev;
      }
      return [...prev, targetKey];
    });
  };

  const handleUploadCvFile = async (file: File) => {
    if (!session) {
      router.push("/auth?callbackUrl=/comparisons");
      return;
    }
    const valid = file.name.endsWith(".pdf") || file.name.endsWith(".docx");
    if (!valid) {
      setError("Please upload a PDF or DOCX file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("File exceeds 10MB limit.");
      return;
    }

    try {
      setUploadingCv(true);
      setError(null);
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", "cv");

      const res = await apiFetch<{
        id?: string;
        cvVersionId?: string | null;
        cvVersion?: { id: string } | null;
        document?: {
          id?: string;
          filename?: string;
          extractedText?: string;
          cvVersionId?: string | null;
        } | null;
      }>("/api/documents", {
        method: "POST",
        body: formData,
      });

      const doc = (res?.document || res) as unknown as DocumentRecord;
      if (!doc || !doc.id) {
        throw new Error("Failed to create document record.");
      }

      setDocuments((prev) => [doc, ...prev.filter((d) => d.id !== doc.id)]);
      setSelectedDocId(doc.id);

      let versionId =
        res?.cvVersionId ||
        res?.cvVersion?.id ||
        res?.document?.cvVersionId;

      if (!versionId) {
        try {
          const versions = await apiFetch<CvVersionItem[]>(
            `/api/cv/versions?documentId=${doc.id}`
          );
          if (versions && versions.length > 0) {
            versionId = versions[0].id;
            setCvVersions(versions);
            setSelectedCvVersionId(versionId);
          }
        } catch {
          // ignore
        }
      } else {
        setSelectedCvVersionId(versionId);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to upload CV";
      if (
        message.toLowerCase().includes("authentication required") ||
        message.toLowerCase().includes("unauthorized") ||
        message.toLowerCase().includes("auth")
      ) {
        router.push("/auth?callbackUrl=/comparisons");
        return;
      }
      setError(message);
    } finally {
      setUploadingCv(false);
    }
  };

  const handleRunComparison = async () => {
    if (!session) {
      router.push("/auth?callbackUrl=/comparisons");
      return;
    }
    let versionId = selectedCvVersionId;

    if (!versionId && cvVersions.length > 0) {
      versionId = cvVersions[0].id;
      setSelectedCvVersionId(versionId);
    }

    if (!versionId && selectedDocId) {
      try {
        const versions = await apiFetch<CvVersionItem[]>(
          `/api/cv/versions?documentId=${selectedDocId}`
        );
        if (versions && versions.length > 0) {
          versionId = versions[0].id;
          setCvVersions(versions);
          setSelectedCvVersionId(versionId);
        } else {
          const doc = documents.find((d) => d.id === selectedDocId);
          if (doc) {
            const created = await apiFetch<CvVersionItem>("/api/cv/versions", {
              method: "POST",
              body: JSON.stringify({
                sourceDocumentId: doc.id,
                extractedText: doc.extractedText || "Candidate CV profile and qualifications for role comparison.",
              }),
            });
            if (created?.id) {
              versionId = created.id;
              setCvVersions([created]);
              setSelectedCvVersionId(versionId);
            }
          }
        }
      } catch (err) {
        console.error("Failed to auto-resolve CV version", err);
      }
    }

    if (!versionId) {
      setError("Please select or upload a candidate CV first before comparing roles.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (selectedJdIds.length < 2 || selectedJdIds.length > 3) {
      setError("Please select 2 or 3 job descriptions to compare.");
      return;
    }

    setComparing(true);
    setError(null);
    try {
      // Resolve any preset:* keys to existing or newly created JD records
      const resolvedJdIds: string[] = [];
      for (const rawId of selectedJdIds) {
        if (rawId.startsWith("preset:")) {
          const presetId = rawId.replace("preset:", "");
          const preset = FAMOUS_ROLE_PRESETS.find((p) => p.id === presetId);
          if (preset) {
            const existing = availableJds.find((j) => {
              const matchTitle = (j.title || "").trim().toLowerCase() === preset.title.trim().toLowerCase();
              const matchCompany = (j.company || "").trim().toLowerCase() === preset.company.trim().toLowerCase();
              return matchTitle && matchCompany;
            });
            if (existing) {
              resolvedJdIds.push(existing.id);
            } else {
              const created = await apiFetch<JobDescriptionItem>("/api/job-descriptions", {
                method: "POST",
                body: JSON.stringify({
                  title: preset.title,
                  company: preset.company,
                  rawText: preset.description || preset.sampleText || preset.summary,
                }),
              });
              setAvailableJds((prev) => [created, ...prev]);
              resolvedJdIds.push(created.id);
            }
          }
        } else {
          resolvedJdIds.push(rawId);
        }
      }

      // Deduplicate resolved IDs strictly
      const finalUniqueIds = Array.from(new Set(resolvedJdIds));
      if (finalUniqueIds.length < 2 || finalUniqueIds.length > 3) {
        setError("Please select 2 or 3 distinct job descriptions to compare.");
        setComparing(false);
        return;
      }

      const result = await apiFetch<MultiJdComparisonResult>("/api/comparisons", {
        method: "POST",
        body: JSON.stringify({
          cvVersionId: versionId,
          jobDescriptionIds: finalUniqueIds,
        }),
      });

      if (typeof window !== "undefined") {
        sessionStorage.setItem("cookmycv_latest_comparison", JSON.stringify(result));
        sessionStorage.setItem(
          "cookmycv_latest_comparison_input",
          JSON.stringify({ cvVersionId: versionId, selectedJdIds: finalUniqueIds })
        );
        try {
          const raw = localStorage.getItem("cookmycv_comparison_history");
          const history = raw ? JSON.parse(raw) : [];
          const newEntry = {
            id: `comp_${Date.now()}`,
            createdAt: new Date().toISOString(),
            winningRoleTitle: result.recommendedRole?.title || "Top Recommended Role",
            comparisonSummary: result.comparisonSummary || "",
            rolesCount: result.roles?.length || 0,
            roles: (result.roles || []).map((r) => ({
              roleTitle: r.title,
              company: r.company,
              overallMatchScore: r.overallScore,
              callbackProbability: r.interviewProbability ?? Math.round(r.overallScore * 0.85),
              isWinner: r.title === result.recommendedRole?.title,
            })),
            fullResult: result,
          };
          const filtered = Array.isArray(history)
            ? history.filter((h: { winningRoleTitle: string; rolesCount: number }) => h.winningRoleTitle !== newEntry.winningRoleTitle || h.rolesCount !== newEntry.rolesCount)
            : [];
          localStorage.setItem("cookmycv_comparison_history", JSON.stringify([newEntry, ...filtered].slice(0, 25)));
        } catch (_) {}
      }

      router.push("/comparisons/result");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Comparison analysis failed";
      if (
        message.toLowerCase().includes("authentication required") ||
        message.toLowerCase().includes("unauthorized") ||
        message.toLowerCase().includes("auth")
      ) {
        router.push("/auth?callbackUrl=/comparisons");
        return;
      }
      setError(message);
      setComparing(false);
    }
  };

  if (comparing) {
    return <FullPageLoading />;
  }

  if (loadingInitial) {
    return <FullPageLoading />;
  }

  // Filter presets based on category and expanded state
  const filteredPresets = FAMOUS_ROLE_PRESETS.filter(
    (p) => activeCategory === "all" || p.category === activeCategory
  );
  const displayedPresets = showAllPresets
    ? filteredPresets
    : filteredPresets.slice(0, 4);

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Page Header with One Clear Primary CTA */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-text tracking-tight">
            Role Compare
          </h1>
          <p className="text-xs sm:text-sm text-text-secondary mt-1 font-medium">
            Compare 1 CV against 2 or 3 target positions side-by-side using unified ATS & committee rubrics.
          </p>
        </div>
        <Button
          variant="primary"
          size="lg"
          disabled={comparing || selectedJdIds.length < 2}
          isLoading={comparing}
          onClick={handleRunComparison}
          className="text-sm font-bold h-11 px-6 bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-950/50 w-full sm:w-auto cursor-pointer"
        >
          Compare {selectedJdIds.length} Selected Roles →
        </Button>
      </div>

      {error && (
        <Alert
          variant="danger"
          title="Notice"
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => setError(null)}
              className="text-xs"
            >
              Dismiss
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {/* Main Content */}
      <div className="space-y-8">
        {/* Top Section: Active CV & Target Roles */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Active CV Selection & Direct Upload */}
          <Card className="lg:col-span-5 bg-surface border-border rounded-2xl flex flex-col justify-between">
            <div>
              <CardHeader className="border-b border-border pb-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                    Step 1 · Candidate CV
                  </span>
                  <Badge variant="neutral" size="sm">PDF / DOCX</Badge>
                </div>
                <CardTitle className="text-base font-bold text-text mt-1">
                  Select or Upload CV
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {/* Switch existing CV if available */}
                {documents.length > 0 && (
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-xs font-bold text-text">
                          Selected CV
                        </label>
                        <span className="text-[11px] font-mono text-text-muted">
                          {documents.length} available
                        </span>
                      </div>
                      <select
                        value={selectedDocId}
                        onChange={(e) => setSelectedDocId(e.target.value)}
                        className="w-full bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-text font-medium focus:outline-hidden focus:border-purple-500 cursor-pointer"
                      >
                        {documents.map((doc) => (
                          <option key={doc.id} value={doc.id}>
                            {doc.filename}
                          </option>
                        ))}
                      </select>
                    </div>

                    {cvVersions.length > 1 && (
                      <div>
                        <label className="block text-xs font-bold text-text mb-1.5">
                          Version
                        </label>
                        <select
                          value={selectedCvVersionId}
                          onChange={(e) => setSelectedCvVersionId(e.target.value)}
                          className="w-full bg-surface-elevated border border-border rounded-xl px-3.5 py-2 text-xs text-text font-medium focus:outline-hidden focus:border-purple-500 cursor-pointer"
                        >
                          {cvVersions.map((v) => (
                            <option key={v.id} value={v.id}>
                              Version {v.versionNumber} ({new Date(v.createdAt).toLocaleDateString()})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {/* Direct Upload Dropzone to easily change CV */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setCvDragOver(true);
                  }}
                  onDragLeave={() => setCvDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setCvDragOver(false);
                    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                      handleUploadCvFile(e.dataTransfer.files[0]);
                    }
                  }}
                  onClick={() => document.getElementById("compare-cv-upload-input")?.click()}
                  className={`border border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${
                    cvDragOver
                      ? "border-purple-500 bg-surface-elevated"
                      : "border-border hover:border-purple-500/40 bg-surface-elevated"
                  }`}
                >
                  <input
                    id="compare-cv-upload-input"
                    type="file"
                    accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleUploadCvFile(e.target.files[0]);
                      }
                    }}
                  />
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-text">
                      {uploadingCv ? "Uploading and parsing CV..." : "+ Upload Different CV"}
                    </p>
                    <p className="text-[11px] text-text-muted">
                      Drop any PDF or DOCX file to switch comparison CV
                    </p>
                  </div>
                </div>
              </CardContent>
            </div>
          </Card>

          {/* Right: Quick Role Presets & Custom Role Addition */}
          <Card className="lg:col-span-7 bg-surface border-border rounded-2xl flex flex-col justify-between">
            <CardHeader className="border-b border-border pb-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                  Step 2 · Target Roles
                </span>
                <span className="text-xs font-mono text-purple-600 dark:text-purple-300 font-bold">
                  {selectedJdIds.length} of 3 Selected
                </span>
              </div>
              <CardTitle className="text-base font-bold text-text mt-1">
                Pick Roles or Add Custom JD
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4 flex-1 flex flex-col justify-between">
              <div>
                {/* Category Filter Tabs (Simple, neutral, no glow) */}
                <div className="flex items-center justify-between mb-2.5 flex-wrap gap-2">
                  <span className="text-xs font-bold text-text">
                    Famous Benchmarks:
                  </span>
                  <div className="flex items-center gap-1 overflow-x-auto text-xs font-mono">
                    {[
                      { id: "all", label: "All" },
                      { id: "big_tech", label: "Big Tech" },
                      { id: "ai", label: "AI" },
                      { id: "cyber", label: "Cyber" },
                      { id: "blockchain", label: "Blockchain" },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveCategory(tab.id as "all" | PresetCategory)}
                        className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                          activeCategory === tab.id
                            ? "bg-purple-600 text-white dark:bg-zinc-800 dark:text-white font-bold border border-purple-500 dark:border-zinc-700"
                            : "text-text-muted hover:text-text hover:bg-surface-elevated border border-transparent font-medium"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {displayedPresets.map((preset) => {
                    const isSelected = isPresetSelected(preset);
                    const isMaxReached = selectedJdIds.length >= 3 && !isSelected;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        disabled={isMaxReached}
                        onClick={() => handleTogglePreset(preset)}
                        className={`p-3.5 rounded-xl border text-left transition-all flex items-start gap-3 ${
                          isSelected
                            ? "border-purple-600 dark:border-purple-500 bg-surface-elevated dark:bg-purple-950/60 ring-2 ring-purple-500 shadow-md shadow-purple-500/20 cursor-pointer"
                            : isMaxReached
                            ? "border-border bg-surface-elevated/40 opacity-60 cursor-not-allowed"
                            : "border-border bg-surface-elevated hover:border-purple-500/40 hover:bg-surface cursor-pointer"
                        }`}
                      >
                        <div className="p-2 rounded-lg bg-surface border border-border/80 shrink-0 flex items-center justify-center">
                          {getCompanyLogo(preset.id)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1 mb-0.5">
                            <span className="text-xs font-bold text-text truncate">
                              {preset.company}
                            </span>
                            {isSelected ? (
                              <span className="text-[10px] text-purple-700 dark:text-purple-300 font-bold font-mono bg-surface border border-purple-500/40 px-1.5 py-0.5 rounded-xs shrink-0">
                                Selected
                              </span>
                            ) : isMaxReached ? (
                              <span className="text-[10px] text-text-muted font-mono shrink-0">
                                3 of 3 Selected
                              </span>
                            ) : (
                              <span className="text-[10px] text-text-muted font-mono shrink-0">
                                + Select
                              </span>
                            )}
                          </div>
                          <p className="text-xs font-bold text-purple-700 dark:text-purple-300 truncate mb-1">
                            {preset.title}
                          </p>
                          <p className="text-[11px] text-text-secondary leading-snug line-clamp-1 font-normal">
                            {preset.summary}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Simple Non-glowing See More Toggle */}
                <div className="pt-2 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setShowAllPresets(!showAllPresets)}
                    className="text-xs text-text-muted hover:text-text py-1 px-3.5 rounded border border-border hover:border-border-hover bg-surface-elevated transition-colors cursor-pointer font-mono font-medium"
                  >
                    {showAllPresets ? "Show less" : "See more"}
                  </button>
                </div>
              </div>

              <div className="pt-2 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <span className="text-xs text-text-muted">
                  Need a custom job post?
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddJd(!showAddJd)}
                  className="text-xs font-semibold w-full sm:w-auto"
                >
                  {showAddJd ? "Close Form" : "+ Custom Job Description"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Inline Add Custom JD Form (Smooth Collapsible) */}
        {showAddJd && (
          <Card className="bg-surface-elevated border border-purple-500/40 rounded-2xl shadow-xl">
            <CardHeader className="border-b border-border pb-3">
              <CardTitle className="text-sm font-bold text-text">
                Add New Target Job Description
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <form onSubmit={handleCreateNewJd} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label="Job Title *"
                    placeholder="e.g. Senior Backend Engineer"
                    value={newJdTitle}
                    onChange={(e) => setNewJdTitle(e.target.value)}
                    required
                  />
                  <Input
                    label="Company Name *"
                    placeholder="e.g. Stripe, CBE, Amazon"
                    value={newJdCompany}
                    onChange={(e) => setNewJdCompany(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-text mb-1.5">
                    Job Description Text * (min 50 chars)
                  </label>
                  <Textarea
                    placeholder="Paste the core requirements, responsibilities, and qualifications..."
                    value={newJdText}
                    onChange={(e) => setNewJdText(e.target.value)}
                    rows={5}
                    required
                  />
                  <span className="text-[11px] text-text-muted float-right mt-1 font-mono">
                    {newJdText.length} characters
                  </span>
                </div>
                <div className="flex justify-end gap-2.5 pt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => setShowAddJd(false)}
                    className="text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    type="submit"
                    isLoading={savingJd}
                    disabled={newJdText.trim().length < 50}
                    className="text-xs font-bold"
                  >
                    Save & Add Role
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Custom Job Descriptions Section */}
        {(() => {
          const uniqueCustomJds: JobDescriptionItem[] = [];
          const seenCustom = new Set<string>();
          for (const jd of availableJds) {
            if (isFamousPresetJd(jd)) continue;
            const key = `${(jd.company || "").trim().toLowerCase()}:::${(jd.title || "").trim().toLowerCase()}`;
            if (!seenCustom.has(key)) {
              seenCustom.add(key);
              uniqueCustomJds.push(jd);
            }
          }
          if (uniqueCustomJds.length === 0) return null;

          return (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-text">
                  Custom Target Roles ({uniqueCustomJds.filter((jd) => selectedJdIds.includes(jd.id)).length} Selected)
                </h2>
                <span className="text-xs text-text-muted font-mono">
                  Click a card to toggle selection (min 2, max 3)
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {uniqueCustomJds.map((jd) => {
                  const isSelected = selectedJdIds.includes(jd.id);
                  const isMaxReached = selectedJdIds.length >= 3 && !isSelected;
                  return (
                    <div
                      key={jd.id}
                      onClick={() => handleToggleJdSelection(jd.id)}
                      role="checkbox"
                      aria-checked={isSelected}
                      tabIndex={isMaxReached ? -1 : 0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleToggleJdSelection(jd.id);
                        }
                      }}
                      className={`p-5 rounded-2xl border transition-all flex flex-col justify-between gap-3 ${
                        isSelected
                          ? "border-purple-600 dark:border-purple-500 bg-surface-elevated dark:bg-purple-950/40 ring-2 ring-purple-500 shadow-lg shadow-purple-500/20 cursor-pointer"
                          : isMaxReached
                          ? "border-border bg-surface/50 opacity-60 cursor-not-allowed"
                          : "border-border bg-surface hover:border-purple-500/40 hover:bg-surface-elevated cursor-pointer"
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <Badge
                            variant={isSelected ? "purple" : "neutral"}
                            size="sm"
                          >
                            {isSelected ? "Selected" : isMaxReached ? "3/3 Selected" : "Click to Add"}
                          </Badge>
                          <span className="text-xs text-purple-700 dark:text-purple-300 font-mono font-bold">
                            {jd.company || "Company"}
                          </span>
                        </div>
                        <h3 className="font-bold text-sm sm:text-base text-text truncate">
                          {jd.title || "Target Role"}
                        </h3>
                        <p className="text-xs text-text-secondary mt-2 line-clamp-3 leading-relaxed">
                          {jd.rawText}
                        </p>
                      </div>

                      <div className="pt-3 border-t border-border/60 flex items-center justify-between text-xs font-mono text-purple-700 dark:text-purple-300 font-semibold">
                        <span>{isSelected ? "Included in Comparison" : "Select Role"}</span>
                        <span>{isSelected ? "✓" : "+"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
