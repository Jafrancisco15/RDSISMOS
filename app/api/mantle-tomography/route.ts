import { NextRequest, NextResponse } from "next/server";
import {
  MANTLE_TOMOGRAPHY_DEPTHS,
  aggregateMantleCells,
  chooseTomographyGridStep,
  summarizeMantleCells,
  type MantleTomographyCell,
  type MantleTomographyResponse,
} from "@/lib/mantleTomography";
import {
  decodeNetcdfNumericSlice,
  netcdfTypeSize,
  parseNetcdfClassicHeader,
  type NetcdfClassicHeader,
  type NetcdfVariable,
} from "@/lib/netcdfClassic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "SEISGLOB2" as const;
const MODEL_FILE_URL = "https://ds.iris.edu/files/products/emc/emc-files/SEISGLOB2_percent.nc";
const HEADER_RANGE_END = 131_071;
const MODEL_MIN_DEPTH_KM = 50;
const MODEL_DEPTH_STEP_KM = 50;

type Bounds = { west: number; south: number; east: number; north: number };
type HeaderCache = { header: NetcdfClassicHeader; initialBuffer: ArrayBuffer; fullFile: boolean };

let headerPromise: Promise<HeaderCache> | null = null;

function normalizeLongitude(value: number) {
  let longitude = value;
  while (longitude > 180) longitude -= 360;
  while (longitude < -180) longitude += 360;
  return longitude;
}

function parseBounds(value: string | null): Bounds {
  if (!value) return { west: -180, south: -89, east: 180, north: 89 };
  const values = value.split(",").map(Number);
  if (values.length !== 4 || !values.every(Number.isFinite)) return { west: -180, south: -89, east: 180, north: 89 };
  const [westRaw, southRaw, eastRaw, northRaw] = values;
  const south = Math.max(-89, Math.min(89, southRaw));
  const north = Math.max(-89, Math.min(89, northRaw));
  if (south >= north) return { west: -180, south: -89, east: 180, north: 89 };
  return {
    west: normalizeLongitude(westRaw),
    south,
    east: normalizeLongitude(eastRaw),
    north,
  };
}

function nearestDepth(value: string | null) {
  const requested = Number(value);
  if (!Number.isFinite(requested)) return 650;
  return MANTLE_TOMOGRAPHY_DEPTHS.reduce((best, candidate) =>
    Math.abs(candidate - requested) < Math.abs(best - requested) ? candidate : best,
  );
}

function longitudeSpan(bounds: Bounds) {
  if (bounds.west <= bounds.east) return bounds.east - bounds.west;
  return 360 - bounds.west + bounds.east;
}

function longitudeInside(longitude: number, bounds: Bounds) {
  const value = normalizeLongitude(longitude);
  if (bounds.west <= bounds.east) return value >= bounds.west && value <= bounds.east;
  return value >= bounds.west || value <= bounds.east;
}

async function fetchModelRange(start: number, end: number, signal: AbortSignal) {
  const response = await fetch(MODEL_FILE_URL, {
    headers: {
      Accept: "application/x-netcdf,application/octet-stream,*/*",
      Range: `bytes=${start}-${end}`,
      "User-Agent": "RDSISMOS/1.0",
    },
    signal,
    next: { revalidate: 604_800 },
  });
  if (!response.ok) throw new Error(`EarthScope EMC NetCDF respondió HTTP ${response.status}.`);
  const buffer = await response.arrayBuffer();
  return { buffer, partial: response.status === 206 };
}

async function loadHeader(signal: AbortSignal) {
  if (!headerPromise) {
    headerPromise = (async () => {
      const first = await fetchModelRange(0, HEADER_RANGE_END, signal);
      const header = parseNetcdfClassicHeader(first.buffer);
      return { header, initialBuffer: first.buffer, fullFile: !first.partial };
    })().catch((error) => {
      headerPromise = null;
      throw error;
    });
  }
  return headerPromise;
}

function dimensionSize(header: NetcdfClassicHeader, variable: NetcdfVariable, name: string) {
  const position = variable.dimensionIds.findIndex((id) => header.dimensions[id]?.name.toLowerCase() === name);
  if (position < 0) throw new Error(`SEISGLOB2 no expone la dimensión ${name} en dvs.`);
  const dimensionId = variable.dimensionIds[position];
  const size = header.dimensions[dimensionId]?.size;
  if (!size) throw new Error(`Dimensión ${name} inválida en SEISGLOB2.`);
  return { position, size };
}

