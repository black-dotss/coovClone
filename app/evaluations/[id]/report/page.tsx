"use client";

import React, { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ScoreRing } from "@/components/ui/score-ring";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Alert } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import { LoadingSpinner, FullPageLoading } from "@/components/ui/loading-spinner";
import { Avatar, AgentRoleKey } from "@/components/ui/avatar";
import { EvaluationOnChainPanel } from "@/components/solana/evaluation-onchain-panel";
import { useSession } from "@/lib/auth/auth-client";
import type { StructuredEvaluationReport } from "@/lib/reports/types";

interface CompletedAgentSummary {
  role: AgentRoleKey;
  displayName: string;
  scoreContribution: number;
  durationMs?: number;
  voiceCommentary?: string;
  position?: string;
  findings?: Array<{ claim: string; severity: string; evidenceSnippet?: string }>;
}

const COMMITTEE_PERSONAS: Array<{
  role: AgentRoleKey;
  title: string;
  focus: string;
}> = [
  { role: "hr_recruiter", title: "HR Recruiter", focus: "Tenure & trajectory" },
  { role: "technical_interviewer", title: "Technical Interviewer", focus: "Architecture & code depth" },
  { role: "ats_scanner", title: "ATS Scanner", focus: "Keywords & parsability" },
  { role: "hiring_manager", title: "Hiring Manager", focus: "Ownership & business delivery" },
  { role: "career_strategist", title: "Career Strategist", focus: "Seniority & industry benchmark" },
  { role: "red_flag_analyst", title: "Red Flag Analyst", focus: "Risk audit & consistency gaps" },
];

type ReportCategory =
  | "overview"
  | "agents"
  | "pipeline"
  | "strengths"
  | "fixes"
  | "tools";

interface GraphDimension {
  name: string;
  shortName: string;
  score: number;
  benchmark: number;
  description: string;
}

