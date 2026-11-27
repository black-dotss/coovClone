"use client";

import React from "react";

export default function GlobalError({
  error,
  retry,
  reset,
}: {
  error: unknown;
  retry?: () => void;
  reset?: () => void;
}) {
  const errorMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
      ? error
      : "An unexpected system error occurred.";

  const handleRetry = () => {
    if (typeof retry === "function") {
      retry();
    } else if (typeof reset === "function") {
      reset();
    }
  };

  return (
    <html lang="en">
      <head>
        <title>Application Error</title>
      </head>
      <body
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: "#09090b",
          color: "#f4f4f5",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem",
            textAlign: "center",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              width: "3rem",
              height: "3rem",
              borderRadius: "0.75rem",
              backgroundColor: "rgba(88, 28, 135, 0.4)",
              border: "1px solid rgba(168, 85, 247, 0.4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#d8b4fe",
              fontSize: "1.25rem",
              fontWeight: "bold",
              marginBottom: "1rem",
            }}
          >
            !
          </div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", margin: "0 0 0.5rem 0" }}>
            Something went wrong
          </h2>
          <p
            style={{
              fontSize: "0.875rem",
              color: "#a1a1aa",
              maxWidth: "28rem",
              margin: "0 0 1.5rem 0",
              lineHeight: 1.5,
            }}
          >
            {errorMessage}
          </p>
          <button
            onClick={handleRetry}
            style={{
              padding: "0.625rem 1.25rem",
              borderRadius: "0.5rem",
              backgroundColor: "#9333ea",
              color: "#ffffff",
              border: "none",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
