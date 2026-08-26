import { NextResponse } from "next/server";
import { REFERENCE_EXTRACTION_SITES, type ExtractionSite } from "@/lib/extractions";

export const runtime = "nodejs";
export const revalidate = 43_200;
export const maxDuration = 60;

const MRDS_URL = "https://energy.usgs.gov/arcgis/rest/services/MRData/Mineral_Resource_Data_System/FeatureServer/3/query";
const MRDS_PAGE_SIZE = 750;
const MRDS_PAGES = 4;

type MrdsFeature = {
  id?: string | number;
  properties?: Record<string, unknown>;
  geometry?: { type?: string; coordinates?: unknown } | null;
};

type MrdsPayload = { features?: MrdsFeature[] };

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function propertyText(properties: Record<string, unknown>, keys: string[], fallback = "") {
  const wanted = new Set(keys.map(normalizedKey));
  for (const [key, value] of Object.entries(properties)) {
    if (!wanted.has(normalizedKey(key))) continue;
    const result = text(value);
    if (result) return result;
  }
  return fallback;
}

function locationText(properties: Record<string, unknown>) {
  const parts = [
    propertyText(properties, ["district", "mining_district"]),
    propertyText(properties, ["county", "province"]),
    propertyText(properties, ["state", "state_name"]),
  ].filter(Boolean);
  return [...new Set(parts)].join(" · ");
}

async function fetchMinerals(signal: AbortSignal): Promise<ExtractionSite[]> {
  const sites: ExtractionSite[] = [];
  for (let page = 0; page < MRDS_PAGES; page += 1) {
    const params = new URLSearchParams({
      where: "dev_stat IN ('Producer','Past Producer')",
      outFields: "*",
      returnGeometry: "true",
      outSR: "4326",
      f: "geojson",
      resultRecordCount: String(MRDS_PAGE_SIZE),
      resultOffset: String(page * MRDS_PAGE_SIZE),
      orderByFields: "gid ASC",
    });
    const response = await fetch(`${MRDS_URL}?${params}`, {
      cache: "force-cache",
      signal,
      headers: { Accept: "application/geo+json,application/json", "User-Agent": "RDSISMOS/1.0" },
    });
    if (!response.ok) throw new Error(`USGS MRDS respondió HTTP ${response.status}.`);
    const payload = await response.json() as MrdsPayload;
    const features = payload.features ?? [];
    for (const [index, feature] of features.entries()) {
      if (feature.geometry?.type !== "Point" || !Array.isArray(feature.geometry.coordinates)) continue;
      const longitude = Number(feature.geometry.coordinates[0]);
      const latitude = Number(feature.geometry.coordinates[1]);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
      const properties = feature.properties ?? {};
      const name = propertyText(properties, ["site_name", "sitename", "name"], `Sitio mineral ${page * MRDS_PAGE_SIZE + index + 1}`);
      const commodity = propertyText(properties, ["code_list", "commodities", "commodity"], "Mineral no especificado");
      const status = propertyText(properties, ["dev_stat", "development_status", "status"], "Estado no especificado");
      const country = propertyText(properties, ["country", "country_name", "country_na"], "País no especificado");
      const location = locationText(properties);
      const depId = propertyText(properties, ["dep_id", "depid"], String(properties.gid ?? feature.id ?? `${page}-${index}`));
      sites.push({
        id: `mrds-${depId}`,
        name,
        kind: "mineral",
        latitude,
        longitude,
        country,
        location: location || undefined,
        status,
        detail: `${commodity} · ${status}. MRDS es una compilación histórica; el estado operacional puede estar desactualizado.`,
        source: "USGS Mineral Resources Data System (MRDS)",
        sourceType: "official",
        quantityLabel: "Producción cuantitativa no disponible en el registro MRDS cargado",
      });
    }
    if (features.length < MRDS_PAGE_SIZE) break;
  }
  return sites;
}

export async function GET(request: Request) {
  const warnings: string[] = [];
  let mineralSites: ExtractionSite[] = [];
  try {
    mineralSites = await fetchMinerals(request.signal);
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "USGS MRDS no está disponible temporalmente.");
  }

  const sites = [...REFERENCE_EXTRACTION_SITES, ...mineralSites];
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    sites,
    counts: sites.reduce<Record<string, number>>((acc, site) => {
      acc[site.kind] = (acc[site.kind] ?? 0) + 1;
      return acc;
    }, {}),
    warnings,
    coverage: {
      loadedSites: sites.length,
      mineralLimit: MRDS_PAGE_SIZE * MRDS_PAGES,
      note: "Todos los sitios devueltos por este endpoint se renderizan en el globo. La cobertura mundial depende de cada fuente y no equivale a un inventario universal de pozos.",
    },
    sources: [
      "USGS Mineral Resources Data System (MRDS)",
      "EPA Underground Injection Control context (Class II)",
      "EIA oil/gas basin context",
      "Reference regional centroids for layers without a stable public point API",
    ],
  }, {
    headers: { "Cache-Control": "public, s-maxage=43200, stale-while-revalidate=604800" },
  });
}
