import { faultStyle, type ActiveFaultFeature, type FaultLineGeometry } from "./activeFaults";
import type { SeismicMechanism } from "./seismicMechanisms";
import { haversineKm, initialBearingDeg, normalizeLongitude } from "./tectonicVectors";

const DEG = Math.PI / 180;
const SHEAR_MODULUS_PA = 30e9;
const POISSON_RATIO = 0.25;
const EFFECTIVE_FRICTION = 0.4;
const DEFAULT_RECEIVER_DEPTH_KM = 10;
const MAX_SOURCE_DISTANCE_KM = 700;

type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3];
type Pair = [number, number];

export interface ReceiverPlane {
  strikeDeg: number;
  dipDeg: number;
  rakeDeg: number;
  normal: Vec3;
  slip: Vec3;
  assumed: boolean;
  note: string | null;
}

export interface CoulombContribution {
  sourceId: string;
  sourceMagnitude: number;
  sourcePlace: string;
  distanceKm: number;
  deltaCfsMpa: number;
}

export interface FaultStressBalance {
  faultId: string;
  faultName: string;
  latitude: number;
  longitude: number;
  strikeDeg: number;
  dipDeg: number;
  rakeDeg: number;
  receiverStyle: "normal" | "reverse" | "strike-slip" | "unknown";
  netMpa: number;
  positiveMpa: number;
  negativeMpa: number;
  grossMpa: number;
  cancellationPct: number;
  sourceCount: number;
  strongestSourceId: string | null;
  strongestContributionMpa: number | null;
  confidence: "high" | "medium" | "low";
  orientationAssumed: boolean;
  note: string | null;
  contributions: CoulombContribution[];
}

export interface StressBalanceSummary {
  evaluatedFaults: number;
  loadedFaults: number;
  relaxedFaults: number;
  nearNeutralFaults: number;
  highCancellationFaults: number;
  medianCancellationPct: number;
  maxAbsNetMpa: number;
}

function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function norm(a: Vec3) {
  return Math.sqrt(dot(a, a));
}

function unit(a: Vec3): Vec3 {
  const length = norm(a);
  if (!Number.isFinite(length) || length < 1e-12) return [0, 0, 0];
  return [a[0] / length, a[1] / length, a[2] / length];
}

function zeroMatrix(): Mat3 {
  return [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
}

function normalize360(value: number) {
  return ((value % 360) + 360) % 360;
}

function angleDifference360(a: number, b: number) {
  const raw = Math.abs(normalize360(a) - normalize360(b));
  return Math.min(raw, 360 - raw);
}

function linePairs(value: unknown) {
  if (!Array.isArray(value)) return [] as Pair[];
  return value
    .filter((item): item is Pair => Array.isArray(item) && item.length >= 2 && Number.isFinite(Number(item[0])) && Number.isFinite(Number(item[1])))
    .map((item) => [Number(item[0]), Number(item[1])] as Pair);
}

function geometryLines(geometry: FaultLineGeometry | null) {
  if (!geometry) return [] as Pair[][];
  if (geometry.type === "LineString") return [linePairs(geometry.coordinates)];
  if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) return geometry.coordinates.map(linePairs);
  return [] as Pair[][];
}

function lineLengthKm(line: Pair[]) {
  let length = 0;
  for (let index = 1; index < line.length; index += 1) {
    length += haversineKm(line[index - 1][1], line[index - 1][0], line[index][1], line[index][0]);
  }
  return length;
}

