import { COUNTRIES } from "@/lib/countries";
import { getDb, hasDatabaseConfiguration } from "@/lib/db";
import { queryEarthquakeCatalogAll } from "@/lib/earthquakes/catalog";
import type { EarthquakeEvent, EarthquakeFilters } from "@/lib/earthquakes/types";
import { buildHistoricalMigrationCapsuleV2 } from "@/lib/historicalMigrationV2";
import { haversineKm } from "@/lib/regions";
import type { CountryTarget, SeismicEvent } from "@/lib/types";
import { projectionIsOperational } from "./operationalProjection";
import { persistMigrationCapsule } from "./store";

const DAY_MS = 86_400_000;
const DEFAULT_LOOKBACK_DAYS = 14;
const DEFAULT_MINIMUM_MAGNITUDE = 4.5;
const DEFAULT_SOURCE_LIMIT = 1;
const DEFAULT_CANDIDATE_LIMIT = 12;
const MAX_SCAN_EVENTS = 5_000;
const SAME_SEQUENCE_DAYS = 3;
const SAME_SEQUENCE_KM = 450;

export interface AutomaticGenerationOptions {
  lookbackDays?: number;
  minimumMagnitude?: number;
  sourceLimit?: number;
  candidateLimit?: number;
}

export interface AutomaticGenerationSummary {
  generatedAt: string;
  databaseConfigured: boolean;
  databaseConnected: boolean;
  configuration: {
    lookbackDays: number;
    minimumMagnitude: number;
    sourceLimit: number;
    candidateLimit: number;
  };
  catalogEvents: number;
  alreadyKnownSources: number;
  candidatesConsidered: number;
  sourcesAttempted: number;
  capsulesCreated: number;
  operationalPredictionsCreated: number;
  created: Array<{
    sourceEventId: string;
    sourceMagnitude: number;
    sourcePlace: string;
    targetCountryCode: string;
    targetCountryName: string;
    capsuleId: string;
    destinations: number;
    operationalDestinations: number;
  }>;
  skipped: Array<{
    sourceEventId: string;
    sourceMagnitude: number;
    sourcePlace: string;
    reason: string;
  }>;
  errors: string[];
}

