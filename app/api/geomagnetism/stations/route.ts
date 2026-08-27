import { NextResponse } from "next/server";
import { USGS_GEOMAG_STATIONS } from "@/lib/usgsGeomag";

export const runtime = "nodejs";
export const revalidate = 86_400;

export async function GET() {
  const stations = USGS_GEOMAG_STATIONS
    .map((station) => ({
      code: station.code,
      name: station.name,
      minuteDatasetId: `USGS:${station.code}:PT60S`,
      hasOneSecond: true,
      latitude: station.latitude,
      longitude: station.longitude,
      elevationM: station.elevationM,
      country: station.country,
      dataSource: "USGS Geomagnetism",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({
    stations,
    count: stations.length,
    mappedCount: stations.length,
    source: "USGS Geomagnetism Program observatory network",
    dataService: "https://geomag.usgs.gov/ws/data/",
    generatedAt: new Date().toISOString(),
    warnings: [],
    licenseNote: "Observatory metadata and geomagnetic measurements are provided by the U.S. Geological Survey Geomagnetism Program.",
  }, {
    headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
  });
}
