export const MANTLE_TOMOGRAPHY_DEPTHS = [100, 400, 650, 1000, 1500, 2000, 2500, 2850] as const;

export interface MantleTomographyCell {
  latitude: number;
  longitude: number;
  dvsPct: number;
}

export interface MantleTomographyResponse {
  generatedAt: string;
  source: "EarthScope EMC";
  model: "SEISGLOB2";
  referenceModel: "PREM";
  depthKm: number;
  gridStepDeg: number;
  cells: MantleTomographyCell[];
  minDvsPct: number;
  maxDvsPct: number;
  meanDvsPct: number;
  scaleAbsPct: number;
  fastPct: number;
  slowPct: number;
  warnings: string[];
}

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeLongitude(value: number) {
  let longitude = value;
  while (longitude > 180) longitude -= 360;
  while (longitude < -180) longitude += 360;
  return longitude;
}

function splitRow(line: string, delimiter: string) {
  if (delimiter === " ") return line.trim().split(/\s+/);
  return line.split(delimiter).map((value) => value.trim().replace(/^"|"$/g, ""));
}

function fieldAliases(fields: string[]) {
  const keys = fields.map(normalizedKey);
  const find = (aliases: string[]) => keys.findIndex((key) => aliases.map(normalizedKey).includes(key));
  return {
    latitude: find(["latitude", "lat"]),
    longitude: find(["longitude", "lon", "long"]),
    depth: find(["depth", "depthkm", "z"]),
    dvs: find(["dvs", "dvsv", "vsanomaly", "velocityperturbation", "shearvelocityperturbation"]),
  };
}

function metadataValue(lines: string[], name: string) {
  const pattern = new RegExp(`^\\s*#\\s*${name}\\s*[:=]\\s*(.+)$`, "i");
  for (const line of lines) {
    const match = line.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

export function parseEarthModelGeoCsv(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const delimiterMeta = metadataValue(lines, "delimiter");
  const delimiter = delimiterMeta?.includes("|") ? "|" : delimiterMeta?.includes(";") ? ";" : delimiterMeta?.toLowerCase().includes("space") ? " " : ",";
  const fieldsMeta = metadataValue(lines, "fields") ?? metadataValue(lines, "field_names") ?? metadataValue(lines, "fieldnames");

  let fields = fieldsMeta ? splitRow(fieldsMeta, delimiter) : [];
  let dataStart = 0;

  if (!fields.length) {
    const headerIndex = lines.findIndex((line) => !line.startsWith("#") && /[a-zA-Z]/.test(line) && /(lat|lon|depth|dvs|velocity)/i.test(line));
    if (headerIndex >= 0) {
      fields = splitRow(lines[headerIndex], delimiter);
      dataStart = headerIndex + 1;
    }
  }

  if (!fields.length) return [] as MantleTomographyCell[];
  const indexes = fieldAliases(fields);
  if (indexes.latitude < 0 || indexes.longitude < 0 || indexes.dvs < 0) return [] as MantleTomographyCell[];

  const cells: MantleTomographyCell[] = [];
  for (let index = dataStart; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("#") || /[a-zA-Z]/.test(line)) continue;
    const values = splitRow(line, delimiter);
    const latitude = Number(values[indexes.latitude]);
    const longitude = Number(values[indexes.longitude]);
    const dvsPct = Number(values[indexes.dvs]);
    if (![latitude, longitude, dvsPct].every(Number.isFinite)) continue;
    if (latitude < -90 || latitude > 90 || Math.abs(dvsPct) > 100) continue;
    cells.push({ latitude, longitude: normalizeLongitude(longitude), dvsPct });
  }
  return cells;
}

export function chooseTomographyGridStep(spanLatitudeDeg: number, spanLongitudeDeg: number, targetCells = 3200) {
  const area = Math.max(1, Math.abs(spanLatitudeDeg) * Math.abs(spanLongitudeDeg));
  const raw = Math.sqrt(area / Math.max(250, targetCells));
  return Math.max(1, Math.min(8, Math.ceil(raw)));
}

export function aggregateMantleCells(cells: MantleTomographyCell[], stepDeg: number) {
  const buckets = new Map<string, { lat: number; lon: number; dvs: number; count: number }>();
  for (const cell of cells) {
    const latIndex = Math.floor((cell.latitude + 90) / stepDeg);
    const lonIndex = Math.floor((normalizeLongitude(cell.longitude) + 180) / stepDeg);
    const key = `${latIndex}:${lonIndex}`;
    const current = buckets.get(key) ?? { lat: 0, lon: 0, dvs: 0, count: 0 };
    current.lat += cell.latitude;
    current.lon += normalizeLongitude(cell.longitude);
    current.dvs += cell.dvsPct;
    current.count += 1;
    buckets.set(key, current);
  }
  return [...buckets.values()].map((bucket) => ({
    latitude: bucket.lat / bucket.count,
    longitude: normalizeLongitude(bucket.lon / bucket.count),
    dvsPct: bucket.dvs / bucket.count,
  }));
}

function percentile(values: number[], fraction: number) {
  if (!values.length) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * fraction)));
  return sorted[index];
}

export function summarizeMantleCells(cells: MantleTomographyCell[]) {
  if (!cells.length) {
    return { minDvsPct: 0, maxDvsPct: 0, meanDvsPct: 0, scaleAbsPct: 1, fastPct: 0, slowPct: 0 };
  }
  const values = cells.map((cell) => cell.dvsPct);
  const meanDvsPct = values.reduce((sum, value) => sum + value, 0) / values.length;
  const scaleAbsPct = Math.max(0.8, Math.min(5, percentile(values.map(Math.abs), 0.9)));
  return {
    minDvsPct: Math.min(...values),
    maxDvsPct: Math.max(...values),
    meanDvsPct,
    scaleAbsPct,
    fastPct: 100 * values.filter((value) => value >= 0.5).length / values.length,
    slowPct: 100 * values.filter((value) => value <= -0.5).length / values.length,
  };
}

export function tomographyColor(value: number, scaleAbsPct: number) {
  const scale = Math.max(0.25, scaleAbsPct);
  const normalized = Math.max(-1, Math.min(1, value / scale));
  if (normalized <= -0.75) return "#991b1b";
  if (normalized <= -0.4) return "#ef4444";
  if (normalized <= -0.12) return "#fb923c";
  if (normalized < 0.12) return "#cbd5e1";
  if (normalized < 0.4) return "#60a5fa";
  if (normalized < 0.75) return "#2563eb";
  return "#1e3a8a";
}
