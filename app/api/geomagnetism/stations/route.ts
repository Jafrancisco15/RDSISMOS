import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 43_200;
export const maxDuration = 30;

const CATALOG_URL = "https://imag-data.bgs.ac.uk/GIN_V1/hapi/catalog";
const CAPABILITIES_URL = "https://imag-data.bgs.ac.uk/GIN_V1/GINServices?Request=GetCapabilities&format=html";

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

type ObservatoryMeta = { name: string; latitude: number; longitude: number; elevationM: number | null };

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

function plainHtml(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLongitude(value: number) {
  let longitude = value;
  while (longitude > 180) longitude -= 360;
  while (longitude < -180) longitude += 360;
  return longitude;
}

function parseCapabilitiesHtml(html: string) {
  const result = new Map<string, ObservatoryMeta>();
  const rows = html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => plainHtml(match[1]));
    if (cells.length < 4) continue;
    const code = cells[0].toUpperCase();
    if (!/^[A-Z0-9]{3}$/.test(code)) continue;
    const latitude = Number(cells[2]);
    const rawLongitude = Number(cells[3]);
    const elevation = cells.length > 4 ? Number(cells[4]) : NaN;
    if (!Number.isFinite(latitude) || !Number.isFinite(rawLongitude)) continue;
    result.set(code, {
      name: cells[1] || code,
      latitude,
      longitude: normalizeLongitude(rawLongitude),
      elevationM: Number.isFinite(elevation) ? elevation : null,
    });
  }
  return result;
}

export async function GET(request: Request) {
  try {
    const [catalogResponse, capabilitiesResult] = await Promise.all([
      fetch(CATALOG_URL, {
        signal: request.signal,
        next: { revalidate: 43_200 },
        headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" },
      }),
      fetch(CAPABILITIES_URL, {
        signal: request.signal,
        next: { revalidate: 43_200 },
        headers: { Accept: "text/html", "User-Agent": "RDSISMOS/1.0" },
      }).then(async (response) => response.ok ? parseCapabilitiesHtml(await response.text()) : new Map<string, ObservatoryMeta>()).catch(() => new Map<string, ObservatoryMeta>()),
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
        const meta = capabilitiesResult.get(upper);
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
    return NextResponse.json({
      stations,
      count: stations.length,
      mappedCount: mapped,
      source: "INTERMAGNET HAPI catalog + GIN GetCapabilities",
      generatedAt: new Date().toISOString(),
      licenseNote: "INTERMAGNET data are generally CC BY-NC 4.0 unless an institute states otherwise.",
    }, { headers: { "Cache-Control": "public, s-maxage=43200, stale-while-revalidate=604800" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible cargar el catálogo INTERMAGNET." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
