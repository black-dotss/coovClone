import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD, PHASE_DEVELOPMENT_SERVER } from "next/constants";

const nextConfig = (phase: string): NextConfig => {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    import("@opennextjs/cloudflare")
      .then((m) => m.initOpenNextCloudflareForDev())
      .catch(() => {});
  }

  if (phase === PHASE_PRODUCTION_BUILD) {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
  }

  const config: NextConfig = {
    serverExternalPackages: [
      "pdf-parse",
      "pdfkit",
      "pdfjs-dist",
    ],
    outputFileTracingIncludes: {
      "/api/**/*": ["./node_modules/pdfjs-dist/**/*"],
    },
    images: {
      unoptimized: true,
      remotePatterns: [
        {
          protocol: "https",
          hostname: "lh3.googleusercontent.com",
        },
        {
          protocol: "https",
          hostname: "*.googleusercontent.com",
        },
        {
          protocol: "https",
          hostname: "avatars.githubusercontent.com",
        },
        {
          protocol: "https",
          hostname: "*.githubusercontent.com",
        },
      ],
    },
    experimental: {
      agentFeedback: true,
    },
    turbopack: {
      rules: {
        "*.css": {
          loaders: ["@tailwindcss/turbopack"],
          as: "*.css",
        },
      },
    },
  };

  return config;
};

export default nextConfig;

