import type { EarthquakeFilters } from "./types";

const MAX_RANGE_DAYS = 365 * 50 + 15;
const MAX_LIMIT = 20_000;

export function parseEarthquakeFilters(params: URLSearchParams): EarthquakeFilters {
  const now = new Date();
  const defaultStart = new Date(now);
  defaultStart.setUTCDate(defaultStart.getUTCDate() - 30);
  const startTime = parseDate(params.get("starttime"), defaultStart);
  const endTime = parseDate(params.get("endtime"), now);
  if (startTime > endTime) throw new Error("La fecha inicial no puede superar la fecha final.");
  if ((endTime.getTime() - startTime.getTime()) / 86_400_000 > MAX_RANGE_DAYS) {
    throw new Error("El rango máximo permitido es de 50 años.");
  }
  const latitude = optionalNumber(params.get("latitude"), -90, 90);
  const longitude = optionalNumber(params.get("longitude"), -180, 180);
  const maxRadiusKm = optionalNumber(params.get("maxradiuskm"), 0, 20_000);
  if (maxRadiusKm !== undefined && (latitude === undefined || longitude === undefined)) {
    throw new Error("El radio requiere latitud y longitud.");
  }
  return {
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    minMagnitude: optionalNumber(params.get("minmagnitude"), -2, 10),
    maxMagnitude: optionalNumber(params.get("maxmagnitude"), -2, 10),
    minDepth: optionalNumber(params.get("mindepth"), -20, 1_000),
    maxDepth: optionalNumber(params.get("maxdepth"), -20, 1_000),
    latitude,
    longitude,
    maxRadiusKm,
    magnitudeType: cleanText(params.get("magnitudetype"), 12),
    eventType: cleanText(params.get("eventtype"), 40),
    source: cleanText(params.get("source"), 40),
    reviewedOnly: params.get("reviewed") === "true",
    search: cleanText(params.get("search"), 120),
    orderBy: parseOrder(params.get("orderby")),
    limit: integer(params.get("limit"), 1, 500, 50),
    offset: integer(params.get("offset"), 1, 1_000_000, 1),
  };
}

export function toUsgsParams(filters: EarthquakeFilters, format = "geojson") {
  const params = new URLSearchParams({
    format,
    starttime: filters.startTime,
    endtime: filters.endTime,
    limit: String(Math.min(filters.limit, MAX_LIMIT)),
    offset: String(filters.offset),
    orderby: filters.orderBy ?? "time",
  });
  assign(params, "minmagnitude", filters.minMagnitude);
  assign(params, "maxmagnitude", filters.maxMagnitude);
  assign(params, "mindepth", filters.minDepth);
  assign(params, "maxdepth", filters.maxDepth);
  assign(params, "latitude", filters.latitude);
  assign(params, "longitude", filters.longitude);
  assign(params, "maxradiuskm", filters.maxRadiusKm);
  if (filters.eventType) params.set("eventtype", filters.eventType);
  return params;
}

export function splitInterval(start: Date, end: Date): [[Date, Date], [Date, Date]] {
  if (end <= start) throw new Error("Intervalo inválido.");
  const middle = new Date(Math.floor((start.getTime() + end.getTime()) / 2));
  return [[start, middle], [new Date(middle.getTime() + 1), end]];
}

function assign(params: URLSearchParams, key: string, value?: number) {
  if (value !== undefined) params.set(key, String(value));
}
function parseDate(value: string | null, fallback: Date) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Fecha inválida: ${value}`);
  return date;
}
function optionalNumber(value: string | null, min: number, max: number) {
  if (value === null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`Valor numérico fuera de rango: ${value}`);
  }
  return number;
}
function integer(value: string | null, min: number, max: number, fallback: number) {
  const number = value ? Number(value) : fallback;
  if (!Number.isInteger(number) || number < min || number > max) throw new Error("Paginación inválida.");
  return number;
}
function cleanText(value: string | null, max: number) {
  if (!value) return undefined;
  return value.replace(/[<>]/g, "").trim().slice(0, max) || undefined;
}
function parseOrder(value: string | null): EarthquakeFilters["orderBy"] {
  return ["time", "time-asc", "magnitude", "magnitude-asc"].includes(value ?? "")
    ? (value as EarthquakeFilters["orderBy"])
    : "time";
}
