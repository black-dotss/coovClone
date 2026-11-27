import React from "react";
import Link from "next/link";
import Image from "next/image";

export const metadata = {
  title: "Device Limit — Cook My Cv",
  description: "Cook My Cv enforces a strict one account per device policy.",
};

export default function DeviceLimitPage() {
  return (
    <div className="min-h-[calc(100vh-4.5rem)] flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md text-center space-y-6 bg-surface border border-border p-8 rounded-2xl shadow-sm">
        <div className="flex justify-center">
          <Link href="/">
            <Image
              src="/logo/logo.png"
              alt="Cook My Cv Logo"
              width={160}
              height={44}
              className="h-10 w-auto object-contain"
              priority
            />
          </Link>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-white">
            One Account Per Device
          </h1>
          <p className="text-base font-medium text-amber-400">
            You can only use one account per device.
          </p>
        </div>

        <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
          This device is already associated with an existing Cook My Cv account. To maintain fair access to free trial evaluations and computational resources, our security policy permits only a single account per device.
        </p>

        <div className="pt-2 flex flex-col gap-3">
          <Link
            href="/auth?mode=signin"
            className="w-full inline-flex items-center justify-center px-4 py-2.5 rounded-lg bg-white text-black font-semibold text-sm hover:bg-zinc-200 transition-colors"
          >
            Sign In to Existing Account
          </Link>
          <Link
            href="/"
            className="w-full inline-flex items-center justify-center px-4 py-2.5 rounded-lg border border-border bg-surface-elevated text-text font-medium text-xs hover:bg-surface transition-colors"
          >
            Return to Home
          </Link>
        </div>

        <div className="pt-4 border-t border-border text-xs text-text-muted space-y-1">
          <p>
            Need help recovering access to your registered account?
          </p>
          <p>
            Contact support at{" "}
            <a
              href="mailto:israelashenafi29@gmail.com"
              className="text-text hover:underline font-mono"
            >
              israelashenafi29@gmail.com
            </a>{" "}
            or Telegram{" "}
            <a
              href="https://t.me/israelashenafi"
              target="_blank"
              rel="noopener noreferrer"
              className="text-text hover:underline font-mono"
            >
              @israelashenafi
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
