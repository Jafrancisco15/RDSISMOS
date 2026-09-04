import { NextRequest, NextResponse } from "next/server";
import { emptyCometInSarCatalog, loadCometInSarCatalog } from "@/lib/cometInSAR";
import { emptyNglGnssResult, loadNglGnssDeformation, type GnssEventSource } from "@/lib/nglGnss";
import { buildTectonicStatePhase4Result } from "@/lib/tectonicStatePhase4";
import type { TectonicStatePhase4Seed } from "@/lib/tectonicStatePhase4Bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function finite(value: unknown, fallback = Number.NaN) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clean(value: unknown, maximum = 280) {
  return typeof value === "string" ? value.replace(/[<>]/g, "").trim().slice(0, maximum) : "";
}

function sourceFrom(value: unknown): GnssEventSource | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = clean(raw.externalId ?? raw.id, 120);
  const timeUtc = clean(raw.timeUtc, 80);
  const latitude = finite(raw.latitude);
  const longitude = finite(raw.longitude);
  const magnitude = finite(raw.magnitude);
  const depthKm = finite(raw.depthKm, 0);
  if (!id || !timeUtc || !Number.isFinite(Date.parse(timeUtc))) return null;
  if (![latitude, longitude, magnitude, depthKm].every(Number.isFinite)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return {
    id,
    timeUtc: new Date(timeUtc).toISOString(),
    latitude,
    longitude,
    magnitude,
    depthKm: Math.max(0, depthKm),
    place: clean(raw.place, 260) || "Evento sísmico",
  };
}

function seedFrom(value: unknown, sourceId: string): TectonicStatePhase4Seed | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<TectonicStatePhase4Seed>;
  if (raw.sourceEventId !== sourceId || raw.phase3Version !== "1.0") return null;
  if (typeof raw.gatePassed !== "boolean" || !Number.isFinite(Number(raw.gateScore))) return null;
  if (!Array.isArray(raw.constraints)) return null;
  if (!Number.isFinite(Number(raw.acceptedConstraintCount)) || raw.acceptedConstraintCount !== raw.constraints.length) return null;
  return raw as TectonicStatePhase4Seed;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const source = sourceFrom(body.event);
  if (!source) {
    return NextResponse.json(
      { error: "Fase 4 requiere un evento real con ID, tiempo, posición, profundidad y magnitud válidos." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const seed = seedFrom(body.seed, source.id);
  if (!seed) {
    return NextResponse.json(
      { error: "Fase 4 requiere el contrato phase4Seed correspondiente al mismo evento de Fase 3 v1.0." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const [gnssSettled, insarSettled] = await Promise.allSettled([
    loadNglGnssDeformation(source, { signal: request.signal, maxStations: 8 }),
    loadCometInSarCatalog(source, request.signal),
  ]);

  const gnss = gnssSettled.status === "fulfilled"
    ? gnssSettled.value
    : emptyNglGnssResult(gnssSettled.reason instanceof Error ? gnssSettled.reason.message : "NGL no disponible.");
  const insar = insarSettled.status === "fulfilled"
    ? insarSettled.value
    : emptyCometInSarCatalog(insarSettled.reason instanceof Error ? insarSettled.reason.message : "COMET LiCSAR no disponible.");
  const phase4 = buildTectonicStatePhase4Result(source, seed, gnss, insar);

  return NextResponse.json({
    phase: 4,
    generatedAt: phase4.generatedAt,
    source,
    phase4,
    methodology: {
      gnssProvider: "Nevada Geodetic Laboratory IGS20 daily position time series; rapid 24 h when coverage permits, final otherwise",
      displacementEstimator: "weighted linear pre-event trend removed independently from E/N/U; robust post-event residual median",
      field: "quality/precision/distance-weighted interpolation of observed GNSS E/N/U; structural constraints never alter measured displacement",
      phase3Coupling: "strict phase4Seed; failed Phase 3 gate contributes zero structural constraints while GNSS remains observable",
      insar: "COMET LiCSAR event catalog discovery; LOS GeoTIFF deliberately excluded from numeric fusion in v0.1 until raster/phase/look-vector validation",
      prediction: "none; this is an observed deformation reconstruction, not earthquake probability",
    },
  }, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