export function representativeFaultPoint(feature: ActiveFaultFeature) {
  const candidates = geometryLines(feature.geometry)
    .filter((line) => line.length >= 2)
    .map((line) => ({ line, lengthKm: lineLengthKm(line) }))
    .sort((a, b) => b.lengthKm - a.lengthKm);
  const line = candidates[0]?.line;
  if (!line) return null;

  const target = Math.max(0, candidates[0].lengthKm / 2);
  let travelled = 0;
  for (let index = 1; index < line.length; index += 1) {
    const a = line[index - 1];
    const b = line[index];
    const segmentKm = haversineKm(a[1], a[0], b[1], b[0]);
    if (travelled + segmentKm >= target || index === line.length - 1) {
      const fraction = segmentKm > 0 ? Math.max(0, Math.min(1, (target - travelled) / segmentKm)) : 0.5;
      const latitude = a[1] + (b[1] - a[1]) * fraction;
      const lonDelta = normalizeLongitude(b[0] - a[0]);
      const longitude = normalizeLongitude(a[0] + lonDelta * fraction);
      const strikeDeg = initialBearingDeg(a[1], a[0], b[1], b[0]);
      return { latitude, longitude, strikeDeg };
    }
    travelled += segmentKm;
  }
  return null;
}

function parseFirstNumber(value: string | null) {
  if (!value) return null;
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function compassAzimuth(value: string | null) {
  if (!value) return null;
  const numeric = parseFirstNumber(value);
  if (numeric !== null && /\d/.test(value)) return normalize360(numeric);
  const key = value.toUpperCase().replace(/[^A-Z]/g, "");
  const compass: Record<string, number> = {
    N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
    S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
  };
  return compass[key] ?? null;
}

function inferredDip(style: ReturnType<typeof faultStyle>) {
  if (style === "strike-slip") return 90;
  if (style === "normal") return 60;
  if (style === "reverse") return 30;
  return 60;
}

function rakeForFault(feature: ActiveFaultFeature, style: ReturnType<typeof faultStyle>) {
  const raw = feature.properties.averageRake;
  const parsed = parseFirstNumber(raw);
  if (parsed !== null && parsed >= -180 && parsed <= 180) return { rakeDeg: parsed, assumed: false };
  if (style === "normal") return { rakeDeg: -90, assumed: true };
  if (style === "reverse") return { rakeDeg: 90, assumed: true };
  const slip = feature.properties.slipType?.toLowerCase() ?? "";
  if (slip.includes("sinistral") || slip.includes("left lateral") || slip.includes("left-lateral")) return { rakeDeg: 180, assumed: true };
  if (style === "strike-slip") return { rakeDeg: 0, assumed: true };
  return { rakeDeg: 0, assumed: true };
}

export function faultPlaneVectors(strikeDeg: number, dipDeg: number, rakeDeg: number) {
  const strike = normalize360(strikeDeg) * DEG;
  const dip = Math.max(1, Math.min(89.999, dipDeg)) * DEG;
  const rake = rakeDeg * DEG;
  const strikeVector: Vec3 = [Math.sin(strike), Math.cos(strike), 0];
  const downDip: Vec3 = [Math.cos(dip) * Math.cos(strike), -Math.cos(dip) * Math.sin(strike), -Math.sin(dip)];
  const normal: Vec3 = unit([Math.cos(strike) * Math.sin(dip), -Math.sin(strike) * Math.sin(dip), Math.cos(dip)]);
  const slip: Vec3 = unit([
    Math.cos(rake) * strikeVector[0] - Math.sin(rake) * downDip[0],
    Math.cos(rake) * strikeVector[1] - Math.sin(rake) * downDip[1],
    Math.cos(rake) * strikeVector[2] - Math.sin(rake) * downDip[2],
  ]);
  return { normal, slip };
}

export function receiverPlanesForFault(feature: ActiveFaultFeature): ReceiverPlane[] {
  const representative = representativeFaultPoint(feature);
  if (!representative) return [];
  const style = faultStyle(feature.properties.slipType);
  if (style === "unknown") return [];

  const parsedDip = parseFirstNumber(feature.properties.dip);
  const dipDeg = parsedDip !== null && parsedDip > 0 && parsedDip <= 90 ? parsedDip : inferredDip(style);
  const dipAzimuth = compassAzimuth(feature.properties.dipDirection);
  const rake = rakeForFault(feature, style);
  const baseStrike = normalize360(representative.strikeDeg);
  const candidates = dipAzimuth === null || dipDeg >= 85
    ? [baseStrike]
    : [baseStrike, normalize360(baseStrike + 180)].sort((a, b) =>
        angleDifference360(normalize360(a + 90), dipAzimuth) - angleDifference360(normalize360(b + 90), dipAzimuth));
  const strikes = dipAzimuth === null && dipDeg < 85 ? [baseStrike, normalize360(baseStrike + 180)] : [candidates[0]];

  return strikes.map((strikeDeg) => {
    const vectors = faultPlaneVectors(strikeDeg, dipDeg, rake.rakeDeg);
    const assumed = parsedDip === null || rake.assumed || dipAzimuth === null;
    const notes: string[] = [];
    if (parsedDip === null) notes.push(`dip inferido ${dipDeg.toFixed(0)}°`);
    if (rake.assumed) notes.push(`rake inferido ${rake.rakeDeg.toFixed(0)}°`);
    if (dipAzimuth === null && dipDeg < 85) notes.push("dirección de buzamiento ambigua");
    return {
      strikeDeg,
      dipDeg,
      rakeDeg: rake.rakeDeg,
      ...vectors,
      assumed,
      note: notes.length ? notes.join(" · ") : null,
    };
  });
}

export function scalarMomentFromMagnitude(mw: number) {
  return 10 ** (1.5 * mw + 9.1);
}

export function sourceMomentTensor(mechanism: SeismicMechanism): Mat3 | null {
  if (mechanism.strikeDeg === null || mechanism.dipDeg === null || mechanism.rakeDeg === null) return null;
  const { normal, slip } = faultPlaneVectors(mechanism.strikeDeg, mechanism.dipDeg, mechanism.rakeDeg);
  const rawMoment = mechanism.scalarMomentNm ?? scalarMomentFromMagnitude(mechanism.magnitude);
  const dcFraction = mechanism.percentDoubleCouple === null ? 1 : Math.max(0.1, Math.min(1, mechanism.percentDoubleCouple / 100));
  const moment = rawMoment * dcFraction;
  const tensor = zeroMatrix();
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) tensor[i][j] = moment * (slip[i] * normal[j] + normal[i] * slip[j]);
  }
  return tensor;
}

