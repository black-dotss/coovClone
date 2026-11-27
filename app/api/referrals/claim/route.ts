import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { recordReferral } from "@/lib/referrals/service";

export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const referrerId = body.referrerId;

    if (!referrerId || typeof referrerId !== "string") {
      return NextResponse.json({ error: "Invalid referrerId" }, { status: 400 });
    }

    const result = await recordReferral({
      referrerId: referrerId.trim(),
      referredUserId: session.user.id,
    });

    return NextResponse.json(result);
  } catch (_error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
