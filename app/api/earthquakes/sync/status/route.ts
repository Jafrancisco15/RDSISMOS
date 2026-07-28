import { NextRequest, NextResponse } from "next/server";
import { getSyncStatus, listSyncStatuses, updateSyncStatus } from "@/lib/earthquakes/syncStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  return NextResponse.json(id ? getSyncStatus(id) : listSyncStatuses(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const body = await request.json() as { id?: string; action?: string };
  if (!body.id || !["stop", "continue"].includes(body.action ?? "")) {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }
  const status = updateSyncStatus(body.id, body.action === "stop" ? { stopped: true, state: "paused" } : { stopped: false, state: "running" });
  return status ? NextResponse.json(status) : NextResponse.json({ error: "Job no encontrado." }, { status: 404 });
}
