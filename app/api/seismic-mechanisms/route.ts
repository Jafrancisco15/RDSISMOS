import { NextRequest, NextResponse } from "next/server";
import {
  numericProperty,
  parsePrincipalAxes,
  type SeismicMechanism,
  type SeismicMechanismResponse,
} from "@/lib/seismicMechanisms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const USGS_QUERY = "https://earthquake.usgs.gov/fdsnws/event/1/query";
const DAY_MS = 86_400_000;

type Product = {
  source?: unknown;
  preferredWeight?: unknown;
  properties?: unknown;
};

type Feature = {
  id?: unknown;
  geometry?: { coordinates?: unknown };
  properties?: Record<string, unknown>;
};

type Bounds = { west: number; south: number; east: number; north: number };

function numberParam(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeLongitude(value: number) {
  let longitude = value;
  while (longitude > 180) longitude -= 360;
  while (longitude < -180) longitude += 360;
  return longitude;
}

function parseBounds(value: string | null): Bounds | null {
  if (!value) return null;
  const values = value.split(",").map(Number);
  if (values.length !== 4 || !values.every(Number.isFinite)) return null;
  const [westRaw, southRaw, eastRaw, northRaw] = values;
  const south = Math.max(-89.9, Math.min(89.9, southRaw));
  const north = Math.max(-89.9, Math.min(89.9, northRaw));
  if (south >= north) return null;
  return { west: normalizeLongitude(westRaw), south, east: normalizeLongitude(eastRaw), north };
}

function boundsSegments(bounds: Bounds | null) {
  if (!bounds) return [null] as Array<{ west: number; east: number } | null>;
  if (bounds.west <= bounds.east) return [{ west: bounds.west, east: bounds.east }];
  return [{ west: bounds.west, east: 180 }, { west: -180, east: bounds.east }];
}

function productList(detail: unknown, type: string) {
  if (!detail || typeof detail !== "object") return [] as Product[];
  const properties = (detail as Record<string, unknown>).properties;
  if (!properties || typeof properties !== "object") return [] as Product[];
  const products = (properties as Record<string, unknown>).products;
  if (!products || typeof products !== "object") return [] as Product[];
  const list = (products as Record<string, unknown>)[type];
  return Array.isArray(list) ? list.filter((item): item is Product => Boolean(item && typeof item === "object")) : [];
}

function preferredProducts(detail: unknown) {
  return [...productList(detail, "moment-tensor"), ...productList(detail, "focal-mechanism")]
    .sort((a, b) => Number(b.preferredWeight ?? 0) - Number(a.preferredWeight ?? 0));
}

function productProperties(product: Product) {
  return product.properties && typeof product.properties === "object"
    ? product.properties as Record<string, unknown>
    : {};
}

async function fetchJson(url: string, signal: AbortSignal) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" },
    signal,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`USGS respondió HTTP ${response.status}.`);
  return response.json() as Promise<unknown>;
}

async function mechanismFromFeature(feature: Feature, signal: AbortSignal): Promise<SeismicMechanism | null> {
  const id = text(feature.id);
  const properties = feature.properties ?? {};
  const detailUrl = text(properties.detail);
  const coordinates = feature.geometry?.coordinates;
  if (!id || !detailUrl || !Array.isArray(coordinates) || coordinates.length < 3) return null;

  const longitude = Number(coordinates[0]);
  const latitude = Number(coordinates[1]);
  const depthKm = Number(coordinates[2]);
  const magnitude = Number(properties.mag);
  const timeValue = Number(properties.time);
  if (![longitude, latitude, depthKm, magnitude, timeValue].every(Number.isFinite)) return null;

  const detail = await fetchJson(detailUrl, signal);
  for (const product of preferredProducts(detail)) {
    const productProps = productProperties(product);
    const axes = parsePrincipalAxes(productProps);
    if (!axes) continue;
    const source = text(product.source) ?? text(productProps.eventsource) ?? "USGS";
    return {
      id,
      timeUtc: new Date(timeValue).toISOString(),
      place: text(properties.place) ?? "Región no especificada",
      latitude,
      longitude,
      depthKm,
      magnitude,
      ...axes,
      strikeDeg: numericProperty(productProps, ["nodal-plane-1-strike", "nodalPlane1Strike", "np1-strike"]),
      dipDeg: numericProperty(productProps, ["nodal-plane-1-dip", "nodalPlane1Dip", "np1-dip"]),
      rakeDeg: numericProperty(productProps, ["nodal-plane-1-rake", "nodalPlane1Rake", "np1-rake"]),
      strike2Deg: numericProperty(productProps, ["nodal-plane-2-strike", "nodalPlane2Strike", "np2-strike"]),
      dip2Deg: numericProperty(productProps, ["nodal-plane-2-dip", "nodalPlane2Dip", "np2-dip"]),
      rake2Deg: numericProperty(productProps, ["nodal-plane-2-rake", "nodalPlane2Rake", "np2-rake"]),
      percentDoubleCouple: numericProperty(productProps, ["percent-double-couple", "percentDoubleCouple", "double-couple-percent"]),
      scalarMomentNm: numericProperty(productProps, ["scalar-moment", "scalarMoment", "seismic-moment", "seismicMoment", "moment"]),
      source,
      sourceUrl: text(properties.url),
    };
  }
  return null;
}

