import { NextResponse } from "next/server";
import { loadProjectionEffectiveness } from "@/lib/learning/projectionEffectiveness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await loadProjectionEffectiveness();
  return NextResponse.json(result, {
    status: result.databaseConnected || !result.databaseConfigured ? 200 : 503,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
