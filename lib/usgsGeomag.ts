import type { MagneticSample, MagneticStationSeries } from "@/lib/geomagnetism";

export type UsgsGeomagStation = {
  code: string;
  name: string;
  latitude: number;
  longitude: number;
  elevationM: number | null;
  country: string;
};

type UsgsValueStream = {
  id?: string;
  values?: unknown[];
  metadata?: Record<string, unknown>;
};

type UsgsDataPayload = {
  times?: unknown[];
  values?: UsgsValueStream[];
  metadata?: Record<string, unknown>;
};

const DAY_MS = 86_400_000;
const USGS_DATA_URL = "https://geomag.usgs.gov/ws/data/";

// Active USGS Geomagnetism Program observatories. Coordinates are normalized to -180..180.
export const USGS_GEOMAG_STATIONS: UsgsGeomagStation[] = [
  { code: "BOU", name: "Boulder", latitude: 40.137, longitude: -105.237, elevationM: 1682, country: "United States" },
  { code: "BRW", name: "Barrow", latitude: 71.322, longitude: -156.622, elevationM: 12, country: "United States" },
  { code: "BSL", name: "Stennis Space Center", latitude: 30.350, longitude: -89.640, elevationM: null, country: "United States" },
  { code: "CMO", name: "College", latitude: 64.874, longitude: -147.860, elevationM: 197, country: "United States" },
  { code: "DED", name: "Deadhorse", latitude: 70.355, longitude: -148.793, elevationM: 10, country: "United States" },
  { code: "FRD", name: "Fredericksburg", latitude: 38.205, longitude: -77.373, elevationM: 69, country: "United States" },
  { code: "FRN", name: "Fresno", latitude: 37.091, longitude: -119.718, elevationM: 331, country: "United States" },
  { code: "GUA", name: "Guam", latitude: 13.590, longitude: 144.870, elevationM: 140, country: "United States" },
  { code: "HON", name: "Honolulu", latitude: 21.320, longitude: -158.000, elevationM: 4, country: "United States" },
  { code: "NEW", name: "Newport", latitude: 48.264, longitude: -117.122, elevationM: 770, country: "United States" },
  { code: "SHU", name: "Shumagin", latitude: 55.347, longitude: -160.460, elevationM: 80, country: "United States" },
  { code: "SIT", name: "Sitka", latitude: 57.058, longitude: -135.327, elevationM: 24, country: "United States" },
  { code: "SJG", name: "San Juan (Cayey)", latitude: 18.111, longitude: -66.1498, elevationM: 424, country: "Puerto Rico / United States" },
  { code: "TUC", name: "Tucson", latitude: 32.175, longitude: -110.733, elevationM: 946, country: "United States" },
];

export const USGS_GEOMAG_CODES = new Set(USGS_GEOMAG_STATIONS.map((station) => station.code));