type StoredSource = {
  id: string;
  time: number;
  magnitude: number;
  latitude: number;
  longitude: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function numeric(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function analysisMagnitude(event: EarthquakeEvent) {
  return event.magnitudeMw ?? event.magnitude;
}

function toSeismicEvent(event: EarthquakeEvent): SeismicEvent {
  return {
    id: event.id,
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
    magnitudeMw: event.magnitudeMw,
    magnitudeNormalizationMethod: event.magnitudeNormalizationMethod,
    magnitudeNormalizationUncertainty: event.magnitudeNormalizationUncertainty,
    receiverZoneId: event.receiverZoneId,
    receiverZoneName: event.receiverZoneName,
    tectonicRegime: event.tectonicRegime,
    receiverZoneConfidence: event.receiverZoneConfidence,
    parentCandidateId: event.parentCandidateId,
    sequenceAssociationScorePct: event.sequenceAssociationScorePct,
    backgroundScorePct: event.backgroundScorePct,
    sequenceClassification: event.sequenceClassification,
    sequenceScoreCalibrated: event.sequenceScoreCalibrated,
  };
}

function nearestCountry(event: EarthquakeEvent): CountryTarget {
  let best = COUNTRIES[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const country of COUNTRIES) {
    const distance = haversineKm(
      event.latitude,
      event.longitude,
      country.latitude,
      country.longitude,
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = country;
    }
  }
  return best;
}

function sameSequence(a: EarthquakeEvent, b: EarthquakeEvent) {
  const timeDistance = Math.abs(Date.parse(a.timeUtc) - Date.parse(b.timeUtc));
  return timeDistance < SAME_SEQUENCE_DAYS * DAY_MS
    && haversineKm(a.latitude, a.longitude, b.latitude, b.longitude) < SAME_SEQUENCE_KM;
}

function equivalentStoredSource(event: EarthquakeEvent, stored: StoredSource[]) {
  if (stored.some((item) => item.id === event.id)) return true;
  const eventTime = Date.parse(event.timeUtc);
  return stored.some((item) => (
    Math.abs(item.time - eventTime) <= 20 * 60_000
    && Math.abs(item.magnitude - event.magnitude) <= 0.35
    && haversineKm(item.latitude, item.longitude, event.latitude, event.longitude) <= 80
  ));
}

function chooseIndependentCandidates(
  events: EarthquakeEvent[],
  stored: StoredSource[],
  candidateLimit: number,
) {
  const ranked = events
    .filter((event) => !equivalentStoredSource(event, stored))
    .sort((a, b) => (
      analysisMagnitude(b) - analysisMagnitude(a)
      || Date.parse(b.timeUtc) - Date.parse(a.timeUtc)
    ));

  const selected: EarthquakeEvent[] = [];
  for (const candidate of ranked) {
    if (selected.some((event) => sameSequence(event, candidate))) continue;
    selected.push(candidate);
    if (selected.length >= candidateLimit) break;
  }
  return selected;
}

async function loadStoredSources(startTime: string): Promise<StoredSource[]> {
  const sql = getDb();
  if (!sql) return [];
  const rows = await sql`
    SELECT DISTINCT ON (source_event_external_id)
      source_event_external_id,
      source_time,
      source_magnitude,
      source_latitude,
      source_longitude
    FROM migration_capsules
    WHERE source_time >= ${startTime}
    ORDER BY source_event_external_id, generated_at DESC
  `;
  return rows.map((row) => ({
    id: String(row.source_event_external_id),
    time: Date.parse(String(row.source_time)),
    magnitude: Number(row.source_magnitude),
    latitude: Number(row.source_latitude),
    longitude: Number(row.source_longitude),
  }));
}

export async function runAutomaticProjectionGeneration(
  rawOptions: AutomaticGenerationOptions = {},
): Promise<AutomaticGenerationSummary> {
  const now = new Date();
  const lookbackDays = Math.trunc(clamp(numeric(rawOptions.lookbackDays, DEFAULT_LOOKBACK_DAYS), 2, 30));
  const minimumMagnitude = clamp(numeric(rawOptions.minimumMagnitude, DEFAULT_MINIMUM_MAGNITUDE), 4.5, 7.5);
  const sourceLimit = Math.trunc(clamp(numeric(rawOptions.sourceLimit, DEFAULT_SOURCE_LIMIT), 1, 3));
  const candidateLimit = Math.trunc(clamp(numeric(rawOptions.candidateLimit, DEFAULT_CANDIDATE_LIMIT), sourceLimit, 30));
  const start = new Date(now.getTime() - lookbackDays * DAY_MS);

  const summary: AutomaticGenerationSummary = {
    generatedAt: now.toISOString(),
    databaseConfigured: hasDatabaseConfiguration(),
    databaseConnected: Boolean(getDb()),
    configuration: { lookbackDays, minimumMagnitude, sourceLimit, candidateLimit },
    catalogEvents: 0,
    alreadyKnownSources: 0,
    candidatesConsidered: 0,
    sourcesAttempted: 0,
    capsulesCreated: 0,
    operationalPredictionsCreated: 0,
    created: [],
    skipped: [],
    errors: [],
  };

  if (!getDb()) {
    summary.errors.push("DATABASE_URL no está configurada; no se puede emitir una proyección canónica.");
    return summary;
  }

  const filters: EarthquakeFilters = {
    startTime: start.toISOString(),
    endTime: now.toISOString(),
    minMagnitude: minimumMagnitude,
    maxMagnitude: 9.5,
    eventType: "earthquake",
    orderBy: "magnitude",
    limit: 20_000,
    offset: 1,
  };

  const catalog = await queryEarthquakeCatalogAll(filters, MAX_SCAN_EVENTS);
  summary.catalogEvents = catalog.length;
  const stored = await loadStoredSources(start.toISOString());
  summary.alreadyKnownSources = stored.length;
  const candidates = chooseIndependentCandidates(catalog, stored, candidateLimit);
  summary.candidatesConsidered = candidates.length;

  for (const event of candidates) {
    if (summary.capsulesCreated >= sourceLimit) break;
    summary.sourcesAttempted += 1;
    const target = nearestCountry(event);
    try {
      const capsule = await buildHistoricalMigrationCapsuleV2(
        toSeismicEvent(event),
        target.code,
      );
      const storage = await persistMigrationCapsule(capsule);
      if (!storage.persisted) {
        summary.skipped.push({
          sourceEventId: event.id,
          sourceMagnitude: analysisMagnitude(event),
          sourcePlace: event.place,
          reason: storage.reason ?? "No fue posible persistir la cápsula.",
        });
        continue;
      }
      const operationalDestinations = capsule.destinations.filter((destination) => projectionIsOperational({
        probabilityPct: destination.recurrencePct,
        liftPct: destination.liftPct ?? destination.recurrencePct - (destination.baselinePct ?? 0),
        magnitudeMax: destination.magnitudeMax ?? capsule.forecastMagnitudeMax,
      }));
      summary.capsulesCreated += 1;
      summary.operationalPredictionsCreated += operationalDestinations.length;
      summary.created.push({
        sourceEventId: event.id,
        sourceMagnitude: analysisMagnitude(event),
        sourcePlace: event.place,
        targetCountryCode: target.code,
        targetCountryName: target.name,
        capsuleId: storage.capsuleId ?? capsule.id,
        destinations: capsule.destinations.length,
        operationalDestinations: operationalDestinations.length,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Error desconocido";
      summary.skipped.push({
        sourceEventId: event.id,
        sourceMagnitude: analysisMagnitude(event),
        sourcePlace: event.place,
        reason,
      });
    }
  }

  if (!summary.capsulesCreated && !summary.candidatesConsidered) {
    summary.errors.push("No hay nuevos eventos precedentes independientes dentro del intervalo solicitado.");
  }
  return summary;
}
