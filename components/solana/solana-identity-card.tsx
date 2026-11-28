"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";

export interface SolanaIdentityCardProps {
  badgeLabel: string;
  clusterLabel: string;
  roleTitle: string;
  score: number;
  scoreTier?: string | null;
  subtitle?: string | null;
  verifiedSkills?: string[];
  issuedLabel?: string | null;
  downloadFileName?: string;
  onDownloadError?: (message: string) => void;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Unable to load artwork (${src})`));
    img.src = src;
  });
}

/**
 * Generates and downloads a bold, clean portrait A4-proportioned (1240x1754) PNG
 * of the On-Chain & SBT Solana Identity Card featuring the enlarged `/doll/sol.png`.
 */
async function downloadSolanaIdentityCardPng(props: SolanaIdentityCardProps) {
  // Portrait A4 proportion (210 : 297)
  const W = 1240;
  const H = 1754;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas rendering context is unavailable in this browser.");
  }

  // Background
  ctx.fillStyle = "#09090d";
  ctx.fillRect(0, 0, W, H);

  // Subtle ambient purple glow
  const glow = ctx.createRadialGradient(W / 2, 560, 40, W / 2, 560, 620);
  glow.addColorStop(0, "rgba(168, 85, 247, 0.28)");
  glow.addColorStop(0.55, "rgba(168, 85, 247, 0.08)");
  glow.addColorStop(1, "rgba(9, 9, 13, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Bold outer card frame
  drawRoundedRect(ctx, 48, 48, W - 96, H - 96, 36);
  ctx.fillStyle = "#111118";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(168, 85, 247, 0.65)";
  ctx.stroke();

  // Header
  ctx.fillStyle = "#c084fc";
  ctx.font = "800 30px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("COOV × SOLANA", 104, 132);

  const badgeText = `${props.badgeLabel.toUpperCase()} · ${props.clusterLabel.toUpperCase()}`;
  ctx.font = "700 22px ui-monospace, SFMono-Regular, Menlo, monospace";
  const badgeW = Math.min(480, ctx.measureText(badgeText).width + 48);
  drawRoundedRect(ctx, W - 104 - badgeW, 92, badgeW, 56, 14);
  ctx.fillStyle = "#1a1a24";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(168, 85, 247, 0.55)";
  ctx.stroke();
  ctx.fillStyle = "#e4e4e7";
  ctx.fillText(badgeText, W - 104 - badgeW + 24, 128);

  // Borderless Enlarged Mascot + Aligned Giant Score Showcase
  const showcaseGlow = ctx.createRadialGradient(420, 560, 40, 420, 560, 340);
  showcaseGlow.addColorStop(0, "rgba(168, 85, 247, 0.28)");
  showcaseGlow.addColorStop(1, "rgba(17, 17, 24, 0)");
  ctx.fillStyle = showcaseGlow;
  ctx.fillRect(80, 190, 700, 740);

  try {
    const dollImg = await loadImage("/doll/sol.png");
    const maxDollW = 640;
    const maxDollH = 680;
    const scale = Math.min(maxDollW / dollImg.width, maxDollH / dollImg.height);
    const drawW = dollImg.width * scale;
    const drawH = dollImg.height * scale;
    ctx.drawImage(
      dollImg,
      96 + (maxDollW - drawW) / 2,
      210 + (maxDollH - drawH) / 2,
      drawW,
      drawH
    );
  } catch {
    ctx.fillStyle = "#a855f7";
    ctx.font = "800 36px sans-serif";
    ctx.fillText("SOLANA CREDENTIAL", 120, 560);
  }

  // Giant Score aligned beside the mascot (borderless)
  ctx.textAlign = "right";
  ctx.fillStyle = "#a1a1aa";
  ctx.font = "700 26px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("SCORE", W - 104, 430);

  ctx.fillStyle = "#c084fc";
  ctx.font = "900 184px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(`${props.score}`, W - 104, 608);

  ctx.fillStyle = "#71717a";
  ctx.font = "700 44px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("/ 100", W - 104, 672);
  ctx.textAlign = "left";

  // Bold Role Title & Metadata Section
  let cursorY = 980;
  ctx.fillStyle = "#a1a1aa";
  ctx.font = "700 22px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("VERIFIED CREDENTIAL", 104, cursorY);

  cursorY += 66;
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 54px system-ui, -apple-system, sans-serif";
  const roleLines = wrapCanvasText(ctx, props.roleTitle || "Solana Candidate", W - 208).slice(0, 2);
  for (const line of roleLines) {
    ctx.fillText(line, 104, cursorY);
    cursorY += 64;
  }

  const metaLineY = Math.max(cursorY + 24, 1185);
  const subParts = [props.scoreTier, props.subtitle].filter(Boolean);
  if (subParts.length > 0) {
    ctx.fillStyle = "#c084fc";
    ctx.font = "700 28px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(subParts.join("  ·  ").slice(0, 56), 104, metaLineY);
  }

  // Verified Skills Row
  let nextY = metaLineY + 76;
  const skills = (props.verifiedSkills ?? []).slice(0, 6);
  if (skills.length > 0) {
    ctx.fillStyle = "#a1a1aa";
    ctx.font = "700 22px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText("VERIFIED SKILLS", 104, nextY);
    nextY += 34;

    let chipX = 104;
    ctx.font = "700 24px ui-monospace, SFMono-Regular, Menlo, monospace";
    for (const skill of skills) {
      const label = skill.slice(0, 22);
      const chipW = ctx.measureText(label).width + 44;
      if (chipX + chipW > W - 104) {
        chipX = 104;
        nextY += 68;
      }
      drawRoundedRect(ctx, chipX, nextY, chipW, 52, 12);
      ctx.fillStyle = "#171722";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#2e2e3d";
      ctx.stroke();
      ctx.fillStyle = "#f4f4f5";
      ctx.fillText(label, chipX + 22, nextY + 34);
      chipX += chipW + 16;
    }
  }

  // Bold Bottom Divider & Stamp
  ctx.beginPath();
  ctx.moveTo(104, H - 156);
  ctx.lineTo(W - 104, H - 156);
  ctx.strokeStyle = "#272733";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "#a1a1aa";
  ctx.font = "700 22px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(`COOV PROTOCOL · SOLANA ${props.clusterLabel.toUpperCase()}`, 104, H - 100);

  if (props.issuedLabel) {
    const issued = props.issuedLabel.toUpperCase();
    const w = ctx.measureText(issued).width;
    ctx.fillStyle = "#c084fc";
    ctx.fillText(issued, W - 104 - w, H - 100);
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png", 1.0)
  );
  if (!blob) {
    throw new Error("Could not encode PNG image for card download.");
  }

  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  const safeSlug = (props.roleTitle || "solana-id")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  a.download = props.downloadFileName || `coov-${safeSlug || "solana"}-card.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}