// X-Y Coordinate Graph Component
function CompetencyXYChart({
  dimensions,
}: {
  dimensions: GraphDimension[];
}) {
  const width = 760;
  const height = 290;
  const paddingLeft = 55;
  const paddingRight = 55;
  const paddingTop = 35;
  const paddingBottom = 45;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const points = dimensions.map((dim, i) => {
    const x = paddingLeft + (i / (dimensions.length - 1)) * chartWidth;
    const y = paddingTop + chartHeight - (dim.score / 100) * chartHeight;
    return { x, y, ...dim };
  });

  const benchmarkY = paddingTop + chartHeight - (70 / 100) * chartHeight;

  const linePath = points.reduce((acc, p, i) => {
    return i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
  }, "");

  const yTicks = [0, 25, 50, 75, 100];

  return (
    <div className="w-full space-y-4">
      {/* Chart Header & Legend */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-border">
        <h4 className="text-xs font-bold text-text-muted font-mono uppercase tracking-wider">
          Role Competency Trajectory vs 70% Target
        </h4>
        <div className="flex flex-wrap items-center gap-3.5 text-xs font-mono">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-1 bg-purple-500 inline-block rounded-xs" />
            <span className="text-text font-medium">Candidate Curve</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 border-t border-dashed border-text-muted inline-block" />
            <span className="text-text-muted">70% Target</span>
          </div>
        </div>
      </div>

      {/* SVG Canvas with exact scroll boundary matching compare page */}
      <div className="w-full max-w-full overflow-x-auto bg-surface border border-border rounded-xl p-3 sm:p-6 shadow-xs">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto min-w-[540px]"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Horizontal Gridlines & Y-Axis Labels */}
          {yTicks.map((tick) => {
            const y = paddingTop + chartHeight - (tick / 100) * chartHeight;
            return (
              <g key={tick}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={width - paddingRight}
                  y2={y}
                  className="stroke-zinc-200 dark:stroke-zinc-800"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <text
                  x={paddingLeft - 10}
                  y={y + 3.5}
                  textAnchor="end"
                  className="fill-zinc-400 dark:fill-zinc-500 font-mono text-[11px]"
                >
                  {tick}%
                </text>
              </g>
            );
          })}

          {/* Benchmark 70% Horizontal Line */}
          <line
            x1={paddingLeft}
            y1={benchmarkY}
            x2={width - paddingRight}
            y2={benchmarkY}
            className="stroke-zinc-400 dark:stroke-zinc-600"
            strokeWidth="1.5"
            strokeDasharray="4 4"
            opacity="0.85"
          />
          <text
            x={width - paddingRight}
            y={benchmarkY - 6}
            textAnchor="end"
            className="fill-zinc-500 dark:fill-zinc-400 font-mono text-[10px] font-semibold"
          >
            70% Bar
          </text>

          {/* Main X-Y Data Line */}
          <path
            d={linePath}
            fill="none"
            stroke="#A855F7"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Data Points on (X, Y) Coordinates */}
          {points.map((p, i) => (
            <g key={i}>
              <circle
                cx={p.x}
                cy={p.y}
                r="5"
                className="fill-white dark:fill-zinc-950"
                stroke="#A855F7"
                strokeWidth="2.5"
              />
              <circle cx={p.x} cy={p.y} r="2" fill="#C084FC" />
              <text
                x={p.x}
                y={p.y - 10}
                textAnchor="middle"
                className="fill-zinc-900 dark:fill-white font-mono text-[10px] font-bold"
              >
                {p.score}%
              </text>
              <text
                x={p.x}
                y={paddingTop + chartHeight + 16}
                textAnchor="middle"
                className="fill-zinc-600 dark:fill-zinc-300 font-mono text-[10px] font-medium"
              >
                {p.shortName}
              </text>
            </g>
          ))}

          {/* Y Axis Line */}
          <line
            x1={paddingLeft}
            y1={paddingTop}
            x2={paddingLeft}
            y2={paddingTop + chartHeight}
            className="stroke-zinc-300 dark:stroke-zinc-700"
            strokeWidth="1.5"
          />

          {/* X Axis Line */}
          <line
            x1={paddingLeft}
            y1={paddingTop + chartHeight}
            x2={width - paddingRight}
            y2={paddingTop + chartHeight}
            className="stroke-zinc-300 dark:stroke-zinc-700"
            strokeWidth="1.5"
          />
        </svg>
      </div>

      {/* Metric Delta Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-0.5 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1">
        {dimensions.map((dim, i) => {
          const delta = dim.score - 70;
          const isAbove = delta >= 0;
          return (
            <div
              key={i}
              className="p-2.5 bg-surface-elevated border border-border rounded-lg text-center space-y-0.5 shadow-2xs min-w-0 overflow-hidden"
            >
              <div className="text-[11px] font-mono text-text-muted truncate">{dim.shortName}</div>
              <div className="text-sm font-mono font-bold text-text">{dim.score}%</div>
              <div
                className={`text-[10px] font-mono font-semibold ${
                  isAbove ? "text-purple-600 dark:text-purple-400" : "text-text-muted"
                }`}
              >
                {isAbove ? `+${delta}% vs bar` : `${delta}% vs bar`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function EvaluationReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session } = useSession();

  const [report, setReport] = useState<StructuredEvaluationReport | null>(null);
  const [completedAgents, setCompletedAgents] = useState<CompletedAgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [navigatingAction, setNavigatingAction] = useState<string | null>(null);

  // Active category tab in left sidebar
  const [activeCategory, setActiveCategory] = useState<ReportCategory>("overview");

  // PDF & Sharing state
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadingCard, setDownloadingCard] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function loadReport() {
      try {
        const [reportRes, progressRes] = await Promise.allSettled([
          apiFetch<StructuredEvaluationReport>(`/api/evaluations/${id}/report`),
          apiFetch<{ completedAgents?: CompletedAgentSummary[] }>(`/api/evaluations/${id}/progress`),
        ]);

        if (reportRes.status === "fulfilled") {
          setReport(reportRes.value);
        } else {
          throw new Error("Failed to load evaluation report");
        }

        if (progressRes.status === "fulfilled" && progressRes.value?.completedAgents) {
          setCompletedAgents(progressRes.value.completedAgents);
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to load evaluation report";
        setError(message);
      } finally {
        setLoading(false);
      }
    }
    loadReport();
  }, [id]);

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    setDownloadError(null);
    try {
      const res = await fetch(`/api/evaluations/${id}/pdf`, {
        credentials: "include",
      });
      if (!res.ok) {
        let msg = `PDF download failed (${res.status})`;
        try {
          const errData = await res.json();
          if (errData?.error?.message) {
            msg = errData.error.message;
          }
        } catch {
          // fallback
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cookmycv-report-${id.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to download PDF report";
      setDownloadError(msg);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleDownloadShareCard = async () => {
    if (!report) return;
    setDownloadingCard(true);
    setCardError(null);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 2400;
      canvas.height = 1350;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not initialize 2D graphics canvas");
      ctx.scale(2, 2);

      // 1. Detect Company & Role
      const testedCompany = report.targetCompany || "";
      const testedRole = report.targetRole || "Senior Engineering Track";

      const targetText = (
        testedCompany +
        " " +
        testedRole +
        " " +
        (report.explanation || "")
      ).toLowerCase();

      const FAMOUS_LOGOS: Record<string, string> = {
        meta: "https://upload.wikimedia.org/wikipedia/commons/7/7b/Meta_Platforms_Inc._logo.svg",
        google: "https://upload.wikimedia.org/wikipedia/commons/2/2f/Google_2015_logo.svg",
        netflix: "https://upload.wikimedia.org/wikipedia/commons/0/08/Netflix_2015_logo.svg",
        amazon: "https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg",
        apple: "https://upload.wikimedia.org/wikipedia/commons/f/fa/Apple_logo_black.svg",
        microsoft: "https://upload.wikimedia.org/wikipedia/commons/9/96/Microsoft_logo_%282012%29.svg",
        uber: "https://upload.wikimedia.org/wikipedia/commons/c/cc/Uber_logo_2018.png",
        spotify: "https://upload.wikimedia.org/wikipedia/commons/1/19/Spotify_logo_without_text.svg",
        stripe: "https://upload.wikimedia.org/wikipedia/commons/b/ba/Stripe_Logo%2C_revised_2016.svg",
        openai: "https://upload.wikimedia.org/wikipedia/commons/4/4d/OpenAI_Logo.svg",
      };

      let matchedCompany: { name: string; url: string } | null = null;
      for (const [key, logoUrl] of Object.entries(FAMOUS_LOGOS)) {
        if (targetText.includes(key)) {
          matchedCompany = {
            name: key.charAt(0).toUpperCase() + key.slice(1),
            url: logoUrl,
          };
          break;
        }
      }

      const displayCompany = testedCompany || matchedCompany?.name || "";
      const displayRole = testedRole;

      // 2. Load Assets concurrently: Doll Mascot, Candidate Avatar, Company Logo
      const dollImg = new Image();
      dollImg.crossOrigin = "anonymous";
      const dollPromise = new Promise<void>((resolve) => {
        dollImg.onload = () => resolve();
        dollImg.onerror = () => resolve();
        dollImg.src = "/Agents_PP/HR.png";
      });

      const userAvatarImg = new Image();
      userAvatarImg.crossOrigin = "anonymous";
      const avatarPromise = new Promise<void>((resolve) => {
        if (session?.user?.image) {
          userAvatarImg.onload = () => resolve();
          userAvatarImg.onerror = () => resolve();
          userAvatarImg.src = session.user.image;
        } else {
          resolve();
        }
      });

      const companyLogoImg = new Image();
      companyLogoImg.crossOrigin = "anonymous";
      const companyPromise = new Promise<void>((resolve) => {
        if (matchedCompany?.url) {
          companyLogoImg.onload = () => resolve();
          companyLogoImg.onerror = () => resolve();
          companyLogoImg.src = matchedCompany.url;
        } else {
          resolve();
        }
      });

      await Promise.all([dollPromise, avatarPromise, companyPromise]);

      // 3. Background: Deep rich dark background with ambient glow
      ctx.fillStyle = "#09090b";
      ctx.fillRect(0, 0, 1200, 675);

      const radGlow1 = ctx.createRadialGradient(250, 340, 50, 300, 340, 550);
      radGlow1.addColorStop(0, "rgba(168, 85, 247, 0.28)");
      radGlow1.addColorStop(0.5, "rgba(88, 28, 135, 0.12)");
      radGlow1.addColorStop(1, "rgba(9, 9, 11, 0)");
      ctx.fillStyle = radGlow1;
      ctx.fillRect(0, 0, 1200, 675);

      const radGlow2 = ctx.createRadialGradient(880, 340, 40, 880, 340, 480);
      radGlow2.addColorStop(0, "rgba(168, 85, 247, 0.22)");
      radGlow2.addColorStop(0.6, "rgba(59, 7, 100, 0.08)");
      radGlow2.addColorStop(1, "rgba(9, 9, 11, 0)");
      ctx.fillStyle = radGlow2;
      ctx.fillRect(0, 0, 1200, 675);

      // Outer sleek border
      ctx.strokeStyle = "#27272a";
      ctx.lineWidth = 2;
      ctx.strokeRect(30, 30, 1140, 615);

      // Brand badge at top-left
      ctx.fillStyle = "rgba(168, 85, 247, 0.15)";
      ctx.strokeStyle = "rgba(168, 85, 247, 0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(65, 55, 170, 38, 19);
      ctx.fill();
      ctx.stroke();

      ctx.font = "bold 15px system-ui, sans-serif";
      ctx.fillStyle = "#c084fc";
      ctx.fillText("COOV.SPACE", 95, 79);

      // 4. Draw Giant Doll Mascot (Big and cheerful, NO HR mentions!)
      if (dollImg.complete && dollImg.naturalWidth > 0) {
        const dollH = 430;
        const dollW = (dollImg.naturalWidth / dollImg.naturalHeight) * dollH;
        ctx.drawImage(dollImg, 65, 130, dollW, dollH);
      }

      // 5. Candidate Profile Section (BIG profile picture & name)
      const candidateName =
        session?.user?.name ||
        (session?.user?.email ? session.user.email.split("@")[0] : "Verified Candidate");

      const profileX = 520;
      const avatarCenterX = profileX + 45;
      const avatarCenterY = 135;
      const avatarR = 42;

      // Draw avatar image or initials
      ctx.save();
      ctx.beginPath();
      ctx.arc(avatarCenterX, avatarCenterY, avatarR, 0, 2 * Math.PI);
      ctx.closePath();
      ctx.clip();

      if (userAvatarImg.complete && userAvatarImg.naturalWidth > 0) {
        ctx.drawImage(
          userAvatarImg,
          avatarCenterX - avatarR,
          avatarCenterY - avatarR,
          avatarR * 2,
          avatarR * 2
        );
      } else {
        const grad = ctx.createLinearGradient(
          avatarCenterX - avatarR,
          avatarCenterY - avatarR,
          avatarCenterX + avatarR,
          avatarCenterY + avatarR
        );
        grad.addColorStop(0, "#7c3aed");
        grad.addColorStop(1, "#a855f7");
        ctx.fillStyle = grad;
        ctx.fillRect(
          avatarCenterX - avatarR,
          avatarCenterY - avatarR,
          avatarR * 2,
          avatarR * 2
        );

        ctx.font = "bold 38px system-ui, sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(candidateName.charAt(0).toUpperCase(), avatarCenterX, avatarCenterY);
      }
      ctx.restore();

      // Avatar border ring
      ctx.beginPath();
      ctx.arc(avatarCenterX, avatarCenterY, avatarR, 0, 2 * Math.PI);
      ctx.strokeStyle = "#a855f7";
      ctx.lineWidth = 3;
      ctx.stroke();

      // Candidate Name (BIG)
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.font = "bold 34px system-ui, sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(candidateName, profileX + 110, 130);

      // Tested Role & Tested Company (Visible and clearly labeled, responsive aspect ratio)
      if (matchedCompany && companyLogoImg.complete && companyLogoImg.naturalWidth > 0) {
        // Company logo rounded container
        const logoBoxX = profileX + 110;
        const logoBoxY = 145;
        const logoBoxW = 46;
        const logoBoxH = 46;

        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.roundRect(logoBoxX, logoBoxY, logoBoxW, logoBoxH, 8);
        ctx.fill();

        // Responsive containment preserving aspect ratio without distortion
        const nw = companyLogoImg.naturalWidth;
        const nh = companyLogoImg.naturalHeight;
        const maxDrawW = logoBoxW - 10;
        const maxDrawH = logoBoxH - 10;
        const scale = Math.min(maxDrawW / nw, maxDrawH / nh);
        const drawW = nw * scale;
        const drawH = nh * scale;
        const drawX = logoBoxX + 5 + (maxDrawW - drawW) / 2;
        const drawY = logoBoxY + 5 + (maxDrawH - drawH) / 2;

        ctx.drawImage(companyLogoImg, drawX, drawY, drawW, drawH);

        ctx.font = "bold 18px system-ui, sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.fillText(`${displayCompany || matchedCompany.name} • ${displayRole}`, logoBoxX + logoBoxW + 12, 174);
      } else if (displayCompany) {
        const logoBoxX = profileX + 110;
        const logoBoxY = 145;
        const logoBoxW = 46;
        const logoBoxH = 46;

        // Clean initial badge for custom company
        ctx.fillStyle = "#27272a";
        ctx.strokeStyle = "#3f3f46";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(logoBoxX, logoBoxY, logoBoxW, logoBoxH, 8);
        ctx.fill();
        ctx.stroke();

        ctx.font = "bold 20px system-ui, sans-serif";
        ctx.fillStyle = "#c084fc";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(displayCompany.charAt(0).toUpperCase(), logoBoxX + logoBoxW / 2, logoBoxY + logoBoxH / 2);

        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.font = "bold 18px system-ui, sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.fillText(`${displayCompany} • ${displayRole}`, logoBoxX + logoBoxW + 12, 174);
      } else {
        ctx.font = "bold 18px system-ui, sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.fillText(displayRole, profileX + 110, 168);
      }

      // 6. Huge Score Circle (The Circle Data in BIG)
      const ringCenterX = 820;
      const ringCenterY = 370;
      const ringR = 95;

      // Track
      ctx.beginPath();
      ctx.arc(ringCenterX, ringCenterY, ringR, 0, 2 * Math.PI);
      ctx.strokeStyle = "#27272a";
      ctx.lineWidth = 18;
      ctx.stroke();

      // Progress Fill
      const scorePct = Math.min(100, Math.max(0, report.overallScore)) / 100;
      ctx.beginPath();
      ctx.arc(
        ringCenterX,
        ringCenterY,
        ringR,
        -Math.PI / 2,
        -Math.PI / 2 + 2 * Math.PI * scorePct
      );
      ctx.strokeStyle = "#a855f7";
      ctx.lineWidth = 18;
      ctx.lineCap = "round";
      ctx.stroke();

      // Center Percentage Score (BIG)
      ctx.font = "bold 58px monospace";
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.fillText(`${report.overallScore}%`, ringCenterX, ringCenterY + 12);

      ctx.font = "bold 13px monospace";
      ctx.fillStyle = "#a1a1aa";
      ctx.fillText("PANEL SCORE", ringCenterX, ringCenterY + 36);

      // 7. Bold Verdict Badge
      const verdict = report.verdict || "STRONG PASS";
      const isStrong =
        verdict.toLowerCase().includes("pass") || verdict.toLowerCase().includes("strong");

      const verdictW = 280;
      const verdictH = 46;
      const verdictX = ringCenterX - verdictW / 2;
      const verdictY = ringCenterY + 115;

      ctx.fillStyle = isStrong ? "rgba(16, 185, 129, 0.16)" : "rgba(168, 85, 247, 0.16)";
      ctx.strokeStyle = isStrong ? "#10b981" : "#a855f7";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(verdictX, verdictY, verdictW, verdictH, 23);
      ctx.fill();
      ctx.stroke();

      ctx.font = "bold 16px monospace";
      ctx.fillStyle = isStrong ? "#34d399" : "#c084fc";
      ctx.fillText(`VERDICT: ${verdict.toUpperCase()}`, ringCenterX, verdictY + 28);

      // 8. Bottom Clean Footer
      ctx.textAlign = "left";
      ctx.font = "12px monospace";
      ctx.fillStyle = "#71717a";
      ctx.fillText("Simulated with 6 AI Panel Personas • coov.space", profileX, 600);

      // 9. Export Blob
      canvas.toBlob((blob) => {
        if (!blob) throw new Error("Canvas PNG generation failed");
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `coov-card-${candidateName.toLowerCase().replace(/\s+/g, "-")}.png`;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }, "image/png");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to generate COOV card";
      setCardError(msg);
    } finally {
      setDownloadingCard(false);
    }
  };

  const handleOpenShareModal = async () => {
    setShareModalOpen(true);
    setShareError(null);
    if (shareUrl) return;

    setShareLoading(true);
    try {
      const res = await apiFetch<{ shareUrl: string }>(
        `/api/evaluations/${id}/share`,
        {
          method: "POST",
          body: JSON.stringify({ expiresInDays: 30 }),
        }
      );
      const fullUrl = res.shareUrl.startsWith("http")
        ? res.shareUrl
        : `${window.location.origin}${res.shareUrl}`;
      setShareUrl(fullUrl);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to generate share link";
      setShareError(message);
    } finally {
      setShareLoading(false);
    }
  };

  const handleCopyShareLink = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  if (loading) {
    return <FullPageLoading />;
  }

  if (error || !report) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <Alert variant="danger" title="Unable to Load Report">
          {error || "The report could not be found or is not yet ready."}
        </Alert>
        <div className="mt-5 flex gap-3">
          <Link href={`/evaluations/${id}/progress?view=chat`}>
            <Button variant="secondary" size="sm">Back to Agent Deliberation</Button>
          </Link>
          <Link href="/profile">
            <Button variant="outline" size="sm">Back to Profile</Button>
          </Link>
        </div>
      </div>
    );
  }

  const categories: Array<{
    id: ReportCategory;
    label: string;
    count?: string | number;
    icon: React.ReactNode;
  }> = [
    {
      id: "overview",
      label: "Overview",
      icon: (
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </svg>
      ),
    },
    {
      id: "agents",
      label: "Agent Opinions",
      count: 6,
      icon: (
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      ),
    },
    {
      id: "pipeline",
      label: "Hiring Pipeline",
      count: 4,
      icon: (
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
    },
    {
      id: "strengths",
      label: "Strengths, Gaps & ATS",
      count: `${report.atsSummary?.keywordCoverage}%`,
      icon: (
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      ),
    },
    {
      id: "fixes",
      label: "Action Items & Fixes",
      count: (report.redFlags?.length || 0) + (report.prioritizedFixes?.length || 0),
      icon: (
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      ),
    },
    {
      id: "tools",
      label: "Tools & Export",
      icon: (
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
        </svg>
      ),
    },
  ];

  // Dimension dataset for X-Y coordinate chart (100% sourced from real agent dimensions)
  const dimensionMetrics: GraphDimension[] = [
    {
      name: "Role Fit & Requirements",
      shortName: "Role Fit",
      score: report.dimensions.roleFit,
      benchmark: 70,
      description: "Alignment with job expectations and experience trajectory",
    },
    {
      name: "Technical Depth & Proof",
      shortName: "Tech Depth",
      score: report.dimensions.skillsAndEvidence,
      benchmark: 70,
      description: "Concrete engineering proof and architectural capabilities",
    },
    {
      name: "ATS Keyword Coverage",
      shortName: "ATS Match",
      score: report.dimensions.atsAlignment,
      benchmark: 65,
      description: "Parsing passability and keyword matching algorithms",
    },
    {
      name: "Business Impact & Metrics",
      shortName: "Impact",
      score: report.dimensions.impactAndClarity,
      benchmark: 70,
      description: "Quantified commercial outcomes and leadership scope",
    },
    {
      name: "Presentation & Consistency",
      shortName: "Presentation",
      score: report.dimensions.professionalPresentation,
      benchmark: 70,
      description: "Clarity of communication, format, and structure",
    },
  ];

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-12 space-y-6 overflow-x-hidden">
      {/* Top Header Bar: Clean breadcrumb + Return to Agent Chat */}
      <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex items-center gap-2 text-xs text-text-muted font-mono">
          <Link href="/profile" className="hover:text-text transition-colors whitespace-nowrap">
            Profile
          </Link>
          <span>/</span>
          <span className="text-text font-semibold whitespace-nowrap">Ref: {id.slice(0, 8)}</span>
        </div>

        {/* Top Right: Single Return to Agent Chat Link */}
        <Link
          href={`/evaluations/${id}/progress?view=chat`}
          className="inline-flex items-center gap-1.5 text-xs font-mono text-text-muted hover:text-text transition-colors whitespace-nowrap shrink-0"
        >
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          <span><span className="hidden sm:inline">Return to </span>Agent Chat</span>
        </Link>
      </div>

      {/* Mobile Top Navigation Pills (Quick scroll & switch on mobile screens) */}
      <div className="lg:hidden w-full max-w-full overflow-x-auto pb-2 flex items-center gap-1.5 scrollbar-none py-2 border-b border-border">
        {categories.map((cat) => {
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
                isActive
                  ? "bg-purple-600 text-white shadow-xs"
                  : "bg-surface-elevated text-text-secondary hover:text-text border border-border"
              }`}
            >
              <span>{cat.icon}</span>
              <span>{cat.label}</span>
              {cat.count !== undefined && (
                <span className={`text-[10px] px-1 py-0.2 rounded font-mono ${isActive ? "bg-purple-700 text-white" : "text-text-muted"}`}>
                  {cat.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Main Layout: Fixed Left Sidebar + Main Content Area */}
      <div className="w-full max-w-full min-w-0 flex flex-col lg:flex-row gap-6 items-start">
        {/* Left Fixed Sidebar with bold sharp UI inspired by modern developer consoles */}
        <aside className="hidden lg:block lg:w-64 lg:min-w-[16rem] lg:max-w-[16rem] shrink-0 sticky top-20 space-y-4 bg-surface border border-border rounded-xl p-3 self-start shadow-xs">
          {/* Report Sections */}
          <div className="space-y-1">
            <div className="text-xs font-bold uppercase tracking-wider text-text-muted px-3.5 pt-1 pb-1">
              Sections
            </div>
            <nav className="space-y-1">
              {categories.map((cat) => {
                const isActive = activeCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setActiveCategory(cat.id)}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 text-sm rounded-lg transition-all text-left cursor-pointer group ${
                      isActive
                        ? "bg-surface-elevated text-text font-bold border border-border shadow-xs"
                        : "text-text-secondary hover:text-text hover:bg-surface-elevated/60 font-semibold"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={isActive ? "text-purple-600 dark:text-purple-400 font-bold" : "text-text-muted group-hover:text-text transition-colors"}>
                        {cat.icon}
                      </span>
                      <span>{cat.label}</span>
                    </div>
                    {cat.count !== undefined && (
                      <span
                        className={`text-xs font-mono px-2 py-0.5 rounded font-bold ${
                          isActive
                            ? "bg-purple-600 text-white"
                            : "bg-surface-elevated text-text-muted border border-border"
                        }`}
                      >
                        {cat.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Optional Interactive Tools */}
          <div className="space-y-1 pt-3 border-t border-border">
            <div className="text-xs font-bold uppercase tracking-wider text-text-muted px-3.5 py-1">
              Optional Tools
            </div>
            <div className="space-y-0.5">
              <button
                onClick={() => {
                  setNavigatingAction("rewrites");
                  router.push(`/evaluations/${id}/rewrites`);
                }}
                disabled={navigatingAction === "rewrites"}
                className="w-full flex items-center justify-between px-3.5 py-2 text-sm font-semibold text-text-secondary hover:text-text hover:bg-surface-elevated/60 rounded-lg transition-colors group text-left cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <svg className="w-4 h-4 text-text-muted group-hover:text-text transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  <span>Bullet Rewrites</span>
                </div>
                {navigatingAction === "rewrites" ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <span className="text-text-muted">→</span>
                )}
              </button>
              <button
                onClick={() => {
                  setNavigatingAction("defense");
                  router.push(`/evaluations/${id}/defense`);
                }}
                disabled={navigatingAction === "defense"}
                className="w-full flex items-center justify-between px-3.5 py-2 text-sm font-semibold text-text-secondary hover:text-text hover:bg-surface-elevated/60 rounded-lg transition-colors group text-left cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <svg className="w-4 h-4 text-text-muted group-hover:text-text transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                  </svg>
                  <span>Defend Deductions</span>
                </div>
                {navigatingAction === "defense" ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <span className="text-text-muted">→</span>
                )}
              </button>
              <button
                onClick={() => {
                  setNavigatingAction("interview");
                  router.push(`/evaluations/${id}/interview`);
                }}
                disabled={navigatingAction === "interview"}
                className="w-full flex items-center justify-between px-3.5 py-2 text-sm font-semibold text-text-secondary hover:text-text hover:bg-surface-elevated/60 rounded-lg transition-colors group text-left cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <svg className="w-4 h-4 text-text-muted group-hover:text-text transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <span>Mock Interview</span>
                </div>
                {navigatingAction === "interview" ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <span className="text-text-muted">→</span>
                )}
              </button>
            </div>
          </div>

          {/* Export Utilities */}
          <div className="space-y-1 pt-3 border-t border-border">
            <div className="text-xs font-bold uppercase tracking-wider text-text-muted px-3.5 py-1">
              Export
            </div>
            <div className="space-y-0.5">
              <button
                onClick={handleDownloadPdf}
                disabled={downloadingPdf}
                className="w-full flex items-center justify-between px-3.5 py-2 text-sm font-semibold text-text-secondary hover:text-text hover:bg-surface-elevated/60 rounded-lg transition-colors text-left cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <svg className="w-4 h-4 text-text-muted group-hover:text-text transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span>{downloadingPdf ? "Generating..." : "Download PDF"}</span>
                </div>
              </button>
              {downloadError && (
                <div className="px-3.5 py-1 text-xs text-red-500 font-medium">
                  {downloadError}
                </div>
              )}
              <button
                onClick={handleDownloadShareCard}
                disabled={downloadingCard}
                className="w-full flex items-center justify-between px-3.5 py-2 text-sm font-semibold text-text-secondary hover:text-text hover:bg-surface-elevated/60 rounded-lg transition-colors text-left cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <svg className="w-4 h-4 text-text-muted group-hover:text-text transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span>{downloadingCard ? "Generating..." : "Download COOV Card"}</span>
                </div>
              </button>
              {cardError && (
                <div className="px-3.5 py-1 text-xs text-red-500 font-medium">
                  {cardError}
                </div>
              )}
              <button
                onClick={handleOpenShareModal}
                className="w-full flex items-center justify-between px-3.5 py-2 text-sm font-semibold text-text-secondary hover:text-text hover:bg-surface-elevated/60 rounded-lg transition-colors text-left cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <svg className="w-4 h-4 text-text-muted group-hover:text-text transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  <span>Share Link</span>
                </div>
              </button>
              <button
                onClick={() => window.print()}
                className="w-full flex items-center justify-between px-3.5 py-2 text-sm font-semibold text-text-secondary hover:text-text hover:bg-surface-elevated/60 rounded-lg transition-colors text-left cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <svg className="w-4 h-4 text-text-muted group-hover:text-text transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  <span>Print</span>
                </div>
              </button>
            </div>
          </div>
        </aside>

        {/* Right Main Content Area (Medium Sizing & Dimensions) */}
        <main className="w-full max-w-full min-w-0 flex-1 min-h-[700px] space-y-6">
          {/* TAB 1: OVERVIEW */}
          {activeCategory === "overview" && (
            <div className="w-full max-w-full min-w-0 space-y-6">
              {/* 0. Solana On-Chain Proof & Soulbound Credential */}
              <EvaluationOnChainPanel evaluationId={id} />

              {/* 1. Role Competency Curve */}
              <div className="w-full max-w-full min-w-0 overflow-hidden p-3 sm:p-5 bg-surface border border-border rounded-xl space-y-4 shadow-xs">
                <CompetencyXYChart dimensions={dimensionMetrics} />
              </div>

              {/* 2. Score & Executive Summary Bento */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="md:col-span-1 flex flex-col items-center justify-center p-4 sm:p-5 text-center border-border bg-surface rounded-xl">
                  <ScoreRing score={report.overallScore} size={115} strokeWidth={9} label="Overall Score" />
                  <div className="mt-3 space-y-1">
                    <div className="text-xs font-mono uppercase tracking-wider text-text-muted font-bold">
                      Verdict: <span className="text-text font-bold">{report.verdict}</span>
                    </div>
                    <p className="text-[11px] text-text-muted font-mono">
                      Confidence: {Math.round(report.confidence * 100)}%
                    </p>
                  </div>
                </Card>

                <Card className="md:col-span-2 border-border bg-surface rounded-xl p-4 sm:p-5">
                  <CardHeader className="p-0 pb-2">
                    <CardTitle className="text-sm font-bold text-text font-mono uppercase tracking-wider">
                      Executive Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <p className="text-xs sm:text-sm text-text-secondary leading-relaxed font-normal">
                      {report.explanation}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Mobile Quick Action Buttons (1-tap access on mobile devices) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 lg:hidden">
                <button
                  onClick={() => {
                    setNavigatingAction("rewrites");
                    router.push(`/evaluations/${id}/rewrites`);
                  }}
                  disabled={navigatingAction === "rewrites"}
                  className="flex items-center gap-2 p-2.5 rounded-lg bg-surface border border-border hover:border-purple-500/50 text-left transition-all cursor-pointer group min-w-0 overflow-hidden"
                >
                  <div className="w-8 h-8 rounded-md bg-purple-600/10 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
                    {navigatingAction === "rewrites" ? (
                      <LoadingSpinner size="sm" />
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-text truncate">Rewrites</div>
                    <div className="text-[10px] text-text-muted font-mono truncate">Sharpen CV</div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setNavigatingAction("defense");
                    router.push(`/evaluations/${id}/defense`);
                  }}
                  disabled={navigatingAction === "defense"}
                  className="flex items-center gap-2 p-2.5 rounded-lg bg-surface border border-border hover:border-purple-500/50 text-left transition-all cursor-pointer group min-w-0 overflow-hidden"
                >
                  <div className="w-8 h-8 rounded-md bg-purple-600/10 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
                    {navigatingAction === "defense" ? (
                      <LoadingSpinner size="sm" />
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-text truncate">Defend</div>
                    <div className="text-[10px] text-text-muted font-mono truncate">Reassess score</div>
                  </div>
                </button>

                <button
                  onClick={handleDownloadPdf}
                  disabled={downloadingPdf}
                  className="flex items-center gap-2 p-2.5 rounded-lg bg-surface border border-border hover:border-purple-500/50 text-left transition-all cursor-pointer group min-w-0 overflow-hidden"
                >
                  <div className="w-8 h-8 rounded-md bg-purple-600/10 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
                    {downloadingPdf ? (
                      <LoadingSpinner size="sm" />
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-text truncate">PDF Report</div>
                    <div className="text-[10px] text-text-muted font-mono truncate">{downloadingPdf ? "Generating..." : "Download"}</div>
                  </div>
                </button>

                <button
                  onClick={handleOpenShareModal}
                  className="flex items-center gap-2 p-2.5 rounded-lg bg-surface border border-border hover:border-purple-500/50 text-left transition-all cursor-pointer group min-w-0 overflow-hidden"
                >
                  <div className="w-8 h-8 rounded-md bg-purple-600/10 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-text truncate">Share Link</div>
                    <div className="text-[10px] text-text-muted font-mono truncate">Public URL</div>
                  </div>
                </button>
              </div>

              {/* 3. Candidate Screening Pipeline (Added directly to Overview page) */}
              <div className="p-4 sm:p-5 bg-surface border border-border rounded-xl space-y-4">
                <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 border-b border-border pb-3">
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-wider text-text font-mono">
                      Candidate Screening Pipeline
                    </h3>
                    <p className="text-xs text-text-muted font-mono">
                      Progression across 4 committee screening gates
                    </p>
                  </div>
                  <span className="text-xs font-mono font-bold text-text bg-surface-elevated border border-border px-2.5 py-1 rounded shrink-0">
                    {report.overallScore >= 70 ? "PASSED" : "FLAGGED GAPS"}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {/* Stage 1: ATS Audit */}
                  <div className="p-3.5 bg-surface-elevated border border-border rounded-lg space-y-2 min-w-0 overflow-hidden">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-text-muted uppercase font-semibold">Stage 1 · ATS</span>
                      <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border border-border bg-surface text-text">
                        {report.atsSummary?.keywordCoverage >= 65 ? "PASSED" : "FLAGGED"}
                      </span>
                    </div>
                    <div className="text-xs font-bold text-text">ATS Keyword Audit</div>
                    <div className="text-lg font-bold font-mono text-text">
                      {report.atsSummary?.keywordCoverage ?? report.dimensions.atsAlignment}%
                    </div>
                    <p className="text-[11px] text-text-muted leading-normal">
                      Parsing match ratio against required job keywords.
                    </p>
                  </div>

                  {/* Stage 2: HR Recruiter Screen */}
                  <div className="p-3.5 bg-surface-elevated border border-border rounded-lg space-y-2 min-w-0 overflow-hidden">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-text-muted uppercase font-semibold">Stage 2 · Recruiter</span>
                      <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border border-border bg-surface text-text">
                        {report.dimensions.roleFit >= 65 ? "APPROVED" : "REVIEW"}
                      </span>
                    </div>
                    <div className="text-xs font-bold text-text">HR Phone Screen</div>
                    <div className="text-lg font-bold font-mono text-text">
                      {report.dimensions.roleFit}/100
                    </div>
                    <p className="text-[11px] text-text-muted leading-normal">
                      Tenure, role level progression, and basic qualification fit.
                    </p>
                  </div>

                  {/* Stage 3: Technical Review */}
                  <div className="p-3.5 bg-surface-elevated border border-border rounded-lg space-y-2 min-w-0 overflow-hidden">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-text-muted uppercase font-semibold">Stage 3 · Tech Bar</span>
                      <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border border-border bg-surface text-text">
                        {report.dimensions.skillsAndEvidence >= 65 ? "QUALIFIED" : "GAPS"}
                      </span>
                    </div>
                    <div className="text-xs font-bold text-text">Technical Review</div>
                    <div className="text-lg font-bold font-mono text-text">
                      {report.dimensions.skillsAndEvidence}/100
                    </div>
                    <p className="text-[11px] text-text-muted leading-normal">
                      Deep-dive technical competency and architecture proof.
                    </p>
                  </div>

                  {/* Stage 4: Committee Consensus */}
                  <div className="p-3.5 bg-surface-elevated border border-border rounded-lg space-y-2 min-w-0 overflow-hidden">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-text-muted uppercase font-semibold">Stage 4 · Consensus</span>
                      <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border border-border bg-surface text-text">
                        {report.overallScore >= 70 ? "RECOMMENDED" : "HOLD"}
                      </span>
                    </div>
                    <div className="text-xs font-bold text-text">Hiring Committee</div>
                    <div className="text-lg font-bold font-mono text-text">
                      {report.overallScore}/100
                    </div>
                    <p className="text-[11px] text-text-muted leading-normal">
                      Final synthesized score across all 6 deliberation roles.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: AGENT OPINIONS */}
          {activeCategory === "agents" && (
            <div className="space-y-5">
              <div className="border-b border-border pb-3">
                <h2 className="text-lg font-bold text-text">Agent Committee Opinions</h2>
                <p className="text-xs font-mono text-text-muted">Verbatim stances and ratings from the 6 simulated reviewers</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {COMMITTEE_PERSONAS.map((p) => {
                  const summary = completedAgents.find((a) => a.role === p.role);
                  const score =
                    summary?.scoreContribution ??
                    (p.role === "ats_scanner"
                      ? report.atsSummary?.keywordCoverage ?? report.dimensions.atsAlignment
                      : p.role === "technical_interviewer"
                      ? report.dimensions.skillsAndEvidence
                      : p.role === "hr_recruiter"
                      ? report.dimensions.roleFit
                      : p.role === "career_strategist"
                      ? report.dimensions.impactAndClarity
                      : report.overallScore);

                  const commentary =
                    summary?.voiceCommentary ||
                    summary?.position ||
                    summary?.findings?.[0]?.claim ||
                    (p.role === "ats_scanner"
                      ? `${report.atsSummary?.keywordCoverage ?? 0}% keyword coverage across ${report.atsSummary?.matched?.length ?? 0} detected job requirements.`
                      : p.role === "red_flag_analyst"
                      ? report.redFlags?.[0]?.flag || "Audit completed; no high-severity timeline or credential discrepancies."
                      : p.role === "hr_recruiter"
                      ? report.strengths?.[0] || report.explanation
                      : p.role === "technical_interviewer"
                      ? report.weaknesses?.[0] || report.strengths?.[1] || report.explanation
                      : p.role === "career_strategist"
                      ? report.strengths?.[2] || report.explanation
                      : report.explanation);

                  return (
                    <div
                      key={p.role}
                      className="p-4 bg-surface border border-border rounded-xl flex flex-col justify-between gap-3"
                    >
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <Avatar role={p.role} size="lg" className="shrink-0" />
                            <div className="truncate">
                              <h4 className="text-sm font-bold text-text truncate">
                                {p.title}
                              </h4>
                              <p className="text-[11px] text-text-muted font-mono truncate mt-0.5">
                                {p.focus}
                              </p>
                            </div>
                          </div>
                          <span className="font-mono text-sm font-bold text-text shrink-0 bg-surface-elevated border border-border px-2 py-0.5 rounded">
                            {score}/100
                          </span>
                        </div>

                        <p className="text-xs font-mono text-text leading-relaxed bg-surface-elevated/70 p-2.5 rounded-lg border border-border">
                          &ldquo;{commentary}&rdquo;
                        </p>
                      </div>

                      <div className="pt-2 border-t border-border flex items-center justify-between text-[10px] font-mono text-text-muted">
                        <span>Audited by Committee</span>
                        <span className="text-purple-600 dark:text-purple-300 font-semibold">Completed</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: HIRING PIPELINE */}
          {activeCategory === "pipeline" && (
            <div className="space-y-5">
              <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 border-b border-border pb-3">
                <div className="space-y-0.5">
                  <h2 className="text-lg font-bold text-text">Candidate Screening Pipeline Status</h2>
                  <p className="text-xs font-mono text-text-muted">Progression across standard recruitment gates</p>
                </div>
                <span className="text-xs font-mono font-bold text-text bg-surface-elevated border border-border px-2.5 py-1 rounded shrink-0">
                  {report.overallScore >= 70 ? "Screen Cleared" : "Gaps Flagged"}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 bg-surface border border-border rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-text-muted uppercase font-bold">Stage 1 · ATS</span>
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded border border-border bg-surface-elevated text-text">
                      {report.atsSummary?.keywordCoverage >= 65 ? "PASSED" : "FLAGGED"}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-text">ATS Keyword Audit</h3>
                  <p className="text-xs font-mono text-text font-bold">{report.atsSummary?.keywordCoverage}% match ratio</p>
                  <p className="text-xs text-text-secondary leading-relaxed">Parsing passability and keyword matching verification against job description.</p>
                </div>

                <div className="p-4 bg-surface border border-border rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-text-muted uppercase font-bold">Stage 2 · Recruiter</span>
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded border border-border bg-surface-elevated text-text">
                      {report.dimensions.roleFit >= 65 ? "APPROVED" : "REVIEW"}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-text">HR Phone Screen</h3>
                  <p className="text-xs font-mono text-text font-bold">{report.dimensions.roleFit}/100 role fit</p>
                  <p className="text-xs text-text-secondary leading-relaxed">Career tenure, role title progression, and basic qualification checks.</p>
                </div>

                <div className="p-4 bg-surface border border-border rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-text-muted uppercase font-bold">Stage 3 · Tech Bar</span>
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded border border-border bg-surface-elevated text-text">
                      {report.dimensions.skillsAndEvidence >= 65 ? "QUALIFIED" : "GAPS"}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-text">Technical Review</h3>
                  <p className="text-xs font-mono text-text font-bold">{report.dimensions.skillsAndEvidence}/100 proof depth</p>
                  <p className="text-xs text-text-secondary leading-relaxed">Deep-dive technical competency and verifiable architecture implementation proof.</p>
                </div>

                <div className="p-4 bg-surface border border-border rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-text-muted uppercase font-bold">Stage 4 · Consensus</span>
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded border border-border bg-surface-elevated text-text">
                      {report.overallScore >= 70 ? "FAST TRACK" : "HOLD"}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-text">Hiring Committee</h3>
                  <p className="text-xs font-mono text-text font-bold">{report.overallScore}/100 consensus</p>
                  <p className="text-xs text-text-secondary leading-relaxed">Final panel decision synthesized across all 6 deliberation roles.</p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: STRENGTHS, GAPS & ATS */}
          {activeCategory === "strengths" && (
            <div className="space-y-6">
              <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 border-b border-border pb-3">
                <div className="space-y-0.5">
                  <h2 className="text-lg font-bold text-text">Strengths, Critical Gaps & ATS Audit</h2>
                  <p className="text-xs font-mono text-text-muted">Direct findings extracted from candidate profile and keyword audit</p>
                </div>
                <span className="text-xs font-mono font-bold text-text bg-surface-elevated border border-border px-2.5 py-1 rounded shrink-0">
                  {report.atsSummary?.keywordCoverage}% Match
                </span>
              </div>

              {/* Strengths & Weaknesses 2-Column Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-5 bg-surface border border-border rounded-xl space-y-3">
                  <h3 className="text-xs font-mono font-bold uppercase text-text">
                    Key Strengths ({report.strengths.length})
                  </h3>
                  <ul className="space-y-2.5">
                    {report.strengths.map((str, i) => (
                      <li key={i} className="text-xs sm:text-sm text-text flex items-start gap-2.5">
                        <span className="text-purple-500 font-bold shrink-0 mt-0.5">•</span>
                        <span className="leading-relaxed font-normal">{str}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="p-5 bg-surface border border-border rounded-xl space-y-3">
                  <h3 className="text-xs font-mono font-bold uppercase text-text-muted">
                    Critical Weaknesses ({report.weaknesses.length})
                  </h3>
                  <ul className="space-y-2.5">
                    {report.weaknesses.map((weak, i) => (
                      <li key={i} className="text-xs sm:text-sm text-text flex items-start gap-2.5">
                        <span className="text-text-muted font-bold shrink-0 mt-0.5">•</span>
                        <span className="leading-relaxed font-normal">{weak}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* ATS Keyword Breakdown Section */}
              <div className="p-5 bg-surface border border-border rounded-xl space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold uppercase text-text">
                    ATS Parsing & Keyword Match Ratio
                  </span>
                  <span className="text-xs font-mono font-bold text-text">
                    {report.atsSummary?.keywordCoverage}% Match
                  </span>
                </div>
                <ProgressBar value={report.atsSummary?.keywordCoverage || 0} variant="purple" size="md" />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                  <div className="p-4 bg-surface-elevated border border-border rounded-lg space-y-2">
                    <span className="text-xs font-mono font-bold text-text block">
                      Matched Keywords ({report.atsSummary?.matched?.length || 0})
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {report.atsSummary?.matched?.length > 0 ? (
                        report.atsSummary.matched.map((term, i) => (
                          <Badge key={i} variant="neutral" size="sm" className="font-semibold break-all max-w-full">
                            {term}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-text-muted font-mono">None detected</span>
                      )}
                    </div>
                  </div>

                  <div className="p-4 bg-surface-elevated border border-border rounded-lg space-y-2">
                    <span className="text-xs font-mono font-bold text-text block">
                      Missing Requirements ({report.atsSummary?.missing?.length || 0})
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {report.atsSummary?.missing?.length > 0 ? (
                        report.atsSummary.missing.map((term, i) => (
                          <Badge key={i} variant="neutral" size="sm" className="break-all max-w-full">
                            {term}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-text-muted font-mono">All requirements detected</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: ACTION ITEMS & PRIORITIZED FIXES */}
          {activeCategory === "fixes" && (
            <div className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
                <div className="space-y-0.5">
                  <h2 className="text-lg font-bold text-text tracking-tight">
                    Action Items & Prioritized Fixes
                  </h2>
                  <p className="text-xs font-mono text-text-muted">
                    Concrete revisions ranked by impact to immediately raise your interview odds
                  </p>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  className="font-semibold text-xs"
                  isLoading={navigatingAction === "rewrites"}
                  onClick={() => {
                    setNavigatingAction("rewrites");
                    router.push(`/evaluations/${id}/rewrites`);
                  }}
                >
                  Generate Rewrites →
                </Button>
              </div>

              {/* Red Flag Findings */}
              {report.redFlags && report.redFlags.length > 0 && (
                <div className="p-5 bg-surface border border-border rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold uppercase text-text">
                      Red Flag Audit Findings ({report.redFlags.length})
                    </span>
                    <span className="text-[11px] font-mono text-text-muted">Requires Clarification</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {report.redFlags.map((flag, i) => (
                      <div
                        key={i}
                        className="p-3.5 bg-surface-elevated border border-border rounded-lg space-y-2 flex flex-col justify-between"
                      >
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="text-xs sm:text-sm font-bold text-text leading-snug">
                              {flag.flag}
                            </h3>
                            <button
                              onClick={() => {
                                setNavigatingAction(`defense-${i}`);
                                router.push(`/evaluations/${id}/defense?claim=${encodeURIComponent(flag.flag)}`);
                              }}
                              disabled={navigatingAction === `defense-${i}`}
                              className="text-xs font-mono font-semibold text-purple-600 dark:text-purple-400 hover:underline shrink-0 flex items-center gap-1 cursor-pointer"
                            >
                              {navigatingAction === `defense-${i}` ? <LoadingSpinner size="sm" /> : "Defend →"}
                            </button>
                          </div>

                          {flag.evidenceSnippet && (
                            <div className="p-2.5 bg-surface border border-border rounded text-xs text-text font-mono">
                              <strong className="text-text-muted">CV Citation:</strong> &ldquo;{flag.evidenceSnippet}&rdquo;
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Prioritized Fixes */}
              {report.prioritizedFixes && report.prioritizedFixes.length > 0 && (
                <div className="p-5 bg-surface border border-border rounded-xl space-y-3">
                  <span className="text-xs font-mono font-bold uppercase text-text block">
                    Recommended High-ROI Improvements ({report.prioritizedFixes.length})
                  </span>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {report.prioritizedFixes.map((fix, i) => (
                      <div
                        key={i}
                        className="p-3.5 bg-surface-elevated border border-border rounded-lg flex flex-col justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex items-start gap-2.5">
                            <span className="w-5 h-5 rounded bg-surface border border-border flex items-center justify-center font-mono text-[11px] font-bold text-text shrink-0 mt-0.5">
                              {i + 1}
                            </span>
                            <h4 className="text-xs sm:text-sm font-semibold text-text leading-snug">
                              {fix.fix}
                            </h4>
                          </div>
                          <div className="text-xs font-medium text-text-secondary font-mono pl-7.5">
                            Expected ROI: {fix.expectedBenefit}
                          </div>
                        </div>

                        <div className="flex justify-end pt-1 border-t border-border/60 pl-7.5">
                          <Badge variant="neutral" size="sm" className="font-mono text-[10px]">
                            {fix.effort.toUpperCase()} EFFORT
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 5: TOOLS & EXPORT (Dedicated full access on mobile and desktop) */}
          {activeCategory === "tools" && (
            <div className="space-y-6">
              <div className="border-b border-border pb-3">
                <h2 className="text-lg font-bold text-text">Interactive Tools & Report Exports</h2>
                <p className="text-xs font-mono text-text-muted">Take direct action to polish your CV, defend your score, and export deliverables</p>
              </div>

              {/* Section 1: Interactive Tools */}
              <div className="space-y-3">
                <h3 className="text-xs font-mono font-bold uppercase text-text-muted tracking-wider">
                  Interactive AI Tools
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  {/* Bullet Rewrites */}
                  <div className="p-4 bg-surface border border-border rounded-xl space-y-3 flex flex-col justify-between">
                    <div className="space-y-1.5">
                      <div className="w-9 h-9 rounded-lg bg-purple-600/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </div>
                      <h4 className="text-sm font-bold text-text">Bullet Rewrites</h4>
                      <p className="text-xs text-text-secondary leading-relaxed">
                        Transform weak CV statements into high-impact, quantifiable achievements with verified action verbs.
                      </p>
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      className="w-full text-xs font-semibold"
                      isLoading={navigatingAction === "rewrites"}
                      onClick={() => {
                        setNavigatingAction("rewrites");
                        router.push(`/evaluations/${id}/rewrites`);
                      }}
                    >
                      Launch Rewrites →
                    </Button>
                  </div>

                  {/* Defend Deductions */}
                  <div className="p-4 bg-surface border border-border rounded-xl space-y-3 flex flex-col justify-between">
                    <div className="space-y-1.5">
                      <div className="w-9 h-9 rounded-lg bg-purple-600/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                        </svg>
                      </div>
                      <h4 className="text-sm font-bold text-text">Defend Deductions</h4>
                      <p className="text-xs text-text-secondary leading-relaxed">
                        Present counter-evidence to simulated committee reviewers to claw back penalised score points.
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full text-xs font-semibold"
                      isLoading={navigatingAction === "defense"}
                      onClick={() => {
                        setNavigatingAction("defense");
                        router.push(`/evaluations/${id}/defense`);
                      }}
                    >
                      Defend Score →
                    </Button>
                  </div>

                  {/* Mock Interview */}
                  <div className="p-4 bg-surface border border-border rounded-xl space-y-3 flex flex-col justify-between">
                    <div className="space-y-1.5">
                      <div className="w-9 h-9 rounded-lg bg-purple-600/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                      </div>
                      <h4 className="text-sm font-bold text-text">Mock Interview</h4>
                      <p className="text-xs text-text-secondary leading-relaxed">
                        Practice answering tough questions generated directly from your flagged gaps and CV weaknesses.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs font-semibold"
                      isLoading={navigatingAction === "interview"}
                      onClick={() => {
                        setNavigatingAction("interview");
                        router.push(`/evaluations/${id}/interview`);
                      }}
                    >
                      Practice Q&A →
                    </Button>
                  </div>
                </div>
              </div>

              {/* Section 2: Exports & Downloads */}
              <div className="space-y-3 pt-2">
                <h3 className="text-xs font-mono font-bold uppercase text-text-muted tracking-wider">
                  Downloads & Sharing
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {/* PDF Download */}
                  <div className="p-4 bg-surface border border-border rounded-xl space-y-3 flex flex-col justify-between">
                    <div className="space-y-1.5">
                      <h4 className="text-sm font-bold text-text">Comprehensive PDF Report</h4>
                      <p className="text-xs text-text-secondary leading-relaxed">
                        Complete evaluation dossier with dimension breakdowns, committee votes, and prioritized revisions.
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full text-xs font-semibold"
                      disabled={downloadingPdf}
                      onClick={handleDownloadPdf}
                    >
                      {downloadingPdf ? "Generating PDF..." : "Download Full PDF"}
                    </Button>
                    {downloadError && <p className="text-xs text-red-500 font-mono">{downloadError}</p>}
                  </div>

                  {/* COOV Card Download */}
                  <div className="p-4 bg-surface border border-border rounded-xl space-y-3 flex flex-col justify-between">
                    <div className="space-y-1.5">
                      <h4 className="text-sm font-bold text-text">Branded COOV Card (PNG)</h4>
                      <p className="text-xs text-text-secondary leading-relaxed">
                        High-resolution 2400×1350 brag graphic ready for LinkedIn, Twitter/X, and portfolio sharing.
                      </p>
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      className="w-full text-xs font-semibold"
                      disabled={downloadingCard}
                      onClick={handleDownloadShareCard}
                    >
                      {downloadingCard ? "Generating Card..." : "Download COOV Card"}
                    </Button>
                    {cardError && <p className="text-xs text-red-500 font-mono">{cardError}</p>}
                  </div>

                  {/* Share Public Link */}
                  <div className="p-4 bg-surface border border-border rounded-xl space-y-3 flex flex-col justify-between">
                    <div className="space-y-1.5">
                      <h4 className="text-sm font-bold text-text">Share Public Report Link</h4>
                      <p className="text-xs text-text-secondary leading-relaxed">
                        Create a secure, privacy-redacted public link to share your evaluation with mentors or recruiters.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs font-semibold"
                      onClick={handleOpenShareModal}
                    >
                      Generate Share Link
                    </Button>
                  </div>

                  {/* Print / Save */}
                  <div className="p-4 bg-surface border border-border rounded-xl space-y-3 flex flex-col justify-between">
                    <div className="space-y-1.5">
                      <h4 className="text-sm font-bold text-text">Print / Browser Save</h4>
                      <p className="text-xs text-text-secondary leading-relaxed">
                        Standard browser printer output optimized for clean paper printouts or PDF printing.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs font-semibold"
                      onClick={() => window.print()}
                    >
                      Print Report
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Share Modal */}
      <Modal
        isOpen={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        title="Share Evaluation Report"
      >
        <div className="space-y-4">
          <p className="text-xs sm:text-sm text-text-secondary">
            Anyone with this link can view your structured evaluation summary. Contact details are automatically redacted.
          </p>

          {shareLoading ? (
            <div className="py-6 flex justify-center">
              <LoadingSpinner label="Generating link..." />
            </div>
          ) : shareError ? (
            <Alert variant="danger">{shareError}</Alert>
          ) : shareUrl ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareUrl}
                  className="w-full text-xs font-mono bg-surface-elevated border border-border rounded px-3 py-2 text-text"
                />
                <Button size="sm" onClick={handleCopyShareLink}>
                  {copied ? "Copied!" : "Copy"}
                </Button>
              </div>
            </div>
          ) : (
            <Alert variant="danger">Unable to generate share link right now.</Alert>
          )}

          <div className="flex justify-end pt-3 border-t border-border">
            <Button variant="secondary" onClick={() => setShareModalOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
