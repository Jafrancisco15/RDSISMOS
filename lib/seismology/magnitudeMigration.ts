import type { EarthquakeEvent, TectonicRegime } from "@/lib/earthquakes/types";
import { analysisMagnitude } from "./magnitudeNormalization";

export type MagnitudeMigrationScope = TectonicRegime | "global";

export interface MagnitudeMigrationPair {
  parentId: string;
  eventId: string;
  regime: TectonicRegime;
  parentMagnitudeMw: number;
  childMagnitudeMw: number;
  deltaMagnitude: number;
  lagDays: number;
  distanceKm: number;
  sameReceiverZone: boolean;
}

export interface MagnitudeMigrationSummary {
  scope: MagnitudeMigrationScope;
  sampleCount: number;
  parentCount: number;
  meanDeltaMagnitude: number | null;
  medianDeltaMagnitude: number | null;
  p10DeltaMagnitude: number | null;
  p25DeltaMagnitude: number | null;
  p75DeltaMagnitude: number | null;
  p90DeltaMagnitude: number | null;
  probabilityChildLower: number | null;
  probabilityChildAtLeastParent: number | null;
  probabilityDropAtLeastHalf: number | null;
  probabilityDropAtLeastOne: number | null;
  largestFollowerParentCount: number;
  largestFollowerMeanDrop: number | null;
  largestFollowerMedianDrop: number | null;
}

export interface EmpiricalMagnitudeMigrationResult {
  method: "empirical_delta_magnitude_v1";
  pairSelectionMethod: "space_time_receiver_without_child_magnitude_v1";
  magnitudeScale: "analysis_mw_homogenized";
  sampleCount: number;
  summaries: MagnitudeMigrationSummary[];
  interpretation: string[];
}

