import { COUNTRIES } from "@/lib/countries";
import { haversineKm } from "@/lib/regions";
import type { SeismicEvent } from "@/lib/types";
import { fetchExpandedSeismicCatalog } from "@/lib/providers/multisource";
import { queryAllPartitioned, queryEarthquakes } from "./usgs";
import type { EarthquakeEvent, EarthquakeFilters, EarthquakePage } from "./types";

const DAY_MS = 86_400_000;
const MULTISOURCE_MAX_DAYS = 370;

function countryTarget(code?: string) {
  const normalized = code?.trim().toUpperCase();
  return COUNTRIES.find((country) => country.code === normalized)
    ?? COUNTRIES.find((country) => country.code === "DO")
    ?? COUNTRIES[0];
}

function withCountryRadius(filters: EarthquakeFilters): EarthquakeFilters {
  if (!filters.countryCode || filters.latitude !== undefined || filters.longitude !== undefined || filters.maxRadiusKm !== undefined) {
    return filters;
  }
  const target = countryTarget(filters.countryCode);
  return {
    ...filters,
    latitude: target.latitude,
    longitude: target.longitude,
    maxRadiusKm: Math.min(4_000, Math.max(250, target.radiusKm + 300)),
  };
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

function sourceMatches(event: EarthquakeEvent, source?: string) {
  const selected = source?.trim().toLowerCase();
  if (!selected || selected === "all") return true;
  if (selected === "usgs") return event.sourceCatalog.toLowerCase().includes("usgs");
  if (selected === "emsc") return event.sourceCatalog.toLowerCase().includes("emsc");
  if (selected === "raspberry") return event.sourceCatalog.toLowerCase().includes("raspberry");
  return event.sourceCatalog.toLowerCase().includes(selected) || event.network.toLowerCase().includes(selected);
}

function eventMatches(event: EarthquakeEvent, filters: EarthquakeFilters) {
  const time = new Date(event.timeUtc).getTime();
  if (time < new Date(filters.startTime).getTime() || time > new Date(filters.endTime).getTime()) return false;
  if (filters.minMagnitude !== undefined && event.magnitude < filters.minMagnitude) return false;
  if (filters.maxMagnitude !== undefined && event.magnitude > filters.maxMagnitude) return false;
  if (filters.minDepth !== undefined && event.depthKm < filters.minDepth) return false;
  if (filters.maxDepth !== undefined && event.depthKm > filters.maxDepth) return false;
  if (filters.magnitudeType && event.magnitudeType.toLowerCase() !== filters.magnitudeType.toLowerCase()) return false;
  if (filters.eventType && filters.eventType !== "all" && event.eventType.toLowerCase() !== filters.eventType.toLowerCase()) return false;
  if (!sourceMatches(event, filters.source)) return false;
  if (filters.reviewedOnly && event.status.toLowerCase() !== "reviewed") return false;

  const search = filters.search?.trim().toLocaleLowerCase();
  if (search && !`${event.place} ${event.countryOrRegion} ${event.network} ${event.sourceCatalog}`.toLocaleLowerCase().includes(search)) return false;

  if (filters.latitude !== undefined && filters.longitude !== undefined && filters.maxRadiusKm !== undefined) {
    const distance = haversineKm(event.latitude, event.longitude, filters.latitude, filters.longitude);
    if (distance > filters.maxRadiusKm) return false;
  }
  return true;
}

function sortEvents(events: EarthquakeEvent[], orderBy: EarthquakeFilters["orderBy"]) {
  const sorted = [...events];
  if (orderBy === "time-asc") return sorted.sort((a, b) => Date.parse(a.timeUtc) - Date.parse(b.timeUtc));
  if (orderBy === "magnitude") return sorted.sort((a, b) => b.magnitude - a.magnitude || Date.parse(b.timeUtc) - Date.parse(a.timeUtc));
  if (orderBy === "magnitude-asc") return sorted.sort((a, b) => a.magnitude - b.magnitude || Date.parse(b.timeUtc) - Date.parse(a.timeUtc));
  return sorted.sort((a, b) => Date.parse(b.timeUtc) - Date.parse(a.timeUtc));
}

function recentEnough(filters: EarthquakeFilters) {
  return (Date.parse(filters.endTime) - Date.parse(filters.startTime)) / DAY_MS <= MULTISOURCE_MAX_DAYS;
}

async function loadRecentMultisource(filters: EarthquakeFilters) {
  const spatialFilters = withCountryRadius(filters);
  const target = countryTarget(filters.countryCode);
  const requestedMin = filters.minMagnitude ?? (filters.countryCode ? 2 : 4.2);
  const providerMin = filters.countryCode ? Math.max(0, requestedMin) : Math.max(4.2, requestedMin);
  const catalog = await fetchExpandedSeismicCatalog(
    new Date(filters.startTime),
    new Date(filters.endTime),
    target,
    providerMin,
  );
  const events = sortEvents(
    catalog.events.map(toEarthquakeEvent).filter((event) => eventMatches(event, spatialFilters)),
    filters.orderBy,
  );
  return {
    events,
    provider: catalog.provider,
    providerStatus: catalog.providerStatus,
    warnings: catalog.warning ? [catalog.warning] : [],
  };
}

function needsFullUsgsScan(filters: EarthquakeFilters) {
  return Boolean(filters.search || filters.magnitudeType || (filters.source && filters.source !== "all" && filters.source !== "usgs"));
}

async function loadAllUsgs(filters: EarthquakeFilters, maximum: number, signal?: AbortSignal) {
  const spatialFilters = withCountryRadius(filters);
  const events: EarthquakeEvent[] = [];
  await queryAllPartitioned(
    { ...spatialFilters, source: undefined, search: undefined, magnitudeType: undefined, limit: 20_000, offset: 1 },
    (batch) => {
      if (events.length + batch.length > maximum) {
        throw new Error(`La consulta supera ${maximum.toLocaleString()} eventos. Reduzca el rango o aumente la magnitud mínima.`);
      }
      events.push(...batch);
    },
    signal,
  );
  return sortEvents(events.filter((event) => eventMatches(event, spatialFilters)), filters.orderBy);
}

function validateSourceAndReview(filters: EarthquakeFilters, source?: string) {
  if (filters.reviewedOnly && (source === "emsc" || source === "raspberry")) {
    throw new Error("El estado revisado solo está disponible para eventos USGS.");
  }
}

export async function queryEarthquakeCatalog(filters: EarthquakeFilters, signal?: AbortSignal): Promise<EarthquakePage> {
  const source = filters.source?.toLowerCase();
  validateSourceAndReview(filters, source);
  const isExplicitSpatialQuery = filters.latitude !== undefined && filters.longitude !== undefined && filters.maxRadiusKm !== undefined;
  const useMultisource = recentEnough(filters) && source !== "usgs" && !filters.reviewedOnly && !isExplicitSpatialQuery;

  if (useMultisource) {
    const result = await loadRecentMultisource(filters);
    const start = Math.max(0, filters.offset - 1);
    const pageEvents = result.events.slice(start, start + filters.limit);
    return {
      events: pageEvents,
      total: result.events.length,
      limit: filters.limit,
      offset: filters.offset,
      hasMore: start + pageEvents.length < result.events.length,
      generatedAt: new Date().toISOString(),
      provider: result.provider,
      providerStatus: result.providerStatus,
      warnings: result.warnings,
      catalogMode: "multisource",
    };
  }

  if (source === "emsc" || source === "raspberry") {
    throw new Error("La fuente seleccionada está disponible para ventanas recientes de hasta 370 días.");
  }

  const spatialFilters = withCountryRadius({ ...filters, source: undefined });
  if (needsFullUsgsScan(filters)) {
    const events = await loadAllUsgs(filters, 50_000, signal);
    const start = Math.max(0, filters.offset - 1);
    const pageEvents = events.slice(start, start + filters.limit);
    return {
      events: pageEvents,
      total: events.length,
      limit: filters.limit,
      offset: filters.offset,
      hasMore: start + pageEvents.length < events.length,
      generatedAt: new Date().toISOString(),
      provider: "USGS ComCat",
      providerStatus: ["USGS ComCat histórico"],
      warnings: [],
      catalogMode: "historical-usgs",
    };
  }

  const page = await queryEarthquakes(spatialFilters, signal);
  return {
    ...page,
    provider: "USGS ComCat",
    providerStatus: [filters.reviewedOnly ? "USGS ComCat · solo revisados" : "USGS ComCat histórico"],
    warnings: [],
    catalogMode: "historical-usgs",
  };
}

export async function queryEarthquakeCatalogAll(
  filters: EarthquakeFilters,
  maximum: number,
  signal?: AbortSignal,
) {
  const source = filters.source?.toLowerCase();
  validateSourceAndReview(filters, source);
  const isExplicitSpatialQuery = filters.latitude !== undefined && filters.longitude !== undefined && filters.maxRadiusKm !== undefined;
  if (recentEnough(filters) && source !== "usgs" && !filters.reviewedOnly && !isExplicitSpatialQuery) {
    const result = await loadRecentMultisource(filters);
    if (result.events.length > maximum) {
      throw new Error(`La consulta supera ${maximum.toLocaleString()} eventos. Reduzca el rango o aumente la magnitud mínima.`);
    }
    return result.events;
  }
  if (source === "emsc" || source === "raspberry") {
    throw new Error("La fuente seleccionada está disponible para ventanas recientes de hasta 370 días.");
  }
  return loadAllUsgs(filters, maximum, signal);
}
