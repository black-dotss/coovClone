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
  onFooterAction?: () => void;
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

function drawSolanaMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const grad = ctx.createLinearGradient(x, y, x + width, y + height);
  grad.addColorStop(0, "#00FFA3");
  grad.addColorStop(0.5, "#8A6BFF");
  grad.addColorStop(1, "#DC1FFF");
  ctx.fillStyle = grad;

  const barH = height * 0.22;
  const gap = (height - barH * 3) / 2;
  const skew = width * 0.16;

  // Top bar (slanted right)
  ctx.beginPath();
  ctx.moveTo(x + skew, y);
  ctx.lineTo(x + width, y);
  ctx.lineTo(x + width - skew, y + barH);
  ctx.lineTo(x, y + barH);
  ctx.closePath();
  ctx.fill();

  // Middle bar (slanted opposite)
  const midY = y + barH + gap;
  ctx.beginPath();
  ctx.moveTo(x, midY);
  ctx.lineTo(x + width - skew, midY);
  ctx.lineTo(x + width, midY + barH);
  ctx.lineTo(x + skew, midY + barH);
  ctx.closePath();
  ctx.fill();

  // Bottom bar (slanted right)
  const botY = y + (barH + gap) * 2;
  ctx.beginPath();
  ctx.moveTo(x + skew, botY);
  ctx.lineTo(x + width, botY);
  ctx.lineTo(x + width - skew, botY + barH);
  ctx.lineTo(x, botY + barH);
  ctx.closePath();
  ctx.fill();
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
 * Generates and downloads a high-resolution A4-proportioned (1240x1754) PNG
 * modeled after the sleek dark obsidian Solana Candidate Scorecard layout.
 */
