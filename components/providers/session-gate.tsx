"use client";

import React, { useEffect, useState, useSyncExternalStore } from "react";
import { useSession } from "@/lib/auth/auth-client";
import { FullPageLoading } from "@/components/ui/loading-spinner";

interface SessionGateProps {
  children: React.ReactNode;
}

const emptySubscribe = () => () => {};

/**
 * Gates page content during initial session confirmation, preventing the
 * flash of unauthenticated ("logged out") UI for authenticated users.
 */
export function SessionGate({ children }: SessionGateProps) {
  const { data: session, isPending } = useSession();
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    // Resilience timeout: never block the page for more than 2 seconds if network/auth lags
    const timer = setTimeout(() => {
      setTimedOut(true);
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  // Capture ?ref= from URL on any page
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const ref = urlParams.get("ref");
        if (ref && ref.trim()) {
          const cleanRef = ref.trim();
          localStorage.setItem("cookmycv_pending_ref", cleanRef);
          document.cookie = `cookmycv_ref=${encodeURIComponent(cleanRef)}; Path=/; Max-Age=2592000; SameSite=Lax`;
        }
      } catch {}
    }
  }, []);

  // Auto-claim pending referral when authenticated
  useEffect(() => {
    if (session?.user?.id && typeof window !== "undefined") {
      try {
        const rawRef =
          localStorage.getItem("cookmycv_pending_ref") ||
          (document.cookie.match(/cookmycv_ref=([^;]+)/) || [])[1];

        const pendingRef = rawRef ? decodeURIComponent(rawRef).trim() : null;

        if (pendingRef && pendingRef !== session.user.id) {
          fetch("/api/referrals/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ referrerId: pendingRef }),
          })
            .then((res) => res.json())
            .then((data) => {
              if (data?.success || data?.bonusGranted || data?.message?.includes("already")) {
                localStorage.removeItem("cookmycv_pending_ref");
                document.cookie = "cookmycv_ref=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
              }
            })
            .catch(() => {});
        }
      } catch {}
    }
  }, [session?.user?.id]);

  if (!isClient || (isPending && !timedOut)) {
    return <FullPageLoading />;
  }

  return <>{children}</>;
}