function kelvinDisplacement(r: Vec3, moment: Mat3, mu = SHEAR_MODULUS_PA, nu = POISSON_RATIO): Vec3 {
  const radius = norm(r);
  if (!Number.isFinite(radius) || radius < 1) return [0, 0, 0];
  const radius3 = radius ** 3;
  const radius5 = radius ** 5;
  const prefactor = 1 / (16 * Math.PI * mu * (1 - nu));
  const a = 3 - 4 * nu;
  const displacement: Vec3 = [0, 0, 0];

  for (let i = 0; i < 3; i += 1) {
    let sum = 0;
    for (let j = 0; j < 3; j += 1) {
      for (let k = 0; k < 3; k += 1) {
        const deltaIJ = i === j ? 1 : 0;
        const deltaIK = i === k ? 1 : 0;
        const deltaJK = j === k ? 1 : 0;
        const derivative = prefactor * (
          -a * deltaIJ * r[k] / radius3
          + (deltaIK * r[j] + r[i] * deltaJK) / radius3
          - 3 * r[i] * r[j] * r[k] / radius5
        );
        sum -= moment[j][k] * derivative;
      }
    }
    displacement[i] = sum;
  }
  return displacement;
}

function estimatedRuptureCoreKm(magnitude: number) {
  const ruptureLengthKm = 10 ** (-2.44 + 0.59 * magnitude);
  return Math.max(8, Math.min(120, ruptureLengthKm * 0.5));
}

function localOffsetMeters(source: SeismicMechanism, latitude: number, longitude: number, receiverDepthKm: number): Vec3 {
  const meanLatitude = (source.latitude + latitude) * 0.5 * DEG;
  const east = normalizeLongitude(longitude - source.longitude) * 111_320 * Math.max(0.05, Math.cos(meanLatitude));
  const north = (latitude - source.latitude) * 111_320;
  const up = (source.depthKm - receiverDepthKm) * 1000;
  return [east, north, up];
}

