import { NextResponse } from "next/server";
import { ACTIONS_CORS_HEADERS, type ActionsJson } from "@solana/actions";

export async function GET() {
  const payload: ActionsJson = {
    rules: [
      {
        pathPattern: "/bounties/*",
        apiPath: "/api/actions/bounty/*",
      },
      {
        pathPattern: "/bounties/**",
        apiPath: "/api/actions/bounty/**",
      },
      {
        pathPattern: "/api/actions/**",
        apiPath: "/api/actions/**",
      },
    ],
  };

  return NextResponse.json(payload, {
    headers: ACTIONS_CORS_HEADERS,
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: ACTIONS_CORS_HEADERS,
  });
}
