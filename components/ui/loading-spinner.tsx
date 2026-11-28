import React from "react";
import { InfinityLoop } from "@/components/loading-ui/infinity";

export interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  label?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = "md",
  className = "",
  label,
}) => {
  const sizeMap = {
    sm: "w-10 h-5",
    md: "w-16 h-8",
    lg: "w-24 h-12",
    xl: "w-32 h-16",
  };

  return (
    <div
      className={`flex items-center justify-center ${className}`}
      role="status"
      aria-label={label || "Loading"}
    >
      <InfinityLoop className={`${sizeMap[size]} text-purple-400`} />
      <span className="sr-only">{label || "Loading"}</span>
    </div>
  );
};

export function FullPageLoading() {
  return (
    <div className="flex-1 w-full min-h-[calc(100vh-5rem)] flex items-center justify-center px-4">
      <InfinityLoop className="w-28 h-14 text-purple-400" />
    </div>
  );
}
