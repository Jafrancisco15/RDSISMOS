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
const CONTROL_GAP_DAYS = 7;
const MAX_ZONES = 6;

interface MigrationCountry {
  code: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
}

interface MigrationZone {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  countries: MigrationCountry[];
}

const MIGRATION_ZONES: MigrationZone[] = [
  {
    id: "mexico-central-america",
    name: "México, Guatemala y Centroamérica",
    latitude: 15,
    longitude: -91,
    radiusKm: 1_850,
    countries: [
      { code: "MX", name: "México", latitude: 23, longitude: -102, radiusKm: 1_350 },
      { code: "GT", name: "Guatemala", latitude: 15.5, longitude: -90.25, radiusKm: 420 },
      { code: "BZ", name: "Belice", latitude: 17.25, longitude: -88.75, radiusKm: 280 },
      { code: "SV", name: "El Salvador", latitude: 13.83, longitude: -88.92, radiusKm: 280 },
      { code: "HN", name: "Honduras", latitude: 15, longitude: -86.5, radiusKm: 430 },
      { code: "NI", name: "Nicaragua", latitude: 13, longitude: -85, radiusKm: 480 },
      { code: "CR", name: "Costa Rica", latitude: 10, longitude: -84, radiusKm: 330 },
      { code: "PA", name: "Panamá", latitude: 9, longitude: -80, radiusKm: 480 },
    ],
  },
  {
    id: "caribbean",
    name: "Caribe, Puerto Rico y La Española",
    latitude: 18,
    longitude: -70,
    radiusKm: 1_550,
    countries: [
      { code: "DO", name: "República Dominicana", latitude: 18.8, longitude: -70.2, radiusKm: 340 },
      { code: "HT", name: "Haití", latitude: 19, longitude: -72.42, radiusKm: 300 },
      { code: "PR", name: "Puerto Rico", latitude: 18.2, longitude: -66.5, radiusKm: 330 },
      { code: "CU", name: "Cuba", latitude: 21.5, longitude: -80, radiusKm: 720 },
      { code: "JM", name: "Jamaica", latitude: 18.2, longitude: -77.3, radiusKm: 310 },
      { code: "BS", name: "Bahamas", latitude: 24.25, longitude: -76, radiusKm: 620 },
      { code: "KY", name: "Islas Caimán", latitude: 19.5, longitude: -80.5, radiusKm: 270 },
      { code: "TT", name: "Trinidad y Tobago", latitude: 10.7, longitude: -61.2, radiusKm: 300 },
      { code: "DM", name: "Dominica", latitude: 15.42, longitude: -61.33, radiusKm: 260 },
      { code: "AG", name: "Antigua y Barbuda", latitude: 17.05, longitude: -61.8, radiusKm: 260 },
    ],
  },
  {
    id: "north-south-america",
    name: "Norte de Sudamérica",
    latitude: 3,
    longitude: -74,
    radiusKm: 1_900,
    countries: [
      { code: "CO", name: "Colombia", latitude: 4, longitude: -72, radiusKm: 1_050 },
      { code: "VE", name: "Venezuela", latitude: 8, longitude: -66, radiusKm: 1_050 },
      { code: "EC", name: "Ecuador", latitude: -2, longitude: -77.5, radiusKm: 620 },
      { code: "PE", name: "Perú", latitude: -10, longitude: -76, radiusKm: 1_250 },
      { code: "GY", name: "Guyana", latitude: 5, longitude: -59, radiusKm: 560 },
      { code: "SR", name: "Surinam", latitude: 4, longitude: -56, radiusKm: 520 },
      { code: "BR", name: "Brasil (norte)", latitude: -3, longitude: -58, radiusKm: 1_350 },
    ],
  },
  {
    id: "andes-south",
    name: "Andes centrales y meridionales",
    latitude: -24,
    longitude: -70,
    radiusKm: 2_350,
    countries: [
      { code: "EC", name: "Ecuador", latitude: -2, longitude: -77.5, radiusKm: 620 },
      { code: "PE", name: "Perú", latitude: -10, longitude: -76, radiusKm: 1_250 },
      { code: "BO", name: "Bolivia", latitude: -17, longitude: -65, radiusKm: 1_050 },
      { code: "CL", name: "Chile", latitude: -30, longitude: -71, radiusKm: 1_150 },
      { code: "AR", name: "Argentina (oeste)", latitude: -34, longitude: -68, radiusKm: 1_250 },
    ],
  },
  {
    id: "alaska-aleutians",
    name: "Alaska y Aleutianas",
    latitude: 53,
    longitude: -166,
    radiusKm: 2_300,
    countries: [
      { code: "US", name: "Estados Unidos (Alaska)", latitude: 61, longitude: -151, radiusKm: 1_650 },
      { code: "RU", name: "Rusia (Kamchatka y Aleutianas occidentales)", latitude: 56, longitude: 162, radiusKm: 1_250 },
    ],
  },
  {
    id: "west-north-america",
    name: "Oeste de Norteamérica",
    latitude: 38,
    longitude: -122,
    radiusKm: 1_850,
    countries: [
      { code: "US", name: "Estados Unidos (costa oeste)", latitude: 38, longitude: -121, radiusKm: 1_300 },
      { code: "CA", name: "Canadá (Columbia Británica)", latitude: 53, longitude: -125, radiusKm: 1_050 },
      { code: "MX", name: "México (Baja California)", latitude: 28, longitude: -114, radiusKm: 850 },
    ],
  },
  {
    id: "japan-kuril",
    name: "Japón, Kuriles y costa oriental de Asia",
    latitude: 38,
    longitude: 143,
    radiusKm: 2_000,
    countries: [
      { code: "JP", name: "Japón", latitude: 37, longitude: 138, radiusKm: 900 },
      { code: "RU", name: "Rusia (islas Kuriles)", latitude: 48, longitude: 153, radiusKm: 950 },
      { code: "CN", name: "China oriental", latitude: 34, longitude: 119, radiusKm: 1_150 },
      { code: "KR", name: "Corea del Sur", latitude: 37, longitude: 127.5, radiusKm: 430 },
      { code: "KP", name: "Corea del Norte", latitude: 40, longitude: 127, radiusKm: 450 },
    ],
  },
  {
    id: "philippines-taiwan",
    name: "Filipinas, Taiwán y mar de China",
    latitude: 18,
    longitude: 124,
    radiusKm: 1_850,
    countries: [
      { code: "PH", name: "Filipinas", latitude: 13, longitude: 122, radiusKm: 780 },
      { code: "TW", name: "Taiwán", latitude: 23.7, longitude: 121, radiusKm: 330 },
      { code: "CN", name: "China meridional", latitude: 25, longitude: 115, radiusKm: 950 },
      { code: "JP", name: "Japón (Ryukyu)", latitude: 27, longitude: 128, radiusKm: 620 },
    ],
  },
  {
    id: "indonesia",
    name: "Indonesia y arcos de Sunda/Banda",
    latitude: -3,
    longitude: 120,
    radiusKm: 2_550,
    countries: [
      { code: "ID", name: "Indonesia", latitude: -5, longitude: 120, radiusKm: 1_750 },
      { code: "TL", name: "Timor-Leste", latitude: -8.8, longitude: 125.7, radiusKm: 300 },
      { code: "PG", name: "Papúa Nueva Guinea", latitude: -6, longitude: 147, radiusKm: 900 },
      { code: "MY", name: "Malasia", latitude: 4, longitude: 102, radiusKm: 700 },
    ],
  },
  {
    id: "southwest-pacific",
    name: "Vanuatu, Fiyi y Pacífico suroccidental",
    latitude: -20,
    longitude: 175,
    radiusKm: 2_500,
    countries: [
      { code: "VU", name: "Vanuatu", latitude: -16, longitude: 167, radiusKm: 520 },
      { code: "FJ", name: "Fiyi", latitude: -18, longitude: 175, radiusKm: 500 },
      { code: "SB", name: "Islas Salomón", latitude: -8, longitude: 159, radiusKm: 650 },
      { code: "TO", name: "Tonga", latitude: -20, longitude: -175, radiusKm: 520 },
      { code: "WS", name: "Samoa", latitude: -13.6, longitude: -172.3, radiusKm: 380 },
      { code: "NC", name: "Nueva Caledonia", latitude: -21.5, longitude: 165.5, radiusKm: 480 },
    ],
  },
  {
    id: "new-zealand-kermadec",
    name: "Nueva Zelanda y Kermadec",
    latitude: -34,
    longitude: 178,
    radiusKm: 1_900,
    countries: [
      { code: "NZ", name: "Nueva Zelanda", latitude: -41, longitude: 174, radiusKm: 1_050 },
      { code: "TO", name: "Tonga y Kermadec norte", latitude: -25, longitude: -177, radiusKm: 800 },
    ],
  },
  {
    id: "mediterranean-turkey",
    name: "Mediterráneo oriental, Grecia y Turquía",
    latitude: 38,
    longitude: 28,
    radiusKm: 2_150,
    countries: [
      { code: "TR", name: "Turquía", latitude: 39, longitude: 35, radiusKm: 1_050 },
      { code: "GR", name: "Grecia", latitude: 39, longitude: 22, radiusKm: 520 },
      { code: "CY", name: "Chipre", latitude: 35, longitude: 33, radiusKm: 280 },
      { code: "IT", name: "Italia", latitude: 42.5, longitude: 12.5, radiusKm: 850 },
      { code: "AL", name: "Albania", latitude: 41, longitude: 20, radiusKm: 300 },
      { code: "BG", name: "Bulgaria", latitude: 43, longitude: 25, radiusKm: 440 },
      { code: "MK", name: "Macedonia del Norte", latitude: 41.6, longitude: 21.7, radiusKm: 280 },
    ],
  },
  {
    id: "iran-central-asia",
    name: "Irán y Asia central",
    latitude: 34,
    longitude: 61,
    radiusKm: 2_150,
    countries: [
      { code: "IR", name: "Irán", latitude: 32, longitude: 53, radiusKm: 1_350 },
      { code: "AF", name: "Afganistán", latitude: 33, longitude: 65, radiusKm: 900 },
      { code: "PK", name: "Pakistán", latitude: 30, longitude: 70, radiusKm: 1_000 },
      { code: "TM", name: "Turkmenistán", latitude: 40, longitude: 60, radiusKm: 700 },
      { code: "TJ", name: "Tayikistán", latitude: 39, longitude: 71, radiusKm: 480 },
      { code: "KG", name: "Kirguistán", latitude: 41, longitude: 75, radiusKm: 480 },
      { code: "UZ", name: "Uzbekistán", latitude: 41, longitude: 64, radiusKm: 700 },
      { code: "KZ", name: "Kazajistán", latitude: 48, longitude: 68, radiusKm: 1_400 },
    ],
  },
  {
    id: "himalaya-india",
    name: "Himalaya, India y regiones vecinas",
    latitude: 29,
    longitude: 82,
    radiusKm: 1_950,
    countries: [
      { code: "NP", name: "Nepal", latitude: 28, longitude: 84, radiusKm: 520 },
      { code: "IN", name: "India septentrional", latitude: 28, longitude: 79, radiusKm: 1_150 },
      { code: "BT", name: "Bután", latitude: 27.5, longitude: 90.5, radiusKm: 300 },
      { code: "PK", name: "Pakistán", latitude: 30, longitude: 70, radiusKm: 1_000 },
      { code: "CN", name: "China (Tíbet)", latitude: 31, longitude: 88, radiusKm: 1_050 },
      { code: "BD", name: "Bangladés", latitude: 24, longitude: 90, radiusKm: 480 },
      { code: "MM", name: "Myanmar", latitude: 21, longitude: 96, radiusKm: 900 },
    ],
  },
  {
    id: "east-africa",
    name: "África oriental y mar Rojo",
    latitude: 1,
    longitude: 37,
    radiusKm: 2_050,
    countries: [
      { code: "ET", name: "Etiopía", latitude: 8, longitude: 38, radiusKm: 1_050 },
      { code: "ER", name: "Eritrea", latitude: 15, longitude: 39, radiusKm: 460 },
      { code: "DJ", name: "Yibuti", latitude: 11.5, longitude: 43, radiusKm: 280 },
      { code: "KE", name: "Kenia", latitude: 1, longitude: 38, radiusKm: 850 },
      { code: "TZ", name: "Tanzania", latitude: -6, longitude: 35, radiusKm: 950 },
      { code: "UG", name: "Uganda", latitude: 1, longitude: 32, radiusKm: 520 },
      { code: "RW", name: "Ruanda", latitude: -2, longitude: 30, radiusKm: 280 },
      { code: "BI", name: "Burundi", latitude: -3.5, longitude: 30, radiusKm: 280 },
      { code: "SO", name: "Somalia", latitude: 6, longitude: 46, radiusKm: 1_050 },
      { code: "YE", name: "Yemen", latitude: 15.5, longitude: 48, radiusKm: 720 },
    ],
  },
  {
    id: "mid-atlantic",
    name: "Dorsal Mesoatlántica y Atlántico",
    latitude: 0,
    longitude: -25,
    radiusKm: 3_100,
    countries: [
      { code: "IS", name: "Islandia", latitude: 65, longitude: -18, radiusKm: 430 },
      { code: "PT", name: "Portugal y Azores", latitude: 38, longitude: -25, radiusKm: 850 },
      { code: "CV", name: "Cabo Verde", latitude: 16, longitude: -24, radiusKm: 420 },
    ],
  },
];

