"use client";

import React, { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { WalletConnectButton } from "@/components/solana/wallet-connect-button";
import { useSession } from "@/lib/auth/auth-client";

export const Navbar: React.FC = () => {
  const pathname = usePathname();
  const { data: session, isPending } = useSession();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isSuperAdmin = (session?.user?.email || "").toLowerCase().trim() === "israelashenafi29@gmail.com";

  // Automatically close mobile menu on route change
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setMobileMenuOpen(false);
  }

  const navLinks = [
    { label: "New Review", href: "/evaluations/new" },
    { label: "Bounties", href: "/bounties" },
    { label: "Role Compare", href: "/comparisons" },
    { label: "Plans", href: "/billing" },
    ...(isSuperAdmin ? [{ label: "Admin", href: "/admin" }] : []),
    ...(session ? [{ label: "On-Chain & SBT", href: "/profile?tab=solana" }] : []),
    ...(session ? [{ label: "History", href: "/evaluations" }] : []),
  ];

  return (
    <div className="sticky top-2 z-50 w-full max-w-full px-3 sm:px-6 lg:px-8 pointer-events-none transition-all">
      {/* Rectangular Navigation Bar */}
      <header className="w-full max-w-7xl mx-auto rounded-xl border border-border/80 bg-surface/90 backdrop-blur-md px-4 sm:px-6 h-14 sm:h-15 flex items-center justify-between shadow-xs pointer-events-auto transition-colors">
        {/* Brand & Left Links */}
        <div className="flex items-center gap-5 sm:gap-7">
          <Link href="/" className="flex items-center gap-2 group shrink-0">
            <Image
              src="/logo/logo.png"
              alt="COOV Logo"
              width={160}
              height={44}
              className="h-7 sm:h-8 w-auto object-contain transition-transform group-hover:scale-105"
              priority
            />
          </Link>

          {/* Desktop Nav Links */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                    isActive
                      ? "bg-surface-elevated text-text font-semibold border border-border"
                      : "text-text-secondary hover:text-text hover:bg-surface-elevated/60"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right Actions Dock */}
        <div className="hidden md:flex items-center gap-2.5">
          <WalletConnectButton />
          {isPending ? (
            <div className="h-9 w-28 rounded-lg bg-surface-elevated/40 animate-pulse border border-border/40" />
          ) : session ? (
            <Link
              href="/profile"
              title="View Profile & Settings"
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg border border-border/60 bg-surface-elevated/40 hover:bg-surface-elevated text-text hover:text-purple-600 dark:hover:text-purple-300 transition-colors"
            >
              <Avatar
                name={session.user.name || session.user.email}
                image={session.user.image || undefined}
                size="sm"
              />
              <span className="text-xs font-semibold max-w-[130px] truncate">
                {session.user.name || "Profile"}
              </span>
            </Link>
          ) : (
            <div className="flex items-center gap-2.5">
              <Link href="/auth">
                <Button variant="ghost" size="sm" className="text-xs sm:text-sm h-9 text-text-secondary hover:text-text px-3.5">
                  Sign in
                </Button>
              </Link>
              <Link href="/auth?register=true">
                <Button variant="primary" size="sm" className="text-xs sm:text-sm h-9 font-semibold px-4.5">
                  Get Started
                </Button>
              </Link>
            </div>
          )}
        </div>

        {/* Mobile menu trigger */}
        <div className="flex items-center gap-2 md:hidden">
          <WalletConnectButton compact />
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-1.5 rounded-md text-text-muted hover:text-text hover:bg-surface-elevated border border-border cursor-pointer transition-colors"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* Mobile dropdown */}
      {mobileMenuOpen && (
        <div className="mt-2 p-3 rounded-2xl border border-border bg-surface shadow-xl space-y-1.5 md:hidden pointer-events-auto animate-menu-drop will-change-transform">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileMenuOpen(false)}
              className={`block px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors duration-150 ${
                pathname === link.href
                  ? "bg-surface-elevated text-text font-semibold border border-border"
                  : "text-text-muted hover:bg-surface-elevated hover:text-text"
              }`}
            >
              {link.label}
            </Link>
          ))}
          {isPending ? (
            <div className="h-10 w-full rounded-xl bg-surface-elevated/40 animate-pulse border border-border/40" />
          ) : session ? (
            <Link
              href="/profile"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:bg-surface-elevated hover:text-text transition-colors duration-150"
            >
              <Avatar
                name={session.user.name || session.user.email}
                image={session.user.image || undefined}
                size="sm"
              />
              <span>Profile & Settings</span>
            </Link>
          ) : null}
          <div className="pt-2 border-t border-border flex flex-col gap-2.5">
            {!isPending && !session && (
              <div className="flex gap-2.5">
                <Link href="/auth" onClick={() => setMobileMenuOpen(false)} className="flex-1">
                  <Button variant="outline" size="sm" className="w-full text-sm h-10">
                    Sign in
                  </Button>
                </Link>
                <Link href="/auth?register=true" onClick={() => setMobileMenuOpen(false)} className="flex-1">
                  <Button variant="primary" size="sm" className="w-full text-sm h-10 font-semibold">
                    Get started
                  </Button>
                </Link>
              </div>
            )}
            <div className="pt-1 text-center">
              <a
                href="https://israelashenafi.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-mono text-text-muted hover:text-purple-400 transition-colors"
              >
                Made by israelashenafi.com
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
