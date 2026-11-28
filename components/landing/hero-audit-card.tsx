"use client";

import React, { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth/auth-client";
import { savePendingCv } from "@/lib/client/pending-cv";

export function HeroAuditCard() {
  const router = useRouter();
  const { data: session } = useSession();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{ name: string; size: string } | null>(null);
  const [actualFile, setActualFile] = useState<File | null>(null);
  const [targetRole, setTargetRole] = useState("");
  const [isNavigating, setIsNavigating] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = async (file: File) => {
    const sizeInMb = (file.size / (1024 * 1024)).toFixed(1);
    setSelectedFile({
      name: file.name,
      size: `${sizeInMb} MB`,
    });
    setActualFile(file);
    await savePendingCv(file, targetRole);
  };

  const handleStart = async () => {
    const query = targetRole.trim() ? `?role=${encodeURIComponent(targetRole.trim())}` : "";
    const target = `/evaluations/new${query}`;
    try {
      setIsNavigating(true);
      if (actualFile) {
        await savePendingCv(actualFile, targetRole);
      }
      if (!session) {
        router.push(`/auth?callbackUrl=${encodeURIComponent(target)}`);
        return;
      }
      router.push(target);
    } catch {
      router.push(session ? "/evaluations/new" : "/auth?callbackUrl=/evaluations/new");
    }
  };

  return (
    <div className="w-full max-w-xl text-left mt-6">
      <div className="rounded-lg border border-border bg-surface p-4 sm:p-5 transition-colors">
        {/* Dropzone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative rounded-md border border-dashed p-5 text-center cursor-pointer transition-colors ${
            dragOver
              ? "border-text bg-surface-elevated"
              : "border-border hover:border-text-secondary bg-surface-elevated/40"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={handleFileInputChange}
            className="hidden"
          />

          {selectedFile ? (
            <div className="flex items-center justify-between gap-3 text-left">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-md bg-surface-elevated border border-border flex items-center justify-center text-text shrink-0">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className="truncate">
                  <p className="text-xs font-semibold text-text truncate">{selectedFile.name}</p>
                  <p className="text-[11px] text-text-muted font-mono">{selectedFile.size} · ready to audit</p>
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
                className="text-xs text-text-secondary hover:text-text underline shrink-0 cursor-pointer bg-transparent border-0 p-0"
              >
                Replace
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-1">
              <div className="w-8 h-8 rounded-md bg-surface-elevated border border-border flex items-center justify-center text-text-secondary mb-2.5">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
              </div>
              <p className="text-xs font-medium text-text">
                Select your CV or drag and drop
              </p>
              <p className="text-[11px] text-text-muted mt-0.5 font-mono">PDF, DOCX up to 10MB</p>
            </div>
          )}
        </div>

        {/* Target role & Submit */}
        <div className="mt-3 flex flex-col sm:flex-row items-center gap-2">
          <input
            type="text"
            value={targetRole}
            onChange={(e) => setTargetRole(e.target.value)}
            placeholder="Target role (e.g. Senior Software Engineer)"
            className="w-full sm:flex-1 px-3 py-2 rounded-md text-xs bg-surface-elevated border border-border focus:outline-none focus:border-text-secondary text-text placeholder:text-text-muted transition-colors font-sans"
          />
          <Button
            variant="primary"
            size="sm"
            onClick={handleStart}
            disabled={isNavigating}
            className="w-full sm:w-auto text-xs py-2 px-4 whitespace-nowrap h-[34px]"
          >
            Run Screening Audit
            <svg className="w-3.5 h-3.5 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </Button>
        </div>

        {/* Micro Specs */}
        <div className="mt-3 pt-2.5 border-t border-border/60 flex items-center justify-between text-[11px] text-text-muted font-mono">
          <span>3 free audits included</span>
          <span>Zero hallucinated metrics</span>
          <span>Telebirr & CBE</span>
        </div>
      </div>
    </div>
  );
}