async function downloadSolanaIdentityCardPng(props: SolanaIdentityCardProps) {
  const W = 1240;
  const H = 1754;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas rendering context is unavailable in this browser.");
  }

  // Deep obsidian background
  ctx.fillStyle = "#06060b";
  ctx.fillRect(0, 0, W, H);

  // Inner rounded card frame
  drawRoundedRect(ctx, 40, 40, W - 80, H - 80, 56);
  const bgGrad = ctx.createLinearGradient(0, 40, 0, H - 40);
  bgGrad.addColorStop(0, "#0a0812");
  bgGrad.addColorStop(0.55, "#07060b");
  bgGrad.addColorStop(1, "#0b0813");
  ctx.fillStyle = bgGrad;
  ctx.fill();

  // Purple ambient radial glow behind mascot + floor shadow
  ctx.save();
  ctx.clip();
  const bodyGlow = ctx.createRadialGradient(470, 620, 40, 470, 620, 540);
  bodyGlow.addColorStop(0, "rgba(168, 85, 247, 0.34)");
  bodyGlow.addColorStop(0.5, "rgba(147, 51, 234, 0.12)");
  bodyGlow.addColorStop(1, "rgba(7, 6, 11, 0)");
  ctx.fillStyle = bodyGlow;
  ctx.fillRect(0, 0, W, H);

  const floorGlow = ctx.createRadialGradient(470, 1020, 20, 470, 1020, 320);
  floorGlow.addColorStop(0, "rgba(192, 132, 252, 0.38)");
  floorGlow.addColorStop(0.45, "rgba(147, 51, 234, 0.14)");
  floorGlow.addColorStop(1, "rgba(7, 6, 11, 0)");
  ctx.fillStyle = floorGlow;
  ctx.fillRect(100, 820, 760, 320);
  ctx.restore();

  // Glowing purple outer border
  drawRoundedRect(ctx, 40, 40, W - 80, H - 80, 56);
  const borderGrad = ctx.createLinearGradient(40, 40, W - 40, H - 40);
  borderGrad.addColorStop(0, "rgba(192, 132, 252, 0.72)");
  borderGrad.addColorStop(0.5, "rgba(139, 92, 246, 0.45)");
  borderGrad.addColorStop(1, "rgba(168, 85, 247, 0.68)");
  ctx.lineWidth = 4;
  ctx.strokeStyle = borderGrad;
  ctx.stroke();

  // Header Left: Solana 3-bar gradient mark
  drawSolanaMark(ctx, 104, 106, 92, 74);

  // Header Right: Pill badge "Candidate ID · Devnet"
  const topPillText = `${props.badgeLabel} · ${props.clusterLabel}`;
  ctx.font = "600 28px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  const topPillW = Math.min(540, ctx.measureText(topPillText).width + 110);
  const topPillX = W - 104 - topPillW;
  drawRoundedRect(ctx, topPillX, 104, topPillW, 72, 36);
  ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(192, 132, 252, 0.28)";
  ctx.stroke();

  // Small purple user silhouette in header pill
  ctx.fillStyle = "#c084fc";
  ctx.beginPath();
  ctx.arc(topPillX + 44, 132, 8.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(topPillX + 44, 156, 14, Math.PI, 0);
  ctx.fill();

  ctx.fillStyle = "#e4e4e7";
  ctx.fillText(topPillText, topPillX + 74, 149);

  // Mascot Artwork (left/center hero) + subtle purple accent sparks
  try {
    const dollImg = await loadImage("/doll/sol.png");
    const maxDollW = 680;
    const maxDollH = 820;
    const scale = Math.min(maxDollW / dollImg.width, maxDollH / dollImg.height);
    const drawW = dollImg.width * scale;
    const drawH = dollImg.height * scale;
    const dollX = 130 + (maxDollW - drawW) / 2;
    const dollY = 210 + (maxDollH - drawH) / 2;

    ctx.save();
    ctx.shadowColor = "rgba(168, 85, 247, 0.45)";
    ctx.shadowBlur = 46;
    ctx.drawImage(dollImg, dollX, dollY, drawW, drawH);
    ctx.restore();

    // Two playful purple accent ticks floating beside mascot hair
    ctx.save();
    ctx.fillStyle = "#a855f7";
    ctx.beginPath();
    ctx.roundRect(dollX + drawW * 0.78, dollY + 120, 18, 76, 9);
    ctx.fill();
    ctx.translate(dollX + drawW * 0.87, dollY + 160);
    ctx.rotate(0.48);
    ctx.beginPath();
    ctx.roundRect(0, 0, 18, 66, 9);
    ctx.fill();
    ctx.restore();
  } catch {
    ctx.fillStyle = "#c084fc";
    ctx.font = "800 38px sans-serif";
    ctx.fillText("SOLANA CREDENTIAL", 140, 620);
  }

  // Right-side Giant Score Stack
  ctx.textAlign = "center";
  const scoreCenterX = W - 246;
  ctx.fillStyle = "#e4e4e7";
  ctx.font = "600 28px system-ui, -apple-system, sans-serif";
  ctx.fillText("S C O R E", scoreCenterX, 558);

  const scoreGrad = ctx.createLinearGradient(scoreCenterX, 595, scoreCenterX, 765);
  scoreGrad.addColorStop(0, "#d8b4fe");
  scoreGrad.addColorStop(0.6, "#c084fc");
  scoreGrad.addColorStop(1, "#9333ea");
  ctx.fillStyle = scoreGrad;
  ctx.font = "900 212px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(`${props.score}`, scoreCenterX, 756);

  ctx.fillStyle = "#e4e4e7";
  ctx.font = "500 40px system-ui, -apple-system, sans-serif";
  ctx.fillText("/  100", scoreCenterX, 830);
  ctx.textAlign = "left";

  // Lower Credential & Role Section
  let cursorY = 1138;
  // Shield-check icon
  ctx.save();
  ctx.fillStyle = "#c084fc";
  ctx.beginPath();
  ctx.moveTo(126, cursorY - 28);
  ctx.lineTo(146, cursorY - 21);
  ctx.lineTo(146, cursorY - 5);
  ctx.quadraticCurveTo(146, cursorY + 12, 126, cursorY + 18);
  ctx.quadraticCurveTo(106, cursorY + 12, 106, cursorY - 5);
  ctx.lineTo(106, cursorY - 21);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#07060b";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(118, cursorY - 6);
  ctx.lineTo(124, cursorY);
  ctx.lineTo(135, cursorY - 12);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = "#d4d4d8";
  ctx.font = "600 28px system-ui, -apple-system, sans-serif";
  ctx.fillText("V E R I F I E D   C R E D E N T I A L", 174, cursorY + 2);

  cursorY += 86;
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 58px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  const roleLines = wrapCanvasText(
    ctx,
    props.roleTitle || "Solana Candidate",
    W - 208
  ).slice(0, 2);
  for (const line of roleLines) {
    ctx.fillText(line, 104, cursorY);
    cursorY += 72;
  }

  // Anchored Audits / Score Tier Rounded Pill
  const pillLabel = props.scoreTier || props.subtitle || "1 Anchored Audits";
  const pillY = cursorY + 22;
  ctx.font = "500 28px system-ui, -apple-system, sans-serif";
  const pillW = Math.min(W - 208, ctx.measureText(pillLabel).width + 136);
  drawRoundedRect(ctx, 104, pillY, pillW, 74, 37);
  ctx.fillStyle = "rgba(168, 85, 247, 0.08)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(192, 132, 252, 0.34)";
  ctx.stroke();

  // Monitor icon inside pill
  ctx.strokeStyle = "#c084fc";
  ctx.lineWidth = 3;
  drawRoundedRect(ctx, 138, pillY + 22, 30, 21, 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(134, pillY + 50);
  ctx.lineTo(172, pillY + 50);
  ctx.stroke();

  ctx.fillStyle = "#d8b4fe";
  ctx.fillText(pillLabel, 190, pillY + 46);

  // Footer Row: Solana Mark + SOLANA DEVNET | Link Pill Button
  const footerY = H - 150;
  drawSolanaMark(ctx, 104, footerY, 64, 52);

  ctx.fillStyle = "#e4e4e7";
  ctx.font = "500 26px system-ui, -apple-system, sans-serif";
  ctx.fillText(
    `S O L A N A   ${props.clusterLabel.toUpperCase().split("").join(" ")}`,
    194,
    footerY + 35
  );

  const actionText = props.issuedLabel || "Link Wallet";
  ctx.font = "600 28px system-ui, -apple-system, sans-serif";
  const actionW = Math.min(440, ctx.measureText(actionText).width + 146);
  const actionX = W - 104 - actionW;
  drawRoundedRect(ctx, actionX, footerY - 12, actionW, 78, 39);
  ctx.fillStyle = "rgba(168, 85, 247, 0.08)";
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "rgba(168, 85, 247, 0.7)";
  ctx.stroke();

  // Chain link icon
  ctx.strokeStyle = "#c084fc";
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.arc(actionX + 48, footerY + 30, 9, Math.PI * 0.4, Math.PI * 1.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(actionX + 60, footerY + 22, 9, -Math.PI * 0.6, Math.PI * 0.6);
  ctx.stroke();

  ctx.fillStyle = "#d8b4fe";
  ctx.fillText(actionText, actionX + 86, footerY + 36);

  // Right chevron ">"
  ctx.strokeStyle = "#d8b4fe";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(actionX + actionW - 44, footerY + 18);
  ctx.lineTo(actionX + actionW - 34, footerY + 27);
  ctx.lineTo(actionX + actionW - 44, footerY + 36);
  ctx.stroke();

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

const SolanaGradientLogo: React.FC<{ className?: string; gradId: string }> = ({
  className = "w-7 h-6",
  gradId,
}) => (
  <svg viewBox="0 0 397.7 311.7" fill="none" className={className} aria-hidden="true">
    <defs>
      <linearGradient id={gradId} x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#DC1FFF" />
        <stop offset="50%" stopColor="#8A6BFF" />
        <stop offset="100%" stopColor="#00FFA3" />
      </linearGradient>
    </defs>
    <path
      d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z"
      fill={`url(#${gradId})`}
    />
    <path
      d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z"
      fill={`url(#${gradId})`}
    />
    <path
      d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z"
      fill={`url(#${gradId})`}
    />
  </svg>
);

/**
 * Sleek dark obsidian portrait A4-proportioned Solana Identity Card modeled after
 * the Solana Devnet Candidate Scorecard layout, with matching high-res PNG export.
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

  const pillLabel = props.scoreTier || props.subtitle || "1 Anchored Audits";
  const footerActionText = props.issuedLabel || "Link Wallet";

  return (
    <div className="space-y-3">
      {/* Sleek Dark Portrait A4-aspect (210 : 297) Identity Scorecard */}
      <div className="w-full max-w-[380px] mx-auto aspect-[210/297] rounded-[26px] border border-purple-500/55 bg-[#07060b] p-5 sm:p-6 flex flex-col justify-between shadow-[0_0_38px_rgba(168,85,247,0.2)] relative overflow-hidden text-white">
        {/* Ambient Purple Glow Background */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 75% 55% at 42% 42%, rgba(168,85,247,0.22), rgba(147,51,234,0.06) 55%, transparent 80%)",
          }}
        />

        {/* Top Header: Solana Gradient Mark + Candidate Pill */}
        <div className="relative z-10 flex items-center justify-between gap-2">
          <SolanaGradientLogo gradId="coovSolLogoTop" className="w-7 h-6 shrink-0" />
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-purple-400/25 bg-white/[0.04] text-[11px] font-medium text-zinc-200">
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              className="w-3.5 h-3.5 text-purple-400 shrink-0"
              aria-hidden="true"
            >
              <path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.4 0-8 2.2-8 5v1.5c0 .3.2.5.5.5h15c.3 0 .5-.2.5-.5V19c0-2.8-3.6-5-8-5Z" />
            </svg>
            <span className="truncate max-w-[175px]">
              {props.badgeLabel} · {props.clusterLabel}
            </span>
          </div>
        </div>

        {/* Centerpiece: Enlarged Borderless Solana Mascot + Giant Score */}
        <div className="relative z-10 my-1 flex-1 min-h-0 flex items-center justify-between gap-1">
          <div className="flex-1 min-w-0 h-full flex items-center justify-center relative">
            {/* Soft Violet Floor & Halo Aura */}
            <div
              className="absolute inset-x-4 bottom-2 h-10 rounded-full blur-xl pointer-events-none"
              style={{ background: "rgba(168, 85, 247, 0.45)" }}
            />
            {/* Playful Purple Accent Ticks */}
            <div className="relative w-full h-full flex items-center justify-center">
              <div className="hidden sm:flex items-end gap-1.5 absolute top-[18%] right-[8%] pointer-events-none">
                <span className="w-1 h-5 rounded-full bg-purple-400 rotate-12" />
                <span className="w-1 h-3.5 rounded-full bg-purple-500 rotate-[38deg]" />
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/doll/sol.png"
                alt="COOV Solana Credential Mascot"
                className="relative w-full h-full max-h-[260px] object-contain drop-shadow-[0_14px_30px_rgba(168,85,247,0.42)]"
              />
            </div>
          </div>

          <div className="shrink-0 text-center pr-1 flex flex-col items-center justify-center">
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-300 block mb-1">
              Score
            </span>
            <span className="text-[64px] sm:text-[74px] font-black leading-[0.88] tracking-tight bg-gradient-to-b from-purple-300 via-purple-400 to-purple-500 bg-clip-text text-transparent">
              {props.score}
            </span>
            <span className="text-xs sm:text-sm font-medium tracking-[0.12em] text-zinc-200 mt-1.5">
              / 100
            </span>
          </div>
        </div>

        {/* Lower Metadata & Footer */}
        <div className="relative z-10 space-y-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5">
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-4 h-4 text-purple-400 shrink-0"
                aria-hidden="true"
              >
                <path d="M12 2 4 5.5v6c0 5.2 3.4 9.9 8 11.5 4.6-1.6 8-6.3 8-11.5v-6L12 2Zm-1.1 13.3-3.2-3.2 1.4-1.4 1.8 1.8 4.4-4.4 1.4 1.4-5.8 5.8Z" />
              </svg>
              <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-300">
                Verified Credential
              </span>
            </div>

            <h4 className="text-lg sm:text-[21px] font-extrabold text-white leading-snug tracking-tight line-clamp-2">
              {props.roleTitle || "Solana Candidate"}
            </h4>

            <div>
              <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-purple-400/25 bg-purple-950/35 text-xs font-medium text-purple-200 max-w-full">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="w-3.5 h-3.5 text-purple-400 shrink-0"
                  aria-hidden="true"
                >
                  <rect x="3" y="4" width="18" height="12" rx="2" />
                  <path d="M7 20h10M12 16v4" />
                </svg>
                <span className="truncate">{pillLabel}</span>
              </span>
            </div>
          </div>

          {/* Bottom Stamp + Action Pill */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="inline-flex items-center gap-2 min-w-0">
              <SolanaGradientLogo gradId="coovSolLogoBottom" className="w-5 h-4 shrink-0" />
              <span className="text-[10px] sm:text-[11px] font-medium tracking-[0.2em] uppercase text-zinc-300 truncate">
                Solana {props.clusterLabel}
              </span>
            </div>

            {props.onFooterAction ? (
              <button
                type="button"
                onClick={props.onFooterAction}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-purple-500/60 bg-purple-500/[0.08] hover:bg-purple-500/20 transition-colors text-xs font-semibold text-purple-300 cursor-pointer shrink-0"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="w-3.5 h-3.5 shrink-0"
                  aria-hidden="true"
                >
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                <span>{footerActionText}</span>
                <span aria-hidden="true" className="text-purple-300">
                  ›
                </span>
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-purple-500/60 bg-purple-500/[0.08] text-xs font-semibold text-purple-300 shrink-0">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="w-3.5 h-3.5 shrink-0"
                  aria-hidden="true"
                >
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                <span>{footerActionText}</span>
                <span aria-hidden="true" className="text-purple-300">
                  ›
                </span>
              </span>
            )}
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
