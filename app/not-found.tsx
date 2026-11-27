import React from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-[85vh] flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8 py-8 text-center select-none overflow-x-hidden">
      {/* Massive 2x Enlarged 404 with Doll in the Middle 0 */}
      <div className="relative flex items-center justify-center font-black text-[9rem] sm:text-[18rem] md:text-[24rem] lg:text-[30rem] leading-none tracking-tighter text-white">
        <span className="drop-shadow-2xl select-none">4</span>

        <div className="relative flex items-center justify-center mx-1 sm:mx-3 md:mx-6">
          <span className="opacity-70 select-none">0</span>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Image
              src="/doll/404.png"
              alt="COOV 404 Mascot"
              width={700}
              height={700}
              className="w-[145%] sm:w-[165%] md:w-[190%] max-w-none h-auto object-contain drop-shadow-[0_20px_50px_rgba(0,0,0,0.8)] z-10 -translate-y-4 sm:-translate-y-8 md:-translate-y-12"
              priority
            />
          </div>
        </div>

        <span className="drop-shadow-2xl select-none">4</span>
      </div>

      {/* Description & Action */}
      <div className="mt-4 sm:mt-6 max-w-md mx-auto space-y-3 z-20 relative">
        <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
          Lost in the Committee Hallways
        </h1>
        <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
          The page or evaluation you are looking for has been moved, expired, or filtered out by our ATS scanners.
        </p>

        <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link href="/">
            <Button variant="primary" size="md" className="w-full sm:w-auto font-bold text-xs px-6">
              Return Home →
            </Button>
          </Link>
          <Link href="/evaluations/new">
            <Button variant="outline" size="md" className="w-full sm:w-auto font-semibold text-xs px-6">
              Start New CV Review
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
