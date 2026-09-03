const HAPI_BASE = "https://vires.services/hapi";
const DATASETS = ["SW_FAST_MAGA_LR_1B", "SW_FAST_MAGB_LR_1B", "SW_FAST_MAGC_LR_1B"] as const;

export type SwarmSatellite = "A" | "B" | "C";
export interface SwarmMagneticPoint {
  id: string;
  source: "Swarm";
  satellite: SwarmSatellite;
  latitude: number;
  longitude: number;
  strengthNt: number;
  observedAt: string;
}

type HapiInfo = { startDate?: unknown; stopDate?: unknown; start?: unknown; stop?: unknown; status?: { message?: unknown } };

function validDate(value: unknown) {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? null : date;
}
function numeric(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function satelliteFor(dataset: string): SwarmSatellite {
  return dataset.includes("MAGB") ? "B" : dataset.includes("MAGC") ? "C" : "A";
}
function normalizeLongitude(value: number) { return ((value + 540) % 360) - 180; }

async function datasetRange(dataset: string, signal?: AbortSignal) {
  const response = await fetch(`${HAPI_BASE}/info?${new URLSearchParams({ id: dataset })}`, {
    signal,
    next: { revalidate: 600 },
    headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" },
  });
  if (!response.ok) throw new Error(`${dataset}: VirES info HTTP ${response.status}`);
  const info = await response.json() as HapiInfo;
  const start = validDate(info.startDate ?? info.start);
  const stop = validDate(info.stopDate ?? info.stop);
  if (!start || !stop || start >= stop) throw new Error(`${dataset}: VirES no publicó un rango temporal válido.`);
  return { start, stop };
}

async function fetchDataset(dataset: typeof DATASETS[number], hours: number, signal?: AbortSignal): Promise<SwarmMagneticPoint[]> {
  const range = await datasetRange(dataset, signal);
  const stop = new Date(Math.min(Date.now(), range.stop.getTime()));
  const start = new Date(Math.max(range.start.getTime(), stop.getTime() - Math.max(1, hours) * 3_600_000));
  if (start >= stop) return [];
  const params = new URLSearchParams({
    dataset,
    parameters: "Latitude,Longitude,F",
    start: start.toISOString(),
    stop: stop.toISOString(),
    format: "csv",
  });
  const response = await fetch(`${HAPI_BASE}/data?${params}`, {
    signal,
    cache: "no-store",
    headers: { Accept: "text/csv", "User-Agent": "RDSISMOS/1.0" },
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`${dataset}: VirES data HTTP ${response.status}: ${raw.replace(/\s+/g, " ").slice(0, 120)}`);
  const satellite = satelliteFor(dataset);
  const points: SwarmMagneticPoint[] = [];
  const lines = raw.split(/\r?\n/).filter(Boolean);
  // MAGx_LR_1B is 1 Hz; keep roughly one point/minute for a lightweight world map.
  for (let index = 0; index < lines.length; index += 60) {
    const columns = lines[index].split(",").map((value) => value.replace(/^"|"$/g, "").trim());
    if (columns.length < 4) continue;
    const observedAt = columns[0];
    const latitude = numeric(columns[1]);
    const longitude = numeric(columns[2]);
    const strengthNt = numeric(columns[3]);
    if (!observedAt || Number.isNaN(Date.parse(observedAt)) || latitude === null || longitude === null || strengthNt === null) continue;
    if (latitude < -90 || latitude > 90 || strengthNt < 1_000 || strengthNt > 100_000) continue;
    points.push({
      id: `swarm:${satellite}:${observedAt}`,
      source: "Swarm",
      satellite,
      latitude,
      longitude: normalizeLongitude(longitude),
      strengthNt,
      observedAt,
    });
  }
  return points;
}

export async function fetchRecentSwarmMagnetics(hours = 3, signal?: AbortSignal) {
  const settled = await Promise.allSettled(DATASETS.map((dataset) => fetchDataset(dataset, hours, signal)));
  const points: SwarmMagneticPoint[] = [];
  const warnings: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") points.push(...result.value);
    else warnings.push(`${DATASETS[index]}: ${result.reason instanceof Error ? result.reason.message : "sin datos"}`);
  });
  return { points, warnings, datasets: [...DATASETS], hours };
}
