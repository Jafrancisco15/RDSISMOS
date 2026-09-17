import {
  analyzeDynamicTriggering,
  analyzeIntraplateRelaxation,
  type CatalogWindow,
  type HypothesisCatalogEvent,
  type SeismicHypothesesResponse,
} from "./seismicHypotheses";
import {
  assignPlateToPoint,
  preparePlateModel,
  type PlateFeatureCollection,
} from "./plateAssignment";

const DAY_MS = 86_400_000;
const USGS_QUERY = "https://earthquake.usgs.gov/fdsnws/event/1/query";
export const PB2002_URL = "https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_plates.json";
const ANALYSIS_START = "1990-01-01T00:00:00.000Z";
const WINDOW_DAYS = 5;
const MAX_SURFACE_TRAVEL_HOURS = 2;

type BuildOptions = {
  triggerLimit?: number;
  randomDateLimit?: number;
  bootstrapIterations?: number;
  monteCarloIterations?: number;
  fresh?: boolean;
  signal?: AbortSignal;
};

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  values.push(current);
  return values;
}

export function parseUsgsCsv(text: string): HypothesisCatalogEvent[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const index = new Map(headers.map((header, position) => [header, position]));
  const value = (row: string[], key: string) => row[index.get(key) ?? -1] ?? "";
  const events: HypothesisCatalogEvent[] = [];
  for (const line of lines.slice(1)) {
    const row = parseCsvLine(line);
    const timeUtc = value(row, "time");
    const latitude = Number(value(row, "latitude"));
    const longitude = Number(value(row, "longitude"));
    const depthKm = Number(value(row, "depth"));
    const magnitude = Number(value(row, "mag"));
    const id = value(row, "id");
    const type = value(row, "type");
    if (!id || !timeUtc || type !== "earthquake" || !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) || !Number.isFinite(depthKm) || !Number.isFinite(magnitude)) continue;
    events.push({
      id,
      timeUtc: new Date(timeUtc).toISOString(),
      latitude,
      longitude,
      depthKm,
      magnitude,
      place: value(row, "place") || "Región no especificada",
    });
  }
  return events;
}

