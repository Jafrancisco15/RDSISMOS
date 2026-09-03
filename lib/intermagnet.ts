import type { MagneticSample, MagneticStationSeries } from "@/lib/geomagnetism";
import type { GeomagneticStation } from "@/lib/geomagNetwork";

const CAPABILITIES_URL = "https://imag-data.bgs.ac.uk/GIN_V1/GINServices?Request=GetCapabilities&format=json";
const HAPI_INFO_URL = "https://imag-data.bgs.ac.uk/GIN_V1/hapi/info";
const HAPI_DATA_URL = "https://imag-data.bgs.ac.uk/GIN_V1/hapi/data";

type GenericRecord = Record<string, unknown>;
type HapiPayload = {
  parameters?: Array<{ name?: string }>;
  data?: unknown[][];
  status?: { code?: number; message?: string };
};
type HapiInfoPayload = {
  startDate?: unknown;
  stopDate?: unknown;
  start?: unknown;
  stop?: unknown;
  status?: { code?: number; message?: string };
};

export interface IntermagnetAvailability {
  datasetId: string;
  start: Date;
  stop: Date;
}

function keyValue(record: GenericRecord, candidates: string[]) {
  const entries = Object.entries(record);
  for (const candidate of candidates) {
    const found = entries.find(([key]) => key.toLowerCase() === candidate.toLowerCase());
    if (found) return found[1];
  }
  return undefined;
}
function numeric(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function longitude180(value: number) { return ((value + 540) % 360) - 180; }
function text(value: unknown) { return String(value ?? "").trim(); }
function usableField(value: number | null) { return value !== null && Math.abs(value) < 90_000; }
function validDate(value: unknown) {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? null : date;
}
function conciseHapiMessage(raw: string) {
  try {
    const payload = JSON.parse(raw) as { status?: { message?: unknown }; message?: unknown };
    return String(payload.status?.message ?? payload.message ?? "error HAPI").replace(/\s+/g, " ").trim().slice(0, 180);
  } catch {
    return raw.replace(/\s+/g, " ").trim().slice(0, 180) || "error HAPI";
  }
}

export function parseIntermagnetCapabilities(payload: unknown): GeomagneticStation[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as GenericRecord;
  const rawList = keyValue(root, ["ObservatoryList", "observatoryList", "observatories"]);
  if (!Array.isArray(rawList)) return [];
  const stations: GeomagneticStation[] = [];
  for (const raw of rawList) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as GenericRecord;
    const code = text(keyValue(record, ["IagaCode", "IAGACode", "code"])).toUpperCase();
    const name = text(keyValue(record, ["Name", "ObservatoryName", "name"]));
    const latitude = numeric(keyValue(record, ["Latitude", "lat"]));
    const longitudeRaw = numeric(keyValue(record, ["Longitude", "lon", "lng"]));
    if (!/^[A-Z0-9]{3}$/.test(code) || latitude === null || longitudeRaw === null) continue;
    const lowered = name.toLowerCase();
    if (lowered.includes("(closed)") || lowered.includes("no longer imo")) continue;
    const elevationM = numeric(keyValue(record, ["Elevation", "ElevationM", "elevation"]));
    const embargo = numeric(keyValue(record, ["DataEmbargo", "DataEmbargoHours", "dataEmbargo"]));
    const countryMatch = name.match(/,\s*([^,(]+)(?:\s*\(|$)/);
    stations.push({
      code,
      name: name || code,
      latitude,
      longitude: longitude180(longitudeRaw),
      elevationM,
      country: countryMatch?.[1]?.trim(),
      minuteDatasetId: `INTERMAGNET:${code}:best-avail:PT1M:xyzf`,
      hasOneSecond: false,
      dataSource: "INTERMAGNET",
      sources: ["INTERMAGNET"],
      dataEmbargoHours: embargo,
    });
  }
  return stations;
}

export async function fetchIntermagnetStations(signal?: AbortSignal) {
  const response = await fetch(CAPABILITIES_URL, {
    signal,
    next: { revalidate: 86_400 },
    headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" },
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`INTERMAGNET capabilities HTTP ${response.status}`);
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { throw new Error("INTERMAGNET capabilities devolvió una respuesta no JSON."); }
  const stations = parseIntermagnetCapabilities(payload);
  if (!stations.length) throw new Error("INTERMAGNET no devolvió observatorios utilizables.");
  return stations;
}

function parseHapiRows(payload: HapiPayload, code: string, datasetId: string): MagneticStationSeries {
  const parameters = Array.isArray(payload.parameters) ? payload.parameters : [];
  const names = parameters.map((parameter) => String(parameter?.name ?? "").trim().toLowerCase());
  const indexOf = (...options: string[]) => names.findIndex((name) => options.includes(name));
  const timeIndex = Math.max(0, indexOf("time", "datetime"));
  const xIndex = indexOf("x"); const yIndex = indexOf("y"); const zIndex = indexOf("z"); const fIndex = indexOf("f");
  if (xIndex < 0 || yIndex < 0 || zIndex < 0) throw new Error(`${code}: INTERMAGNET no devolvió componentes XYZ.`);
  const samples: MagneticSample[] = [];
  for (const row of payload.data ?? []) {
    if (!Array.isArray(row)) continue;
    const timeUtc = String(row[timeIndex] ?? "");
    if (!timeUtc || Number.isNaN(Date.parse(timeUtc))) continue;
    const x = numeric(row[xIndex]); const y = numeric(row[yIndex]); const z = numeric(row[zIndex]); const f = fIndex >= 0 ? numeric(row[fIndex]) : null;
    if (!usableField(x) || !usableField(y) || !usableField(z)) continue;
    samples.push({ timeUtc, x: x!, y: y!, z: z!, f: usableField(f) ? f : null });
  }
  return { code, datasetId, samples };
}

export function clampIntermagnetRange(requestedStart: Date, requestedEnd: Date, availability: Pick<IntermagnetAvailability, "start" | "stop">) {
  const start = new Date(Math.max(requestedStart.getTime(), availability.start.getTime()));
  const end = new Date(Math.min(requestedEnd.getTime(), availability.stop.getTime()));
  return start < end ? { start, end } : null;
}

export async function fetchIntermagnetAvailability(code: string, signal?: AbortSignal): Promise<IntermagnetAvailability> {
  const upper = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{3}$/.test(upper)) throw new Error(`Código INTERMAGNET inválido: ${code}`);
  const datasetId = `${upper.toLowerCase()}/best-avail/PT1M/xyzf`;
  const response = await fetch(`${HAPI_INFO_URL}?${new URLSearchParams({ id: datasetId })}`, {
    signal,
    next: { revalidate: 3_600 },
    headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" },
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`${upper}: INTERMAGNET info HTTP ${response.status}: ${conciseHapiMessage(raw)}`);
  let payload: HapiInfoPayload;
  try { payload = JSON.parse(raw) as HapiInfoPayload; } catch { throw new Error(`${upper}: INTERMAGNET info no JSON.`); }
  const start = validDate(payload.startDate ?? payload.start);
  const stop = validDate(payload.stopDate ?? payload.stop);
  if (!start || !stop || start >= stop) throw new Error(`${upper}: INTERMAGNET no publicó un rango temporal válido.`);
  return { datasetId, start, stop };
}

export async function fetchIntermagnetSeries(code: string, start: Date, end: Date, signal?: AbortSignal) {
  const upper = code.trim().toUpperCase();
  const availability = await fetchIntermagnetAvailability(upper, signal);
  const range = clampIntermagnetRange(start, end, availability);
  if (!range) {
    throw new Error(`${upper}: sin datos en la ventana solicitada; disponibilidad ${availability.start.toISOString().slice(0, 16)}Z → ${availability.stop.toISOString().slice(0, 16)}Z.`);
  }
  const params = new URLSearchParams({
    id: availability.datasetId,
    "time.min": range.start.toISOString(),
    "time.max": range.end.toISOString(),
    format: "json",
  });
  const response = await fetch(`${HAPI_DATA_URL}?${params}`, {
    signal,
    cache: "no-store",
    headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" },
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`${upper}: INTERMAGNET HTTP ${response.status}: ${conciseHapiMessage(raw)}`);
  let payload: HapiPayload;
  try { payload = JSON.parse(raw) as HapiPayload; } catch { throw new Error(`${upper}: INTERMAGNET devolvió una respuesta no JSON.`); }
  const series = parseHapiRows(payload, upper, `INTERMAGNET:${availability.datasetId}`);
  if (series.samples.length < 30) throw new Error(`${upper}: solo ${series.samples.length} minutos válidos dentro de su disponibilidad temporal.`);
  return series;
}
