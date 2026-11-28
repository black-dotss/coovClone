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
  walletAddress?: string | null;
  primaryIdLabel?: string;
  primaryIdValue?: string | null;
  secondaryIdLabel?: string;
  secondaryIdValue?: string | null;
  hashLabel?: string;
  hashValue?: string | null;
  verifiedSkills?: string[];
  issuedLabel?: string | null;
  downloadFileName?: string;
  onDownloadError?: (message: string) => void;
}

function truncateMiddle(value: string, head = 8, tail = 8): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
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
 * Generates and downloads a portrait A4-proportioned (1240x1754) PNG of the
 * On-Chain & SBT Solana Identity Card.
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

  // Subtle top radial glow
  const glow = ctx.createRadialGradient(W / 2, 470, 40, W / 2, 470, 560);
  glow.addColorStop(0, "rgba(168, 85, 247, 0.24)");
  glow.addColorStop(0.55, "rgba(168, 85, 247, 0.07)");
  glow.addColorStop(1, "rgba(9, 9, 13, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Outer card frame
  drawRoundedRect(ctx, 48, 48, W - 96, H - 96, 36);
  ctx.fillStyle = "#111118";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(168, 85, 247, 0.55)";
  ctx.stroke();

  // Inner header bar
  ctx.fillStyle = "#c084fc";
  ctx.font = "700 26px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("COOV × SOLANA IDENTITY CARD", 104, 128);

  const badgeText = `${props.badgeLabel.toUpperCase()} · ${props.clusterLabel.toUpperCase()}`;
  ctx.font = "700 22px ui-monospace, SFMono-Regular, Menlo, monospace";
  const badgeW = Math.min(480, ctx.measureText(badgeText).width + 44);
  drawRoundedRect(ctx, W - 104 - badgeW, 92, badgeW, 52, 12);
  ctx.fillStyle = "#1a1a24";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(168, 85, 247, 0.5)";
  ctx.stroke();
  ctx.fillStyle = "#e4e4e7";
  ctx.fillText(badgeText, W - 104 - badgeW + 22, 125);

  // Header divider
  ctx.beginPath();
  ctx.moveTo(104, 168);
  ctx.lineTo(W - 104, 168);
  ctx.strokeStyle = "#272733";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Large Mascot Showcase Frame
  drawRoundedRect(ctx, 104, 204, W - 208, 600, 28);
  ctx.fillStyle = "#151520";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#272733";
  ctx.stroke();

  const showcaseGlow = ctx.createRadialGradient(W / 2, 504, 30, W / 2, 504, 290);
  showcaseGlow.addColorStop(0, "rgba(168, 85, 247, 0.25)");
  showcaseGlow.addColorStop(1, "rgba(21, 21, 32, 0)");
  ctx.fillStyle = showcaseGlow;
  ctx.fillRect(104, 204, W - 208, 600);

  try {
    const dollImg = await loadImage("/doll/sol.png");
    const boxSize = 520;
    const scale = Math.min(boxSize / dollImg.width, boxSize / dollImg.height);
    const drawW = dollImg.width * scale;
    const drawH = dollImg.height * scale;
    ctx.drawImage(
      dollImg,
      (W - drawW) / 2,
      204 + (600 - drawH) / 2,
      drawW,
      drawH
    );
  } catch {
    ctx.fillStyle = "#a855f7";
    ctx.font = "700 32px sans-serif";
    ctx.fillText("SOLANA CREDENTIAL", W / 2 - 170, 504);
  }

  // Role & Score Block
  let cursorY = 865;
  ctx.fillStyle = "#a1a1aa";
  ctx.font = "700 22px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("VERIFIED ROLE / CREDENTIAL", 104, cursorY);

  cursorY += 54;
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 44px system-ui, -apple-system, sans-serif";
  const roleLines = wrapCanvasText(ctx, props.roleTitle || "Solana Candidate", 700).slice(0, 2);
  for (const line of roleLines) {
    ctx.fillText(line, 104, cursorY);
    cursorY += 54;
  }

  // Score Box on right
  drawRoundedRect(ctx, W - 364, 836, 260, 148, 22);
  ctx.fillStyle = "#171722";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(168, 85, 247, 0.65)";
  ctx.stroke();

  ctx.fillStyle = "#a1a1aa";
  ctx.font = "700 20px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("SCORE", W - 332, 876);

  ctx.fillStyle = "#c084fc";
  ctx.font = "800 68px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(`${props.score}`, W - 332, 950);

  ctx.fillStyle = "#71717a";
  ctx.font = "700 28px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("/100", W - 224, 950);

  const metaLineY = Math.max(cursorY + 8, 1018);
  const subParts = [props.scoreTier, props.subtitle, props.issuedLabel].filter(Boolean);
  if (subParts.length > 0) {
    ctx.fillStyle = "#c084fc";
    ctx.font = "600 24px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(subParts.join("  ·  ").slice(0, 68), 104, metaLineY);
  }

  // Verified Skills Row
  let nextY = metaLineY + 58;
  const skills = (props.verifiedSkills ?? []).slice(0, 6);
  if (skills.length > 0) {
    ctx.fillStyle = "#a1a1aa";
    ctx.font = "700 20px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText("VERIFIED SKILLS", 104, nextY);
    nextY += 26;

    let chipX = 104;
    ctx.font = "600 22px ui-monospace, SFMono-Regular, Menlo, monospace";
    for (const skill of skills) {
      const label = skill.slice(0, 22);
      const chipW = ctx.measureText(label).width + 36;
      if (chipX + chipW > W - 104) {
        chipX = 104;
        nextY += 56;
      }
      drawRoundedRect(ctx, chipX, nextY, chipW, 44, 10);
      ctx.fillStyle = "#171722";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#2e2e3d";
      ctx.stroke();
      ctx.fillStyle = "#e4e4e7";
      ctx.fillText(label, chipX + 18, nextY + 29);
      chipX += chipW + 14;
    }
    nextY += 86;
  } else {
    nextY += 24;
  }

  // Cryptographic Proof Box
  const proofTop = Math.max(nextY, 1210);
  const proofH = 380;
  drawRoundedRect(ctx, 104, proofTop, W - 208, proofH, 22);
  ctx.fillStyle = "#14141d";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#272733";
  ctx.stroke();

  const rows: Array<{ label: string; value: string }> = [
    {
      label: "WALLET",
      value: props.walletAddress || "Not connected",
    },
    {
      label: (props.primaryIdLabel || "ON-CHAIN PDA").toUpperCase(),
      value: props.primaryIdValue || "Pending anchor",
    },
    {
      label: (props.secondaryIdLabel || "SBT CREDENTIAL").toUpperCase(),
      value: props.secondaryIdValue || (props.score >= 85 ? "Eligible (>= 85/100)" : "Score 85/100+ for SBT"),
    },
    {
      label: (props.hashLabel || "SHA-256 FINGERPRINT").toUpperCase(),
      value: props.hashValue || "Pending computation",
    },
  ];

  let rowY = proofTop + 56;
  for (const row of rows) {
    ctx.fillStyle = "#71717a";
    ctx.font = "700 18px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(row.label, 140, rowY);

    ctx.fillStyle = "#f4f4f5";
    ctx.font = "500 22px ui-monospace, SFMono-Regular, Menlo, monospace";
    const clipped = row.value.length > 62 ? truncateMiddle(row.value, 28, 28) : row.value;
    ctx.fillText(clipped, 140, rowY + 32);
    rowY += 86;
  }

  // Footer strip
  ctx.fillStyle = "#71717a";
  ctx.font = "700 20px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(`COOV PROTOCOL · SOLANA ${props.clusterLabel.toUpperCase()} ATTESTATION`, 104, H - 86);

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
 * Portrait A4-proportioned On-Chain & SBT Identity Card featuring `/doll/sol.png`
 * and crisp one-click portrait PNG export.
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
      {/* Portrait A4-aspect (210 : 297) Identity Card */}
      <div className="w-full max-w-[380px] mx-auto aspect-[210/297] rounded-2xl border border-purple-500/40 bg-surface p-5 flex flex-col justify-between shadow-xl relative overflow-hidden">
        {/* Top Header */}
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-border">
          <span className="text-[10px] font-mono font-bold tracking-wider uppercase text-purple-400">
            COOV × SOLANA ID
          </span>
          <span className="px-2 py-0.5 text-[10px] font-mono rounded-md bg-surface-elevated border border-border text-text">
            {props.badgeLabel} · {props.clusterLabel}
          </span>
        </div>

        {/* Enlarged Solana Doll Centerpiece */}
        <div className="my-3 flex-1 min-h-0 rounded-xl border border-border bg-surface-elevated flex items-center justify-center p-3 relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(168,85,247,0.18),transparent_70%)] pointer-events-none" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/doll/sol.png"
            alt="COOV Solana Credential Mascot"
            className="relative w-full h-full max-h-[210px] object-contain drop-shadow-[0_14px_28px_rgba(168,85,247,0.35)]"
          />
        </div>

        {/* Role & Score Highlight */}
        <div className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted block">
                Verified Profile
              </span>
              <h4 className="text-sm sm:text-base font-extrabold text-text leading-snug line-clamp-2">
                {props.roleTitle || "Solana Candidate"}
              </h4>
              {(props.scoreTier || props.subtitle) && (
                <p className="text-[11px] font-mono text-purple-400 truncate">
                  {[props.scoreTier, props.subtitle].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>

            <div className="px-3 py-2 rounded-xl bg-surface-elevated border border-purple-500/40 text-right shrink-0">
              <span className="text-[9px] font-mono uppercase text-text-muted block">
                Score
              </span>
              <span className="text-2xl font-extrabold font-mono text-purple-400 leading-none">
                {props.score}
                <span className="text-[11px] text-text-muted font-normal">/100</span>
              </span>
            </div>
          </div>

          {/* Skills */}
          {skills.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {skills.slice(0, 4).map((skill) => (
                <span
                  key={skill}
                  className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-surface-elevated border border-border text-text-secondary truncate max-w-[130px]"
                >
                  {skill}
                </span>
              ))}
            </div>
          )}

          {/* Cryptographic Lines */}
          <div className="p-3 rounded-xl bg-surface-elevated border border-border space-y-1.5 text-[10px] font-mono">
            <div className="flex items-center justify-between gap-2">
              <span className="text-text-muted uppercase shrink-0">Wallet</span>
              <span className="text-text truncate">
                {props.walletAddress ? truncateMiddle(props.walletAddress, 6, 6) : "Not linked"}
              </span>
            </div>
            {props.primaryIdValue && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-muted uppercase shrink-0">
                  {props.primaryIdLabel || "PDA"}
                </span>
                <span className="text-purple-400 truncate">
                  {truncateMiddle(props.primaryIdValue, 6, 6)}
                </span>
              </div>
            )}
            {props.secondaryIdValue && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-muted uppercase shrink-0">
                  {props.secondaryIdLabel || "SBT"}
                </span>
                <span className="text-text truncate">
                  {props.secondaryIdValue.length > 20
                    ? truncateMiddle(props.secondaryIdValue, 6, 6)
                    : props.secondaryIdValue}
                </span>
              </div>
            )}
            {props.hashValue && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-muted uppercase shrink-0">
                  {props.hashLabel || "SHA-256"}
                </span>
                <span className="text-text-secondary truncate">
                  {truncateMiddle(props.hashValue, 8, 8)}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between text-[9px] font-mono text-text-muted pt-1">
            <span>SOLANA {props.clusterLabel.toUpperCase()}</span>
            <span>{props.issuedLabel || "COOV CREDENTIAL"}</span>
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
          className="w-full"
        >
          {downloading ? "Rendering Card PNG..." : "Download Card (PNG)"}
        </Button>
      </div>
    </div>
  );
}
