import { NextRequest, NextResponse } from "next/server";
import { analyzeMagneticLocality, type KpSample, type MagneticStationSeries } from "@/lib/geomagnetism";
import { coverageForReferences, selectAutomaticReferences, type GeomagneticStation } from "@/lib/geomagNetwork";
import { fetchFederatedGeomagneticSeries, fetchFederatedGeomagneticStations } from "@/lib/geomagneticProviders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_DAYS = 31;
const DAY_MS = 86_400_000;

type KpPayload = { datetime?: unknown[]; Kp?: unknown[]; kp?: unknown[]; time?: unknown[]; values?: unknown[] };

function parseDate(value: string | null, fallback: Date, end = false) {
  if (!value) return fallback;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}${end ? "T23:59:00.000Z" : "T00:00:00.000Z"}`) : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Fecha inválida: ${value}`);
  return parsed;
}
function normalizedCode(value: string | null, label: string) {
  const code = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{3}$/.test(code)) throw new Error(`${label} debe ser un código IAGA de 3 caracteres.`);
  return code;
}
function numeric(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
async function responseJson<T>(response: Response, label: string): Promise<T> {
  const text = await response.text();
  if (!text.trim()) throw new Error(`${label}: respuesta vacía.`);
  try { return JSON.parse(text) as T; }
  catch { throw new Error(`${label}: respuesta no JSON: ${text.replace(/\s+/g, " ").trim().slice(0, 180)}`); }
}

async function fetchKp(start: Date, end: Date, signal: AbortSignal): Promise<KpSample[]> {
  try {
    const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString(), index: "Kp" });
    const response = await fetch(`https://kp.gfz.de/app/json/?${params}`, { signal, cache: "no-store", headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" } });
    if (!response.ok) return [];
    const payload = await responseJson<KpPayload>(response, "GFZ Kp");
    const times = Array.isArray(payload.datetime) ? payload.datetime : Array.isArray(payload.time) ? payload.time : [];
    const values = Array.isArray(payload.Kp) ? payload.Kp : Array.isArray(payload.kp) ? payload.kp : Array.isArray(payload.values) ? payload.values : [];
    const out: KpSample[] = [];
    for (let i = 0; i < Math.min(times.length, values.length); i += 1) {
      const value = numeric(values[i]); const timeUtc = String(times[i] ?? "");
      if (value === null || !timeUtc || Number.isNaN(Date.parse(timeUtc))) continue;
      out.push({ timeUtc, value });
    }
    return out;
  } catch { return []; }
}

function stationByCode(stations: GeomagneticStation[], code: string) {
  const station = stations.find((item) => item.code === code);
  if (!station) throw new Error(`${code} no aparece en la red federada USGS + INTERMAGNET.`);
  return station;
}

function compactWarnings(items: string[]) {
  if (!items.length) return [];
  const temporal: string[] = [];
  const kp: string[] = [];
  const coverage: string[] = [];
  const network: string[] = [];
  const other: string[] = [];
  for (const warning of items) {
    if (/sin datos en la ventana|disponibilidad|solo \d+ minutos válidos|sin datos recientes|time outside valid range/i.test(warning)) temporal.push(warning);
    else if (/\bKp\b|GFZ/i.test(warning)) kp.push(warning);
    else if (/cobertura insuficiente|solo una referencia/i.test(warning)) coverage.push(warning);
    else if (/INTERMAGNET no disponible|fallback/i.test(warning)) network.push(warning);
    else other.push(warning);
  }
  const output: string[] = [];
  if (temporal.length) output.push(`${temporal.length} observatorio${temporal.length === 1 ? "" : "s"} de control no cubrían suficientemente esta ventana y fueron descartados automáticamente.`);
  if (coverage.length) output.push(coverage[0]);
  if (kp.length) output.push("Kp de GFZ no estuvo disponible para toda la ventana; el score conserva la penalización por incertidumbre geomagnética global.");
  if (network.length) output.push(network[0]);
  output.push(...other.slice(0, 2));
  return [...new Set(output)];
}

export async function GET(request: NextRequest) {
  try {
    const now = new Date();
    const start = parseDate(request.nextUrl.searchParams.get("start"), new Date(now.getTime() - 3 * DAY_MS));
    const requestedEnd = parseDate(request.nextUrl.searchParams.get("end"), now, true);
    const end = new Date(Math.min(now.getTime(), requestedEnd.getTime()));
    if (start >= end) throw new Error("La fecha inicial debe ser anterior a la final y no puede comenzar en el futuro.");
    const days = (end.getTime() - start.getTime()) / DAY_MS;
    if (days > MAX_DAYS) throw new Error(`El análisis geomagnético admite hasta ${MAX_DAYS} días por consulta.`);

    const { stations, warnings: networkWarnings } = await fetchFederatedGeomagneticStations(request.signal);
    const targetCode = normalizedCode(request.nextUrl.searchParams.get("target"), "La estación objetivo");
    const targetStation = stationByCode(stations, targetCode);
    const requestedReferences = String(request.nextUrl.searchParams.get("references") ?? "").split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
    const manual = request.nextUrl.searchParams.get("auto") === "0" && requestedReferences.length > 0;

    let candidates: GeomagneticStation[];
    if (manual) {
      const unique = [...new Set(requestedReferences)].filter((code) => code !== targetCode).slice(0, 6);
      candidates = unique.map((code) => stationByCode(stations, normalizedCode(code, "Cada referencia")));
    } else {
      candidates = selectAutomaticReferences(targetStation, stations, 7);
    }
    if (!candidates.length) throw new Error("No hay observatorios de referencia disponibles alrededor de la estación objetivo.");

    const [targetResult, candidateResults, kp] = await Promise.all([
      fetchFederatedGeomagneticSeries(targetStation, start, end, request.signal),
      Promise.allSettled(candidates.map((station) => fetchFederatedGeomagneticSeries(station, start, end, request.signal))),
      fetchKp(start, end, request.signal),
    ]);

    const referenceSeries: MagneticStationSeries[] = [];
    const referenceStations: GeomagneticStation[] = [];
    const warningDetails = [...networkWarnings];
    for (let index = 0; index < candidateResults.length; index += 1) {
      const result = candidateResults[index];
      if (result.status === "fulfilled" && referenceSeries.length < 4) {
        referenceSeries.push(result.value);
        referenceStations.push(candidates[index]);
      } else if (result.status === "rejected") {
        warningDetails.push(`${candidates[index].code}: ${result.reason instanceof Error ? result.reason.message : "sin datos"}`);
      }
    }
    if (!referenceSeries.length) throw new Error("Ninguna estación de referencia federada tuvo datos coincidentes en la ventana solicitada.");
    if (referenceSeries.length < 2) warningDetails.push("Solo una referencia tuvo datos válidos; la clasificación de localidad tiene cobertura insuficiente.");
    if (!kp.length) warningDetails.push("Kp de GFZ no estuvo disponible; el score aplica una penalización por incertidumbre geomagnética global.");

    const metrics = analyzeMagneticLocality(targetResult, referenceSeries, kp);
    const coverage = coverageForReferences(targetStation, referenceStations);
    const actualStart = targetResult.samples[0]?.timeUtc ?? start.toISOString();
    const actualEnd = targetResult.samples.at(-1)?.timeUtc ?? end.toISOString();

    return NextResponse.json({
      target: { code: targetCode, datasetId: targetResult.datasetId, samples: targetResult.samples.length, source: targetStation.dataSource },
      references: referenceSeries.map((series, index) => ({ code: series.code, datasetId: series.datasetId, samples: series.samples.length, source: referenceStations[index]?.dataSource ?? "federada" })),
      referenceMode: manual ? "manual" : "automatic",
      coverage,
      requestedStart: start.toISOString(), requestedEnd: requestedEnd.toISOString(), effectiveEnd: end.toISOString(), start: actualStart, end: actualEnd,
      metrics,
      warnings: compactWarnings(warningDetails),
      warningDetails,
      methodology: {
        cadence: "60 s",
        sources: "USGS Geomagnetism + INTERMAGNET HAPI, federados por código IAGA; USGS tiene prioridad cuando ambos sirven la misma estación",
        controls: manual ? "referencias elegidas por el usuario" : "selección automática por distancia útil + diversidad azimutal; se conservan hasta 4 referencias con datos válidos",
        commonMode: "mediana por componente de las referencias, tras centrar cada serie por su mediana",
        residual: "vector objetivo centrado menos señal común de referencias",
        robustZ: "desviación del módulo residual usando MAD × 1.4826",
        zhProxy: "|Z residual| / H residual; proxy temporal, no análisis espectral ULF Z/H",
        kp: "GFZ Kp se usa como penalización por actividad geomagnética planetaria",
      },
      sources: ["USGS Geomagnetism Data Web Service", "INTERMAGNET Edinburgh GIN / HAPI", "GFZ Potsdam Kp index"],
      licenseNote: "USGS data are U.S. government data. INTERMAGNET data are processed on demand and remain subject to INTERMAGNET/data-provider conditions and attribution. GFZ Kp is CC BY 4.0.",
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible ejecutar el análisis geomagnético." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
