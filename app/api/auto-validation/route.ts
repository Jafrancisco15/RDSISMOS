import { NextRequest, NextResponse } from "next/server";
import { scoreAutoValidation, type ValidationProbabilityCase } from "@/lib/autoValidation";
import { countryByCode } from "@/lib/countries";
import { getDb, hasDatabaseConfiguration } from "@/lib/db";
import { etasSourceCanAffectTarget, replayEtasProbability } from "@/lib/etasReplay";
import { queryEarthquakes } from "@/lib/earthquakes/usgs";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import { loadScopeHistoricalEvidence } from "@/lib/scopeHistoricalEvidence";
import { buildScopeProjection, type ScopeProjectionResponse } from "@/lib/scopeProjection";
import type { HistoricalMigrationCapsule, SeismicEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY_MS = 86_400_000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 14;

function numeric(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isCapsule(value: unknown): value is HistoricalMigrationCapsule {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Boolean(
    record.id
    && record.sourceEvent
    && record.targetCountry
    && Array.isArray(record.destinations)
    && Array.isArray(record.analogs),
  );
}

function toSeismicEvent(event: EarthquakeEvent): SeismicEvent {
  return {
    id: event.externalId || event.id,
    time: event.timeUtc,
    updatedAt: event.updatedUtc,
    magnitude: event.magnitude,
    magnitudeType: event.magnitudeType,
    latitude: event.latitude,
    longitude: event.longitude,
    depthKm: event.depthKm,
    place: event.place,
    agency: event.network || event.magnitudeSource || event.sourceCatalog,
    source: event.sourceCatalog,
    detailUrl: event.sourceUrl,
  };
}

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
  const sql = getDb();
  if (!sql) {
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      available: false,
      databaseConfigured: hasDatabaseConfiguration(),
      databaseConnected: false,
      warning: "La memoria prospectiva no está disponible; Auto-Validación no puede fabricar métricas sin resultados persistidos.",
      methods: [],
      ranking: [],
      cases: [],
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }

  const requestedLimit = Math.trunc(numeric(request.nextUrl.searchParams.get("limit"), DEFAULT_LIMIT));
  const limit = Math.min(MAX_LIMIT, Math.max(4, requestedLimit));

  try {
    const [totalRow] = await sql`
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT DISTINCT p.capsule_id, p.country_code
        FROM migration_country_predictions p
        JOIN migration_outcomes o ON o.prediction_id = p.id
        WHERE p.analog_hits > 0
      ) q
    `;

    const rows = await sql`
      WITH ranked AS (
        SELECT
          p.id AS prediction_id,
          p.capsule_id,
          p.country_code,
          p.country_name,
          p.probability_pct,
          p.baseline_probability_pct,
          p.surveillance_start,
          p.surveillance_end,
          p.magnitude_min,
          p.magnitude_max,
          p.analog_hits,
          c.generated_at,
          c.capsule_payload,
          o.occurred,
          o.evaluated_at,
          ROW_NUMBER() OVER (
            PARTITION BY p.capsule_id, p.country_code
            ORDER BY o.evaluated_at DESC, p.analog_hits DESC, p.probability_pct DESC, p.updated_at DESC
          ) AS duplicate_rank
        FROM migration_country_predictions p
        JOIN migration_capsules c ON c.id = p.capsule_id
        JOIN migration_outcomes o ON o.prediction_id = p.id
        WHERE p.analog_hits > 0
      )
      SELECT *
      FROM ranked
      WHERE duplicate_rank = 1
      ORDER BY evaluated_at DESC
      LIMIT ${limit}
    `;

    const validRows = rows.filter((row) => isCapsule(row.capsule_payload));
    if (!validRows.length) {
      return NextResponse.json({
        generatedAt: new Date().toISOString(),
        available: true,
        databaseConfigured: true,
        databaseConnected: true,
        prospectiveEvaluatedCases: numeric(totalRow?.total),
        pairedCasesRequested: limit,
        pairedCasesUsed: 0,
        climatologyPct: 0,
        methods: [],
        ranking: [],
        cases: [],
        warning: "Todavía no hay casos evaluados utilizables para comparar los tres métodos.",
      }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
    }

    const capsuleById = new Map<string, HistoricalMigrationCapsule>();
    for (const row of validRows) {
      capsuleById.set(String(row.capsule_id), row.capsule_payload as HistoricalMigrationCapsule);
    }

    const evidenceCache = new Map<string, Promise<Awaited<ReturnType<typeof loadScopeHistoricalEvidence>>>>();
    const scopeByCapsule = new Map<string, ScopeProjectionResponse>();
    await mapWithConcurrency([...capsuleById.entries()], 2, async ([capsuleId, capsule]) => {
      const analogs = capsule.analogs.slice(0, 10);
      const evidence = await mapWithConcurrency(analogs, 3, async (analog, index) => {
        const probeWaveform = index < 4;
        const key = `${analog.analogEvent.id}:${probeWaveform ? "wave" : "meta"}`;
        let pending = evidenceCache.get(key);
        if (!pending) {
          pending = loadScopeHistoricalEvidence(analog.analogEvent, { probeWaveform });
          evidenceCache.set(key, pending);
        }
        return pending;
      });
      scopeByCapsule.set(capsuleId, buildScopeProjection({ ...capsule, analogs }, evidence));
    });

    const warnings: string[] = [];
    const caseResults = await mapWithConcurrency(validRows, 2, async (row) => {
      const capsule = row.capsule_payload as HistoricalMigrationCapsule;
      const target = countryByCode(String(row.country_code));
      const source = capsule.sourceEvent;
      const issuedAt = new Date(String(row.generated_at));
      let etasProbabilityPct = 0;
      let etasEmitted = false;
      let etasSourceAgeDays = Math.max(0, (issuedAt.getTime() - Date.parse(source.time)) / DAY_MS);
      let etasError: string | null = null;

      if (etasSourceCanAffectTarget(source, target)) {
        try {
          const start = new Date(issuedAt.getTime() - 90 * DAY_MS);
          const page = await queryEarthquakes({
            startTime: start.toISOString(),
            endTime: issuedAt.toISOString(),
            minMagnitude: 4.2,
            latitude: target.latitude,
            longitude: target.longitude,
            maxRadiusKm: target.radiusKm + 2_000,
            eventType: "earthquake",
            orderBy: "time",
            limit: 5_000,
            offset: 1,
          }, request.signal);
          const context = page.events.map(toSeismicEvent);
          if (!context.some((event) => event.id === source.id)) context.push(source);
          const replay = replayEtasProbability(source, context, target, issuedAt);
          etasProbabilityPct = replay.probabilityPct;
          etasEmitted = replay.emitted;
          etasSourceAgeDays = replay.sourceAgeDays;
        } catch (error) {
          etasError = error instanceof Error ? error.message : "No fue posible reconstruir ETAS.";
        }
      }

      const scope = scopeByCapsule.get(String(row.capsule_id));
      const scopeDestination = scope?.destinations.find((item) => item.countryCode === target.code);
      return {
        id: `${String(row.capsule_id)}:${target.code}`,
        capsuleId: String(row.capsule_id),
        countryCode: target.code,
        countryName: target.name,
        sourcePlace: source.place,
        sourceMagnitude: source.magnitude,
        sourceTime: source.time,
        issuedAt: issuedAt.toISOString(),
        evaluatedAt: new Date(String(row.evaluated_at)).toISOString(),
        occurred: Boolean(row.occurred),
        map3dProbabilityPct: numeric(row.probability_pct),
        map3dBaselinePct: numeric(row.baseline_probability_pct),
        etasProbabilityPct,
        etasEmitted,
        etasSourceAgeDays: Number(etasSourceAgeDays.toFixed(2)),
        etasError,
        scopeProbabilityPct: scopeDestination?.probabilityPct ?? 0,
        scopeBaselinePct: scopeDestination?.baselinePct ?? 0,
        scopeEvidenceQualityPct: scope?.evidenceQualityPct ?? 0,
      };
    });

    const comparable = caseResults.filter((item) => {
      if (!item.etasError) return true;
      warnings.push(`${item.countryName} / ${item.sourcePlace}: ETAS replay no disponible (${item.etasError}).`);
      return false;
    });

    const scoringCases: ValidationProbabilityCase[] = comparable.map((item) => ({
      id: item.id,
      occurred: item.occurred,
      probabilities: {
        map3d: item.map3dProbabilityPct,
        etas: item.etasProbabilityPct,
        scope: item.scopeProbabilityPct,
      },
    }));
    const scored = scoreAutoValidation(scoringCases);

    const casePayload = comparable.map(({ etasError: _etasError, ...item }) => item);
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      available: true,
      databaseConfigured: true,
      databaseConnected: true,
      prospectiveEvaluatedCases: numeric(totalRow?.total),
      pairedCasesRequested: validRows.length,
      pairedCasesUsed: comparable.length,
      climatologyPct: scored.climatologyPct,
      methods: scored.methods,
      ranking: scored.ranking,
      cases: casePayload,
      warnings,
      methodology: [
        "Mapa 3D usa la probabilidad persistida antes de conocerse el resultado y el resultado auditado de esa cápsula.",
        "Scope Projection reconstruye la misma cápsula congelada y repondera sus análogos con evidencia histórica EarthScope; se etiqueta como replay retrospectivo hasta acumular un ledger prospectivo propio.",
        "ETAS Projection reconstruye la fórmula operacional usando únicamente catálogo USGS disponible hasta la fecha de emisión del caso; no se introducen eventos posteriores al calcular la probabilidad.",
        "Los tres modelos se comparan sobre los mismos pares evento-precedente/país seleccionados del ledger evaluado de Mapa 3D. Esto es útil para comparación pareada, pero favorece el universo de casos que Mapa 3D decidió emitir y no sustituye una prueba CSEP independiente.",
        "Information Gain usa como referencia una climatología común Laplace-suavizada de esta misma muestra. Falsos positivos y omisiones usan esa climatología como umbral común de señal.",
      ],
    }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      available: false,
      databaseConfigured: true,
      databaseConnected: false,
      warning: error instanceof Error ? error.message : "No fue posible construir Auto-Validación.",
      methods: [],
      ranking: [],
      cases: [],
    }, {
      status: 200,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }
}
