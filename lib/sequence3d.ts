export interface LocalPoint3D {
  eastKm: number;
  northKm: number;
  depthKm: number;
}

export interface ProjectedPoint2D {
  x: number;
  y: number;
  cameraDepth: number;
}

const KM_PER_DEG_LAT = 111.195;

export function normalizeAngleDeg(value: number) {
  return ((value % 360) + 360) % 360;
}

export function longitudeDeltaDeg(value: number) {
  let delta = value;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

export function localPointFromLatLon(
  latitude: number,
  longitude: number,
  depthKm: number,
  originLatitude: number,
  originLongitude: number,
): LocalPoint3D {
  const meanLatitude = (latitude + originLatitude) * 0.5 * Math.PI / 180;
  return {
    eastKm: longitudeDeltaDeg(longitude - originLongitude) * KM_PER_DEG_LAT * Math.cos(meanLatitude),
    northKm: (latitude - originLatitude) * KM_PER_DEG_LAT,
    depthKm,
  };
}

export function projectLocalPoint(
  point: LocalPoint3D,
  viewAzimuthDeg: number,
  elevationDeg: number,
  verticalExaggeration = 1,
): ProjectedPoint2D {
  const azimuth = normalizeAngleDeg(viewAzimuthDeg) * Math.PI / 180;
  const elevation = Math.max(5, Math.min(80, elevationDeg)) * Math.PI / 180;
  const forward = point.northKm * Math.cos(azimuth) + point.eastKm * Math.sin(azimuth);
  const right = point.eastKm * Math.cos(azimuth) - point.northKm * Math.sin(azimuth);
  const down = Math.max(0, point.depthKm) * Math.max(0.1, verticalExaggeration);
  return {
    x: right,
    y: down * Math.cos(elevation) - forward * Math.sin(elevation),
    cameraDepth: forward * Math.cos(elevation) + down * Math.sin(elevation),
  };
}

export function profileCoordinates(point: LocalPoint3D, azimuthDeg: number) {
  const azimuth = normalizeAngleDeg(azimuthDeg) * Math.PI / 180;
  return {
    alongKm: point.northKm * Math.cos(azimuth) + point.eastKm * Math.sin(azimuth),
    crossKm: point.eastKm * Math.cos(azimuth) - point.northKm * Math.sin(azimuth),
    depthKm: point.depthKm,
  };
}

export function slabDepthOnLocalPlane({
  eastKm,
  northKm,
  centerDepthKm,
  strikeDeg,
  dipDeg,
}: {
  eastKm: number;
  northKm: number;
  centerDepthKm: number;
  strikeDeg: number;
  dipDeg: number;
}) {
  const dipDirection = normalizeAngleDeg(strikeDeg + 90) * Math.PI / 180;
  const alongDipKm = northKm * Math.cos(dipDirection) + eastKm * Math.sin(dipDirection);
  const safeDip = Math.max(0, Math.min(85, dipDeg)) * Math.PI / 180;
  return centerDepthKm + alongDipKm * Math.tan(safeDip);
}

export function slabProfileSlope({
  profileAzimuthDeg,
  strikeDeg,
  dipDeg,
}: {
  profileAzimuthDeg: number;
  strikeDeg: number;
  dipDeg: number;
}) {
  const dipDirectionDeg = normalizeAngleDeg(strikeDeg + 90);
  const difference = (normalizeAngleDeg(profileAzimuthDeg - dipDirectionDeg)) * Math.PI / 180;
  const safeDip = Math.max(0, Math.min(85, dipDeg)) * Math.PI / 180;
  return Math.tan(safeDip) * Math.cos(difference);
}

export function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function timelineCutoffMs(timesMs: number[], progressPct: number) {
  if (!timesMs.length) return Number.POSITIVE_INFINITY;
  const minimum = Math.min(...timesMs);
  const maximum = Math.max(...timesMs);
  const progress = Math.max(0, Math.min(100, progressPct)) / 100;
  return minimum + (maximum - minimum) * progress;
}
