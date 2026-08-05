import { NextResponse } from "next/server";
import { COUNTRIES, countryByCode } from "@/lib/countries";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { GlobeProjection, SeismicGlobeResponse } from "@/lib/globeTypes";
import {
  loadGlobeProjectionsAt,
  loadRegionalEtasGlobeProjectionsAt,
} from "@/lib/learning/globeStore";
import { persistRegionalEtasProjections } from "@/lib/learning/etasStore";
import { generateMigrationProjections } from "@/lib/projections";
import { fetchExpandedSeismicCatalog } from "@/lib/providers/multisource";
import type { SeismicEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WINDOW_DAYS = 90;
const MINIMUM_MAGNITUDE = 4.2;
const DAY_MS = 86_400_000;

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

function regionalProjectionToGlobe(
  projection: ReturnType<typeof generateMigrationProjections>[number],
  snapshotDate: string,
  generatedAt: Date,
): GlobeProjection {
  return {
    id: `regional:${projection.id}`,
    projectionKind: "regional-etas",
    snapshotDate,
    generatedAt: projection.startTime ?? generatedAt.toISOString(),
    countryCode: projection.targetCountry.code,
    countryName: projection.targetCountry.name,
    latitude: projection.projectedZone.latitude,
    longitude: projection.projectedZone.longitude,
    radiusKm: projection.projectedZone.radiusKm,
    probabilityPct: projection.probabilityPct,
    baselinePct: projection.backgroundProbabilityPct,
    liftPct: projection.excessProbabilityPct,
    surveillanceStart: projection.startTime,
    surveillanceEnd: projection.expiresAt,
    magnitudeMin: Math.max(MINIMUM_MAGNITUDE, projection.magnitudeMin),
    magnitudeMax: projection.magnitudeMax,
    analogHits: 0,
    controlHits: 0,
    medianLeadDays: null,
    sourceEvent: {
      id: projection.sourceEvent.id,
      time: projection.sourceEvent.time,
      magnitude: projection.sourceEvent.magnitude,
      latitude: projection.sourceEvent.latitude,
      longitude: projection.sourceEvent.longitude,
      place: projection.sourceEvent.place,
    },
    confidencePct: projection.migrationCompatibilityPct
      ?? Math.min(90, Math.max(10, projection.excessProbabilityPct)),
  };
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
    loadGlobeProjectionsAt(viewEnd, 600),
    comparisonEnd ? loadGlobeProjectionsAt(comparisonEnd, 600) : Promise.resolve(null),
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

  let generatedRegional: ReturnType<typeof generateMigrationProjections> = [];
  let registryAvailable = false;
  if (catalog && liveView) {
    generatedRegional = generateMigrationProjections(catalog.events, target, now, 60);
    const registry = await persistRegionalEtasProjections(generatedRegional);
    registryAvailable = registry.registryAvailable;
    if (registry.warning) warnings.push(`Registro ETAS: ${registry.warning}`);
  }

  const [storedRegional, comparisonRegional] = await Promise.all([
    loadRegionalEtasGlobeProjectionsAt(viewEnd, 600),
    comparisonEnd ? loadRegionalEtasGlobeProjectionsAt(comparisonEnd, 600) : Promise.resolve([]),
  ]);
  const regionalProjections = storedRegional.length || registryAvailable
    ? storedRegional
    : generatedRegional
        .filter((projection) => projection.status === "active" && projection.magnitudeMax >= MINIMUM_MAGNITUDE)
        .map((projection) => regionalProjectionToGlobe(projection, dateKey(viewEnd), viewEnd));
  const projections = [
    ...(primaryStored?.projections ?? []),
    ...regionalProjections,
  ].sort((a, b) => b.probabilityPct - a.probabilityPct || b.liftPct - a.liftPct);
  const comparisonProjections = [
    ...(comparisonStored?.projections ?? []),
    ...comparisonRegional,
  ].sort((a, b) => b.probabilityPct - a.probabilityPct || b.liftPct - a.liftPct);

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
    projectionsTotal: projections.length,
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
