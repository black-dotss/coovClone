import React from "react";
import { getCompanyLogo } from "@/components/ui/company-logo";

export const BountyCompanyLogo: React.FC<{
  company: string;
  logoUrl?: string | null;
  size?: "sm" | "md" | "lg";
}> = ({ company, logoUrl, size = "md" }) => {
  const boxClass =
    size === "sm"
      ? "w-8 h-8 rounded-lg"
      : size === "lg"
      ? "w-12 h-12 rounded-xl"
      : "w-10 h-10 rounded-lg";

  const iconClass = size === "sm" ? "w-4 h-4" : size === "lg" ? "w-6 h-6" : "w-5 h-5";

  if (logoUrl && /^(https?:\/\/|data:image\/)/i.test(logoUrl.trim())) {
    return (
      <div
        className={`${boxClass} border border-border bg-surface-elevated overflow-hidden flex items-center justify-center shrink-0`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt={`${company} logo`}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className={`${boxClass} border border-border bg-surface-elevated flex items-center justify-center shrink-0`}
    >
      {getCompanyLogo(company, `${iconClass} shrink-0`)}
    </div>
  );
};
