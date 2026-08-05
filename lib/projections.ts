import { haversineKm } from "./regions";
import type {
  CountryTarget,
  EtasModelParameters,
  MigrationProjection,
  ProjectionAssociationClass,
  SeismicEvent,
} from "./types";

const DAY_MS = 86_400_000;
const ETAS_COMPATIBLE_THRESHOLD = 55;
const ETAS_POSSIBLE_THRESHOLD = 30;

const BASE_PARAMETERS = {
  productivityK: 0.005,
  productivityAlpha: 1.4,
  omoriC: 0.05,
  omoriP: 1.1,
  spatialQ: 1.6,
  gutenbergRichterB: 1,
} as const;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function ageDays(event: SeismicEvent, now: Date) {
  return Math.max(0, (now.getTime() - new Date(event.time).getTime()) / DAY_MS);
}

function estimateMagnitudeCompleteness(
  events: SeismicEvent[],
  target: CountryTarget,
) {
  const localMagnitudes = events
    .filter(
      (event) =>
        haversineKm(
          event.latitude,
          event.longitude,
          target.latitude,
          target.longitude,
        ) <= target.radiusKm + 1_200,
    )
    .map((event) => event.magnitude)
    .filter(Number.isFinite);

  if (localMagnitudes.length < 20) return 3;
  const bins = new Map<number, number>();
  for (const magnitude of localMagnitudes) {
    const bin = Math.round(magnitude * 10) / 10;
    bins.set(bin, (bins.get(bin) ?? 0) + 1);
  }
  const modalBin = [...bins.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 2.8;
  return clamp(Number((modalBin + 0.2).toFixed(1)), 2.5, 4.5);
}

function integratedOmori(t0: number, t1: number, c: number, p: number) {
  if (t1 <= t0) return 0;
  if (Math.abs(p - 1) < 0.0001) return Math.log((t1 + c) / (t0 + c));
  return (
    (Math.pow(t1 + c, 1 - p) - Math.pow(t0 + c, 1 - p)) /
    (1 - p)
  );
}

function normalizeLongitudeDifference(value: number) {
  if (value > 180) return value - 360;
  if (value < -180) return value + 360;
  return value;
}

function projectedPoint(source: SeismicEvent, target: CountryTarget) {
  const distance = haversineKm(
    source.latitude,
    source.longitude,
    target.latitude,
    target.longitude,
  );
  if (distance <= target.radiusKm) {
    return { latitude: source.latitude, longitude: source.longitude };
  }

  const ratio = clamp((target.radiusKm * 0.82) / Math.max(distance, 1), 0, 1);
  const longitudeDifference = normalizeLongitudeDifference(
    source.longitude - target.longitude,
  );
  let longitude = target.longitude + longitudeDifference * ratio;
  if (longitude > 180) longitude -= 360;
  if (longitude < -180) longitude += 360;
  return {
    latitude: target.latitude + (source.latitude - target.latitude) * ratio,
    longitude,
  };
}

function backgroundExpectedCount(
  events: SeismicEvent[],
  sourceEvent: SeismicEvent,
  center: { latitude: number; longitude: number },
  radiusKm: number,
  magnitudeMin: number,
  forecastDays: number,
) {
  const sourceTime = Date.parse(sourceEvent.time);
  const earliestAvailable = events.reduce(
    (minimum, event) => Math.min(minimum, Date.parse(event.time)),
    sourceTime - 90 * DAY_MS,
  );
  const lookbackStart = Math.max(sourceTime - 90 * DAY_MS, earliestAvailable);
  const lookbackDays = Math.max(7, (sourceTime - lookbackStart) / DAY_MS);
  const count = events.filter((event) => {
    const time = Date.parse(event.time);
    return event.id !== sourceEvent.id
      && time >= lookbackStart
      && time < sourceTime
      && event.magnitude >= magnitudeMin
      && haversineKm(event.latitude, event.longitude, center.latitude, center.longitude) <= radiusKm;
  }).length;

  // Jeffreys-style half-event smoothing prevents an empty short catalogue from
  // being interpreted as proof that the background rate is exactly zero.
  const ratePerDay = (count + 0.5) / (lookbackDays + 1);
  return Math.max(0, ratePerDay * forecastDays);
}

function probabilityFromExpectedCount(expectedCount: number) {
  return clamp((1 - Math.exp(-Math.max(0, expectedCount))) * 100, 0, 99);
}

function buildProjection(
  sourceEvent: SeismicEvent,
  events: SeismicEvent[],
  target: CountryTarget,
  magnitudeCompleteness: number,
  generatedAt: Date,
): MigrationProjection | null {
  const distanceToTarget = haversineKm(
    sourceEvent.latitude,
    sourceEvent.longitude,
    target.latitude,
    target.longitude,
  );
  const projectedRadiusKm = clamp(
    120 * Math.pow(10, 0.35 * (sourceEvent.magnitude - 5)),
    90,
    750,
  );

  // ETAS describes regional triggering. Reject remote, non-overlapping routes.
  if (distanceToTarget > target.radiusKm + projectedRadiusKm + 900) return null;

  const maxDays = clamp(Math.round(7 + (sourceEvent.magnitude - 5) * 2), 5, 14);
  const sourceTime = new Date(sourceEvent.time);
  const expiresAt = new Date(sourceTime.getTime() + maxDays * DAY_MS);
  const currentAge = ageDays(sourceEvent, generatedAt);
  if (generatedAt.getTime() >= expiresAt.getTime() || currentAge >= maxDays) return null;

  const magnitudeMin = Number(
    Math.max(magnitudeCompleteness, sourceEvent.magnitude - 1.8).toFixed(1),
  );
  const magnitudeMax = Number(Math.min(8.8, sourceEvent.magnitude + 0.4).toFixed(1));
  const productivity =
    BASE_PARAMETERS.productivityK *
    Math.exp(
      BASE_PARAMETERS.productivityAlpha *
        (sourceEvent.magnitude - magnitudeCompleteness),
    );
  const temporalWeight = integratedOmori(
    currentAge,
    maxDays,
    BASE_PARAMETERS.omoriC,
    BASE_PARAMETERS.omoriP,
  );
  const outsideDistance = Math.max(0, distanceToTarget - target.radiusKm);
  const spatialWeight = Math.pow(
    1 + outsideDistance / (projectedRadiusKm + 80),
    -BASE_PARAMETERS.spatialQ,
  );
  const magnitudeWeight = Math.pow(
    10,
    -BASE_PARAMETERS.gutenbergRichterB *
      Math.max(0, magnitudeMin - magnitudeCompleteness),
  );
  const triggeredExpectedCount = clamp(
    productivity * temporalWeight * spatialWeight * magnitudeWeight,
    0,
    3,
  );

  const center = projectedPoint(sourceEvent, target);
  const projectedZoneRadius = Math.min(projectedRadiusKm, target.radiusKm + 250);
  const expectedBackground = backgroundExpectedCount(
    events,
    sourceEvent,
    center,
    projectedZoneRadius,
    magnitudeMin,
    Math.max(1, (expiresAt.getTime() - generatedAt.getTime()) / DAY_MS),
  );
  const totalProbability = probabilityFromExpectedCount(triggeredExpectedCount + expectedBackground);
  const baselineProbability = probabilityFromExpectedCount(expectedBackground);
  const excessProbability = Math.max(0, totalProbability - baselineProbability);

  const model: EtasModelParameters = {
    modelName: "ETAS espacio-tiempo simplificado con tasa de fondo",
    magnitudeCompleteness,
    ...BASE_PARAMETERS,
    calibration:
      "Parámetros generales iniciales; la compatibilidad separa estadísticamente señal ETAS y tasa sísmica de fondo, sin afirmar causalidad física.",
  };

  return {
    id: `etas-${target.code}-${sourceEvent.id}`,
    parentEventId: sourceEvent.id,
    status: "active",
    associationClass: "none",
    sourceEvent,
    sourceRegionName: sourceEvent.place,
    targetCountry: target,
    projectedZone: {
      latitude: center.latitude,
      longitude: center.longitude,
      radiusKm: projectedZoneRadius,
      name: `Zona ETAS asociada a M${sourceEvent.magnitude.toFixed(1)} para ${target.name}`,
    },
    // A forecast starts when it is issued, never retroactively at the parent event.
    startTime: generatedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    maxDays,
    magnitudeMin,
    magnitudeMax,
    probabilityPct: Math.round(totalProbability),
    backgroundProbabilityPct: Math.round(baselineProbability),
    excessProbabilityPct: Math.round(excessProbability),
    expectedCount: Number(triggeredExpectedCount.toFixed(3)),
    backgroundExpectedCount: Number(expectedBackground.toFixed(3)),
    migrationCompatibilityPct: null,
    matchedEvent: null,
    model,
    rationale: [
      `Evento padre M${sourceEvent.magnitude.toFixed(1)} a ${Math.round(distanceToTarget)} km del centro de análisis.`,
      `La probabilidad total se separa en tasa de fondo (${Math.round(baselineProbability)}%) y exceso ETAS (${Math.round(excessProbability)} pp).`,
      `Productividad ETAS: K·exp[α(M−Mc)], con Mc=${magnitudeCompleteness.toFixed(1)}.`,
      `Decaimiento temporal Omori–Utsu p=${BASE_PARAMETERS.omoriP.toFixed(1)} hasta ${expiresAt.toISOString().slice(0, 10)}.`,
      `Un sismo externo a la zona o a la escala se trata como actividad independiente y no como error del modelo.`,
    ],
  };
}

export interface EtasAssociationResult {
  geometricallyCompatible: boolean;
  migrationCompatibilityPct: number;
  associationClass: ProjectionAssociationClass;
}

/**
 * Estimates whether an observed event is statistically more compatible with the
 * ETAS excess intensity than with the local background rate. This is an
 * association score, not proof of physical causation.
 */
export function classifyEtasAssociation(
  event: SeismicEvent,
  projection: MigrationProjection,
): EtasAssociationResult {
  const eventTime = Date.parse(event.time);
  const sourceTime = Date.parse(projection.sourceEvent.time);
  const geometricallyCompatible = event.id !== projection.sourceEvent.id
    && eventTime >= Date.parse(projection.startTime)
    && eventTime <= Date.parse(projection.expiresAt)
    && event.magnitude >= projection.magnitudeMin
    && event.magnitude <= projection.magnitudeMax
    && haversineKm(
      event.latitude,
      event.longitude,
      projection.targetCountry.latitude,
      projection.targetCountry.longitude,
    ) <= projection.targetCountry.radiusKm
    && haversineKm(
      event.latitude,
      event.longitude,
      projection.projectedZone.latitude,
      projection.projectedZone.longitude,
    ) <= projection.projectedZone.radiusKm;

  if (!geometricallyCompatible) {
    return {
      geometricallyCompatible: false,
      migrationCompatibilityPct: 0,
      associationClass: "none",
    };
  }

  const age = Math.max(0, (eventTime - sourceTime) / DAY_MS);
  const distance = haversineKm(
    event.latitude,
    event.longitude,
    projection.projectedZone.latitude,
    projection.projectedZone.longitude,
  );
  const productivity = projection.model.productivityK * Math.exp(
    projection.model.productivityAlpha
      * (projection.sourceEvent.magnitude - projection.model.magnitudeCompleteness),
  );
  const temporalIntensity = productivity * Math.pow(age + projection.model.omoriC, -projection.model.omoriP);
  const spatialIntensity = Math.pow(
    1 + distance / (projection.projectedZone.radiusKm + 80),
    -projection.model.spatialQ,
  );
  const magnitudeIntensity = Math.pow(
    10,
    -projection.model.gutenbergRichterB
      * Math.max(0, event.magnitude - projection.magnitudeMin),
  );
  const triggeredIntensity = Math.max(0, temporalIntensity * spatialIntensity * magnitudeIntensity);
  const remainingDays = Math.max(1, (Date.parse(projection.expiresAt) - Date.parse(projection.startTime)) / DAY_MS);
  const backgroundIntensity = Math.max(0.001, projection.backgroundExpectedCount / remainingDays);
  const migrationCompatibilityPct = Math.round(clamp(
    triggeredIntensity / (triggeredIntensity + backgroundIntensity) * 100,
    0,
    100,
  ));
  const associationClass: ProjectionAssociationClass = migrationCompatibilityPct >= ETAS_COMPATIBLE_THRESHOLD
    ? "migration_compatible"
    : migrationCompatibilityPct >= ETAS_POSSIBLE_THRESHOLD
      ? "possible_association"
      : "background_likely";

  return {
    geometricallyCompatible: true,
    migrationCompatibilityPct,
    associationClass,
  };
}

export function generateMigrationProjections(
  events: SeismicEvent[],
  target: CountryTarget,
  generatedAt = new Date(),
  limit = 12,
): MigrationProjection[] {
  const magnitudeCompleteness = estimateMagnitudeCompleteness(events, target);
  const minimumParentMagnitude = Math.max(4.2, magnitudeCompleteness + 0.7);

  const parentEvents = events
    .filter((event) => {
      const age = ageDays(event, generatedAt);
      const distance = haversineKm(
        event.latitude,
        event.longitude,
        target.latitude,
        target.longitude,
      );
      return (
        age >= 0 &&
        age <= 45 &&
        event.magnitude >= minimumParentMagnitude &&
        distance <= target.radiusKm + 2_000
      );
    })
    .sort((a, b) => {
      const magnitudeDifference = b.magnitude - a.magnitude;
      if (Math.abs(magnitudeDifference) > 0.2) return magnitudeDifference;
      return new Date(b.time).getTime() - new Date(a.time).getTime();
    });

  return parentEvents
    .map((event) =>
      buildProjection(
        event,
        events,
        target,
        magnitudeCompleteness,
        generatedAt,
      ),
    )
    .filter((projection): projection is MigrationProjection => Boolean(projection))
    .sort((a, b) => {
      const probabilityDifference = b.excessProbabilityPct - a.excessProbabilityPct;
      if (probabilityDifference !== 0) return probabilityDifference;
      return new Date(b.sourceEvent.time).getTime() - new Date(a.sourceEvent.time).getTime();
    })
    .slice(0, Math.max(1, limit));
}
