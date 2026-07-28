import { NextRequest, NextResponse } from "next/server";
import { parseEarthquakeFilters } from "@/lib/earthquakes/query";
import { queryAllPartitioned } from "@/lib/earthquakes/usgs";
import { createSyncStatus, updateSyncStatus } from "@/lib/earthquakes/syncStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const token = process.env.EARTHQUAKE_ADMIN_TOKEN;
    if (token && request.headers.get("authorization") !== `Bearer ${token}`) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
    const body = await request.json() as Record<string, unknown>;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) if (value !== undefined && value !== null) params.set(key, String(value));
    const filters = parseEarthquakeFilters(params);
    const status = createSyncStatus({ startTime: filters.startTime, endTime: filters.endTime });
    void runSync(status.id, filters);
    return NextResponse.json(status, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error desconocido" }, { status: 400 });
  }
}

async function runSync(id: string, filters: ReturnType<typeof parseEarthquakeFilters>) {
  try {
    await queryAllPartitioned(filters, async (events, range) => {
      const current = updateSyncStatus(id, { currentStart: range.start, currentEnd: range.end });
      if (current?.stopped) throw new Error("Sincronización detenida por el usuario.");
      updateSyncStatus(id, { processed: (current?.processed ?? 0) + events.length, inserted: (current?.inserted ?? 0) + events.length });
      // Sin base de datos durable conectada, el job valida y procesa lotes pero no persiste entre despliegues.
    });
    updateSyncStatus(id, { state: "completed" });
  } catch (error) {
    updateSyncStatus(id, { state: "failed", errors: [error instanceof Error ? error.message : "Error desconocido"] });
  }
}
