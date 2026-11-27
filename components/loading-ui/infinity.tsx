import React from "react";

interface InfinityLoopProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
}

export function InfinityLoop({ className = "h-12 w-24", ...props }: InfinityLoopProps) {
  // Rounded interlocking infinity path (2:1 aspect ratio)
  const ooPath =
    "M 60,30 C 48,14 44,10 36,10 C 25,10 16,19 16,30 C 16,41 25,50 36,50 C 44,50 48,46 60,30 C 72,14 76,10 84,10 C 95,10 104,19 104,30 C 104,41 95,50 84,50 C 76,50 72,46 60,30 Z";

  return (
    <svg
      viewBox="0 0 120 60"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      <defs>
        <linearGradient id="infinity-purple-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#9333ea" />
          <stop offset="50%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#c084fc" />
        </linearGradient>
      </defs>

      {/* Background guide track */}
      <path
        d={ooPath}
        stroke="currentColor"
        strokeOpacity={0.2}
        strokeWidth={6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Animated infinite looping dash */}
      <path
        d={ooPath}
        stroke="url(#infinity-purple-grad)"
        strokeWidth={6}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={100}
        strokeDasharray="28 72"
        style={{
          animation: "infinity-loop 1.4s linear infinite",
        }}
      />
    </svg>
  );
}

export function FullPageLoading() {
  return (
    <div className="flex-1 w-full min-h-[65vh] flex items-center justify-center">
      <InfinityLoop className="w-28 h-14 text-purple-400" />
    </div>
  );
}

export function InfinityDemo() {
  return <FullPageLoading />;
}