function numeric(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function usableField(value: number | null) {
  return value !== null && Math.abs(value) < 90_000;
}

function streamElement(stream: UsgsValueStream) {
  const metadata = stream.metadata ?? {};
  const candidate = stream.id ?? metadata.element ?? metadata.channel ?? metadata.id;
  return String(candidate ?? "").trim().toUpperCase();
}

function streamUnit(stream: UsgsValueStream) {
  const metadata = stream.metadata ?? {};
  return String(metadata.units ?? metadata.unit ?? "").trim().toLowerCase();
}

function byElement(payload: UsgsDataPayload) {
  const result = new Map<string, UsgsValueStream>();
  for (const stream of payload.values ?? []) {
    const element = streamElement(stream);
    if (element) result.set(element, stream);
  }
  return result;
}

function declinationRadians(value: number, stream: UsgsValueStream | undefined) {
  const unit = stream ? streamUnit(stream) : "";
  if (unit.includes("deg")) return value * Math.PI / 180;
  // USGS D is normally returned in arcminutes (amin).
  return (value / 60) * Math.PI / 180;
}

export function parseUsgsGeomagPayload(
  payload: UsgsDataPayload,
  code: string,
  datasetId: string,
): MagneticStationSeries {
  const times = Array.isArray(payload.times) ? payload.times : [];
  const streams = byElement(payload);
  const xStream = streams.get("X");
  const yStream = streams.get("Y") ?? streams.get("E");
  const hStream = streams.get("H");
  const dStream = streams.get("D");
  const zStream = streams.get("Z");
  const fStream = streams.get("F");
  const samples: MagneticSample[] = [];

  for (let index = 0; index < times.length; index += 1) {
    const timeUtc = String(times[index] ?? "");
    if (!timeUtc || Number.isNaN(Date.parse(timeUtc))) continue;

    let x = numeric(xStream?.values?.[index]);
    let y = numeric(yStream?.values?.[index]);
    const z = numeric(zStream?.values?.[index]);
    const f = numeric(fStream?.values?.[index]);

    if ((!usableField(x) || !usableField(y)) && hStream && dStream) {
      const h = numeric(hStream.values?.[index]);
      const d = numeric(dStream.values?.[index]);
      if (usableField(h) && d !== null) {
        const radians = declinationRadians(d, dStream);
        x = h! * Math.cos(radians);
        y = h! * Math.sin(radians);
      }
    }

    if (!usableField(x) || !usableField(y) || !usableField(z)) continue;
    samples.push({ timeUtc, x: x!, y: y!, z: z!, f: usableField(f) ? f : null });
  }

  return { code, datasetId, samples };
}

function chunks(start: Date, end: Date, maxDays = 18) {
  const out: Array<{ start: Date; end: Date }> = [];
  let cursor = start.getTime();
  const endMs = end.getTime();
  const chunkMs = maxDays * DAY_MS;
  while (cursor < endMs) {
    const next = Math.min(endMs, cursor + chunkMs);
    out.push({ start: new Date(cursor), end: new Date(next) });
    cursor = next + 60_000;
  }
  return out;
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<UsgsDataPayload> {
  const response = await fetch(url, {
    signal,
    cache: "no-store",
    headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`USGS HTTP ${response.status}: ${text.replace(/\s+/g, " ").slice(0, 160)}`);
  try {
    return JSON.parse(text) as UsgsDataPayload;
  } catch {
    throw new Error(`USGS devolvió una respuesta no JSON: ${text.replace(/\s+/g, " ").slice(0, 160)}`);
  }
}

async function fetchMode(
  code: string,
  start: Date,
  end: Date,
  dataType: "adjusted" | "variation" | "quasi-definitive" | "definitive",
  elements: string,
  signal?: AbortSignal,
) {
  const all: MagneticSample[] = [];
  const datasetId = `USGS:${dataType}:${elements.replaceAll(",", "")}:PT60S`;
  for (const window of chunks(start, end)) {
    const params = new URLSearchParams({
      id: code,
      format: "json",
      type: dataType,
      elements,
      sampling_period: "60",
      starttime: window.start.toISOString(),
      endtime: window.end.toISOString(),
    });
    const payload = await fetchJson(`${USGS_DATA_URL}?${params}`, signal);
    const parsed = parseUsgsGeomagPayload(payload, code, datasetId);
    all.push(...parsed.samples);
  }
  const dedup = new Map(all.map((sample) => [sample.timeUtc, sample]));
  return { code, datasetId, samples: [...dedup.values()].sort((a, b) => Date.parse(a.timeUtc) - Date.parse(b.timeUtc)) } satisfies MagneticStationSeries;
}

export async function fetchUsgsGeomagSeries(code: string, start: Date, end: Date, signal?: AbortSignal) {
  const upper = code.trim().toUpperCase();
  if (!USGS_GEOMAG_CODES.has(upper)) throw new Error(`${upper}: no pertenece a la red geomagnética USGS soportada.`);
  const attempts: Array<{ type: "adjusted" | "variation" | "quasi-definitive" | "definitive"; elements: string }> = [
    { type: "adjusted", elements: "X,Y,Z,F" },
    { type: "variation", elements: "H,D,Z,F" },
    { type: "quasi-definitive", elements: "X,Y,Z,F" },
    { type: "definitive", elements: "X,Y,Z,F" },
  ];
  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      const series = await fetchMode(upper, start, end, attempt.type, attempt.elements, signal);
      if (series.samples.length >= 30) return series;
      errors.push(`${attempt.type}: ${series.samples.length} muestras válidas`);
    } catch (error) {
      errors.push(`${attempt.type}: ${error instanceof Error ? error.message : "error"}`);
    }
  }
  throw new Error(`${upper}: no fue posible obtener ≥30 muestras de 1 minuto desde USGS. ${errors.slice(0, 3).join("; ")}`);
}