/**
 * Simple, bold portrait A4-proportioned On-Chain & SBT Identity Card featuring
 * an enlarged `/doll/sol.png` centerpiece and portrait PNG export.
 */
export function SolanaIdentityCard(props: SolanaIdentityCardProps) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadSolanaIdentityCardPng(props);
    } catch (err) {
      props.onDownloadError?.(
        err instanceof Error ? err.message : "Failed to download identity card."
      );
    } finally {
      setDownloading(false);
    }
  };

  const skills = (props.verifiedSkills ?? []).slice(0, 6);

  return (
    <div className="space-y-3">
      {/* Bold Portrait A4-aspect (210 : 297) Identity Card */}
      <div className="w-full max-w-[380px] mx-auto aspect-[210/297] rounded-2xl border-2 border-purple-500/50 bg-surface p-5 sm:p-6 flex flex-col justify-between shadow-xl relative overflow-hidden">
        {/* Top Header */}
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-border">
          <span className="text-[11px] font-mono font-extrabold tracking-wider uppercase text-purple-400">
            COOV × SOLANA
          </span>
          <span className="px-2.5 py-0.5 text-[10px] font-mono font-bold rounded-md bg-surface-elevated border border-border text-text">
            {props.badgeLabel} · {props.clusterLabel}
          </span>
        </div>

        {/* Borderless Enlarged Solana Doll + Aligned Giant Score */}
        <div className="my-2 flex-1 min-h-0 flex items-center justify-between gap-2 relative">
          <div className="flex-1 min-w-0 h-full flex items-center justify-center relative">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(168,85,247,0.22),transparent_70%)] pointer-events-none" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/doll/sol.png"
              alt="COOV Solana Credential Mascot"
              className="relative w-full h-full max-h-[250px] object-contain drop-shadow-[0_16px_32px_rgba(168,85,247,0.4)]"
            />
          </div>

          <div className="shrink-0 text-right pr-1 flex flex-col justify-center">
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-text-muted block mb-1">
              Score
            </span>
            <span className="text-5xl sm:text-6xl font-black font-mono text-purple-400 leading-none tracking-tight">
              {props.score}
            </span>
            <span className="text-sm font-mono font-bold text-text-muted mt-1">
              / 100
            </span>
          </div>
        </div>

        {/* Bold Role Title Block */}
        <div className="space-y-3">
          <div className="min-w-0 space-y-1">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-text-muted block">
              Verified Credential
            </span>
            <h4 className="text-base sm:text-lg font-extrabold text-text leading-tight line-clamp-2">
              {props.roleTitle || "Solana Candidate"}
            </h4>
            {(props.scoreTier || props.subtitle) && (
              <p className="text-xs font-mono font-semibold text-purple-400 truncate">
                {[props.scoreTier, props.subtitle].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>

          {/* Skills */}
          {skills.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {skills.slice(0, 4).map((skill) => (
                <span
                  key={skill}
                  className="px-2 py-0.5 text-[11px] font-mono font-semibold rounded-md bg-surface-elevated border border-border text-text-secondary truncate max-w-[140px]"
                >
                  {skill}
                </span>
              ))}
            </div>
          )}

          {/* Minimal Bold Stamp Footer */}
          <div className="flex items-center justify-between text-[10px] font-mono font-bold pt-3 border-t border-border">
            <span className="text-text-muted">SOLANA {props.clusterLabel.toUpperCase()}</span>
            <span className="text-purple-400">{props.issuedLabel || "VERIFIED ID"}</span>
          </div>
        </div>
      </div>

      {/* Download Card CTA */}
      <div className="max-w-[380px] mx-auto">
        <Button
          type="button"
          variant="primary"
          size="md"
          isLoading={downloading}
          onClick={() => void handleDownload()}
          className="w-full font-bold"
        >
          {downloading ? "Rendering Card PNG..." : "Download Card (PNG)"}
        </Button>
      </div>
    </div>
  );
}
