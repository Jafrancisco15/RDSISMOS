import { NextRequest, NextResponse } from "next/server";
import { queryEarthquakeCatalogAll } from "@/lib/earthquakes/catalog";
import type { EarthquakeFilters } from "@/lib/earthquakes/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 365;
const MAX_EVENTS = 20_000;

function parseDate(value: string | null, fallback: Date, endOfDay: boolean) {
  if (!value) return fallback;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}${endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z"}`)
    : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Fecha inválida: ${value}`);
  return parsed;
}

function magnitude(value: string | null) {
  const parsed = Number(value ?? 4.5);
  if (!Number.isFinite(parsed) || parsed < 4.2 || parsed > 9) {
    throw new Error("La magnitud mínima debe estar entre M4.2 y M9.0.");
  }
  return parsed;
}

export async function GET(request: NextRequest) {
  try {
    const now = new Date();
    const defaultStart = new Date(now.getTime() - 30 * DAY_MS);
    const start = parseDate(request.nextUrl.searchParams.get("starttime"), defaultStart, false);
    const end = parseDate(request.nextUrl.searchParams.get("endtime"), now, true);
    if (start > end) throw new Error("La fecha inicial no puede superar la fecha final.");
    const rangeDays = (end.getTime() - start.getTime()) / DAY_MS;
    if (rangeDays > MAX_RANGE_DAYS) {
      throw new Error(`La vista tectónica 3D admite hasta ${MAX_RANGE_DAYS} días por consulta.`);
    }

    const minMagnitude = magnitude(request.nextUrl.searchParams.get("minmagnitude"));
    const filters: EarthquakeFilters = {
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      minMagnitude,
      eventType: "earthquake",
      orderBy: "time",
      limit: MAX_EVENTS,
      offset: 1,
    };

    const events = await queryEarthquakeCatalogAll(filters, MAX_EVENTS, request.signal);
    return NextResponse.json({
      events,
      total: events.length,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      minMagnitude,
      generatedAt: new Date().toISOString(),
      warnings: [],
    }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible cargar los hipocentros 3D." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
