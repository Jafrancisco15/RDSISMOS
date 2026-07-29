import { NextResponse } from "next/server";
import { getLearningStatus } from "@/lib/learning/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getLearningStatus();
  return NextResponse.json(status, {
    status: status.databaseConnected || !status.databaseConfigured ? 200 : 503,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
