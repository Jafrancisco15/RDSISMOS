import { NextRequest, NextResponse } from "next/server";
import { analyzeMagneticLocality, type KpSample, type MagneticStationSeries } from "@/lib/geomagnetism";
import { fetchUsgsGeomagSeries, USGS_GEOMAG_CODES } from "@/lib/usgsGeomag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_DAYS = 31;
const DAY_MS = 86_400_000;

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
    ? new Date(`${value}${end ? "T23:59:00.000Z" : "T00:00:00.000Z"}`)
    : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Fecha inválida: ${value}`);
  return parsed;
}

function stationCode(value: string | null, label: string) {
  const code = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{3}$/.test(code)) throw new Error(`${label} debe ser un código de observatorio de 3 caracteres.`);
  if (!USGS_GEOMAG_CODES.has(code)) throw new Error(`${code} no está disponible en la red geomagnética USGS configurada.`);
  return code;
}

function numeric(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function responseJson<T>(response: Response, label: string): Promise<T> {
  const text = await response.text();
  if (!text.trim()) throw new Error(`${label}: respuesta vacía.`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label}: respuesta no JSON: ${text.replace(/\s+/g, " ").trim().slice(0, 180)}`);
  }
}

async function fetchKp(start: Date, end: Date, signal: AbortSignal): Promise<KpSample[]> {
  try {
    const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString(), index: "Kp" });
    const response = await fetch(`https://kp.gfz.de/app/json/?${params}`, {
      signal,
      cache: "no-store",
      headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" },
    });
    if (!response.ok) return [];
    const payload = await responseJson<KpPayload>(response, "GFZ Kp");
    const times = Array.isArray(payload.datetime) ? payload.datetime : Array.isArray(payload.time) ? payload.time : [];
    const values = Array.isArray(payload.Kp) ? payload.Kp : Array.isArray(payload.kp) ? payload.kp : Array.isArray(payload.values) ? payload.values : [];
    const out: KpSample[] = [];
    for (let i = 0; i < Math.min(times.length, values.length); i += 1) {
      const value = numeric(values[i]);
      const timeUtc = String(times[i] ?? "");
      if (value === null || !timeUtc || Number.isNaN(Date.parse(timeUtc))) continue;
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
    if (days > MAX_DAYS) throw new Error(`El análisis geomagnético admite hasta ${MAX_DAYS} días por consulta.`);

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
      fetchUsgsGeomagSeries(targetCode, start, end, request.signal),
      ...references.map((code) => fetchUsgsGeomagSeries(code, start, end, request.signal)),
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
    if (!referenceSeries.length) throw new Error("Ninguna estación de referencia USGS tuvo datos coincidentes.");

    const kpResult = settled[settled.length - 1];
    const kp = kpResult.status === "fulfilled" ? kpResult.value as KpSample[] : [];
    if (!kp.length) warnings.push("Kp de GFZ no estuvo disponible; el score aplica una penalización por incertidumbre geomagnética global.");

    const targetSeries = targetResult.value as MagneticStationSeries;
    const metrics = analyzeMagneticLocality(targetSeries, referenceSeries, kp);
    const actualStart = targetSeries.samples[0]?.timeUtc ?? start.toISOString();
    const actualEnd = targetSeries.samples.at(-1)?.timeUtc ?? end.toISOString();

    return NextResponse.json({
      target: { code: targetCode, datasetId: targetSeries.datasetId, samples: targetSeries.samples.length },
      references: referenceSeries.map((series) => ({ code: series.code, datasetId: series.datasetId, samples: series.samples.length })),
      requestedStart: start.toISOString(),
      requestedEnd: end.toISOString(),
      start: actualStart,
      end: actualEnd,
      metrics,
      warnings,
      methodology: {
        cadence: "60 s",
        source: "USGS Geomagnetism Data Web Service",
        orientation: "XYZF adjusted when available; HDZF variation is converted to XYZF as fallback",
        commonMode: "mediana por componente de las estaciones de referencia, tras centrar cada serie por su mediana",
        residual: "vector objetivo centrado menos señal común de referencias",
        robustZ: "desviación del módulo residual usando MAD × 1.4826",
        zhProxy: "|Z residual| / H residual; proxy temporal, no análisis espectral ULF Z/H",
        kp: "GFZ Kp se usa solo como penalización por actividad geomagnética planetaria",
      },
      sources: ["USGS Geomagnetism Data Web Service", "GFZ Potsdam Kp index"],
      licenseNote: "USGS Geomagnetism Program data are U.S. government data; verify source-specific usage notes when redistributing derived products. GFZ Kp is CC BY 4.0.",
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible ejecutar el análisis geomagnético." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
