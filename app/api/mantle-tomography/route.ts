import { NextRequest, NextResponse } from "next/server";
import {
  MANTLE_TOMOGRAPHY_DEPTHS,
  aggregateMantleCells,
  chooseTomographyGridStep,
  parseEarthModelGeoCsv,
  summarizeMantleCells,
  type MantleTomographyCell,
  type MantleTomographyResponse,
} from "@/lib/mantleTomography";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "SEISGLOB2" as const;
const MODEL_CANDIDATES = ["SEISGLOB2", "SEISGLOB2_percent"];
const SERVICE_BASES = [
  "https://service.iris.edu/irisws/earth-model/1/plane",
  "https://service.earthscope.org/irisws/earth-model/1/plane",
];

type Bounds = { west: number; south: number; east: number; north: number };

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

function serviceSegments(bounds: Bounds) {
  if (longitudeSpan(bounds) >= 350) return [{ west: -180, east: 180 }];
  if (bounds.west <= bounds.east) return [{ west: bounds.west, east: bounds.east }];
  return [{ west: bounds.west, east: 180 }, { west: -180, east: bounds.east }];
}

async function fetchGeoCsv(segment: { west: number; east: number }, bounds: Bounds, depthKm: number, signal: AbortSignal) {
  const errors: string[] = [];
  for (const base of SERVICE_BASES) {
    for (const model of MODEL_CANDIDATES) {
      const params = new URLSearchParams({
        model,
        depth: String(depthKm),
        minlat: bounds.south.toFixed(3),
        maxlat: bounds.north.toFixed(3),
        minlon: segment.west.toFixed(3),
        maxlon: segment.east.toFixed(3),
        format: "geocsv",
        nodata: "404",
      });
      try {
        const response = await fetch(`${base}?${params}`, {
          headers: { Accept: "text/plain,text/csv", "User-Agent": "RDSISMOS/1.0" },
          signal,
          next: { revalidate: 604_800 },
        });
        if (!response.ok) {
          errors.push(`${new URL(base).host}/${model}: HTTP ${response.status}`);
          continue;
        }
        const text = await response.text();
        const cells = parseEarthModelGeoCsv(text);
        if (cells.length) return cells;
        errors.push(`${new URL(base).host}/${model}: respuesta sin celdas interpretables`);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        errors.push(`${new URL(base).host}/${model}: ${error instanceof Error ? error.message : "error de consulta"}`);
      }
    }
  }
  throw new Error(`EarthScope EMC no devolvió una sección utilizable. ${errors.slice(0, 4).join(" · ")}`);
}

export async function GET(request: NextRequest) {
  try {
    const depthKm = nearestDepth(request.nextUrl.searchParams.get("depth"));
    const bounds = parseBounds(request.nextUrl.searchParams.get("bbox"));
    const segments = serviceSegments(bounds);
    const rawCells: MantleTomographyCell[] = [];

    for (const segment of segments) {
      const cells = await fetchGeoCsv(segment, bounds, depthKm, request.signal);
      rawCells.push(...cells);
    }

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
