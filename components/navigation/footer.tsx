import React from "react";
import Image from "next/image";
import Link from "next/link";

export const Footer: React.FC = () => {
  return (
    <footer className="border-t border-border py-8 px-4 sm:px-6 lg:px-8 text-xs text-text-muted mt-auto bg-surface/50 backdrop-blur-xs w-full max-w-full overflow-hidden">
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image
              src="/logo/logo.png"
              alt="COOV Logo"
              width={140}
              height={38}
              className="h-7 w-auto object-contain"
            />
            <span className="text-text-muted">· Cook My Cv</span>
          </div>

          {/* Legal and Pricing Links */}
          <nav className="flex flex-wrap items-center justify-center sm:justify-end gap-x-4 gap-y-2 text-xs font-mono">
            <Link href="/pricing" className="text-text-secondary hover:text-text transition-colors whitespace-nowrap">
              Pricing
            </Link>
            <span className="hidden sm:inline text-border">·</span>
            <Link href="/terms" className="text-text-secondary hover:text-text transition-colors whitespace-nowrap">
              Terms of Service
            </Link>
            <span className="hidden sm:inline text-border">·</span>
            <Link href="/privacy" className="text-text-secondary hover:text-text transition-colors whitespace-nowrap">
              Privacy Policy
            </Link>
            <span className="hidden sm:inline text-border">·</span>
            <Link href="/refund" className="text-text-secondary hover:text-text transition-colors whitespace-nowrap">
              Refund Policy
            </Link>
          </nav>
        </div>

        <div className="pt-4 border-t border-border/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] font-mono text-text-muted text-center sm:text-left">
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-2 gap-y-1">
            <span>© 2026 COOV</span>
            <span className="hidden sm:inline text-border">·</span>
            <span className="break-words">Online Merchant of Record: Polar.sh (Polar Software Inc.)</span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <a
              href="https://israelashenafi.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-600 dark:text-purple-400 hover:text-purple-500 transition-colors"
            >
              israelashenafi.com
            </a>
            <span>(</span>
            <a
              href="https://byisrael.tech"
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-600 dark:text-purple-400 hover:text-purple-500 transition-colors"
            >
              byisrael.tech
            </a>
            <span>)</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