function assertExpectedLayout(header: NetcdfClassicHeader, variable: NetcdfVariable) {
  const names = variable.dimensionIds.map((id) => header.dimensions[id]?.name.toLowerCase());
  if (names.join(",") !== "depth,latitude,longitude") {
    throw new Error(`Orden de dimensiones inesperado para SEISGLOB2 dvs: ${names.join(",")}.`);
  }
  const depth = dimensionSize(header, variable, "depth");
  const latitude = dimensionSize(header, variable, "latitude");
  const longitude = dimensionSize(header, variable, "longitude");
  if (latitude.size !== 179 || longitude.size !== 360) {
    throw new Error(`Malla SEISGLOB2 inesperada: ${latitude.size}×${longitude.size}.`);
  }
  return { depthCount: depth.size, latitudeCount: latitude.size, longitudeCount: longitude.size };
}

async function loadDepthSlice(depthKm: number, signal: AbortSignal) {
  const { header, initialBuffer, fullFile } = await loadHeader(signal);
  const variable = header.variables.find((item) => item.name.toLowerCase() === "dvs");
  if (!variable) throw new Error("El archivo oficial SEISGLOB2 no contiene la variable dvs.");
  const { depthCount, latitudeCount, longitudeCount } = assertExpectedLayout(header, variable);
  const depthIndex = Math.round((depthKm - MODEL_MIN_DEPTH_KM) / MODEL_DEPTH_STEP_KM);
  if (depthIndex < 0 || depthIndex >= depthCount) throw new Error(`Profundidad ${depthKm} km fuera de SEISGLOB2.`);

  const valuesPerSlice = latitudeCount * longitudeCount;
  const bytesPerValue = netcdfTypeSize(variable.type);
  const bytesPerSlice = valuesPerSlice * bytesPerValue;
  const start = variable.begin + depthIndex * bytesPerSlice;
  const end = start + bytesPerSlice - 1;

  let sliceBuffer: ArrayBuffer;
  if (fullFile && initialBuffer.byteLength > end) {
    sliceBuffer = initialBuffer.slice(start, end + 1);
  } else {
    const range = await fetchModelRange(start, end, signal);
    sliceBuffer = range.partial ? range.buffer : range.buffer.slice(start, end + 1);
  }
  const values = decodeNetcdfNumericSlice(sliceBuffer, variable.type, valuesPerSlice);
  return { values, latitudeCount, longitudeCount };
}

async function cellsForBounds(depthKm: number, bounds: Bounds, signal: AbortSignal) {
  const { values, latitudeCount, longitudeCount } = await loadDepthSlice(depthKm, signal);
  const cells: MantleTomographyCell[] = [];
  for (let latIndex = 0; latIndex < latitudeCount; latIndex += 1) {
    const latitude = -89 + latIndex;
    if (latitude < bounds.south || latitude > bounds.north) continue;
    for (let lonIndex = 0; lonIndex < longitudeCount; lonIndex += 1) {
      const longitude = normalizeLongitude(lonIndex);
      if (!longitudeInside(longitude, bounds)) continue;
      const dvsPct = values[latIndex * longitudeCount + lonIndex];
      if (!Number.isFinite(dvsPct) || Math.abs(dvsPct) > 100) continue;
      cells.push({ latitude, longitude, dvsPct });
    }
  }
  return cells;
}

export async function GET(request: NextRequest) {
  try {
    const depthKm = nearestDepth(request.nextUrl.searchParams.get("depth"));
    const bounds = parseBounds(request.nextUrl.searchParams.get("bbox"));
    const rawCells = await cellsForBounds(depthKm, bounds, request.signal);

    const spanLon = longitudeSpan(bounds);
    const spanLat = bounds.north - bounds.south;
    const gridStepDeg = chooseTomographyGridStep(spanLat, spanLon);
    const cells = aggregateMantleCells(rawCells, gridStepDeg);
    const summary = summarizeMantleCells(cells);
    const warnings: string[] = [];
    if (cells.length < 50) warnings.push("La ventana contiene pocas celdas del modelo; interpreta el patrón con cautela.");
    if (depthKm >= 2800) warnings.push("Esta sección está muy próxima a la frontera núcleo–manto; la resolución lateral del modelo es limitada y no representa flujo térmico directo.");

    const payload: MantleTomographyResponse = {
      generatedAt: new Date().toISOString(),
      source: "EarthScope EMC",
      model: MODEL,
      referenceModel: "PREM",
      depthKm,
      gridStepDeg,
      cells,
      ...summary,
      warnings,
    };

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible cargar la tomografía del manto." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