interface ClassifiedCountry {
  zone: MigrationZone;
  country: MigrationCountry;
  normalizedDistance: number;
}

interface CacheEntry {
  expiresAt: number;
  value: HistoricalMigrationCapsule;
}

declare global {
  // eslint-disable-next-line no-var
  var rdsismosHistoricalCountryCache: Map<string, CacheEntry> | undefined;
}

const cache = globalThis.rdsismosHistoricalCountryCache ?? new Map<string, CacheEntry>();
globalThis.rdsismosHistoricalCountryCache = cache;

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

function selectIndependentAnalogs(source: SeismicEvent, candidates: EarthquakeEvent[], radiusKm: number) {
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

function classifyCountry(event: EarthquakeEvent): ClassifiedCountry | null {
  const matches: ClassifiedCountry[] = [];
  for (const zone of MIGRATION_ZONES) {
    for (const country of zone.countries) {
      const distance = haversineKm(event.latitude, event.longitude, country.latitude, country.longitude);
      const normalizedDistance = distance / Math.max(country.radiusKm + 260, 420);
      if (normalizedDistance <= 1.2) matches.push({ zone, country, normalizedDistance });
    }
  }
  matches.sort((a, b) => a.normalizedDistance - b.normalizedDistance);
  return matches[0] ?? null;
}

function firstByCountry(events: EarthquakeEvent[]) {
  const result = new Map<string, { classified: ClassifiedCountry; event: EarthquakeEvent }>();
  for (const event of events) {
    const classified = classifyCountry(event);
    if (!classified) continue;
    const key = `${classified.zone.id}:${classified.country.code}`;
    const current = result.get(key);
    if (!current || new Date(event.timeUtc).getTime() < new Date(current.event.timeUtc).getTime()) {
      result.set(key, { classified, event });
    }
  }
  return result;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function magnitudeRange(values: number[], globalMin: number, globalMax: number) {
  if (!values.length) return { minimum: globalMin, maximum: globalMax, observedMin: null, observedMax: null };
  const observedMin = Math.min(...values);
  const observedMax = Math.max(...values);
  if (values.length === 1) {
    return {
      minimum: Number(Math.max(globalMin, values[0] - 0.3).toFixed(1)),
      maximum: Number(Math.min(globalMax, values[0] + 0.3).toFixed(1)),
      observedMin: Number(observedMin.toFixed(1)),
      observedMax: Number(observedMax.toFixed(1)),
    };
  }
  const low = percentile(values, 0.25) ?? globalMin;
  const high = percentile(values, 0.75) ?? globalMax;
  return {
    minimum: Number(Math.max(globalMin, low - 0.2).toFixed(1)),
    maximum: Number(Math.min(globalMax, high + 0.2).toFixed(1)),
    observedMin: Number(observedMin.toFixed(1)),
    observedMax: Number(observedMax.toFixed(1)),
  };
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
    "country-v2",
    source.id,
    source.latitude.toFixed(2),
    source.longitude.toFixed(2),
    source.magnitude.toFixed(1),
    Math.round(source.depthKm / 10),
    target.code,
  ].join(":");
}

export async function buildHistoricalMigrationCapsuleV2(
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
    const analogTime = new Date(event.timeUtc).getTime();
    const postStart = new Date(analogTime + 60_000);
    const postEnd = new Date(postStart.getTime() + windowDays * DAY_MS);
    const controlEnd = new Date(analogTime - CONTROL_GAP_DAYS * DAY_MS);
    const controlStart = new Date(controlEnd.getTime() - windowDays * DAY_MS);
    const filters: EarthquakeFilters = {
      startTime: controlStart.toISOString(),
      endTime: postEnd.toISOString(),
      minMagnitude: forecastMagnitudeMin,
      maxMagnitude: forecastMagnitudeMax,
      eventType: "earthquake",
      orderBy: "time-asc",
      limit: 20_000,
      offset: 1,
    };
    const combined = (await queryEarthquakes(filters, signal)).events;
    const followers = combined.filter((item) => {
      const time = new Date(item.timeUtc).getTime();
      return time >= postStart.getTime() && time <= postEnd.getTime();
    });
    const controls = combined.filter((item) => {
      const time = new Date(item.timeUtc).getTime();
      return time >= controlStart.getTime() && time <= controlEnd.getTime();
    });
    const postCountries = firstByCountry(followers);
    const controlCountries = firstByCountry(controls);
    const strongestFollower = followers.reduce<EarthquakeEvent | null>(
      (strongest, follower) => !strongest || follower.magnitude > strongest.magnitude ? follower : strongest,
      null,
    );
    return {
      analogEvent: toSeismicEvent(event),
      similarityPct: Math.round(score * 100),
      similarityWeight: score,
      followerCount: followers.length,
      controlFollowerCount: controls.length,
      postCountries,
      controlCountries,
      strongestFollower: strongestFollower ? toSeismicEvent(strongestFollower) : null,
    };
  });

  const totalWeight = evaluated.reduce((sum, item) => sum + item.similarityWeight, 0);
  const countryStats = new Map<string, {
    weightedHits: number;
    weightedControlHits: number;
    analogHits: number;
    controlHits: number;
    leadDays: number[];
    magnitudes: number[];
    strongestMagnitude: number | null;
  }>();

  for (const item of evaluated) {
    for (const [countryKey, occurrence] of item.postCountries) {
      const current = countryStats.get(countryKey) ?? {
        weightedHits: 0,
        weightedControlHits: 0,
        analogHits: 0,
        controlHits: 0,
        leadDays: [],
        magnitudes: [],
        strongestMagnitude: null,
      };
      current.weightedHits += item.similarityWeight;
      current.analogHits += 1;
      current.leadDays.push(
        (new Date(occurrence.event.timeUtc).getTime() - new Date(item.analogEvent.time).getTime()) / DAY_MS,
      );
      current.magnitudes.push(occurrence.event.magnitude);
      current.strongestMagnitude = Math.max(current.strongestMagnitude ?? -Infinity, occurrence.event.magnitude);
      countryStats.set(countryKey, current);
    }
    for (const [countryKey] of item.controlCountries) {
      const current = countryStats.get(countryKey) ?? {
        weightedHits: 0,
        weightedControlHits: 0,
        analogHits: 0,
        controlHits: 0,
        leadDays: [],
        magnitudes: [],
        strongestMagnitude: null,
      };
      current.weightedControlHits += item.similarityWeight;
      current.controlHits += 1;
      countryStats.set(countryKey, current);
    }
  }

  const zoneRanking = MIGRATION_ZONES.map((zone) => {
    let weightedPost = 0;
    let weightedControl = 0;
    let targetBonus = 0;
    for (const country of zone.countries) {
      const stats = countryStats.get(`${zone.id}:${country.code}`);
      weightedPost += stats?.weightedHits ?? 0;
      weightedControl += stats?.weightedControlHits ?? 0;
      if (country.code === target.code) targetBonus = 1;
    }
    const recurrence = weightedPost / Math.max(totalWeight, 0.001);
    const baseline = weightedControl / Math.max(totalWeight, 0.001);
    return {
      zone,
      score: Math.max(0, recurrence - baseline) * 100 + recurrence * 12 + targetBonus * 16,
      hasData: weightedPost > 0 || weightedControl > 0 || targetBonus > 0,
    };
  })
    .filter((item) => item.hasData)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ZONES);

  const selectedZoneIds = new Set(zoneRanking.map((item) => item.zone.id));
  const totalCountryPostWeight = [...countryStats.values()].reduce((sum, item) => sum + item.weightedHits, 0);
  const surveillanceStart = sourceTime.toISOString();
  const surveillanceEnd = new Date(sourceTime.getTime() + windowDays * DAY_MS).toISOString();

  const destinations: HistoricalMigrationDestination[] = MIGRATION_ZONES
    .filter((zone) => selectedZoneIds.has(zone.id))
    .flatMap((zone) => zone.countries.map((country) => {
      const stats = countryStats.get(`${zone.id}:${country.code}`);
      const weightedHits = stats?.weightedHits ?? 0;
      const weightedControlHits = stats?.weightedControlHits ?? 0;
      const recurrencePct = Math.round((weightedHits / Math.max(totalWeight, 0.001)) * 100);
      const baselinePct = Math.round((weightedControlHits / Math.max(totalWeight, 0.001)) * 100);
      const range = magnitudeRange(stats?.magnitudes ?? [], forecastMagnitudeMin, forecastMagnitudeMax);
      return {
        zoneId: zone.id,
        zoneName: zone.name,
        countryCode: country.code,
        name: country.name,
        latitude: country.latitude,
        longitude: country.longitude,
        radiusKm: country.radiusKm,
        recurrencePct,
        baselinePct,
        liftPct: recurrencePct - baselinePct,
        relativeWeightPct: Math.round((weightedHits / Math.max(totalCountryPostWeight, 0.001)) * 100),
        analogHits: stats?.analogHits ?? 0,
        controlHits: stats?.controlHits ?? 0,
        weightedHits: Number(weightedHits.toFixed(3)),
        targetOverlap: country.code === target.code,
        medianLeadDays: stats?.leadDays.length ? Number((median(stats.leadDays) ?? 0).toFixed(1)) : null,
        strongestObservedMagnitude:
          stats?.strongestMagnitude === null || stats?.strongestMagnitude === undefined
            ? null
            : Number(stats.strongestMagnitude.toFixed(1)),
        surveillanceStart,
        surveillanceEnd,
        magnitudeMin: range.minimum,
        magnitudeMax: range.maximum,
        observedMagnitudeMin: range.observedMin,
        observedMagnitudeMax: range.observedMax,
      };
    }))
    .sort((a, b) => {
      if (a.targetOverlap !== b.targetOverlap) return a.targetOverlap ? -1 : 1;
      const liftDifference = (b.liftPct ?? 0) - (a.liftPct ?? 0);
      if (liftDifference !== 0) return liftDifference;
      return b.recurrencePct - a.recurrencePct;
    });

  const averageSimilarity = evaluated.reduce((sum, item) => sum + item.similarityPct, 0) / evaluated.length;
  const confidencePct = Math.round(clamp(18 + evaluated.length * 4.2 + averageSimilarity * 0.28, 20, 88));

  const analogs: HistoricalAnalogEvidence[] = evaluated.map((item) => ({
    analogEvent: item.analogEvent,
    similarityPct: item.similarityPct,
    followerCount: item.followerCount,
    controlFollowerCount: item.controlFollowerCount,
    hitZoneIds: [...new Set([...item.postCountries.values()].map((entry) => entry.classified.zone.id))],
    hitCountryCodes: [...item.postCountries.keys()],
    controlHitCountryCodes: [...item.controlCountries.keys()],
    strongestFollower: item.strongestFollower,
  }));

  const capsule: HistoricalMigrationCapsule = {
    id: `historical-country-${target.code}-${source.id}`,
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
    modelName: "Analogía histórica por país con ventana de control + contexto ETAS regional",
    methodology: [
      `Búsqueda de eventos análogos en 50 años dentro de ${radiusKm.toLocaleString()} km del origen y magnitud M${analogMagnitudeMin.toFixed(1)}–M${analogMagnitudeMax.toFixed(1)}.`,
      `Selección de hasta ${MAX_ANALOGS} análogos independientes, separados al menos 45 días.`,
      `Para cada análogo se compara una ventana posterior de ${windowDays} días con una ventana de control de igual duración anterior al evento.`,
      "Cada evento posterior se asigna al país sísmico configurado más próximo; la recurrencia se pondera por similitud.",
      "La diferencia entre recurrencia posterior y línea base ayuda a evitar que regiones normalmente muy activas aparezcan artificialmente como señal de migración.",
    ],
    limitations: [
      "La probabilidad empírica es recurrencia histórica ponderada; no garantiza que ocurra un terremoto.",
      "La línea base procede de ventanas de control históricas y no sustituye una calibración tectónica país por país.",
      "Las áreas de cada país son aproximaciones circulares, especialmente para eventos mar adentro y territorios extensos.",
      `El análisis en vivo evalúa como máximo ${MAX_ANALOGS} análogos para limitar solicitudes y tiempo de ejecución.`,
      "Las asociaciones entre regiones distantes no prueban causalidad física.",
    ],
  };

  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value: capsule });
  return capsule;
}
