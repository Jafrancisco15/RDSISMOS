import { NextRequest, NextResponse } from "next/server";
import { buildHistoricalMigrationCapsuleV2 } from "@/lib/historicalMigrationV2";
import { normalizeMigrationCapsule } from "@/lib/learning/projectionNormalization";
import { persistMigrationCapsule } from "@/lib/learning/store";
import type { EventSource, SeismicEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_SOURCES = new Set<EventSource>([
  "USGS ComCat",
  "USGS real-time",
  "Raspberry Shake QuakeLink",
]);

interface RequestBody {
  countryCode?: unknown;
  sourceEvent?: Record<string, unknown>;
}

function number(value: unknown, minimum: number, maximum: number, name: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} inválido.`);
  }
  return parsed;
}

function text(value: unknown, maximum: number, name: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} inválido.`);
  return value.replace(/[<>]/g, "").trim().slice(0, maximum);
}

function parseSourceEvent(record: Record<string, unknown> | undefined): SeismicEvent {
  if (!record) throw new Error("Falta el evento origen.");
  const time = new Date(text(record.time, 80, "Fecha"));
  if (Number.isNaN(time.getTime())) throw new Error("Fecha inválida.");
  const sourceValue = typeof record.source === "string" ? record.source : "USGS ComCat";
  const source = ALLOWED_SOURCES.has(sourceValue as EventSource)
    ? (sourceValue as EventSource)
    : "USGS ComCat";
  return {
    id: text(record.id, 120, "Identificador"),
    time: time.toISOString(),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
    magnitude: number(record.magnitude, 4.5, 9.5, "Magnitud"),
    magnitudeType:
      typeof record.magnitudeType === "string" && record.magnitudeType.trim()
        ? record.magnitudeType.trim().slice(0, 12)
        : "M",
    latitude: number(record.latitude, -90, 90, "Latitud"),
    longitude: number(record.longitude, -180, 180, "Longitud"),
    depthKm: number(record.depthKm, -100, 1_000, "Profundidad"),
    place: text(record.place, 240, "Lugar"),
    agency:
      typeof record.agency === "string" && record.agency.trim()
        ? record.agency.trim().slice(0, 40)
        : "USGS",
    source,
    detailUrl:
      typeof record.detailUrl === "string" && /^https:\/\//.test(record.detailUrl)
        ? record.detailUrl.slice(0, 500)
        : undefined,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const countryCode =
      typeof body.countryCode === "string" && /^[A-Z]{2}$/i.test(body.countryCode)
        ? body.countryCode.toUpperCase()
        : "DO";
    const sourceEvent = parseSourceEvent(body.sourceEvent);
    const capsule = normalizeMigrationCapsule(await buildHistoricalMigrationCapsuleV2(
      sourceEvent,
      countryCode,
      request.signal,
    ));

    let learningStorage: Awaited<ReturnType<typeof persistMigrationCapsule>>;
    try {
      learningStorage = await persistMigrationCapsule(capsule);
    } catch (storageError) {
      learningStorage = {
        persisted: false,
        reason: storageError instanceof Error ? storageError.message : "No fue posible guardar la cápsula.",
      };
      console.error("No fue posible persistir la cápsula de migración", storageError);
    }

    return NextResponse.json({ ...capsule, learningStorage }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    const status = message.includes("análogos") ? 422 : 400;
    return NextResponse.json(
      { error: message },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
