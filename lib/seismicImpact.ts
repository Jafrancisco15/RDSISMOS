import type { EarthquakeEvent } from "./earthquakes/types";
import type { GlobeMapPath } from "./globeLayers";
import type { SeismicWavefrontTable, SurfaceWavefrontPoint } from "./seismicWavefronts";

const EARTH_RADIUS_KM = 6371;

export interface CountryImpactEstimate {
  country: string;
  latitude: number;
  longitude: number;
  surfaceDistanceKm: number;
  hypocentralDistanceKm: number;
  meanMmi: number;
  sigmaMmi: number;
  probabilityMmi3: number;
  probabilityMmi5: number;
  probabilityMmi6: number;
  level: "instrumental" | "posiblemente perceptible" | "probablemente perceptible" | "potencialmente dañino";
  extrapolated: boolean;
  pArrivalSec: number | null;
  sArrivalSec: number | null;
}

export interface ImpactRadius {
  mmi: 3 | 5 | 6;
  radiusKm: number | null;
}

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function radians(value: number) { return value * Math.PI / 180; }

export function greatCircleDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const phi1 = radians(lat1);
  const phi2 = radians(lat2);
  const dPhi = radians(lat2 - lat1);
  const dLambda = radians(lng2 - lng1);
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

function sphericalMean(points: Array<{ lat: number; lng: number }>) {
  if (!points.length) return { latitude: 0, longitude: 0 };
  let x = 0; let y = 0; let z = 0;
  for (const point of points) {
    const lat = radians(point.lat); const lng = radians(point.lng);
    x += Math.cos(lat) * Math.cos(lng); y += Math.cos(lat) * Math.sin(lng); z += Math.sin(lat);
  }
  return {
    latitude: Math.atan2(z, Math.hypot(x, y)) * 180 / Math.PI,
    longitude: Math.atan2(y, x) * 180 / Math.PI,
  };
}

// Allen, Wald & Worden (2012), hypocentral-distance IPE for active crustal regions.
// OpenQuake implementation coefficients: c0=2.085 c1=1.428 c2=-1.402 c4=0.078,
// m1=-0.209 m2=2.042, sigma s1=0.82 s2=0.37 s3=22.9.
// No site amplification. This is a screening estimate, not a ShakeMap replacement.
export function allen2012RhypoMmi(magnitude: number, rhypoKm: number) {
  const distance = Math.max(0.1, rhypoKm);
  const rm = -0.209 + 2.042 * Math.exp(magnitude - 5);
  let mean = 2.085 + 1.428 * magnitude - 1.402 * Math.log(Math.sqrt(distance * distance + rm * rm));
  if (distance > 50) mean += 0.078 * Math.log(distance / 50);
  const sigma = 0.82 + 0.37 / (1 + (distance / 22.9) ** 2);
  return { mean, sigma };
}

function erf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}

function exceedanceProbability(mean: number, sigma: number, threshold: number) {
  if (!(sigma > 0)) return mean >= threshold ? 1 : 0;
  const cdf = 0.5 * (1 + erf((threshold - mean) / (sigma * Math.SQRT2)));
  return clamp(1 - cdf, 0, 1);
}

export function arrivalTimeAtDistance(curve: SurfaceWavefrontPoint[], distanceDeg: number, maxGapDeg = 3.5) {
  if (curve.length < 2) return null;
  const target = clamp(distanceDeg, 0, 180);
  for (let index = 0; index < curve.length - 1; index += 1) {
    const a = curve[index]; const b = curve[index + 1];
    if (b.distanceDeg - a.distanceDeg > maxGapDeg) continue;
    if (target < a.distanceDeg || target > b.distanceDeg) continue;
    const span = b.distanceDeg - a.distanceDeg;
    if (span <= 1e-9) return Math.min(a.timeSec, b.timeSec);
    const mix = (target - a.distanceDeg) / span;
    return a.timeSec + (b.timeSec - a.timeSec) * mix;
  }
  return null;
}

