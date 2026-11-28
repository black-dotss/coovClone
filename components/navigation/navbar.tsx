"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { WalletConnectButton } from "@/components/solana/wallet-connect-button";
import { useSolanaWallet } from "@/components/providers/solana-wallet-provider";
import { useSession } from "@/lib/auth/auth-client";
import { apiFetch } from "@/lib/client/api";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  href: string | null;
  isRead: boolean;
  createdAt: string;
}

function formatRelativeTime(isoDate: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000));
  if (diffSec < 60) return "just now";
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export const Navbar: React.FC = () => {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const { publicKey } = useSolanaWallet();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifLoading, setNotifLoading] = useState(false);
  const desktopNotifRef = useRef<HTMLDivElement | null>(null);
  const mobileNotifRef = useRef<HTMLDivElement | null>(null);

  const isSuperAdmin = (session?.user?.email || "").toLowerCase().trim() === "israelashenafi29@gmail.com";

  // Automatically close menus on route change
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setMobileMenuOpen(false);
    setNotifOpen(false);
  }

  const fetchNotifications = useCallback(async () => {
    if (!session?.user?.id) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    try {
      const query = publicKey ? `?wallet=${encodeURIComponent(publicKey)}` : "";
      const res = await apiFetch<{
        notifications: NotificationItem[];
        unreadCount: number;
      }>(`/api/notifications${query}`);
      setNotifications(res.notifications ?? []);
      setUnreadCount(res.unreadCount ?? 0);
    } catch {
      // Non-fatal background notification poll error
    }
  }, [publicKey, session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id) return;
    const kick = setTimeout(() => {
      void fetchNotifications();
    }, 50);
    const interval = setInterval(() => {
      void fetchNotifications();
    }, 30_000);
    return () => {
      clearTimeout(kick);
      clearInterval(interval);
    };
  }, [fetchNotifications, session?.user?.id]);

  useEffect(() => {
    if (!notifOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inDesktop = desktopNotifRef.current?.contains(target);
      const inMobile = mobileNotifRef.current?.contains(target);
      if (!inDesktop && !inMobile) {
        setNotifOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNotifOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [notifOpen]);

  const handleToggleNotif = async () => {
    const next = !notifOpen;
    setNotifOpen(next);
    if (next) {
      setNotifLoading(true);
      await fetchNotifications();
      setNotifLoading(false);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      const res = await apiFetch<{
        notifications: NotificationItem[];
        unreadCount: number;
      }>("/api/notifications", {
        method: "PATCH",
        body: JSON.stringify({ markAll: true }),
      });
      setNotifications(res.notifications ?? []);
      setUnreadCount(res.unreadCount ?? 0);
    } catch {
      // Ignore transient mark-read failure
    }
  };

  const handleClickNotification = async (item: NotificationItem) => {
    setNotifOpen(false);
    if (!item.isRead) {
      try {
        const res = await apiFetch<{
          notifications: NotificationItem[];
          unreadCount: number;
        }>("/api/notifications", {
          method: "PATCH",
          body: JSON.stringify({ ids: [item.id] }),
        });
        setNotifications(res.notifications ?? []);
        setUnreadCount(res.unreadCount ?? 0);
      } catch {
        // Ignore transient failure before navigation
      }
    }
    if (item.href) {
      router.push(item.href);
    }
  };

  const navLinks = [
    { label: "New Review", href: "/evaluations/new" },
    { label: "Bounties", href: "/bounties" },
    { label: "On-Chain & SBT", href: "/on-chain" },
    { label: "Role Compare", href: "/comparisons" },
    { label: "History", href: "/evaluations" },
    { label: "Plans", href: "/billing" },
    ...(isSuperAdmin ? [{ label: "Admin", href: "/admin" }] : []),
  ];

  const isLinkActive = (href: string) => {
    if (href === "/evaluations") {
      return (
        pathname === "/evaluations" ||
        (pathname.startsWith("/evaluations/") && pathname !== "/evaluations/new")
      );
    }
    if (href === "/bounties" || href === "/on-chain" || href === "/comparisons") {
      return pathname === href || pathname.startsWith(`${href}/`);
    }
    return pathname === href;
  };

  const bellDropdown = notifOpen && session && (
    <div className="fixed sm:absolute right-3 sm:right-0 top-16 sm:top-full sm:mt-2 w-[calc(100vw-1.5rem)] sm:w-96 max-w-md rounded-2xl border border-border bg-surface shadow-2xl shadow-black/40 overflow-hidden z-[90]">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 bg-surface-elevated/60">
        <div className="flex items-center gap-2">
          <span className="text-sm font-extrabold text-text">Notifications</span>
          {unreadCount > 0 && (
            <span className="px-2 py-0.5 text-[11px] font-mono font-bold rounded-md bg-purple-600 text-white">
              {unreadCount} new
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => void handleMarkAllRead()}
            className="text-xs font-semibold text-purple-400 hover:text-purple-300 cursor-pointer"
          >
            Mark all read
          </button>
        )}
      </div>

      <div className="max-h-96 overflow-y-auto divide-y divide-border/70">
        {notifLoading && notifications.length === 0 ? (
          <div className="p-6 text-center text-xs text-text-muted font-mono">
            Checking bounty &amp; Scout updates...
          </div>
        ) : notifications.length === 0 ? (
          <div className="p-6 text-center space-y-1">
            <p className="text-sm font-bold text-text">No notifications yet</p>
            <p className="text-xs text-text-secondary">
              Share a bounty link to earn 10% Scout rewards and track when friends enter or win.
            </p>
          </div>
        ) : (
          notifications.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => void handleClickNotification(item)}
              className={`w-full text-left px-4 py-3.5 hover:bg-surface-elevated/80 transition-colors cursor-pointer flex items-start gap-3 ${
                !item.isRead ? "bg-purple-500/5" : ""
              }`}
            >
              <span
                className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                  !item.isRead ? "bg-purple-500" : "bg-border"
                }`}
              />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs sm:text-sm font-bold text-text truncate">
                    {item.title}
                  </p>
                  <span className="text-[11px] font-mono text-text-muted shrink-0">
                    {formatRelativeTime(item.createdAt)}
                  </span>
                </div>
                <p className="text-xs text-text-secondary leading-relaxed">
                  {item.message}
                </p>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="sticky top-2 z-50 w-full max-w-full px-3 sm:px-6 lg:px-8 pointer-events-none transition-all">
      {/* Rectangular Navigation Bar */}
      <header className="w-full max-w-7xl mx-auto rounded-xl border border-border/80 bg-surface/90 backdrop-blur-md px-4 sm:px-6 h-14 sm:h-15 flex items-center justify-between shadow-xs pointer-events-auto transition-colors">
        {/* Brand & Left Links */}
        <div className="flex items-center gap-4 lg:gap-6 min-w-0">
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
          <nav className="hidden lg:flex items-center gap-1">
            {navLinks.map((link) => {
              const isActive = isLinkActive(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-2.5 xl:px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
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
        <div className="hidden lg:flex items-center gap-2.5 shrink-0">
          <WalletConnectButton />
          {session && (
            <div ref={desktopNotifRef} className="relative">
              <button
                type="button"
                onClick={() => void handleToggleNotif()}
                aria-label="Notifications"
                title="Notifications"
                className="relative h-9 w-9 rounded-lg border border-border/80 bg-surface-elevated/50 hover:bg-surface-elevated text-text-secondary hover:text-text flex items-center justify-center transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                  />
                </svg>
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-purple-600 text-white text-[10px] font-mono font-bold flex items-center justify-center shadow-xs">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>
              {bellDropdown}
            </div>
          )}
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
              <span className="text-xs font-semibold max-w-[120px] truncate">
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
        <div className="flex items-center gap-2 lg:hidden">
          <WalletConnectButton compact />
          {session && (
            <div ref={mobileNotifRef} className="relative">
              <button
                type="button"
                onClick={() => void handleToggleNotif()}
                aria-label="Notifications"
                className="relative p-1.5 rounded-md border border-border text-text-muted hover:text-text hover:bg-surface-elevated cursor-pointer transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                  />
                </svg>
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-purple-600 text-white text-[9px] font-mono font-bold flex items-center justify-center">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>
              {bellDropdown}
            </div>
          )}
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
        <div className="mt-2 p-3 rounded-2xl border border-border bg-surface shadow-xl space-y-1.5 lg:hidden pointer-events-auto animate-menu-drop will-change-transform">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileMenuOpen(false)}
              className={`block px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors duration-150 ${
                isLinkActive(link.href)
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
              <span>Profile &amp; Settings</span>
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
