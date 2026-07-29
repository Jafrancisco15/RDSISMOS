import { countryByCode } from "./countries";
import type { EarthquakeEvent, EarthquakeFilters } from "./earthquakes/types";
import { queryEarthquakes } from "./earthquakes/usgs";
import { haversineKm } from "./regions";
import type {
  CountryTarget,
  HistoricalAnalogEvidence,
  HistoricalMigrationCapsule,
  HistoricalMigrationDestination,
  SeismicEvent,
} from "./types";

const DAY_MS = 86_400_000;
const MAX_ANALOGS = 10;
const CACHE_TTL_MS = 6 * 60 * 60 * 1_000;

interface MigrationZone {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
}

const MIGRATION_ZONES: MigrationZone[] = [
  { id: "mexico-central-america", name: "México, Guatemala y Centroamérica", latitude: 15, longitude: -91, radiusKm: 1_850 },
  { id: "caribbean", name: "Caribe, Puerto Rico y La Española", latitude: 18, longitude: -70, radiusKm: 1_550 },
  { id: "north-south-america", name: "Norte de Sudamérica", latitude: 3, longitude: -74, radiusKm: 1_900 },
  { id: "andes-south", name: "Andes centrales y meridionales", latitude: -24, longitude: -70, radiusKm: 2_350 },
  { id: "alaska-aleutians", name: "Alaska y Aleutianas", latitude: 53, longitude: -166, radiusKm: 2_300 },
  { id: "west-north-america", name: "Oeste de Norteamérica", latitude: 38, longitude: -122, radiusKm: 1_850 },
  { id: "japan-kuril", name: "Japón, Kuriles y costa oriental de Asia", latitude: 38, longitude: 143, radiusKm: 2_000 },
  { id: "philippines-taiwan", name: "Filipinas, Taiwán y mar de China", latitude: 18, longitude: 124, radiusKm: 1_850 },
  { id: "indonesia", name: "Indonesia y arcos de Sunda/Banda", latitude: -3, longitude: 120, radiusKm: 2_550 },
  { id: "southwest-pacific", name: "Vanuatu, Fiji y Pacífico suroccidental", latitude: -20, longitude: 175, radiusKm: 2_500 },
  { id: "new-zealand-kermadec", name: "Nueva Zelanda y Kermadec", latitude: -34, longitude: 178, radiusKm: 1_900 },
  { id: "mediterranean-turkey", name: "Mediterráneo oriental, Grecia y Turquía", latitude: 38, longitude: 28, radiusKm: 2_150 },
  { id: "iran-central-asia", name: "Irán y Asia central", latitude: 34, longitude: 61, radiusKm: 2_150 },
  { id: "himalaya-india", name: "Himalaya, India y regiones vecinas", latitude: 29, longitude: 82, radiusKm: 1_950 },
  { id: "east-africa", name: "África oriental y mar Rojo", latitude: 1, longitude: 37, radiusKm: 2_050 },
  { id: "mid-atlantic", name: "Dorsal Mesoatlántica y Atlántico", latitude: 0, longitude: -25, radiusKm: 3_100 },
];

interface CacheEntry {
  expiresAt: number;
  value: HistoricalMigrationCapsule;
}

declare global {
  // eslint-disable-next-line no-var
  var rdsismosHistoricalMigrationCache: Map<string, CacheEntry> | undefined;
}

const cache = globalThis.rdsismosHistoricalMigrationCache ?? new Map<string, CacheEntry>();
globalThis.rdsismosHistoricalMigrationCache = cache;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
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
    agency: event.network,
    source: "USGS ComCat",
    detailUrl: event.sourceUrl,
  };
}

function sourceRadiusKm(magnitude: number) {
  return Math.round(clamp(650 + (magnitude - 5) * 210, 550, 1_400));
}

function forecastWindowDays(magnitude: number) {
  return Math.round(clamp(35 + (magnitude - 5) * 18, 30, 90));
}

