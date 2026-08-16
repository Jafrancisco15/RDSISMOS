import { NextRequest, NextResponse } from "next/server";
import { countryByCode } from "@/lib/countries";
import { loadActiveCountryCapsules } from "@/lib/learning/outlookStore";
import { loadScopeHistoricalEvidence } from "@/lib/scopeHistoricalEvidence";
import { buildScopeProjection } from "@/lib/scopeProjection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ACTIVE_CAPSULES = 6;

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
) {
  const output = new Array<R>(values.length);
  let cursor = 0;
  async function consume() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => consume()));
  return output;
}

export async function GET(request: NextRequest) {
  const countryCode = request.nextUrl.searchParams.get("country")?.trim().toUpperCase() || "DO";
  const target = countryByCode(countryCode);
  const stored = await loadActiveCountryCapsules(target.code, MAX_ACTIVE_CAPSULES);

  if (!stored.databaseConnected) {
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      target,
      databaseConfigured: stored.databaseConfigured,
      databaseConnected: false,
      checkedCapsules: 0,
      maximumCapsulesChecked: MAX_ACTIVE_CAPSULES,
      projections: [],
      warning: stored.warning || "No fue posible consultar la memoria de proyecciones activas.",
    }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }

  const now = Date.now();
  const results = await mapWithConcurrency(stored.capsules, 2, async (capsule) => {
    const analogs = capsule.analogs.slice(0, 10);
    const evidence = await mapWithConcurrency(analogs, 3, async (analog, index) => (
      loadScopeHistoricalEvidence(analog.analogEvent, { probeWaveform: index < 4 })
    ));
    const scope = buildScopeProjection({ ...capsule, analogs }, evidence);
    const destination = scope.destinations.find((item) => {
      if (item.countryCode !== target.code) return false;
      const start = Date.parse(item.surveillanceStart);
      const end = Date.parse(item.surveillanceEnd);
      return Number.isFinite(start) && Number.isFinite(end) && start <= now && end > now;
    });
    if (!destination) return null;

    return {
      id: `${scope.source.id}:${destination.countryCode}`,
      source: scope.source,
      destination,
      generatedAt: scope.generatedAt,
      evidenceQualityPct: scope.evidenceQualityPct,
      analogsEvaluated: scope.analogsEvaluated,
      earthScopeSupportedAnalogs: scope.earthScopeSupportedAnalogs,
      waveformConfirmedAnalogs: scope.waveformConfirmedAnalogs,
    };
  });

  const projections = results
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => (
      b.destination.liftPct - a.destination.liftPct
      || b.destination.probabilityPct - a.destination.probabilityPct
      || Date.parse(b.source.time) - Date.parse(a.source.time)
    ));

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    target,
    databaseConfigured: true,
    databaseConnected: true,
    checkedCapsules: stored.capsules.length,
    maximumCapsulesChecked: MAX_ACTIVE_CAPSULES,
    projections,
    warning: projections.length
      ? undefined
      : `No se encontró una señal Scope activa positiva para ${target.name} entre las cápsulas activas revisadas.`,
  }, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
