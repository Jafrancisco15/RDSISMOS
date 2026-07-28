import { WATCHED_REGIONS, haversineKm } from "./regions";
import type {
  MigrationProjection,
  ProjectionTarget,
  SeismicEvent,
} from "./types";

const DAY_MS = 86_400_000;

export const PROJECTION_TARGETS: ProjectionTarget[] = [
  {
    id: "north-south-america",
    name: "Norte de Sudamérica: Colombia, Venezuela, norte de Perú y sur de Ecuador",
    latitude: 2.5,
    longitude: -75.5,
    radiusKm: 1_850,
    includesDominicanRepublic: false,
  },
  {
    id: "mexico-panama-caribbean",
    name: "México, Panamá, Antillas, Puerto Rico y República Dominicana",
    latitude: 15.2,
    longitude: -78.5,
    radiusKm: 2_050,
    includesDominicanRepublic: true,
  },
  {
    id: "japan-philippines-indonesia",
    name: "Costa de Japón, Filipinas e Indonesia",
    latitude: 13.5,
    longitude: 132,
    radiusKm: 2_700,
    includesDominicanRepublic: false,
  },
  {
    id: "dominican-puerto-rico",
    name: "Puerto Rico y República Dominicana",
    latitude: 18.5,
    longitude: -68.7,
    radiusKm: 760,
    includesDominicanRepublic: true,
  },
  {
    id: "panama-costa-rica",
    name: "Zona limítrofe de Panamá y Costa Rica",
    latitude: 8.9,
    longitude: -82.3,
    radiusKm: 650,
    includesDominicanRepublic: false,
  },
  {
    id: "north-peru-south-ecuador",
    name: "Norte de Perú y sur de Ecuador",
    latitude: -3.8,
    longitude: -78.7,
    radiusKm: 820,
    includesDominicanRepublic: false,
  },
  {
    id: "new-zealand-kermadec",
    name: "Nueva Zelanda e islas Kermadec",
    latitude: -31,
    longitude: -177,
    radiusKm: 1_550,
    includesDominicanRepublic: false,
  },
  {
    id: "central-america-caribbean",
    name: "Centroamérica y arco del Caribe",
    latitude: 15,
    longitude: -76,
    radiusKm: 1_650,
    includesDominicanRepublic: true,
  },
];