function combinedSignal(signal?: AbortSignal, timeoutMs = 45_000) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function fetchUsgsCatalog({
  startTime,
  endTime,
  minimumMagnitude,
  revalidateSeconds,
  fresh,
  signal,
}: {
  startTime: string;
  endTime: string;
  minimumMagnitude: number;
  revalidateSeconds: number;
  fresh?: boolean;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams({
    format: "csv",
    starttime: startTime,
    endtime: endTime,
    minmagnitude: String(minimumMagnitude),
    eventtype: "earthquake",
    orderby: "time-asc",
    limit: "20000",
  });
  const response = await fetch(`${USGS_QUERY}?${params}`, {
    headers: { Accept: "text/csv", "User-Agent": "RDSISMOS/1.0" },
    signal: combinedSignal(signal),
    ...(fresh ? { cache: "no-store" as const } : { next: { revalidate: revalidateSeconds } }),
  });
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, " ").trim().slice(0, 180);
    throw new Error(`USGS ComCat HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return parseUsgsCsv(await response.text());
}

async function loadPlateModel(signal?: AbortSignal) {
  const response = await fetch(PB2002_URL, {
    headers: { Accept: "application/geo+json,application/json", "User-Agent": "RDSISMOS/1.0" },
    signal: combinedSignal(signal, 30_000),
    next: { revalidate: 30 * 24 * 3600 },
  });
  if (!response.ok) throw new Error(`PB2002 HTTP ${response.status}`);
  const payload = await response.json() as PlateFeatureCollection;
  if (payload.type !== "FeatureCollection" || !Array.isArray(payload.features)) {
    throw new Error("PB2002 devolvió un GeoJSON no reconocido.");
  }
  const model = preparePlateModel(payload);
  if (!model.plates.length) throw new Error("PB2002 no contiene polígonos de placa utilizables.");
  return model;
}

function independentTriggers(candidates: HypothesisCatalogEvent[], now: Date) {
  const completeThrough = now.getTime() - (WINDOW_DAYS * DAY_MS + MAX_SURFACE_TRAVEL_HOURS * 3_600_000);
  const isolation = (WINDOW_DAYS * 2 * DAY_MS) + MAX_SURFACE_TRAVEL_HOURS * 3_600_000;
  return candidates.filter((candidate, index) => {
    const time = Date.parse(candidate.timeUtc);
    if (time > completeThrough) return false;
    return candidates.every((other, otherIndex) => otherIndex === index || Math.abs(Date.parse(other.timeUtc) - time) > isolation);
  });
}

export function evenlySampleEvents(events: HypothesisCatalogEvent[], requested: number) {
  const sorted = [...events].sort((a, b) => a.timeUtc.localeCompare(b.timeUtc));
  const limit = Math.max(1, Math.min(requested, sorted.length));
  if (limit === sorted.length) return sorted;
  if (limit === 1) return [sorted[Math.floor(sorted.length / 2)]];
  const chosen: HypothesisCatalogEvent[] = [];
  const used = new Set<number>();
  for (let index = 0; index < limit; index += 1) {
    let candidateIndex = Math.round(index * (sorted.length - 1) / (limit - 1));
    while (used.has(candidateIndex) && candidateIndex + 1 < sorted.length) candidateIndex += 1;
    used.add(candidateIndex);
    chosen.push(sorted[candidateIndex]);
  }
  return chosen;
}

function pseudoRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function randomDateAnchors(
  selected: HypothesisCatalogEvent[],
  allTriggers: HypothesisCatalogEvent[],
  requested: number,
  endTime: Date,
) {
  const random = pseudoRandom(0x5244534d ^ endTime.getUTCFullYear());
  const earliest = Date.parse(ANALYSIS_START) + (WINDOW_DAYS + 1) * DAY_MS;
  const latest = endTime.getTime() - (WINDOW_DAYS + 1) * DAY_MS;
  const exclusion = 12 * DAY_MS;
  const anchors: HypothesisCatalogEvent[] = [];
  for (let index = 0; index < requested && selected.length; index += 1) {
    const base = selected[index % selected.length];
    let candidateTime = Date.parse(base.timeUtc);
    let accepted = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const magnitude = 35 + Math.floor(random() * 300);
      const direction = random() < 0.5 ? -1 : 1;
      candidateTime = Math.max(earliest, Math.min(latest, Date.parse(base.timeUtc) + direction * magnitude * DAY_MS));
      if (allTriggers.every((trigger) => Math.abs(Date.parse(trigger.timeUtc) - candidateTime) > exclusion)) {
        accepted = true;
        break;
      }
    }
    if (!accepted) continue;
    anchors.push({
      ...base,
      id: `random-${index + 1}-${base.id}`,
      timeUtc: new Date(candidateTime).toISOString(),
      place: `Fecha aleatoria emparejada con ${base.place}`,
    });
  }
  return anchors;
}

async function fetchCatalogWindow(anchor: HypothesisCatalogEvent, signal?: AbortSignal): Promise<CatalogWindow> {
  const anchorTime = Date.parse(anchor.timeUtc);
  const startTime = new Date(anchorTime - WINDOW_DAYS * DAY_MS).toISOString();
  const endTime = new Date(anchorTime + WINDOW_DAYS * DAY_MS + MAX_SURFACE_TRAVEL_HOURS * 3_600_000).toISOString();
  const events = await fetchUsgsCatalog({
    startTime,
    endTime,
    minimumMagnitude: 2,
    revalidateSeconds: 30 * 24 * 3600,
    signal,
  });
  return { anchor, events, kind: anchor.id.startsWith("random-") ? "random-date" : "trigger" };
}

async function loadWindows(anchors: HypothesisCatalogEvent[], concurrency: number, signal?: AbortSignal) {
  const windows: Array<CatalogWindow | undefined> = Array(anchors.length);
  const failures: string[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < anchors.length) {
      const index = cursor;
      cursor += 1;
      const anchor = anchors[index];
      try {
        windows[index] = await fetchCatalogWindow(anchor, signal);
      } catch (error) {
        failures.push(`${anchor.timeUtc.slice(0, 10)} · ${anchor.place}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, anchors.length) }, () => worker()));
  return { windows: windows.filter((window): window is CatalogWindow => Boolean(window)), failures };
}

