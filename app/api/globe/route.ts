import { NextResponse } from "next/server";
import { COUNTRIES, countryByCode } from "@/lib/countries";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { GlobeProjection, SeismicGlobeResponse } from "@/lib/globeTypes";
import {
  loadGlobeProjectionsAt,
  loadRegionalEtasGlobeProjectionsAt,
} from "@/lib/learning/globeStore";
import { persistImmutableRegionalEtasProjections } from "@/lib/learning/immutableEtasStore";
import {
  OPERATIONAL_MINIMUM_MAGNITUDE,
  projectionIsOperational,
} from "@/lib/learning/operationalProjection";
import { generateMigrationProjections } from "@/lib/projections";
import { fetchExpandedSeismicCatalog } from "@/lib/providers/multisource";
import type { SeismicEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WINDOW_DAYS = 90;
const MINIMUM_MAGNITUDE = OPERATIONAL_MINIMUM_MAGNITUDE;
const DAY_MS = 86_400_000;
const PROJECTION_RENDER_LIMIT = 1_000;

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function asOfDate(raw: string | null, now: Date) {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return now;
  const endOfDay = new Date(`${raw}T23:59:59.999Z`);
  if (Number.isNaN(endOfDay.getTime())) return now;
  return endOfDay.getTime() > now.getTime() ? now : endOfDay;
}

function toEarthquakeEvent(event: SeismicEvent): EarthquakeEvent {
  return {
    id: event.id,
    externalId: event.id,
    sourceCatalog: event.source,
    timeUtc: event.time,
    updatedUtc: event.updatedAt ?? event.time,
    latitude: event.latitude,
    longitude: event.longitude,
    depthKm: event.depthKm,
    magnitude: event.magnitude,
    magnitudeType: event.magnitudeType,
    place: event.place,
    countryOrRegion: event.place.split(",").at(-1)?.trim() ?? event.place,
    eventType: "earthquake",
    status: "reported",
    network: event.agency,
    locationSource: event.source,
    magnitudeSource: event.agency,
    sourceUrl: event.detailUrl,
  };
}

function operational(projection: GlobeProjection) {
  return projectionIsOperational({
    probabilityPct: projection.probabilityPct,
    liftPct: projection.liftPct,
    magnitudeMax: projection.magnitudeMax,
  });
}

export async function GET(request: Request) {
  const now = new Date();
  const url = new URL(request.url);
  const target = countryByCode(url.searchParams.get("country"));
  const viewEnd = asOfDate(url.searchParams.get("date"), now);
  const comparisonRaw = url.searchParams.get("compare");
  const comparisonEnd = comparisonRaw ? asOfDate(comparisonRaw, now) : null;
  const startTime = new Date(viewEnd.getTime() - WINDOW_DAYS * DAY_MS);
  const warnings: string[] = [];
  const liveView = Math.abs(now.getTime() - viewEnd.getTime()) < 60_000;

  const [catalogResult, primaryStoredResult, comparisonStoredResult] = await Promise.allSettled([
    fetchExpandedSeismicCatalog(startTime, viewEnd, target, MINIMUM_MAGNITUDE),
    loadGlobeProjectionsAt(viewEnd, PROJECTION_RENDER_LIMIT),
    comparisonEnd
      ? loadGlobeProjectionsAt(comparisonEnd, PROJECTION_RENDER_LIMIT)
      : Promise.resolve(null),
  ]);

  const catalog = catalogResult.status === "fulfilled" ? catalogResult.value : null;
  if (catalogResult.status === "rejected") {
    warnings.push(catalogResult.reason instanceof Error
      ? `Catálogo observado: ${catalogResult.reason.message}`
      : "No fue posible cargar el catálogo observado.");
  }

  const primaryStored = primaryStoredResult.status === "fulfilled"
    ? primaryStoredResult.value
    : null;
  if (primaryStoredResult.status === "rejected") {
    warnings.push(primaryStoredResult.reason instanceof Error
      ? `Proyecciones: ${primaryStoredResult.reason.message}`
      : "No fue posible cargar las proyecciones históricas.");
  }
  if (primaryStored?.warning) warnings.push(`Proyecciones: ${primaryStored.warning}`);

  const comparisonStored = comparisonStoredResult.status === "fulfilled"
    ? comparisonStoredResult.value
    : null;
  if (comparisonStoredResult.status === "rejected") {
    warnings.push(comparisonStoredResult.reason instanceof Error
      ? `Comparación: ${comparisonStoredResult.reason.message}`
      : "No fue posible cargar la fecha de comparación.");
  }
  if (comparisonStored?.warning) warnings.push(`Comparación: ${comparisonStored.warning}`);

  const observedEvents = (catalog?.events ?? [])
    .filter((event) => event.magnitude >= MINIMUM_MAGNITUDE)
    .map(toEarthquakeEvent);

  if (catalog && liveView) {
    const generatedRegional = generateMigrationProjections(catalog.events, target, now, 60);
    const registry = await persistImmutableRegionalEtasProjections(generatedRegional);
    if (registry.warning) warnings.push(`Registro ETAS: ${registry.warning}`);
  }

  const [storedRegional, comparisonRegional] = await Promise.all([
    loadRegionalEtasGlobeProjectionsAt(viewEnd, PROJECTION_RENDER_LIMIT),
    comparisonEnd
      ? loadRegionalEtasGlobeProjectionsAt(comparisonEnd, PROJECTION_RENDER_LIMIT)
      : Promise.resolve({ registryAvailable: true, totalActive: 0, projections: [] }),
  ]);

  if (!storedRegional.registryAvailable) {
    warnings.push(
      "Registro ETAS no disponible: las proyecciones regionales calculadas para el país seleccionado no se publican ni se cuentan hasta quedar almacenadas en Supabase.",
    );
  }

  const historicalOperational = (primaryStored?.projections ?? []).filter(operational);
  const regionalOperational = storedRegional.projections.filter(operational);
  const comparisonHistorical = (comparisonStored?.projections ?? []).filter(operational);
  const comparisonEtas = comparisonRegional.projections.filter(operational);
  const projections = [
    ...historicalOperational,
    ...regionalOperational,
  ].sort((a, b) => b.liftPct - a.liftPct || b.probabilityPct - a.probabilityPct);
  const comparisonProjections = [
    ...comparisonHistorical,
    ...comparisonEtas,
  ].sort((a, b) => b.liftPct - a.liftPct || b.probabilityPct - a.probabilityPct);
  const projectionsTotal = projections.length;
  const targetProjections = projections.filter((projection) => projection.countryCode === target.code);
  const targetHistorical = targetProjections.filter(
    (projection) => projection.projectionKind === "historical-country",
  ).length;
  const targetEtas = targetProjections.filter(
    (projection) => projection.projectionKind === "regional-etas",
  ).length;

  warnings.push(
    `Integridad operacional: ${historicalOperational.length} históricas + ${regionalOperational.length} ETAS activas con señal positiva sobre la línea base. ${target.name}: ${targetProjections.length} (${targetHistorical} históricas y ${targetEtas} ETAS).`,
  );
  if (!targetProjections.length) {
    warnings.push(
      `${target.name} no tiene ahora una proyección operacional activa. Una fila con probabilidad igual o inferior a la línea base es un control estadístico, no un pronóstico de migración.`,
    );
  }

  const payload: SeismicGlobeResponse = {
    generatedAt: now.toISOString(),
    viewDate: dateKey(viewEnd),
    comparisonDate: comparisonEnd ? dateKey(comparisonEnd) : null,
    observedWindowDays: WINDOW_DAYS,
    observedMinimumMagnitude: MINIMUM_MAGNITUDE,
    observedTotal: observedEvents.length,
    observedEvents,
    provider: catalog?.provider ?? "EMSC",
    providerStatus: catalog?.providerStatus ?? [],
    projectionsTotal,
    projections,
    comparisonProjections,
    target,
    countries: COUNTRIES,
    databaseConfigured: primaryStored?.databaseConfigured ?? false,
    databaseConnected: primaryStored?.databaseConnected ?? false,
    warnings: [catalog?.warning, ...warnings].filter((value): value is string => Boolean(value)),
  };

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
