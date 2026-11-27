"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ScoreRing } from "@/components/ui/score-ring";
import { FullPageLoading } from "@/components/ui/loading-spinner";
import { getCompanyLogo } from "@/components/ui/company-logo";
import type { MultiJdComparisonResult, RoleComparisonResult } from "@/lib/reports/types";

const CHART_AXES = [
  { key: "roleFit", name: "Role Fit" },
  { key: "skills", name: "Tech Skills" },
  { key: "ats", name: "ATS Match" },
  { key: "impact", name: "Impact" },
  { key: "probability", name: "Probability" },
] as const;

function calculateRoleProbability(role: RoleComparisonResult): number {
  if (typeof role.interviewProbability === "number") {
    return role.interviewProbability;
  }
  return Math.min(
    95,
    Math.max(15, Math.round(role.overallScore * 0.7 + role.atsKeywordCoverage * 0.3))
  );
}

/**
 * Returns authentic company branding colors for chart curves and visual accents.
 */
function getCompanyBrandColors(companyOrId?: string, fallbackIndex = 0): { stroke: string; dot: string; label: string } {
  const query = (companyOrId || "").toLowerCase();

  if (query.includes("meta") || query.includes("facebook")) {
    return { stroke: "#0081FB", dot: "#BFDBFE", label: "Meta Blue" };
  }
  if (query.includes("netflix")) {
    return { stroke: "#E50914", dot: "#FECACA", label: "Netflix Red" };
  }
  if (query.includes("google") || query.includes("alphabet")) {
    return { stroke: "#4285F4", dot: "#BFDBFE", label: "Google Blue" };
  }
  if (query.includes("deepmind")) {
    return { stroke: "#34A853", dot: "#BBF7D0", label: "DeepMind Green" };
  }
  if (query.includes("amazon") || query.includes("aws")) {
    return { stroke: "#FF9900", dot: "#FED7AA", label: "Amazon Orange" };
  }
  if (query.includes("microsoft") || query.includes("azure")) {
    return { stroke: "#00A4EF", dot: "#BAE6FD", label: "Microsoft Cyan" };
  }
  if (query.includes("apple")) {
    return { stroke: "#E5E7EB", dot: "#FFFFFF", label: "Apple Silver" };
  }
  if (query.includes("openai")) {
    return { stroke: "#10A37F", dot: "#A7F3D0", label: "OpenAI Green" };
  }
  if (query.includes("anthropic")) {
    return { stroke: "#D97706", dot: "#FDE68A", label: "Anthropic Amber" };
  }
  if (query.includes("nvidia")) {
    return { stroke: "#76B900", dot: "#DCFCE7", label: "NVIDIA Green" };
  }
  if (query.includes("crowdstrike")) {
    return { stroke: "#EF4444", dot: "#FEE2E2", label: "CrowdStrike Red" };
  }
  if (query.includes("cloudflare")) {
    return { stroke: "#F6821F", dot: "#FFEDD5", label: "Cloudflare Orange" };
  }
  if (query.includes("coinbase")) {
    return { stroke: "#0052FF", dot: "#DBEAFE", label: "Coinbase Blue" };
  }
  if (query.includes("chainlink")) {
    return { stroke: "#375BD2", dot: "#C7D2FE", label: "Chainlink Blue" };
  }
  if (query.includes("binance")) {
    return { stroke: "#F3BA2F", dot: "#FEF08A", label: "Binance Gold" };
  }
  if (query.includes("palo alto") || query.includes("paloalto")) {
    return { stroke: "#FA582D", dot: "#FFEDD5", label: "Palo Alto Orange" };
  }

  // Fallback distinct vibrant hues for user custom roles
  const fallbacks = [
    { stroke: "#38BDF8", dot: "#E0F2FE", label: "Sky Blue" },
    { stroke: "#34D399", dot: "#D1FAE5", label: "Emerald" },
    { stroke: "#F43F5E", dot: "#FFE4E6", label: "Rose" },
    { stroke: "#F59E0B", dot: "#FEF3C7", label: "Amber" },
  ];
  return fallbacks[fallbackIndex % fallbacks.length];
}