function similarity(source: SeismicEvent, analog: EarthquakeEvent, radiusKm: number) {
  const distance = haversineKm(source.latitude, source.longitude, analog.latitude, analog.longitude);
  const magnitudeScore = Math.exp(-Math.pow((source.magnitude - analog.magnitude) / 0.38, 2));
  const depthScale = Math.max(45, 70 + source.depthKm * 0.22);
  const depthScore = Math.exp(-Math.pow((source.depthKm - analog.depthKm) / depthScale, 2));
  const distanceScore = Math.exp(-Math.pow(distance / Math.max(radiusKm * 0.72, 1), 2));
  const typeScore = source.magnitudeType.toLowerCase() === analog.magnitudeType.toLowerCase() ? 1 : 0.88;
  return clamp(0.42 * magnitudeScore + 0.24 * depthScore + 0.26 * distanceScore + 0.08 * typeScore, 0, 1);
}

function selectIndependentAnalogs(
  source: SeismicEvent,
  candidates: EarthquakeEvent[],
  radiusKm: number,
) {
  const ranked = candidates
    .map((event) => ({ event, score: similarity(source, event, radiusKm) }))
    .filter(({ score }) => score >= 0.32)
    .sort((a, b) => b.score - a.score || new Date(b.event.timeUtc).getTime() - new Date(a.event.timeUtc).getTime());

  const selected: typeof ranked = [];
  for (const candidate of ranked) {
    const time = new Date(candidate.event.timeUtc).getTime();
    const tooClose = selected.some(
      (item) => Math.abs(new Date(item.event.timeUtc).getTime() - time) < 45 * DAY_MS,
    );
    if (!tooClose) selected.push(candidate);
    if (selected.length >= MAX_ANALOGS) break;
  }
  return selected;
}

function classifyZone(event: EarthquakeEvent) {
  const matches = MIGRATION_ZONES
    .map((zone) => ({
      zone,
      normalizedDistance:
        haversineKm(event.latitude, event.longitude, zone.latitude, zone.longitude) / zone.radiusKm,
    }))
    .filter((item) => item.normalizedDistance <= 1)
    .sort((a, b) => a.normalizedDistance - b.normalizedDistance);
  return matches[0]?.zone;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index], index);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

function cacheKey(source: SeismicEvent, target: CountryTarget) {
  return [
    source.id,
    source.latitude.toFixed(2),
    source.longitude.toFixed(2),
    source.magnitude.toFixed(1),
    Math.round(source.depthKm / 10),
    target.code,
  ].join(":");
}

