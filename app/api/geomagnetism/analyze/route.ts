import { NextRequest, NextResponse } from "next/server";
import { analyzeMagneticLocality, type KpSample, type MagneticSample, type MagneticStationSeries } from "@/lib/geomagnetism";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HAPI_BASE = "https://imag-data.bgs.ac.uk/GIN_V1/hapi";
const MAX_DAYS = 31;
const DAY_MS = 86_400_000;

type HapiInfo = { parameters?: Array<{ name?: string }> };
type HapiData = { data?: unknown[][] };

type KpPayload = {
  datetime?: unknown[];
  Kp?: unknown[];
  kp?: unknown[];
  time?: unknown[];
  values?: unknown[];
};

function parseDate(value: string | null, fallback: Date, end = false) {
  if (!value) return fallback;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}${end ? "T23:59:59.999Z" : "T00:00:00.000Z"}`)
    : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Fecha inválida: ${value}`);
  return parsed;
}

function stationCode(value: string | null, label: string) {
  const code = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{3}$/.test(code)) throw new Error(`${label} debe ser un código IAGA de 3 caracteres.`);
  return code;
}

function numeric(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function usableField(value: number | null) {
  return value !== null && Math.abs(value) < 90_000;
}

async function fetchHapiSeries(code: string, start: Date, end: Date, signal: AbortSignal): Promise<MagneticStationSeries> {
  const lower = code.toLowerCase();
  const candidates = [
    `${lower}/best-avail/PT1M/xyzf`,
    `${lower}/definitive/PT1M/xyzf`,
    `${lower}/quasi-def/PT1M/xyzf`,
    `${lower}/adjusted/PT1M/xyzf`,
  ];
  const errors: string[] = [];

  for (const datasetId of candidates) {
    try {
      const infoUrl = `${HAPI_BASE}/info?id=${encodeURIComponent(datasetId)}`;
      const infoResponse = await fetch(infoUrl, { signal, cache: "no-store", headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" } });
      if (!infoResponse.ok) { errors.push(`${datasetId}: info ${infoResponse.status}`); continue; }
      const info = await infoResponse.json() as HapiInfo;
      const names = (info.parameters ?? []).map((parameter) => String(parameter.name ?? "").toUpperCase());
      const timeIndex = Math.max(0, names.findIndex((name) => name === "TIME"));
      const xIndex = names.findIndex((name) => name === "X");
      const yIndex = names.findIndex((name) => name === "Y");
      const zIndex = names.findIndex((name) => name === "Z");
      const fIndex = names.findIndex((name) => name === "F" || name === "S");
      if (xIndex < 0 || yIndex < 0 || zIndex < 0) { errors.push(`${datasetId}: no XYZ`); continue; }

      const params = new URLSearchParams({
        id: datasetId,
        "time.min": start.toISOString(),
        "time.max": end.toISOString(),
        format: "json",
      });
      const response = await fetch(`${HAPI_BASE}/data?${params}`, { signal, cache: "no-store", headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" } });
      if (!response.ok) { errors.push(`${datasetId}: data ${response.status}`); continue; }
      const payload = await response.json() as HapiData;
      const samples: MagneticSample[] = [];
      for (const row of payload.data ?? []) {
        if (!Array.isArray(row)) continue;
        const timeUtc = String(row[timeIndex] ?? "");
        if (!timeUtc || Number.isNaN(Date.parse(timeUtc))) continue;
        const x = numeric(row[xIndex]); const y = numeric(row[yIndex]); const z = numeric(row[zIndex]);
        const f = fIndex >= 0 ? numeric(row[fIndex]) : null;
        if (!usableField(x) || !usableField(y) || !usableField(z)) continue;
        samples.push({ timeUtc, x: x!, y: y!, z: z!, f: usableField(f) ? f : null });
      }
      if (samples.length >= 30) return { code, datasetId, samples };
      errors.push(`${datasetId}: ${samples.length} muestras válidas`);
    } catch (error) {
      errors.push(`${datasetId}: ${error instanceof Error ? error.message : "error"}`);
    }
  }
  throw new Error(`${code}: no fue posible obtener una serie XYZF de 1 minuto. ${errors.slice(0, 3).join("; ")}`);
}

async function fetchKp(start: Date, end: Date, signal: AbortSignal): Promise<KpSample[]> {
  try {
    const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString(), index: "Kp" });
    const response = await fetch(`https://kp.gfz.de/app/json/?${params}`, { signal, cache: "no-store", headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" } });
    if (!response.ok) return [];
    const payload = await response.json() as KpPayload;
    const times = Array.isArray(payload.datetime) ? payload.datetime : Array.isArray(payload.time) ? payload.time : [];
    const values = Array.isArray(payload.Kp) ? payload.Kp : Array.isArray(payload.kp) ? payload.kp : Array.isArray(payload.values) ? payload.values : [];
    const out: KpSample[] = [];
    for (let i = 0; i < Math.min(times.length, values.length); i += 1) {
      const value = numeric(values[i]);
      const timeUtc = String(times[i] ?? "");
      if (value === null || !timeUtc) continue;
      out.push({ timeUtc, value });
    }
    return out;
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  try {
    const now = new Date();
    const start = parseDate(request.nextUrl.searchParams.get("start"), new Date(now.getTime() - 3 * DAY_MS));
    const end = parseDate(request.nextUrl.searchParams.get("end"), now, true);
    if (start >= end) throw new Error("La fecha inicial debe ser anterior a la final.");
    const days = (end.getTime() - start.getTime()) / DAY_MS;
    if (days > MAX_DAYS) throw new Error(`El análisis INTERMAGNET admite hasta ${MAX_DAYS} días por consulta.`);

    const targetCode = stationCode(request.nextUrl.searchParams.get("target"), "La estación objetivo");
    const references = String(request.nextUrl.searchParams.get("references") ?? "")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);
    if (!references.length) throw new Error("Selecciona al menos una estación de referencia.");
    if (references.length > 4) throw new Error("Usa un máximo de 4 estaciones de referencia por análisis.");
    for (const code of references) stationCode(code, "Cada referencia");
    if (references.includes(targetCode)) throw new Error("La estación objetivo no puede usarse también como referencia.");

    const settled = await Promise.allSettled([
      fetchHapiSeries(targetCode, start, end, request.signal),
      ...references.map((code) => fetchHapiSeries(code, start, end, request.signal)),
      fetchKp(start, end, request.signal),
    ]);
    const targetResult = settled[0];
    if (targetResult.status !== "fulfilled") throw targetResult.reason;
    const referenceSeries: MagneticStationSeries[] = [];
    const warnings: string[] = [];
    for (let i = 0; i < references.length; i += 1) {
      const result = settled[i + 1];
      if (result.status === "fulfilled") referenceSeries.push(result.value as MagneticStationSeries);
      else warnings.push(`${references[i]}: ${result.reason instanceof Error ? result.reason.message : "sin datos"}`);
    }
    if (!referenceSeries.length) throw new Error("Ninguna estación de referencia tuvo datos coincidentes.");
    const kpResult = settled[settled.length - 1];
    const kp = kpResult.status === "fulfilled" ? kpResult.value as KpSample[] : [];
    if (!kp.length) warnings.push("Kp de GFZ no estuvo disponible; el score aplica una penalización por incertidumbre de actividad geomagnética global.");

    const metrics = analyzeMagneticLocality(targetResult.value as MagneticStationSeries, referenceSeries, kp);
    return NextResponse.json({
      target: { code: targetCode, datasetId: (targetResult.value as MagneticStationSeries).datasetId, samples: (targetResult.value as MagneticStationSeries).samples.length },
      references: referenceSeries.map((series) => ({ code: series.code, datasetId: series.datasetId, samples: series.samples.length })),
      start: start.toISOString(),
      end: end.toISOString(),
      metrics,
      warnings,
      methodology: {
        cadence: "PT1M",
        orientation: "XYZF",
        commonMode: "mediana por componente de las estaciones de referencia, tras centrar cada serie por su mediana",
        residual: "vector objetivo centrado menos señal común de referencias",
        robustZ: "desviación del módulo residual usando MAD × 1.4826",
        zhProxy: "|Z residual| / H residual; proxy temporal, no análisis espectral ULF Z/H",
        kp: "GFZ Kp se usa solo como penalización por actividad geomagnética planetaria",
      },
      sources: ["INTERMAGNET HAPI / Edinburgh GIN", "GFZ Potsdam Kp index"],
      licenseNote: "INTERMAGNET data are generally CC BY-NC 4.0 unless an institute specifies different terms; GFZ Kp is CC BY 4.0.",
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible ejecutar el análisis geomagnético." }, { status: 400 });
  }
}
