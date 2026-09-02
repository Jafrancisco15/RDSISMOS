import { NextResponse } from "next/server";
import { fetchFederatedGeomagneticStations } from "@/lib/geomagneticProviders";

export const runtime = "nodejs";
export const revalidate = 86_400;

export async function GET() {
  const { stations, warnings } = await fetchFederatedGeomagneticStations();
  const sourceCounts = stations.reduce((counts, station) => {
    for (const source of station.sources) counts[source] = (counts[source] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>);

  return NextResponse.json({
    stations,
    count: stations.length,
    mappedCount: stations.filter((station) => station.latitude !== null && station.longitude !== null).length,
    source: "Red federada USGS + INTERMAGNET",
    sourceCounts,
    dataServices: [
      "USGS Geomagnetism Data Web Service",
      "INTERMAGNET Edinburgh GIN / HAPI 3.1",
    ],
    generatedAt: new Date().toISOString(),
    warnings,
    licenseNote: "USGS data are U.S. government data. INTERMAGNET data remain subject to INTERMAGNET/data-provider terms and attribution; RDSISMOS processes data on demand rather than redistributing a bulk archive.",
  }, {
    headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
  });
}
