import { NextRequest, NextResponse } from "next/server";
import { queryEarthquakeById } from "@/lib/earthquakes/usgs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const event = await queryEarthquakeById(id, request.signal);
    return NextResponse.json(event, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error desconocido" }, { status: 404 });
  }
}
