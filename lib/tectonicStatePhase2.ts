import type { EarthScopeStation } from "./earthscopeIntegration";
import type { EarthScopeWaveformSource } from "./earthscopeWaveforms";
import { traceRayFamilies, type LocalRayPath } from "./localSeismicRayTracer";

export interface Phase2RayVoxel {
  id: string;
  latitude: number;
  longitude: number;
  depthKm: number;
  horizontalSizeDeg: number;
  depthSizeKm: number;
  rayCount: number;
  pRayCount: number;
  sRayCount: number;
  stationCount: number;
  support01: number;
}

export interface Phase2StationRayCoverage {
  network: string;
  station: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  azimuthDeg: number;
  pPhase: string | null;
  sPhase: string | null;
  pMismatchDeg: number | null;
  sMismatchDeg: number | null;
  voxelCount: number;
}

export interface TectonicStatePhase2Coverage {
  model: "iasp91";
  source: EarthScopeWaveformSource;
  horizontalSizeDeg: number;
  depthSizeKm: number;
  stations: Phase2StationRayCoverage[];
  voxels: Phase2RayVoxel[];
  rayCount: number;
  coveredVoxelCount: number;
  multiRayVoxelCount: number;
  maximumRayCount: number;
  coverageScore: number;
  note: string;
}

type Vec3 = [number, number, number];

type MutableVoxel = {
  latitude: number;
  longitude: number;
  depthKm: number;
  rayIds: Set<string>;
  pRayIds: Set<string>;
  sRayIds: Set<string>;
  stations: Set<string>;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeLongitude(value: number) {
  let longitude = value;
  while (longitude > 180) longitude -= 360;
  while (longitude < -180) longitude += 360;
  return longitude;
}

function toVector(latitude: number, longitude: number): Vec3 {
  const lat = latitude * Math.PI / 180;
  const lon = longitude * Math.PI / 180;
  const cos = Math.cos(lat);
  return [cos * Math.cos(lon), cos * Math.sin(lon), Math.sin(lat)];
}

function fromVector(vector: Vec3) {
  const norm = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  const x = vector[0] / norm;
  const y = vector[1] / norm;
  const z = vector[2] / norm;
  return {
    latitude: Math.asin(clamp(z, -1, 1)) * 180 / Math.PI,
    longitude: normalizeLongitude(Math.atan2(y, x) * 180 / Math.PI),
  };
}

export function greatCircleInterpolate(
  sourceLatitude: number,
  sourceLongitude: number,
  targetLatitude: number,
  targetLongitude: number,
  fraction: number,
) {
  const a = toVector(sourceLatitude, sourceLongitude);
  const b = toVector(targetLatitude, targetLongitude);
  const dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1);
  const omega = Math.acos(dot);
  const f = clamp(fraction, 0, 1);
  if (omega < 1e-8) return { latitude: sourceLatitude, longitude: normalizeLongitude(sourceLongitude) };
  const sinOmega = Math.sin(omega);
  const wa = Math.sin((1 - f) * omega) / sinOmega;
  const wb = Math.sin(f * omega) / sinOmega;
  return fromVector([
    wa * a[0] + wb * b[0],
    wa * a[1] + wb * b[1],
    wa * a[2] + wb * b[2],
  ]);
}

function center(value: number, size: number, minimum: number) {
  return minimum + (Math.floor((value - minimum) / size) + 0.5) * size;
}

function voxelKey(latitude: number, longitude: number, depthKm: number, horizontalSizeDeg: number, depthSizeKm: number) {
  const lat = clamp(center(latitude, horizontalSizeDeg, -90), -90 + horizontalSizeDeg / 2, 90 - horizontalSizeDeg / 2);
  const lon = normalizeLongitude(center(normalizeLongitude(longitude), horizontalSizeDeg, -180));
  const depth = Math.max(depthSizeKm / 2, center(Math.max(0, depthKm), depthSizeKm, 0));
  return {
    id: `${lat.toFixed(2)}:${lon.toFixed(2)}:${depth.toFixed(1)}`,
    latitude: lat,
    longitude: lon,
    depthKm: depth,
  };
}

function nearestPath(paths: LocalRayPath[], phases: LocalRayPath["phase"][], targetDistanceDeg: number) {
  let best: LocalRayPath | null = null;
  let difference = Infinity;
  for (const path of paths) {
    if (!phases.includes(path.phase)) continue;
    const current = Math.abs(path.distanceDeg - targetDistanceDeg);
    if (current < difference) {
      best = path;
      difference = current;
    }
  }
  return best ? { path: best, difference } : null;
}

function chooseP(paths: LocalRayPath[], distanceDeg: number) {
  const direct = nearestPath(paths, ["P"], distanceDeg);
  const core = nearestPath(paths, ["PKP", "PKIKP"], distanceDeg);
  if (!direct) return core;
  if (!core) return direct;
  return direct.difference <= core.difference ? direct : core;
}

function chooseS(paths: LocalRayPath[], distanceDeg: number) {
  const direct = nearestPath(paths, ["S"], distanceDeg);
  const core = nearestPath(paths, ["SKS"], distanceDeg);
  if (!direct) return core;
  if (!core) return direct;
  return direct.difference <= core.difference ? direct : core;
}

