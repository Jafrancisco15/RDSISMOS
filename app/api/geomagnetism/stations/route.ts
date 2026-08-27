import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 43_200;
export const maxDuration = 30;

const CATALOG_URL = "https://imag-data.bgs.ac.uk/GIN_V1/hapi/catalog";

type HapiCatalog = { catalog?: Array<{ id?: string; title?: string }> };

type Station = {
  code: string;
  name: string;
  minuteDatasetId: string;
  hasOneSecond: boolean;
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

export async function GET(request: Request) {
  try {
    const response = await fetch(CATALOG_URL, {
      signal: request.signal,
      next: { revalidate: 43_200 },
      headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" },
    });
    if (!response.ok) throw new Error(`INTERMAGNET HAPI respondió HTTP ${response.status}.`);
    const payload = await response.json() as HapiCatalog;
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
      .map(([code, value]) => ({ code: code.toUpperCase(), name: value.name, minuteDatasetId: value.minuteDatasetId, hasOneSecond: value.hasOneSecond }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      stations,
      count: stations.length,
      source: "INTERMAGNET HAPI catalog",
      generatedAt: new Date().toISOString(),
      licenseNote: "INTERMAGNET data are generally CC BY-NC 4.0 unless an institute states otherwise.",
    }, { headers: { "Cache-Control": "public, s-maxage=43200, stale-while-revalidate=604800" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible cargar el catálogo INTERMAGNET." }, { status: 502 });
  }
}
