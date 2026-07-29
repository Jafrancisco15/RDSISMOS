import { NextRequest, NextResponse } from "next/server";
import { evaluateDueCapsules } from "@/lib/learning/evaluate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: NextRequest) {
  const token = process.env.EARTHQUAKE_ADMIN_TOKEN;
  if (!token) return true;
  return request.headers.get("authorization") === `Bearer ${token}`;
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({})) as { limitCapsules?: unknown };
    const requestedLimit = Number(body.limitCapsules ?? 5);
    const limitCapsules = Number.isInteger(requestedLimit)
      ? Math.min(20, Math.max(1, requestedLimit))
      : 5;
    const result = await evaluateDueCapsules(limitCapsules, request.signal);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible evaluar las cápsulas." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
