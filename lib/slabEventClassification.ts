import type { EarthquakeEvent } from "./earthquakes/types";
import type { SlabContour3D } from "./tectonicDepth3d";

export type SlabEventClass = "cortical" | "interface" | "intraslab" | "deep" | "unclassified";

export interface SlabSample {
  lat: number;
  lng: number;
  depthKm: number;
}

export interface SlabEventClassification {
  kind: SlabEventClass;
  nearestSlabDepthKm: number | null;
  horizontalDistanceKm: number | null;
  depthOffsetKm: number | null;
}

export const SLAB_EVENT_COLORS: Record<SlabEventClass, string> = {
  cortical: "#ffd166",
  interface: "#ff4d6d",
  intraslab: "#d66efd",
  deep: "#4cc9f0",
  unclassified: "#94a3b8",
};

const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  let dLon = (lon2 - lon1) * toRad;
  while (dLon > Math.PI) dLon -= Math.PI * 2;
  while (dLon < -Math.PI) dLon += Math.PI * 2;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function buildSlabSamples(contours: SlabContour3D[], maxSamples = 4200) {
  const raw: SlabSample[] = [];
  for (const contour of contours) {
    for (const point of contour.points) raw.push({ lat: point.lat, lng: point.lng, depthKm: contour.depthKm });
  }
  if (raw.length <= maxSamples) return raw;
  const stride = Math.ceil(raw.length / maxSamples);
  return raw.filter((_, index) => index % stride === 0).slice(0, maxSamples);
}

/**
 * Geometric screening only. Slab2 describes the upper surface of a subducting
 * slab; this classification does not replace focal mechanisms or a published
 * tectonic interpretation.
 */
export function classifyEventRelativeToSlab(event: EarthquakeEvent, samples: SlabSample[]): SlabEventClassification {
  if (!samples.length) {
    return {
      kind: event.depthKm <= 40 ? "cortical" : event.depthKm >= 300 ? "deep" : "unclassified",
      nearestSlabDepthKm: null,
      horizontalDistanceKm: null,
      depthOffsetKm: null,
    };
  }

  let nearest: SlabSample | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const sample of samples) {
    const distance = haversineKm(event.latitude, event.longitude, sample.lat, sample.lng);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = sample;
    }
  }

  if (!nearest || nearestDistance > 180) {
    return {
      kind: event.depthKm <= 40 ? "cortical" : event.depthKm >= 300 ? "deep" : "unclassified",
      nearestSlabDepthKm: nearest?.depthKm ?? null,
      horizontalDistanceKm: Number.isFinite(nearestDistance) ? nearestDistance : null,
      depthOffsetKm: nearest ? event.depthKm - nearest.depthKm : null,
    };
  }

  const delta = event.depthKm - nearest.depthKm;
  let kind: SlabEventClass;
  if (event.depthKm >= 300 && Math.abs(delta) > 90) kind = "deep";
  else if (Math.abs(delta) <= 16) kind = "interface";
  else if (delta > 16 && delta <= 95) kind = "intraslab";
  else if (delta < -16 && event.depthKm <= 70) kind = "cortical";
  else kind = event.depthKm >= 300 ? "deep" : "unclassified";

  return {
    kind,
    nearestSlabDepthKm: nearest.depthKm,
    horizontalDistanceKm: nearestDistance,
    depthOffsetKm: delta,
  };
}