function featureSortValue(feature: Feature, orderBy: "time" | "magnitude") {
  const properties = feature.properties ?? {};
  return orderBy === "magnitude" ? Number(properties.mag ?? -Infinity) : Number(properties.time ?? -Infinity);
}

async function queryFeatures({
  startTime,
  endTime,
  minMagnitude,
  limit,
  orderBy,
  bounds,
  signal,
}: {
  startTime: Date;
  endTime: Date;
  minMagnitude: number;
  limit: number;
  orderBy: "time" | "magnitude";
  bounds: Bounds | null;
  signal: AbortSignal;
}) {
  const segments = boundsSegments(bounds);
  const results = await Promise.all(segments.map(async (segment) => {
    const params = new URLSearchParams({
      format: "geojson",
      starttime: startTime.toISOString(),
      endtime: endTime.toISOString(),
      minmagnitude: String(minMagnitude),
      producttype: "moment-tensor",
      eventtype: "earthquake",
      orderby: orderBy,
      limit: String(limit),
    });
    if (bounds && segment) {
      params.set("minlatitude", bounds.south.toFixed(4));
      params.set("maxlatitude", bounds.north.toFixed(4));
      params.set("minlongitude", segment.west.toFixed(4));
      params.set("maxlongitude", segment.east.toFixed(4));
    }
    return fetchJson(`${USGS_QUERY}?${params}`, signal) as Promise<{ features?: Feature[] }>;
  }));

  const unique = new Map<string, Feature>();
  for (const result of results) {
    for (const feature of result.features ?? []) {
      const id = text(feature.id);
      if (id) unique.set(id, feature);
    }
  }
  return [...unique.values()]
    .sort((a, b) => featureSortValue(b, orderBy) - featureSortValue(a, orderBy))
    .slice(0, limit);
}

export async function GET(request: NextRequest) {
  try {
    const days = Math.round(numberParam(request.nextUrl.searchParams.get("days"), 365, 30, 1825));
    const minMagnitude = numberParam(request.nextUrl.searchParams.get("minMagnitude"), 6, 5.5, 8);
    const limit = Math.round(numberParam(request.nextUrl.searchParams.get("limit"), 28, 5, 60));
    const orderBy = request.nextUrl.searchParams.get("orderBy") === "magnitude" ? "magnitude" as const : "time" as const;
    const bounds = parseBounds(request.nextUrl.searchParams.get("bbox"));
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - days * DAY_MS);
    const features = await queryFeatures({ startTime, endTime, minMagnitude, limit, orderBy, bounds, signal: request.signal });
    const settled = await Promise.allSettled(features.map((feature) => mechanismFromFeature(feature, request.signal)));
    const mechanisms = settled
      .filter((item): item is PromiseFulfilledResult<SeismicMechanism | null> => item.status === "fulfilled")
      .map((item) => item.value)
      .filter((item): item is SeismicMechanism => item !== null);
    const failed = settled.filter((item) => item.status === "rejected").length;
    const warnings: string[] = [];
    if (failed) warnings.push(`${failed} detalles USGS no pudieron consultarse.`);
    if (mechanisms.length < features.length) {
      warnings.push(`${features.length - mechanisms.length} eventos consultados no expusieron ejes P/T utilizables en el producto preferido.`);
    }

    const payload: SeismicMechanismResponse = {
      generatedAt: new Date().toISOString(),
      source: "USGS ComCat",
      days,
      minMagnitude,
      mechanisms,
      warnings,
    };
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible cargar mecanismos focales." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
