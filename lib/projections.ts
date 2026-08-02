import { haversineKm } from "./regions";
import type {
  CountryTarget,
  EtasModelParameters,
  MigrationProjection,
  SeismicEvent,
} from "./types";

const DAY_MS = 86_400_000;

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

function matchesProjection(
  event: SeismicEvent,
  projection: {
    source: SeismicEvent;
    expiresAt: Date;
    projectedLatitude: number;
    projectedLongitude: number;
    projectedRadiusKm: number;
    magnitudeMin: number;
    magnitudeMax: number;
    target: CountryTarget;
  },
) {
  const time = new Date(event.time).getTime();
  return (
    event.id !== projection.source.id &&
    time > new Date(projection.source.time).getTime() &&
    time <= projection.expiresAt.getTime() &&
    event.magnitude >= projection.magnitudeMin &&
    event.magnitude <= projection.magnitudeMax &&
    haversineKm(
      event.latitude,
      event.longitude,
      projection.target.latitude,
      projection.target.longitude,
    ) <= projection.target.radiusKm + 350 &&
    haversineKm(
      event.latitude,
      event.longitude,
      projection.projectedLatitude,
      projection.projectedLongitude,
    ) <= projection.projectedRadiusKm + 220
  );
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
  const startTime = new Date(sourceEvent.time);
  const expiresAt = new Date(startTime.getTime() + maxDays * DAY_MS);
  const currentAge = ageDays(sourceEvent, generatedAt);
  const endAge = currentAge + maxDays;

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
    endAge,
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
  const expectedCount = clamp(
    productivity * temporalWeight * spatialWeight * magnitudeWeight,
    0,
    3,
  );
  const probabilityPct = Math.round(
    clamp((1 - Math.exp(-expectedCount)) * 100, 1, 95),
  );

  const center = projectedPoint(sourceEvent, target);
  const match = events
    .filter((event) =>
      matchesProjection(event, {
        source: sourceEvent,
        expiresAt,
        projectedLatitude: center.latitude,
        projectedLongitude: center.longitude,
        projectedRadiusKm,
        magnitudeMin,
        magnitudeMax,
        target,
      }),
    )
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())[0];

  const status = match
    ? "fulfilled"
    : generatedAt.getTime() > expiresAt.getTime()
      ? "expired"
      : "active";

  const model: EtasModelParameters = {
    modelName: "ETAS espacio-tiempo simplificado",
    magnitudeCompleteness,
    ...BASE_PARAMETERS,
    calibration:
      "Parámetros generales iniciales; aún no calibrados específicamente para este país.",
  };

  return {
    id: `etas-${target.code}-${sourceEvent.id}`,
    parentEventId: sourceEvent.id,
    status,
    sourceEvent,
    sourceRegionName: sourceEvent.place,
    targetCountry: target,
    projectedZone: {
      latitude: center.latitude,
      longitude: center.longitude,
      radiusKm: Math.min(projectedRadiusKm, target.radiusKm + 250),
      name: `Zona ETAS asociada a M${sourceEvent.magnitude.toFixed(1)} para ${target.name}`,
    },
    startTime: startTime.toISOString(),
    expiresAt: expiresAt.toISOString(),
    maxDays,
    magnitudeMin,
    magnitudeMax,
    probabilityPct,
    expectedCount: Number(expectedCount.toFixed(3)),
    matchedEvent: match ?? null,
    model,
    rationale: [
      `Evento padre M${sourceEvent.magnitude.toFixed(1)} a ${Math.round(distanceToTarget)} km del centro de análisis.`,
      `Productividad ETAS: K·exp[α(M−Mc)], con Mc=${magnitudeCompleteness.toFixed(1)}.`,
      `Decaimiento temporal según Omori–Utsu, p=${BASE_PARAMETERS.omoriP.toFixed(1)}, durante ${maxDays} días.`,
      `Decaimiento espacial q=${BASE_PARAMETERS.spatialQ.toFixed(1)}; no se aceptan rutas mundiales sin solapamiento regional.`,
      `Rango de magnitud derivado de Gutenberg–Richter, b=${BASE_PARAMETERS.gutenbergRichterB.toFixed(1)}.`,
    ],
  };
}

export function generateMigrationProjections(
  events: SeismicEvent[],
  target: CountryTarget,
  generatedAt = new Date(),
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

  const statusOrder = { active: 0, fulfilled: 1, expired: 2 } as const;
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
      const statusDifference = statusOrder[a.status] - statusOrder[b.status];
      if (statusDifference !== 0) return statusDifference;
      const probabilityDifference = b.probabilityPct - a.probabilityPct;
      if (probabilityDifference !== 0) return probabilityDifference;
      return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
    })
    .slice(0, 12);
}
