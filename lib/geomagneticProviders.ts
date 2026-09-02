import type { MagneticStationSeries } from "@/lib/geomagnetism";
import { fetchIntermagnetSeries, fetchIntermagnetStations } from "@/lib/intermagnet";
import { mergeGeomagneticStations, type GeomagneticStation } from "@/lib/geomagNetwork";
import { fetchUsgsGeomagSeries, USGS_GEOMAG_CODES, USGS_GEOMAG_STATIONS } from "@/lib/usgsGeomag";

export function usgsStationsAsNetwork(): GeomagneticStation[] {
  return USGS_GEOMAG_STATIONS.map((station) => ({
    code: station.code,
    name: station.name,
    minuteDatasetId: `USGS:${station.code}:PT60S`,
    hasOneSecond: true,
    latitude: station.latitude,
    longitude: station.longitude,
    elevationM: station.elevationM,
    country: station.country,
    dataSource: "USGS Geomagnetism",
    sources: ["USGS"],
  }));
}

export async function fetchFederatedGeomagneticStations(signal?: AbortSignal) {
  const usgs = usgsStationsAsNetwork();
  try {
    const intermagnet = await fetchIntermagnetStations(signal);
    return { stations: mergeGeomagneticStations(usgs, intermagnet), warnings: [] as string[] };
  } catch (error) {
    return {
      stations: usgs,
      warnings: [`INTERMAGNET no disponible: ${error instanceof Error ? error.message : "error desconocido"}. Se mantiene USGS como fallback.`],
    };
  }
}

export async function fetchFederatedGeomagneticSeries(station: GeomagneticStation, start: Date, end: Date, signal?: AbortSignal): Promise<MagneticStationSeries> {
  const errors: string[] = [];
  if (station.sources.includes("USGS") && USGS_GEOMAG_CODES.has(station.code)) {
    try { return await fetchUsgsGeomagSeries(station.code, start, end, signal); }
    catch (error) { errors.push(`USGS: ${error instanceof Error ? error.message : "error"}`); }
  }
  if (station.sources.includes("INTERMAGNET")) {
    try { return await fetchIntermagnetSeries(station.code, start, end, signal); }
    catch (error) { errors.push(`INTERMAGNET: ${error instanceof Error ? error.message : "error"}`); }
  }
  throw new Error(`${station.code}: ninguna fuente geomagnética pudo entregar datos. ${errors.join("; ")}`);
}