function impactLevel(mean: number, p3: number, p5: number, p6: number): CountryImpactEstimate["level"] {
  if (mean >= 6 || p6 >= 0.2) return "potencialmente dañino";
  if (mean >= 5 || p5 >= 0.3) return "probablemente perceptible";
  if (mean >= 3 || p3 >= 0.35) return "posiblemente perceptible";
  return "instrumental";
}

function angularDistanceDeg(surfaceKm: number) { return surfaceKm / EARTH_RADIUS_KM * 180 / Math.PI; }

export function estimateCountryImpacts(
  event: EarthquakeEvent,
  countryBorders: GlobeMapPath[],
  wavefronts?: SeismicWavefrontTable | null,
): CountryImpactEstimate[] {
  const groups = new Map<string, Array<{ lat: number; lng: number }>>();
  for (const path of countryBorders) {
    if (path.kind !== "country-border" || !path.name) continue;
    const points = groups.get(path.name) ?? [];
    // Keep enough points to approximate the nearest edge without making mobile analysis expensive.
    const stride = Math.max(1, Math.ceil(path.points.length / 36));
    for (let index = 0; index < path.points.length; index += stride) points.push(path.points[index]);
    groups.set(path.name, points);
  }

  const output: CountryImpactEstimate[] = [];
  for (const [country, points] of groups) {
    if (!points.length) continue;
    const center = sphericalMean(points);
    let surfaceDistanceKm = Infinity;
    for (const point of points) {
      surfaceDistanceKm = Math.min(surfaceDistanceKm, greatCircleDistanceKm(event.latitude, event.longitude, point.lat, point.lng));
    }
    if (!Number.isFinite(surfaceDistanceKm)) continue;
    const rhypoKm = Math.hypot(surfaceDistanceKm, Math.max(0, event.depthKm));
    const { mean, sigma } = allen2012RhypoMmi(event.magnitude, rhypoKm);
    const p3 = exceedanceProbability(mean, sigma, 3);
    const p5 = exceedanceProbability(mean, sigma, 5);
    const p6 = exceedanceProbability(mean, sigma, 6);
    const distanceDeg = angularDistanceDeg(surfaceDistanceKm);
    output.push({
      country,
      latitude: center.latitude,
      longitude: center.longitude,
      surfaceDistanceKm,
      hypocentralDistanceKm: rhypoKm,
      meanMmi: clamp(mean, 0, 10),
      sigmaMmi: sigma,
      probabilityMmi3: p3,
      probabilityMmi5: p5,
      probabilityMmi6: p6,
      level: impactLevel(mean, p3, p5, p6),
      extrapolated: surfaceDistanceKm > 500,
      pArrivalSec: wavefronts ? arrivalTimeAtDistance(wavefronts.curves.P, distanceDeg) : null,
      sArrivalSec: wavefronts ? arrivalTimeAtDistance(wavefronts.curves.S, distanceDeg) : null,
    });
  }

  return output.sort((a, b) => b.probabilityMmi3 - a.probabilityMmi3 || b.meanMmi - a.meanMmi || a.surfaceDistanceKm - b.surfaceDistanceKm);
}

export function solveImpactRadii(magnitude: number, depthKm: number): ImpactRadius[] {
  return ([3, 5, 6] as const).map((mmi) => {
    const atZero = allen2012RhypoMmi(magnitude, Math.max(0.1, depthKm)).mean;
    if (atZero < mmi) return { mmi, radiusKm: null };
    let low = 0; let high = 4000;
    if (allen2012RhypoMmi(magnitude, Math.hypot(high, depthKm)).mean > mmi) return { mmi, radiusKm: high };
    for (let iteration = 0; iteration < 50; iteration += 1) {
      const mid = (low + high) / 2;
      const value = allen2012RhypoMmi(magnitude, Math.hypot(mid, depthKm)).mean;
      if (value >= mmi) low = mid; else high = mid;
    }
    return { mmi, radiusKm: (low + high) / 2 };
  });
}