export function stressTensorFromMechanism(
  mechanism: SeismicMechanism,
  latitude: number,
  longitude: number,
  receiverDepthKm = DEFAULT_RECEIVER_DEPTH_KM,
): Mat3 | null {
  const moment = sourceMomentTensor(mechanism);
  if (!moment) return null;
  const raw = localOffsetMeters(mechanism, latitude, longitude, receiverDepthKm);
  const rawRadius = norm(raw);
  if (!Number.isFinite(rawRadius) || rawRadius < 100) return null;
  const coreMeters = estimatedRuptureCoreKm(mechanism.magnitude) * 1000;
  const effectiveRadius = Math.sqrt(rawRadius * rawRadius + coreMeters * coreMeters);
  const scale = effectiveRadius / rawRadius;
  const r: Vec3 = [raw[0] * scale, raw[1] * scale, raw[2] * scale];
  const step = Math.max(150, Math.min(2500, effectiveRadius * 0.002));
  const gradient = zeroMatrix();

  for (let axis = 0; axis < 3; axis += 1) {
    const plus: Vec3 = [...r] as Vec3;
    const minus: Vec3 = [...r] as Vec3;
    plus[axis] += step;
    minus[axis] -= step;
    const uPlus = kelvinDisplacement(plus, moment);
    const uMinus = kelvinDisplacement(minus, moment);
    for (let i = 0; i < 3; i += 1) gradient[i][axis] = (uPlus[i] - uMinus[i]) / (2 * step);
  }

  const strain = zeroMatrix();
  let trace = 0;
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) strain[i][j] = 0.5 * (gradient[i][j] + gradient[j][i]);
    trace += strain[i][i];
  }
  const lambda = 2 * SHEAR_MODULUS_PA * POISSON_RATIO / (1 - 2 * POISSON_RATIO);
  const stress = zeroMatrix();
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      stress[i][j] = 2 * SHEAR_MODULUS_PA * strain[i][j] + (i === j ? lambda * trace : 0);
    }
  }
  return stress;
}

export function coulombFailureStressMpa(stress: Mat3, plane: Pick<ReceiverPlane, "normal" | "slip">, friction = EFFECTIVE_FRICTION) {
  const traction: Vec3 = [
    stress[0][0] * plane.normal[0] + stress[0][1] * plane.normal[1] + stress[0][2] * plane.normal[2],
    stress[1][0] * plane.normal[0] + stress[1][1] * plane.normal[1] + stress[1][2] * plane.normal[2],
    stress[2][0] * plane.normal[0] + stress[2][1] * plane.normal[1] + stress[2][2] * plane.normal[2],
  ];
  const normalTensionPa = dot(plane.normal, traction);
  const shearInSlipDirectionPa = dot(plane.slip, traction);
  return (shearInSlipDirectionPa + friction * normalTensionPa) / 1e6;
}

export function summarizeContributions(values: number[]) {
  const positiveMpa = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const negativeMpa = values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0);
  const netMpa = positiveMpa + negativeMpa;
  const grossMpa = positiveMpa + Math.abs(negativeMpa);
  const cancellationPct = grossMpa > 1e-12 ? 100 * (1 - Math.abs(netMpa) / grossMpa) : 0;
  return { positiveMpa, negativeMpa, netMpa, grossMpa, cancellationPct: Math.max(0, Math.min(100, cancellationPct)) };
}