export async function buildSeismicHypothesesReport(options: BuildOptions = {}): Promise<SeismicHypothesesResponse> {
  const now = new Date();
  const endTime = now.toISOString();
  const triggerLimit = Math.max(8, Math.min(200, Math.round(options.triggerLimit ?? 24)));
  const randomDateLimit = Math.max(8, Math.min(200, Math.round(options.randomDateLimit ?? Math.min(16, triggerLimit))));
  const bootstrapIterations = Math.max(1_000, Math.min(5_000, Math.round(options.bootstrapIterations ?? 1_000)));
  const monteCarloIterations = Math.max(1_000, Math.min(5_000, Math.round(options.monteCarloIterations ?? 1_000)));
  const warnings: string[] = [];

  const [catalog, plateModel] = await Promise.all([
    fetchUsgsCatalog({
      startTime: ANALYSIS_START,
      endTime,
      minimumMagnitude: 6.5,
      revalidateSeconds: 6 * 3600,
      fresh: options.fresh,
      signal: options.signal,
    }),
    loadPlateModel(options.signal),
  ]);
  const candidates = catalog.filter((event) => event.magnitude >= 7.5);
  const independent = independentTriggers(candidates, now);
  const selected = evenlySampleEvents(independent, triggerLimit);
  const randomAnchors = randomDateAnchors(selected, candidates, Math.min(randomDateLimit, selected.length), now);
  const [triggerLoad, randomLoad] = await Promise.all([
    loadWindows(selected, 6, options.signal),
    loadWindows(randomAnchors, 4, options.signal),
  ]);
  if (triggerLoad.failures.length) {
    warnings.push(`${triggerLoad.failures.length} ventana(s) de eventos M≥7.5 no pudieron recuperarse.`);
  }
  if (randomLoad.failures.length) {
    warnings.push(`${randomLoad.failures.length} ventana(s) de fechas aleatorias no pudieron recuperarse.`);
  }

  const hypothesisA = analyzeDynamicTriggering(triggerLoad.windows, randomLoad.windows, {
    candidateTriggerCount: candidates.length,
    bootstrapIterations,
  });

  let unmatched = 0;
  const assignedCatalog = catalog.map((event) => {
    const plate = assignPlateToPoint(event.longitude, event.latitude, plateModel);
    if (!plate) unmatched += 1;
    return plate ? { ...event, ...plate } : event;
  });
  if (unmatched) warnings.push(`${unmatched} evento(s) M≥6.5 quedaron fuera de los polígonos PB2002.`);
  const hypothesisB = analyzeIntraplateRelaxation(assignedCatalog, {
    monteCarloIterations,
    plateModel: "PB2002 · Bird (2003)",
  });

  return {
    generatedAtUtc: now.toISOString(),
    experimentVersion: "seismic-hypotheses-v1.0",
    catalog: {
      source: "USGS ANSS ComCat / FDSN Event",
      startTime: ANALYSIS_START,
      endTime,
      triggerCandidates: candidates.length,
      m65Events: catalog.length,
      plateModel: "PB2002 · Bird (2003)",
      plateModelUrl: PB2002_URL,
    },
    hypothesisA,
    hypothesisB,
    warnings,
    sources: [
      {
        name: "USGS ANSS ComCat / FDSN Event",
        url: "https://earthquake.usgs.gov/fdsnws/event/1/",
        use: "Tiempo, magnitud, latitud, longitud y profundidad del catálogo sísmico.",
      },
      {
        name: "PB2002 · Bird (2003)",
        url: "https://doi.org/10.1029/2001GC000252",
        use: "Asignación reproducible de cada evento a una placa tectónica.",
      },
      {
        name: "Reasenberg & Simpson (1992)",
        url: "https://doi.org/10.1126/science.255.5052.1687",
        use: "Referencia del contraste Z de cambio de tasa; aquí se acompaña con fechas aleatorias y FDR.",
      },
    ],
  };
}
