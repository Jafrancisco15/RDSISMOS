export interface PrincipalAxis {
  azimuthDeg: number;
  plungeDeg: number;
}

export interface SeismicMechanism {
  id: string;
  timeUtc: string;
  place: string;
  latitude: number;
  longitude: number;
  depthKm: number;
  magnitude: number;
  pAxis: PrincipalAxis;
  tAxis: PrincipalAxis;
  strikeDeg: number | null;
  dipDeg: number | null;
  rakeDeg: number | null;
  strike2Deg: number | null;
  dip2Deg: number | null;
  rake2Deg: number | null;
  percentDoubleCouple: number | null;
  source: string;
  sourceUrl: string | null;
}

export interface SeismicMechanismResponse {
  generatedAt: string;
  source: "USGS ComCat";
  days: number;
  minMagnitude: number;
  mechanisms: SeismicMechanism[];
  warnings: string[];
}

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function numericProperty(properties: Record<string, unknown>, aliases: string[]) {
  const desired = new Set(aliases.map(normalizedKey));
  for (const [key, value] of Object.entries(properties)) {
    if (!desired.has(normalizedKey(key))) continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function parsePrincipalAxes(properties: Record<string, unknown>) {
  const pAzimuth = numericProperty(properties, ["p-axis-azimuth", "pAxisAzimuth", "p-axis-azimuth-deg"]);
  const pPlunge = numericProperty(properties, ["p-axis-plunge", "pAxisPlunge", "p-axis-plunge-deg"]);
  const tAzimuth = numericProperty(properties, ["t-axis-azimuth", "tAxisAzimuth", "t-axis-azimuth-deg"]);
  const tPlunge = numericProperty(properties, ["t-axis-plunge", "tAxisPlunge", "t-axis-plunge-deg"]);
  if (pAzimuth === null || pPlunge === null || tAzimuth === null || tPlunge === null) return null;
  return {
    pAxis: { azimuthDeg: ((pAzimuth % 360) + 360) % 360, plungeDeg: Math.max(0, Math.min(90, pPlunge)) },
    tAxis: { azimuthDeg: ((tAzimuth % 360) + 360) % 360, plungeDeg: Math.max(0, Math.min(90, tPlunge)) },
  };
}

export function horizontalAxisScale(plungeDeg: number) {
  return Math.max(0.18, Math.cos(plungeDeg * Math.PI / 180));
}