// Multi-Role Competency XY Chart modeled directly after CompetencyXYChart in review report
function MultiRoleCompetencyChart({
  roles,
}: {
  roles: RoleComparisonResult[];
}) {
  const width = 760;
  const height = 290;
  const paddingLeft = 55;
  const paddingRight = 55;
  const paddingTop = 35;
  const paddingBottom = 45;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const benchmarkY = paddingTop + chartHeight - (70 / 100) * chartHeight;
  const yTicks = [0, 25, 50, 75, 100];

  const series = roles.map((role, idx) => {
    const probability = calculateRoleProbability(role);
    const color = getCompanyBrandColors(role.company || role.title, idx);

    const points = CHART_AXES.map((axis, i) => {
      let score = 70;
      if (axis.key === "roleFit") score = role.dimensions.roleFit;
      else if (axis.key === "skills") score = role.dimensions.skillsAndEvidence;
      else if (axis.key === "ats") score = role.atsKeywordCoverage;
      else if (axis.key === "impact") score = role.dimensions.impactAndClarity;
      else if (axis.key === "probability") score = probability;

      const safeScore = Math.min(100, Math.max(0, score));
      const x = paddingLeft + (i / (CHART_AXES.length - 1)) * chartWidth;
      const y = paddingTop + chartHeight - (safeScore / 100) * chartHeight;

      return { x, y, score: safeScore, name: axis.name };
    });

    const linePath = points.reduce((acc, p, i) => {
      return i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
    }, "");

    return { role, color, points, linePath, probability, isTop: idx === 0 };
  });

  return (
    <div className="w-full space-y-4">
      {/* Chart Header & Legend with Authentic Company Logos and Brand Colors */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-border">
        <h4 className="text-xs font-bold text-text-muted font-mono uppercase tracking-wider">
          Competency Trajectory vs 70% Target
        </h4>
        <div className="flex flex-wrap items-center gap-3.5 text-xs font-mono">
          {series.map((s, idx) => (
            <div key={s.role.jobDescriptionId} className="flex items-center gap-1.5">
              <span className="w-3 h-1 inline-block rounded-xs" style={{ backgroundColor: s.color.stroke }} />
              <div className="p-0.5 rounded bg-surface-elevated border border-border shrink-0 inline-flex items-center justify-center">
                {getCompanyLogo(s.role.company || s.role.title, "w-3 h-3")}
              </div>
              <span className="text-text font-medium">
                #{idx + 1} {s.role.company} ({s.role.overallScore}%)
              </span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 border-t border-dashed border-text-muted inline-block" />
            <span className="text-text-muted">70% Target</span>
          </div>
        </div>
      </div>

      {/* SVG Canvas with ample breathing space */}
      <div className="w-full overflow-x-auto bg-surface border border-border rounded-xl p-3 sm:p-6 shadow-xs">
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

          {/* Distinct Lines for each role in company brand color */}
          {series.map((s, idx) => (
            <path
              key={s.role.jobDescriptionId}
              d={s.linePath}
              fill="none"
              stroke={s.color.stroke}
              strokeWidth={idx === 0 ? "3" : "2"}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={idx === 0 ? 1 : 0.85}
            />
          ))}

          {/* Points for each role: clean coordinate markers without overlapping text clutter */}
          {series.map((s, sIdx) => (
            <g key={`dots-${s.role.jobDescriptionId}`}>
              {s.points.map((p, i) => {
                // If top series or spaced, show score label with staggered offset
                const textY = sIdx === 0 ? p.y - 10 : sIdx === 1 ? p.y + 16 : p.y - 12;
                return (
                  <g key={i}>
                    <title>{`${s.role.company} - ${p.name}: ${p.score}%`}</title>
                    <circle cx={p.x} cy={p.y} r={sIdx === 0 ? "5" : "4"} className="fill-white dark:fill-zinc-950" stroke={s.color.stroke} strokeWidth="2" />
                    <circle cx={p.x} cy={p.y} r={sIdx === 0 ? "2" : "1.5"} fill={s.color.dot} />
                    {sIdx === 0 && (
                      <text
                        x={p.x}
                        y={textY}
                        textAnchor="middle"
                        className="fill-zinc-900 dark:fill-white font-mono text-[10px] font-bold"
                      >
                        {p.score}%
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          ))}

          {/* Small Company Logo at the End Point of each trajectory line */}
          {series.map((s) => {
            const endPoint = s.points[s.points.length - 1];
            return (
              <foreignObject
                key={`logo-endpoint-${s.role.jobDescriptionId}`}
                x={endPoint.x + 8}
                y={endPoint.y - 10}
                width={24}
                height={24}
                className="overflow-visible"
              >
                <div
                  className="w-5 h-5 rounded-md bg-surface border shadow-2xs flex items-center justify-center p-0.5"
                  style={{ borderColor: s.color.stroke }}
                  title={`${s.role.company} (${s.role.overallScore}%)`}
                >
                  {getCompanyLogo(s.role.company || s.role.title, "w-3.5 h-3.5")}
                </div>
              </foreignObject>
            );
          })}

          {/* X Axis Labels */}
          {CHART_AXES.map((axis, i) => {
            const x = paddingLeft + (i / (CHART_AXES.length - 1)) * chartWidth;
            return (
              <text
                key={axis.key}
                x={x}
                y={paddingTop + chartHeight + 16}
                textAnchor="middle"
                className="fill-zinc-600 dark:fill-zinc-300 font-mono text-[10px] font-medium"
              >
                {axis.name}
              </text>
            );
          })}

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

      {/* Metric Delta Cards with Winning Company Logo */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-0.5">
        {CHART_AXES.map((axis) => {
          const topRole = roles[0];
          let score = 70;
          if (axis.key === "roleFit") score = topRole.dimensions.roleFit;
          else if (axis.key === "skills") score = topRole.dimensions.skillsAndEvidence;
          else if (axis.key === "ats") score = topRole.atsKeywordCoverage;
          else if (axis.key === "impact") score = topRole.dimensions.impactAndClarity;
          else if (axis.key === "probability") score = calculateRoleProbability(topRole);

          const delta = score - 70;
          const isAbove = delta >= 0;

          return (
            <div
              key={axis.key}
              className="p-2.5 bg-surface-elevated border border-border rounded-lg text-center space-y-0.5 shadow-2xs"
            >
              <div className="text-[11px] font-mono text-text-muted truncate flex items-center justify-center gap-1">
                {getCompanyLogo(topRole.company, "w-3 h-3 shrink-0")}
                <span>{axis.name}</span>
              </div>
              <div className="text-sm font-mono font-bold text-text">{score}%</div>
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

export default function ComparisonResultPage() {
  const router = useRouter();
  const [result, setResult] = useState<MultiJdComparisonResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedRoles, setExpandedRoles] = useState<Record<string, boolean>>({});

  const toggleRoleExpand = (id: string) => {
    setExpandedRoles((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const stored = sessionStorage.getItem("cookmycv_latest_comparison");
        if (stored) {
          const parsed = JSON.parse(stored) as MultiJdComparisonResult;
          if (parsed && Array.isArray(parsed.roles) && parsed.roles.length > 0) {
            setResult(parsed);
          }
        }
      } catch {
        // Fallback
      } finally {
        setLoading(false);
      }
    }, 0);

    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return <FullPageLoading />;
  }

  if (!result || !result.roles || result.roles.length === 0) {
    return (
      <div className="w-full max-w-4xl mx-auto px-4 py-16 text-center space-y-4">
        <h2 className="text-xl font-bold text-text font-mono">No Active Comparison Found</h2>
        <p className="text-sm text-text-muted">
          Please select your CV and target positions from the role compare page to run an evaluation.
        </p>
        <Link href="/comparisons">
          <Button variant="primary" size="md" className="font-semibold text-xs mt-2">
            ← Back to Role Compare
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-5">
      {/* Responsive Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border">
        <div className="flex items-center gap-3">
          <h1 className="text-lg sm:text-xl font-bold text-text tracking-tight font-mono">
            Role Comparison
          </h1>
          <Badge variant="purple" size="sm" className="font-mono text-[11px]">
            {result.roles.length} Positions Analyzed
          </Badge>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/comparisons")}
          className="text-xs font-semibold h-8.5 px-3 self-start sm:self-auto whitespace-nowrap"
        >
          ← Back to Role Compare
        </Button>
      </div>

      {/* Main Report Body */}
      <div className="space-y-5">
        {/* 1. Common Role Competency & Probability Curve Graph */}
        <div className="p-3 sm:p-5 bg-surface border border-border rounded-xl space-y-3 shadow-xs">
          <MultiRoleCompetencyChart roles={result.roles} />
        </div>

        {/* 2. Executive Summary & Winning Fit Bento */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="md:col-span-1 flex flex-col items-center justify-center p-5 text-center border-purple-500/80 bg-surface rounded-xl shadow-xs">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1.5 rounded-lg bg-surface-elevated border border-border shrink-0">
                {getCompanyLogo(result.recommendedRole.company, "w-4 h-4")}
              </div>
              <Badge variant="purple" size="sm" className="font-mono">
                Rank #1 Best Fit
              </Badge>
            </div>
            <ScoreRing
              score={result.roles[0]?.overallScore ?? 80}
              size={110}
              strokeWidth={9}
              label="Fit Score"
            />
            <div className="mt-3 space-y-0.5">
              <div className="text-sm font-bold text-text truncate max-w-[200px]">
                {result.recommendedRole.title}
              </div>
              <div className="text-xs text-purple-600 dark:text-purple-300 font-mono font-semibold">
                {result.recommendedRole.company}
              </div>
            </div>
          </Card>

          <Card className="md:col-span-2 border-border bg-surface rounded-xl shadow-xs">
            <CardHeader className="pb-2">
              <div className="text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 font-mono">
                Executive Comparison Summary
              </div>
              <CardTitle className="text-base font-bold text-text mt-1 flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-surface-elevated border border-border shrink-0 inline-flex items-center justify-center">
                  {getCompanyLogo(result.recommendedRole.company, "w-4 h-4")}
                </div>
                <span className="truncate">Winning Target: {result.recommendedRole.title}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-text-secondary leading-relaxed font-normal">
                <strong className="text-purple-700 dark:text-purple-300 font-semibold">Why this role: </strong>
                {result.recommendedRole.reason}
              </p>
              <p className="text-xs text-text-muted leading-relaxed font-mono">
                {result.comparisonSummary}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* 3. Side-by-Side Target Role Cards with Famous Company Logos Prominently Displayed */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {result.roles.map((role) => {
            const probability = calculateRoleProbability(role);
            const isExpanded = !!expandedRoles[role.jobDescriptionId];

            return (
              <Card
                key={role.jobDescriptionId}
                className={`flex flex-col justify-between rounded-xl ${
                  role.rank === 1
                    ? "border-2 border-purple-500 bg-surface shadow-md"
                    : "border-border bg-surface shadow-xs"
                }`}
              >
                {/* Prominent Company Header with Authentic Logo */}
                <div className="px-5 pt-4 pb-2 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-lg bg-surface-elevated border border-border shrink-0 flex items-center justify-center shadow-2xs">
                      {getCompanyLogo(role.company || role.title, "w-5 h-5")}
                    </div>
                    <div>
                      <span className="text-xs font-bold text-text font-mono block">
                        {role.company}
                      </span>
                      <span className="text-[10px] text-text-muted font-mono uppercase">
                        Target Organization
                      </span>
                    </div>
                  </div>
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded border border-purple-200 dark:border-purple-800/60 bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300">
                    {role.verdict}
                  </span>
                </div>

                <CardHeader className="pt-3 pb-2">
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant={role.rank === 1 ? "purple" : "neutral"} size="sm">
                      Rank #{role.rank}
                    </Badge>
                  </div>
                  <CardTitle className="text-base font-bold text-text truncate">
                    {role.title}
                  </CardTitle>
                </CardHeader>

                <CardContent className="space-y-4 pt-2 flex-1 flex flex-col justify-between">
                  {/* Fit Score & Probability Bento */}
                  <div className="flex items-center justify-around py-3 rounded-xl bg-surface-elevated border border-border shadow-2xs">
                    <div className="text-center">
                      <ScoreRing score={role.overallScore} size={70} strokeWidth={6} />
                      <span className="text-[10px] text-text-muted uppercase font-bold tracking-wider block mt-1 font-mono">
                        Fit Score
                      </span>
                    </div>
                    <div className="text-center">
                      <span className="text-2xl font-extrabold font-mono text-text block">
                        {role.atsKeywordCoverage}%
                      </span>
                      <span className="text-[10px] text-text-muted uppercase font-bold tracking-wider block mt-1 font-mono">
                        ATS Match
                      </span>
                    </div>
                    <div className="text-center">
                      <span className="text-2xl font-extrabold font-mono text-purple-600 dark:text-purple-300 block">
                        {probability}%
                      </span>
                      <span className="text-[10px] text-purple-600 dark:text-purple-400 uppercase font-bold tracking-wider block mt-1 font-mono">
                        Probability
                      </span>
                    </div>
                  </div>

                  {/* Dimension Scores (Simple, readable list with Company Logo) */}
                  <div className="space-y-2 text-xs font-mono bg-surface-elevated/70 p-3 rounded-lg border border-border">
                    <div className="flex items-center gap-2 pb-1.5 border-b border-border text-[11px] text-text-muted">
                      <div className="p-1 rounded bg-surface border border-border shrink-0 inline-flex items-center justify-center">
                        {getCompanyLogo(role.company || role.title, "w-3 h-3")}
                      </div>
                      <span className="font-semibold text-text truncate">{role.company} Breakdown</span>
                    </div>
                    <div className="flex justify-between items-center text-text-secondary pt-0.5">
                      <span>Role Fit</span>
                      <span className="font-bold text-text">{role.dimensions.roleFit}%</span>
                    </div>
                    <div className="flex justify-between items-center text-text-secondary">
                      <span>Technical Depth</span>
                      <span className="font-bold text-text">{role.dimensions.skillsAndEvidence}%</span>
                    </div>
                    <div className="flex justify-between items-center text-text-secondary">
                      <span>ATS Keyword Match</span>
                      <span className="font-bold text-text">{role.atsKeywordCoverage}%</span>
                    </div>
                    <div className="flex justify-between items-center text-text-secondary">
                      <span>Impact & Metrics</span>
                      <span className="font-bold text-text">{role.dimensions.impactAndClarity}%</span>
                    </div>
                  </div>

                  {/* Mobile Toggle Button (Simple, normal text button) */}
                  <button
                    type="button"
                    onClick={() => toggleRoleExpand(role.jobDescriptionId)}
                    className="sm:hidden w-full py-2 text-xs font-mono text-text-secondary hover:text-text font-semibold text-center border-t border-border mt-1 transition-colors cursor-pointer"
                  >
                    {isExpanded ? "Show less ↑" : "See more ↓"}
                  </button>

                  {/* Strengths, Gaps & Tailor Action: Always visible on desktop, toggled on mobile */}
                  <div className={`space-y-4 ${isExpanded ? "block" : "hidden sm:block"}`}>
                    {/* Strengths & Critical Gaps */}
                    <div className="space-y-3">
                      <div className="p-3.5 rounded-xl bg-surface-elevated border border-border space-y-1.5">
                        <span className="font-bold text-text block text-[11px] uppercase tracking-wider font-mono">
                          Key Strengths:
                        </span>
                        <ul className="space-y-1 text-xs text-text-secondary leading-relaxed font-sans">
                          {role.keyStrengths.map((str, i) => (
                            <li key={i} className="flex items-start gap-1.5">
                              <svg className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                              </svg>
                              <span>{str}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      {role.criticalGaps.length > 0 && (
                        <div className="p-3.5 rounded-xl bg-surface-elevated/70 border border-border space-y-1.5">
                          <span className="font-bold text-text-muted block text-[11px] uppercase tracking-wider font-mono">
                            Gaps to Address:
                          </span>
                          <ul className="space-y-1 text-xs text-text-muted leading-relaxed font-sans">
                            {role.criticalGaps.map((gap, i) => (
                              <li key={i} className="flex items-start gap-1.5">
                                <span className="text-text-muted font-bold shrink-0 mt-0.5">•</span>
                                <span>{gap}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    {/* Tailor CV Action Button */}
                    <div className="pt-2">
                      <Link href="/evaluations/new">
                        <Button
                          variant={role.rank === 1 ? "primary" : "outline"}
                          className={`w-full text-xs font-semibold h-9 rounded-lg whitespace-nowrap ${
                            role.rank === 1 ? "bg-purple-600 hover:bg-purple-500 text-white shadow-xs" : ""
                          }`}
                        >
                          Tailor CV for this Role →
                        </Button>
                      </Link>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
