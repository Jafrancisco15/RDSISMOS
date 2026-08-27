import { NextResponse } from "next/server";
import { parseIntermagnetCapabilitiesText, type IntermagnetObservatoryMeta } from "@/lib/intermagnetStations";

export const runtime = "nodejs";
export const revalidate = 43_200;
export const maxDuration = 30;

const CATALOG_URL = "https://imag-data.bgs.ac.uk/GIN_V1/hapi/catalog";
const CAPABILITIES_URLS = [
  "https://imag-data.bgs.ac.uk/GIN_V1/GINServices?Request=GetCapabilities&format=json",
  "https://imag-data.bgs.ac.uk/GIN_V1/GINServices?Request=GetCapabilities&format=html",
];

type HapiCatalog = { catalog?: Array<{ id?: string; title?: string }> };

type Station = {
  code: string;
  name: string;
  minuteDatasetId: string;
  hasOneSecond: boolean;
  latitude: number | null;
  longitude: number | null;
  elevationM: number | null;
};

const CORE_FALLBACK: Record<string, IntermagnetObservatoryMeta> = {
  SJG: { name: "San Juan, USA", latitude: 18.110, longitude: -66.150, elevationM: 424 },
  KOU: { name: "Kourou, Guyana, France", latitude: 5.210, longitude: -52.730, elevationM: 10 },
  TTB: { name: "Tatuoca, Brazil", latitude: -1.205, longitude: -48.513, elevationM: 10 },
  MBO: { name: "Mbour, Senegal", latitude: 14.390, longitude: -16.960, elevationM: 7 },
  BOU: { name: "Boulder, USA", latitude: 40.140, longitude: -105.233, elevationM: 1682 },
  FRD: { name: "Fredericksburg, USA", latitude: 38.210, longitude: -77.367, elevationM: 69 },
  HON: { name: "Honolulu, USA", latitude: 21.320, longitude: -158.000, elevationM: 4 },
  GUA: { name: "Guam, USA", latitude: 13.590, longitude: 144.870, elevationM: 140 },
};

function stationName(title: string | undefined, code: string) {
  if (!title) return code.toUpperCase();
  const match = title.match(/provided by\s+(.+?)\s+\([A-Z0-9]{3}\)\s+observatory/i)
    ?? title.match(/provided by\s+(.+?)\s+observatory/i);
  return match?.[1]?.trim() || code.toUpperCase();
}

function rank(id: string) {
  if (id.includes("/best-avail/PT1M/xyzf")) return 0;
  if (id.includes("/definitive/PT1M/xyzf")) return 1;
  if (id.includes("/quasi-def/PT1M/xyzf")) return 2;
  if (id.includes("/adjusted/PT1M/xyzf")) return 3;
  if (id.includes("/reported/PT1M/native")) return 4;
  return 99;
}

async function fetchCapabilities(signal: AbortSignal) {
  const errors: string[] = [];
  for (const url of CAPABILITIES_URLS) {
    try {
      const response = await fetch(url, {
        signal,
        next: { revalidate: 43_200 },
        headers: {
          Accept: url.endsWith("json") ? "application/json,text/xml,text/plain;q=0.8" : "text/html,text/plain;q=0.8",
          "User-Agent": "RDSISMOS/1.0",
        },
      });
      if (!response.ok) {
        errors.push(`${url.includes("format=json") ? "JSON" : "HTML"}: HTTP ${response.status}`);
        continue;
      }
      const text = await response.text();
      const parsed = parseIntermagnetCapabilitiesText(text);
      if (parsed.size) return { stations: parsed, source: url.includes("format=json") ? "GIN GetCapabilities JSON" : "GIN GetCapabilities HTML", warnings: errors };
      errors.push(`${url.includes("format=json") ? "JSON" : "HTML"}: 0 observatorios parseados`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "error de GetCapabilities");
    }
  }
  return { stations: new Map<string, IntermagnetObservatoryMeta>(), source: "fallback", warnings: errors };
}

export async function GET(request: Request) {
  try {
    const [catalogResponse, capabilities] = await Promise.all([
      fetch(CATALOG_URL, {
        signal: request.signal,
        next: { revalidate: 43_200 },
        headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" },
      }),
      fetchCapabilities(request.signal),
    ]);

    if (!catalogResponse.ok) throw new Error(`INTERMAGNET HAPI respondió HTTP ${catalogResponse.status}.`);
    const text = await catalogResponse.text();
    let payload: HapiCatalog;
    try {
      payload = JSON.parse(text) as HapiCatalog;
    } catch {
      throw new Error(`INTERMAGNET devolvió una respuesta no JSON: ${text.replace(/\s+/g, " ").slice(0, 180)}`);
    }

    const entries = payload.catalog ?? [];
    const byCode = new Map<string, { name: string; minuteDatasetId: string; rank: number; hasOneSecond: boolean }>();

    for (const entry of entries) {
      const id = String(entry.id ?? "").toLowerCase();
      const match = id.match(/^([a-z0-9]{3})\//);
      if (!match) continue;
      const code = match[1];
      const existing = byCode.get(code);
      const entryRank = rank(id);
      const second = id.includes("/PT1S/");
      if (!existing) {
        byCode.set(code, {
          name: stationName(entry.title, code),
          minuteDatasetId: entryRank < 99 ? id : "",
          rank: entryRank,
          hasOneSecond: second,
        });
      } else {
        existing.hasOneSecond ||= second;
        if (entryRank < existing.rank) {
          existing.rank = entryRank;
          existing.minuteDatasetId = id;
          existing.name = stationName(entry.title, code);
        }
      }
    }

    const stations: Station[] = [...byCode.entries()]
      .filter(([, value]) => Boolean(value.minuteDatasetId))
      .map(([code, value]) => {
        const upper = code.toUpperCase();
        const meta = capabilities.stations.get(upper) ?? CORE_FALLBACK[upper];
        return {
          code: upper,
          name: meta?.name ?? value.name,
          minuteDatasetId: value.minuteDatasetId,
          hasOneSecond: value.hasOneSecond,
          latitude: meta?.latitude ?? null,
          longitude: meta?.longitude ?? null,
          elevationM: meta?.elevationM ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const mapped = stations.filter((station) => station.latitude !== null && station.longitude !== null).length;
    const usedCoreFallback = capabilities.stations.size === 0 && mapped > 0;
    return NextResponse.json({
      stations,
      count: stations.length,
      mappedCount: mapped,
      capabilitiesCount: capabilities.stations.size,
      source: `INTERMAGNET HAPI catalog + ${usedCoreFallback ? "core coordinate fallback" : capabilities.source}`,
      warnings: usedCoreFallback
        ? [...capabilities.warnings, "GetCapabilities no pudo georreferenciar el catálogo; se muestran al menos las estaciones núcleo monitorizadas con coordenadas oficiales conocidas."]
        : capabilities.warnings,
      generatedAt: new Date().toISOString(),
      licenseNote: "INTERMAGNET data are generally CC BY-NC 4.0 unless an institute states otherwise.",
    }, { headers: { "Cache-Control": "public, s-maxage=43200, stale-while-revalidate=604800" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible cargar el catálogo INTERMAGNET." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