export function evaluateFaultStressBalance(
  feature: ActiveFaultFeature,
  mechanisms: SeismicMechanism[],
  receiverDepthKm = DEFAULT_RECEIVER_DEPTH_KM,
): FaultStressBalance | null {
  const representative = representativeFaultPoint(feature);
  const planes = receiverPlanesForFault(feature);
  if (!representative || !planes.length) return null;
  const contributions: CoulombContribution[] = [];

  for (const mechanism of mechanisms) {
    if (mechanism.strikeDeg === null || mechanism.dipDeg === null || mechanism.rakeDeg === null) continue;
    const distanceKm = haversineKm(mechanism.latitude, mechanism.longitude, representative.latitude, representative.longitude);
    if (distanceKm > MAX_SOURCE_DISTANCE_KM) continue;
    const stress = stressTensorFromMechanism(mechanism, representative.latitude, representative.longitude, receiverDepthKm);
    if (!stress) continue;
    const values = planes.map((plane) => coulombFailureStressMpa(stress, plane)).filter(Number.isFinite);
    if (!values.length) continue;
    const deltaCfsMpa = values.reduce((sum, value) => sum + value, 0) / values.length;
    if (Math.abs(deltaCfsMpa) < 1e-5) continue;
    contributions.push({
      sourceId: mechanism.id,
      sourceMagnitude: mechanism.magnitude,
      sourcePlace: mechanism.place,
      distanceKm,
      deltaCfsMpa,
    });
  }
  if (!contributions.length) return null;

  const summary = summarizeContributions(contributions.map((item) => item.deltaCfsMpa));
  const strongest = [...contributions].sort((a, b) => Math.abs(b.deltaCfsMpa) - Math.abs(a.deltaCfsMpa))[0] ?? null;
  const plane = planes[0];
  const style = faultStyle(feature.properties.slipType);
  const orientationAssumed = planes.some((item) => item.assumed) || planes.length > 1;
  const confidence: FaultStressBalance["confidence"] = planes.length > 1
    ? "low"
    : orientationAssumed
      ? "medium"
      : "high";
  const notes = [...new Set(planes.map((item) => item.note).filter((item): item is string => Boolean(item)))];

  return {
    faultId: feature.properties.id,
    faultName: feature.properties.name,
    latitude: representative.latitude,
    longitude: representative.longitude,
    strikeDeg: plane.strikeDeg,
    dipDeg: plane.dipDeg,
    rakeDeg: plane.rakeDeg,
    receiverStyle: style,
    ...summary,
    sourceCount: contributions.length,
    strongestSourceId: strongest?.sourceId ?? null,
    strongestContributionMpa: strongest?.deltaCfsMpa ?? null,
    confidence,
    orientationAssumed,
    note: notes.length ? notes.join(" · ") : null,
    contributions: contributions.sort((a, b) => Math.abs(b.deltaCfsMpa) - Math.abs(a.deltaCfsMpa)).slice(0, 5),
  };
}

function percentile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * fraction)))];
}

export function summarizeStressBalances(balances: FaultStressBalance[]): StressBalanceSummary {
  const threshold = 0.005;
  const cancellations = balances.map((item) => item.cancellationPct);
  return {
    evaluatedFaults: balances.length,
    loadedFaults: balances.filter((item) => item.netMpa >= threshold).length,
    relaxedFaults: balances.filter((item) => item.netMpa <= -threshold).length,
    nearNeutralFaults: balances.filter((item) => Math.abs(item.netMpa) < threshold).length,
    highCancellationFaults: balances.filter((item) => item.cancellationPct >= 60 && item.grossMpa >= 0.01).length,
    medianCancellationPct: percentile(cancellations, 0.5),
    maxAbsNetMpa: balances.reduce((best, item) => Math.max(best, Math.abs(item.netMpa)), 0),
  };
}

export function stressBalanceColor(balance: FaultStressBalance) {
  if (balance.confidence === "low") return "#94a3b8";
  const value = balance.netMpa;
  if (value >= 0.05) return "#991b1b";
  if (value >= 0.02) return "#dc2626";
  if (value >= 0.005) return "#fb923c";
  if (value <= -0.05) return "#1e3a8a";
  if (value <= -0.02) return "#2563eb";
  if (value <= -0.005) return "#60a5fa";
  return "#cbd5e1";
}