export async function buildHistoricalMigrationCapsule(
  source: SeismicEvent,
  countryCode: string,
  signal?: AbortSignal,
): Promise<HistoricalMigrationCapsule> {
  const target = countryByCode(countryCode);
  const key = cacheKey(source, target);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const sourceTime = new Date(source.time);
  if (Number.isNaN(sourceTime.getTime())) throw new Error("El evento origen tiene una fecha inválida.");
  if (!Number.isFinite(source.magnitude) || source.magnitude < 4.5 || source.magnitude > 9.5) {
    throw new Error("El análisis histórico requiere un evento origen entre M4.5 y M9.5.");
  }

  const historyEnd = new Date(Math.min(Date.now(), sourceTime.getTime() - DAY_MS));
  const historyStart = new Date(historyEnd);
  historyStart.setUTCFullYear(historyStart.getUTCFullYear() - 50);
  const radiusKm = sourceRadiusKm(source.magnitude);
  const analogMagnitudeMin = Number(Math.max(4.5, source.magnitude - 0.5).toFixed(1));
  const analogMagnitudeMax = Number(Math.min(9.5, source.magnitude + 0.5).toFixed(1));
  const windowDays = forecastWindowDays(source.magnitude);
  const forecastMagnitudeMin = Number(Math.max(4.5, source.magnitude - 0.4).toFixed(1));
  const forecastMagnitudeMax = Number(Math.min(9.5, source.magnitude + 0.6).toFixed(1));

  const analogFilters: EarthquakeFilters = {
    startTime: historyStart.toISOString(),
    endTime: historyEnd.toISOString(),
    minMagnitude: analogMagnitudeMin,
    maxMagnitude: analogMagnitudeMax,
    minDepth: Math.max(-100, source.depthKm - 120),
    maxDepth: Math.min(1_000, source.depthKm + 120),
    latitude: source.latitude,
    longitude: source.longitude,
    maxRadiusKm: radiusKm,
    eventType: "earthquake",
    orderBy: "magnitude",
    limit: 20_000,
    offset: 1,
  };

  const analogPage = await queryEarthquakes(analogFilters, signal);
  const selected = selectIndependentAnalogs(source, analogPage.events, radiusKm);
  if (selected.length < 3) {
    throw new Error(
      `Solo se encontraron ${selected.length} análogos independientes. Amplíe el criterio o use un evento de mayor magnitud.`,
    );
  }

  const evaluated = await mapWithConcurrency(selected, 2, async ({ event, score }) => {
    const start = new Date(new Date(event.timeUtc).getTime() + 60_000);
    const end = new Date(start.getTime() + windowDays * DAY_MS);
    const filters: EarthquakeFilters = {
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      minMagnitude: forecastMagnitudeMin,
      maxMagnitude: forecastMagnitudeMax,
      eventType: "earthquake",
      orderBy: "time-asc",
      limit: 20_000,
      offset: 1,
    };
    const followers = (await queryEarthquakes(filters, signal)).events;
    const firstByZone = new Map<string, EarthquakeEvent>();
    for (const follower of followers) {
      const zone = classifyZone(follower);
      if (!zone) continue;
      const current = firstByZone.get(zone.id);
      if (!current || new Date(follower.timeUtc).getTime() < new Date(current.timeUtc).getTime()) {
        firstByZone.set(zone.id, follower);
      }
    }
    const strongestFollower = followers.reduce<EarthquakeEvent | null>(
      (strongest, follower) => !strongest || follower.magnitude > strongest.magnitude ? follower : strongest,
      null,
    );
    return {
      analogEvent: toSeismicEvent(event),
      similarityPct: Math.round(score * 100),
      similarityWeight: score,
      followerCount: followers.length,
      firstByZone,
      strongestFollower: strongestFollower ? toSeismicEvent(strongestFollower) : null,
    };
  });

  const totalWeight = evaluated.reduce((sum, item) => sum + item.similarityWeight, 0);
  const zoneStats = new Map<string, {
    weightedHits: number;
    analogHits: number;
    leadDays: number[];
    strongestMagnitude: number | null;
  }>();

  for (const item of evaluated) {
    for (const [zoneId, follower] of item.firstByZone) {
      const current = zoneStats.get(zoneId) ?? {
        weightedHits: 0,
        analogHits: 0,
        leadDays: [],
        strongestMagnitude: null,
      };
      current.weightedHits += item.similarityWeight;
      current.analogHits += 1;
      current.leadDays.push(
        (new Date(follower.timeUtc).getTime() - new Date(item.analogEvent.time).getTime()) / DAY_MS,
      );
      current.strongestMagnitude = Math.max(current.strongestMagnitude ?? -Infinity, follower.magnitude);
      zoneStats.set(zoneId, current);
    }
  }

  const totalDestinationWeight = [...zoneStats.values()].reduce((sum, item) => sum + item.weightedHits, 0);
  const destinations: HistoricalMigrationDestination[] = MIGRATION_ZONES
    .map((zone) => {
      const stats = zoneStats.get(zone.id);
      if (!stats) return null;
      const sortedLeads = [...stats.leadDays].sort((a, b) => a - b);
      const middle = Math.floor(sortedLeads.length / 2);
      const medianLeadDays = sortedLeads.length
        ? sortedLeads.length % 2
          ? sortedLeads[middle]
          : (sortedLeads[middle - 1] + sortedLeads[middle]) / 2
        : null;
      return {
        zoneId: zone.id,
        name: zone.name,
        latitude: zone.latitude,
        longitude: zone.longitude,
        radiusKm: zone.radiusKm,
        recurrencePct: Math.round((stats.weightedHits / Math.max(totalWeight, 0.001)) * 100),
        relativeWeightPct: Math.round((stats.weightedHits / Math.max(totalDestinationWeight, 0.001)) * 100),
        analogHits: stats.analogHits,
        weightedHits: Number(stats.weightedHits.toFixed(3)),
        targetOverlap:
          haversineKm(zone.latitude, zone.longitude, target.latitude, target.longitude) <=
          zone.radiusKm + target.radiusKm,
        medianLeadDays: medianLeadDays === null ? null : Number(medianLeadDays.toFixed(1)),
        strongestObservedMagnitude:
          stats.strongestMagnitude === null ? null : Number(stats.strongestMagnitude.toFixed(1)),
      };
    })
    .filter((item): item is HistoricalMigrationDestination => Boolean(item))
    .filter((item) => item.recurrencePct >= 10 || item.analogHits >= 2)
    .sort((a, b) => b.recurrencePct - a.recurrencePct || b.relativeWeightPct - a.relativeWeightPct)
    .slice(0, 8);

  const averageSimilarity = evaluated.reduce((sum, item) => sum + item.similarityPct, 0) / evaluated.length;
  const confidencePct = Math.round(
    clamp(18 + evaluated.length * 4.2 + averageSimilarity * 0.28, 20, 88),
  );

  const analogs: HistoricalAnalogEvidence[] = evaluated.map((item) => ({
    analogEvent: item.analogEvent,
    similarityPct: item.similarityPct,
    followerCount: item.followerCount,
    hitZoneIds: [...item.firstByZone.keys()],
    strongestFollower: item.strongestFollower,
  }));

  const capsule: HistoricalMigrationCapsule = {
    id: `historical-${target.code}-${source.id}`,
    generatedAt: new Date().toISOString(),
    sourceEvent: source,
    targetCountry: target,
    historyStart: historyStart.toISOString(),
    historyEnd: historyEnd.toISOString(),
    sourceRadiusKm: radiusKm,
    analogMagnitudeMin,
    analogMagnitudeMax,
    analogsFound: analogPage.total,
    analogsEvaluated: evaluated.length,
    windowDays,
    forecastMagnitudeMin,
    forecastMagnitudeMax,
    confidencePct,
    destinations,
    analogs,
    modelName: "Motor híbrido: analogía histórica ponderada + contexto ETAS regional",
    methodology: [
      `Búsqueda de eventos análogos en 50 años dentro de ${radiusKm.toLocaleString()} km del origen y magnitud M${analogMagnitudeMin.toFixed(1)}–M${analogMagnitudeMax.toFixed(1)}.`,
      `Selección de hasta ${MAX_ANALOGS} análogos independientes, separados al menos 45 días para reducir duplicación de una misma secuencia.`,
      `Ponderación por similitud de magnitud, profundidad, distancia al origen y tipo de magnitud.`,
      `Evaluación de eventos mundiales M${forecastMagnitudeMin.toFixed(1)}–M${forecastMagnitudeMax.toFixed(1)} durante ${windowDays} días posteriores a cada análogo.`,
      "La recurrencia es el porcentaje ponderado de análogos que registraron al menos un evento en cada macrozona.",
    ],
    limitations: [
      "Las asociaciones son empíricas y no prueban causalidad física entre placas tectónicas distantes.",
      `El análisis en vivo evalúa como máximo ${MAX_ANALOGS} análogos para limitar solicitudes y tiempo de ejecución; el total encontrado se muestra por separado.`,
      "Las macrozonas son agregaciones geográficas aproximadas y pueden solaparse.",
      "Los catálogos antiguos detectan peor los terremotos pequeños; se utiliza un umbral mínimo M4.5.",
      "La confianza resume tamaño y similitud de la muestra; no es la probabilidad de que ocurra un terremoto específico.",
    ],
  };

  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value: capsule });
  return capsule;
}