const ROUTES: Record<string, string[]> = {
  vanuatu: [
    "north-south-america",
    "mexico-panama-caribbean",
    "japan-philippines-indonesia",
  ],
  fiji: [
    "north-south-america",
    "mexico-panama-caribbean",
    "japan-philippines-indonesia",
  ],
  "north-atlantic": ["dominican-puerto-rico", "panama-costa-rica"],
  "alaska-aleutians": ["north-peru-south-ecuador", "new-zealand-kermadec"],
  kermadec: [
    "north-peru-south-ecuador",
    "mexico-panama-caribbean",
    "japan-philippines-indonesia",
  ],
  mexico: ["dominican-puerto-rico", "panama-costa-rica", "north-south-america"],
  chile: ["north-peru-south-ecuador", "central-america-caribbean"],
  peru: ["central-america-caribbean", "dominican-puerto-rico"],
  java: ["new-zealand-kermadec", "north-south-america"],
  flores: ["new-zealand-kermadec", "north-south-america"],
  celebes: ["japan-philippines-indonesia", "new-zealand-kermadec"],
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function ageDays(event: SeismicEvent, now: Date) {
  return (now.getTime() - new Date(event.time).getTime()) / DAY_MS;
}

function targetsForRegion(regionId: string): ProjectionTarget[] {
  const ids = ROUTES[regionId] ?? [];
  return ids
    .map((id) => PROJECTION_TARGETS.find((target) => target.id === id))
    .filter((target): target is ProjectionTarget => Boolean(target));
}

function eventMatchesTarget(
  event: SeismicEvent,
  target: ProjectionTarget,
  magnitudeMin: number,
  magnitudeMax: number,
) {
  return (
    event.magnitude >= magnitudeMin &&
    event.magnitude <= magnitudeMax &&
    haversineKm(event.latitude, event.longitude, target.latitude, target.longitude) <=
      target.radiusKm
  );
}

function buildProjection(
  sourceEvent: SeismicEvent,
  events: SeismicEvent[],
  generatedAt: Date,
): MigrationProjection | null {
  if (!sourceEvent.regionId) return null;

  const targets = targetsForRegion(sourceEvent.regionId);
  if (!targets.length) return null;

  const maxDays = clamp(Math.round(8 + (sourceEvent.magnitude - 5) * 3), 8, 12);
  const startTime = new Date(sourceEvent.time);
  const expiresAt = new Date(startTime.getTime() + maxDays * DAY_MS);
  const magnitudeMin = Math.max(2.5, Number((sourceEvent.magnitude - 0.3).toFixed(1)));
  const magnitudeMax = Number((sourceEvent.magnitude + 0.3).toFixed(1));

  const matching = events
    .filter((candidate) => {
      const candidateTime = new Date(candidate.time).getTime();
      return (
        candidate.id !== sourceEvent.id &&
        candidateTime > startTime.getTime() &&
        candidateTime <= expiresAt.getTime() &&
        targets.some((target) =>
          eventMatchesTarget(candidate, target, magnitudeMin, magnitudeMax),
        )
      );
    })
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())[0];

  const matchedTarget = matching
    ? targets.find((target) =>
        eventMatchesTarget(matching, target, magnitudeMin, magnitudeMax),
      )
    : undefined;

  const status = matching
    ? "fulfilled"
    : generatedAt.getTime() > expiresAt.getTime()
      ? "expired"
      : "active";

  const nearbySourceEvents = events.filter(
    (candidate) =>
      candidate.regionId === sourceEvent.regionId &&
      candidate.id !== sourceEvent.id &&
      Math.abs(new Date(candidate.time).getTime() - startTime.getTime()) <= 7 * DAY_MS &&
      candidate.magnitude >= 4,
  ).length;

  const consistencyScore = clamp(
    Math.round(42 + (sourceEvent.magnitude - 4.7) * 13 + Math.min(nearbySourceEvents, 4) * 5),
    20,
    88,
  );

  const sourceRegionName =
    WATCHED_REGIONS.find((region) => region.id === sourceEvent.regionId)?.name ??
    sourceEvent.place;

  return {
    id: `projection-${sourceEvent.id}`,
    status,
    sourceEvent,
    sourceRegionName,
    startTime: startTime.toISOString(),
    expiresAt: expiresAt.toISOString(),
    maxDays,
    magnitudeMin,
    magnitudeMax,
    targets,
    matchedEvent: matching ?? null,
    matchedTargetId: matchedTarget?.id ?? null,
    consistencyScore,
    rationale: [
      `El evento origen es M${sourceEvent.magnitude.toFixed(1)} en ${sourceRegionName}.`,
      `El rango proyectado conserva una banda experimental de ±0.3 unidades de magnitud.`,
      `La ventana temporal calculada es de ${maxDays} días desde el evento origen.`,
      `Se vigilan ${targets.length} zonas candidatas definidas por el patrón migratorio configurado.`,
    ],
  };
}

export function generateMigrationProjections(
  events: SeismicEvent[],
  generatedAt = new Date(),
): MigrationProjection[] {
  const latestByRegion = new Map<string, SeismicEvent>();

  events
    .filter(
      (event) =>
        Boolean(event.regionId && ROUTES[event.regionId]) &&
        event.magnitude >= 4.7 &&
        ageDays(event, generatedAt) >= 0 &&
        ageDays(event, generatedAt) <= 30,
    )
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .forEach((event) => {
      if (event.regionId && !latestByRegion.has(event.regionId)) {
        latestByRegion.set(event.regionId, event);
      }
    });

  const statusOrder = { active: 0, fulfilled: 1, expired: 2 } as const;

  return [...latestByRegion.values()]
    .map((event) => buildProjection(event, events, generatedAt))
    .filter((projection): projection is MigrationProjection => Boolean(projection))
    .sort((a, b) => {
      const statusDifference = statusOrder[a.status] - statusOrder[b.status];
      if (statusDifference !== 0) return statusDifference;
      return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
    })
    .slice(0, 8);
}