function addPathToVoxels(
  voxels: Map<string, MutableVoxel>,
  source: EarthScopeWaveformSource,
  station: EarthScopeStation,
  path: LocalRayPath,
  rayId: string,
  wave: "P" | "S",
  horizontalSizeDeg: number,
  depthSizeKm: number,
) {
  const totalTheta = path.points.at(-1)?.thetaRad ?? 0;
  if (!(totalTheta > 0)) return 0;
  const visited = new Set<string>();
  for (const point of path.points) {
    const fraction = clamp(point.thetaRad / totalTheta, 0, 1);
    const location = greatCircleInterpolate(
      source.latitude,
      source.longitude,
      station.latitude,
      station.longitude,
      fraction,
    );
    const voxel = voxelKey(location.latitude, location.longitude, point.depthKm, horizontalSizeDeg, depthSizeKm);
    if (visited.has(voxel.id)) continue;
    visited.add(voxel.id);
    let bucket = voxels.get(voxel.id);
    if (!bucket) {
      bucket = {
        latitude: voxel.latitude,
        longitude: voxel.longitude,
        depthKm: voxel.depthKm,
        rayIds: new Set<string>(),
        pRayIds: new Set<string>(),
        sRayIds: new Set<string>(),
        stations: new Set<string>(),
      };
      voxels.set(voxel.id, bucket);
    }
    bucket.rayIds.add(rayId);
    if (wave === "P") bucket.pRayIds.add(rayId);
    else bucket.sRayIds.add(rayId);
    bucket.stations.add(`${station.network}.${station.station}`);
  }
  return visited.size;
}

export function buildTectonicStatePhase2Coverage(
  source: EarthScopeWaveformSource,
  stations: EarthScopeStation[],
  options: { horizontalSizeDeg?: number; depthSizeKm?: number } = {},
): TectonicStatePhase2Coverage {
  const horizontalSizeDeg = clamp(options.horizontalSizeDeg ?? 4, 1, 12);
  const depthSizeKm = clamp(options.depthSizeKm ?? 50, 20, 200);
  const rayFamilies = traceRayFamilies("iasp91", source.depthKm, 58);
  const voxels = new Map<string, MutableVoxel>();
  const stationCoverage: Phase2StationRayCoverage[] = [];
  let rayCount = 0;

  for (const station of stations) {
    const distanceDeg = station.distanceKm / 111.195;
    const p = chooseP(rayFamilies, distanceDeg);
    const s = chooseS(rayFamilies, distanceDeg);
    let voxelCount = 0;
    if (p && p.difference <= 18) {
      rayCount += 1;
      voxelCount += addPathToVoxels(
        voxels, source, station, p.path,
        `${station.network}.${station.station}:P`, "P",
        horizontalSizeDeg, depthSizeKm,
      );
    }
    if (s && s.difference <= 18) {
      rayCount += 1;
      voxelCount += addPathToVoxels(
        voxels, source, station, s.path,
        `${station.network}.${station.station}:S`, "S",
        horizontalSizeDeg, depthSizeKm,
      );
    }
    stationCoverage.push({
      network: station.network,
      station: station.station,
      latitude: station.latitude,
      longitude: station.longitude,
      distanceKm: station.distanceKm,
      azimuthDeg: station.azimuthDeg,
      pPhase: p && p.difference <= 18 ? p.path.phase : null,
      sPhase: s && s.difference <= 18 ? s.path.phase : null,
      pMismatchDeg: p ? Number(p.difference.toFixed(2)) : null,
      sMismatchDeg: s ? Number(s.difference.toFixed(2)) : null,
      voxelCount,
    });
  }

  const maximumRayCount = Math.max(0, ...[...voxels.values()].map((voxel) => voxel.rayIds.size));
  const normalized: Phase2RayVoxel[] = [...voxels.entries()].map(([id, voxel]) => ({
    id,
    latitude: voxel.latitude,
    longitude: voxel.longitude,
    depthKm: voxel.depthKm,
    horizontalSizeDeg,
    depthSizeKm,
    rayCount: voxel.rayIds.size,
    pRayCount: voxel.pRayIds.size,
    sRayCount: voxel.sRayIds.size,
    stationCount: voxel.stations.size,
    support01: maximumRayCount > 0
      ? Number((0.65 * voxel.rayIds.size / maximumRayCount + 0.35 * voxel.stations.size / Math.max(1, stations.length)).toFixed(4))
      : 0,
  })).sort((a, b) => b.rayCount - a.rayCount || b.stationCount - a.stationCount);

  const stationsWithBoth = stationCoverage.filter((station) => station.pPhase && station.sPhase).length;
  const multiRayVoxelCount = normalized.filter((voxel) => voxel.rayCount >= 2).length;
  const stationFraction = stations.length ? stationsWithBoth / stations.length : 0;
  const overlapFraction = normalized.length ? multiRayVoxelCount / normalized.length : 0;
  const coverageScore = Math.round(100 * clamp(0.7 * stationFraction + 0.3 * Math.sqrt(overlapFraction), 0, 1));

  return {
    model: "iasp91",
    source,
    horizontalSizeDeg,
    depthSizeKm,
    stations: stationCoverage,
    voxels: normalized.slice(0, 1_200),
    rayCount,
    coveredVoxelCount: normalized.length,
    multiRayVoxelCount,
    maximumRayCount,
    coverageScore,
    note: "Cobertura geométrica de rayos P/S calculada con un trazador esférico 1-D iasp91 y estaciones que aportaron waveforms. Es sensibilidad geométrica, no una inversión de velocidad ni una probabilidad sísmica.",
  };
}