const REGIMES: TectonicRegime[] = [
  "subduction",
  "strike_slip",
  "rift_normal",
  "collision",
  "mixed",
];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * clamp(ratio, 0, 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function mean(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function normalizedMagnitude(event: EarthquakeEvent) {
  const magnitude = event.magnitudeMw
    ?? analysisMagnitude(event.magnitude, event.magnitudeType);
  return Number.isFinite(magnitude) ? magnitude : null;
}

/**
 * Builds parent-child pairs using only temporal, spatial and receiver-corridor
 * compatibility. Child magnitude is deliberately excluded from pair selection so
 * the observed delta-M distribution is not circularly constrained by the value
 * that we are trying to learn.
 */
export function buildMagnitudeMigrationPairs(events: EarthquakeEvent[]) {
  const byId = new Map(events.map((event) => [event.id, event]));
  const pairs: MagnitudeMigrationPair[] = [];

  for (const event of events) {
    if (!event.parentCandidateId || !event.tectonicRegime) continue;
    const parent = byId.get(event.parentCandidateId);
    if (!parent) continue;

    const lagDays = event.parentLagDays;
    const distanceKm = event.parentDistanceKm;
    if (
      lagDays === null
      || lagDays === undefined
      || distanceKm === null
      || distanceKm === undefined
      || !Number.isFinite(lagDays)
      || !Number.isFinite(distanceKm)
      || lagDays <= 0
    ) continue;

    const parentMagnitude = normalizedMagnitude(parent);
    const childMagnitude = normalizedMagnitude(event);
    if (parentMagnitude === null || childMagnitude === null) continue;

    const timeWindowDays = clamp(
      7 * 10 ** (0.35 * (parentMagnitude - 5)),
      2,
      90,
    );
    const distanceWindowKm = clamp(
      80 * 10 ** (0.3 * (parentMagnitude - 5)),
      40,
      900,
    );
    const sameReceiverZone = Boolean(
      event.receiverZoneId
      && parent.receiverZoneId
      && event.receiverZoneId === parent.receiverZoneId,
    );
    const spatiallyCompatible = distanceKm <= distanceWindowKm
      && (sameReceiverZone || distanceKm <= distanceWindowKm * 0.5);

    if (lagDays > timeWindowDays || !spatiallyCompatible) continue;

    pairs.push({
      parentId: parent.id,
      eventId: event.id,
      regime: event.tectonicRegime,
      parentMagnitudeMw: round(parentMagnitude, 3),
      childMagnitudeMw: round(childMagnitude, 3),
      deltaMagnitude: round(childMagnitude - parentMagnitude, 3),
      lagDays: round(lagDays, 4),
      distanceKm: round(distanceKm, 2),
      sameReceiverZone,
    });
  }

  return pairs;
}

function summarize(scope: MagnitudeMigrationScope, pairs: MagnitudeMigrationPair[]): MagnitudeMigrationSummary {
  const deltas = pairs.map((pair) => pair.deltaMagnitude);
  const parentIds = new Set(pairs.map((pair) => pair.parentId));
  const largestFollowerByParent = new Map<string, MagnitudeMigrationPair>();

  for (const pair of pairs) {
    const current = largestFollowerByParent.get(pair.parentId);
    if (!current || pair.childMagnitudeMw > current.childMagnitudeMw) {
      largestFollowerByParent.set(pair.parentId, pair);
    }
  }

  const largestFollowerDrops = [...largestFollowerByParent.values()]
    .map((pair) => pair.parentMagnitudeMw - pair.childMagnitudeMw);
  const average = mean(deltas);
  const largestAverage = mean(largestFollowerDrops);

  return {
    scope,
    sampleCount: pairs.length,
    parentCount: parentIds.size,
    meanDeltaMagnitude: average === null ? null : round(average),
    medianDeltaMagnitude: percentile(deltas, 0.5) === null ? null : round(percentile(deltas, 0.5)!),
    p10DeltaMagnitude: percentile(deltas, 0.1) === null ? null : round(percentile(deltas, 0.1)!),
    p25DeltaMagnitude: percentile(deltas, 0.25) === null ? null : round(percentile(deltas, 0.25)!),
    p75DeltaMagnitude: percentile(deltas, 0.75) === null ? null : round(percentile(deltas, 0.75)!),
    p90DeltaMagnitude: percentile(deltas, 0.9) === null ? null : round(percentile(deltas, 0.9)!),
    probabilityChildLower: pairs.length
      ? round(pairs.filter((pair) => pair.deltaMagnitude < 0).length / pairs.length)
      : null,
    probabilityChildAtLeastParent: pairs.length
      ? round(pairs.filter((pair) => pair.deltaMagnitude >= 0).length / pairs.length)
      : null,
    probabilityDropAtLeastHalf: pairs.length
      ? round(pairs.filter((pair) => pair.deltaMagnitude <= -0.5).length / pairs.length)
      : null,
    probabilityDropAtLeastOne: pairs.length
      ? round(pairs.filter((pair) => pair.deltaMagnitude <= -1).length / pairs.length)
      : null,
    largestFollowerParentCount: largestFollowerDrops.length,
    largestFollowerMeanDrop: largestAverage === null ? null : round(largestAverage),
    largestFollowerMedianDrop: percentile(largestFollowerDrops, 0.5) === null
      ? null
      : round(percentile(largestFollowerDrops, 0.5)!),
  };
}

export function analyzeEmpiricalMagnitudeMigration(events: EarthquakeEvent[]): EmpiricalMagnitudeMigrationResult {
  const pairs = buildMagnitudeMigrationPairs(events);
  return {
    method: "empirical_delta_magnitude_v1",
    pairSelectionMethod: "space_time_receiver_without_child_magnitude_v1",
    magnitudeScale: "analysis_mw_homogenized",
    sampleCount: pairs.length,
    summaries: [
      summarize("global", pairs),
      ...REGIMES.map((regime) => summarize(
        regime,
        pairs.filter((pair) => pair.regime === regime),
      )),
    ],
    interpretation: [
      "Delta-M se define como magnitud posterior menos magnitud del evento padre; valores negativos representan una disminución.",
      "La magnitud del evento posterior no participa en la selección del par, evitando imponer de antemano un margen alrededor del evento fuente.",
      "La estadística del mayor evento posterior por padre permite contrastar el catálogo con el comportamiento tipo ley de Båth sin forzarlo como regla.",
      "Los cuantiles son condicionales al umbral mínimo del catálogo usado en la corrida: un catálogo que excluye sismos pequeños puede subestimar la caída real de magnitud.",
      "Esta capa permanece experimental y no modifica las proyecciones operacionales hasta superar validación fuera de muestra.",
    ],
  };
}

export function empiricalFollowerMagnitudeInterval(
  sourceMagnitudeMw: number,
  summary: MagnitudeMigrationSummary,
) {
  if (
    summary.p10DeltaMagnitude === null
    || summary.p25DeltaMagnitude === null
    || summary.medianDeltaMagnitude === null
    || summary.p75DeltaMagnitude === null
    || summary.p90DeltaMagnitude === null
  ) return null;

  return {
    broadP10P90: {
      minimum: round(sourceMagnitudeMw + summary.p10DeltaMagnitude, 2),
      maximum: round(sourceMagnitudeMw + summary.p90DeltaMagnitude, 2),
    },
    centralP25P75: {
      minimum: round(sourceMagnitudeMw + summary.p25DeltaMagnitude, 2),
      maximum: round(sourceMagnitudeMw + summary.p75DeltaMagnitude, 2),
    },
    median: round(sourceMagnitudeMw + summary.medianDeltaMagnitude, 2),
  };
}
