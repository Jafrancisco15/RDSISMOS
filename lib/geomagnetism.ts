export interface MagneticSample {
  timeUtc: string;
  x: number;
  y: number;
  z: number;
  f: number | null;
}

export interface MagneticStationSeries {
  code: string;
  datasetId: string;
  samples: MagneticSample[];
}

export interface KpSample {
  timeUtc: string;
  value: number;
}

export interface MagneticAnomalyPoint {
  timeUtc: string;
  residualNt: number;
  robustZ: number;
  dBdtNtPerMin: number;
  zhProxy: number;
}

export interface MagneticLocalityMetrics {
  localityScore: number;
  maxRobustZ: number;
  p95RobustZ: number;
  anomalyFraction: number;
  maxResidualNt: number;
  maxDbDtNtPerMin: number;
  maxZhProxy: number;
  commonModeCorrelation: number;
  maxKp: number | null;
  meanKp: number | null;
  kpPenalty: number;
  alignedSamples: number;
  referenceCount: number;
  anomalies: MagneticAnomalyPoint[];
  plot: MagneticAnomalyPoint[];
}

function finite(values: number[]) {
  return values.filter(Number.isFinite);
}

export function median(values: number[]) {
  const source = finite(values).sort((a, b) => a - b);
  if (!source.length) return 0;
  const middle = Math.floor(source.length / 2);
  return source.length % 2 ? source[middle] : (source[middle - 1] + source[middle]) / 2;
}

export function percentile(values: number[], p: number) {
  const source = finite(values).sort((a, b) => a - b);
  if (!source.length) return 0;
  const index = Math.max(0, Math.min(source.length - 1, (source.length - 1) * p));
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return source[lo];
  const mix = index - lo;
  return source[lo] * (1 - mix) + source[hi] * mix;
}

export function mad(values: number[]) {
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

export function pearson(a: number[], b: number[]) {
  const length = Math.min(a.length, b.length);
  if (length < 3) return 0;
  const x = a.slice(0, length);
  const y = b.slice(0, length);
  const mx = x.reduce((sum, value) => sum + value, 0) / length;
  const my = y.reduce((sum, value) => sum + value, 0) / length;
  let numerator = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < length; i += 1) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    numerator += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denominator = Math.sqrt(dx2 * dy2);
  return denominator > 0 ? numerator / denominator : 0;
}

function centers(series: MagneticSample[]) {
  return {
    x: median(series.map((sample) => sample.x)),
    y: median(series.map((sample) => sample.y)),
    z: median(series.map((sample) => sample.z)),
  };
}

function kpPenalty(maxKp: number | null) {
  if (maxKp === null) return 0.86;
  if (maxKp < 4) return 1;
  if (maxKp < 5) return 0.78;
  if (maxKp < 6) return 0.55;
  return 0.3;
}

function downsample<T>(values: T[], maxPoints: number) {
  if (values.length <= maxPoints) return values;
  const step = values.length / maxPoints;
  const out: T[] = [];
  for (let index = 0; index < maxPoints; index += 1) out.push(values[Math.floor(index * step)]);
  return out;
}

export function analyzeMagneticLocality(
  target: MagneticStationSeries,
  references: MagneticStationSeries[],
  kp: KpSample[] = [],
): MagneticLocalityMetrics {
  if (!target.samples.length) throw new Error("La estación objetivo no tiene datos.");
  if (!references.length) throw new Error("Selecciona al menos una estación de referencia.");

  const targetCenter = centers(target.samples);
  const refCenters = new Map(references.map((series) => [series.code, centers(series.samples)]));
  const refMaps = references.map((series) => ({
    series,
    byTime: new Map(series.samples.map((sample) => [sample.timeUtc, sample])),
  }));

  const targetX: number[] = [];
  const targetY: number[] = [];
  const targetZ: number[] = [];
  const commonX: number[] = [];
  const commonY: number[] = [];
  const commonZ: number[] = [];
  const rows: Array<{ timeUtc: string; rx: number; ry: number; rz: number; residual: number }> = [];

  for (const sample of target.samples) {
    const matches = refMaps
      .map(({ series, byTime }) => {
        const ref = byTime.get(sample.timeUtc);
        const center = refCenters.get(series.code);
        if (!ref || !center) return null;
        return { x: ref.x - center.x, y: ref.y - center.y, z: ref.z - center.z };
      })
      .filter((value): value is { x: number; y: number; z: number } => Boolean(value));
    if (!matches.length) continue;

    const tx = sample.x - targetCenter.x;
    const ty = sample.y - targetCenter.y;
    const tz = sample.z - targetCenter.z;
    const cx = median(matches.map((match) => match.x));
    const cy = median(matches.map((match) => match.y));
    const cz = median(matches.map((match) => match.z));
    const rx = tx - cx;
    const ry = ty - cy;
    const rz = tz - cz;
    rows.push({ timeUtc: sample.timeUtc, rx, ry, rz, residual: Math.hypot(rx, ry, rz) });
    targetX.push(tx); targetY.push(ty); targetZ.push(tz);
    commonX.push(cx); commonY.push(cy); commonZ.push(cz);
  }

  if (rows.length < 30) throw new Error("No hay suficientes minutos coincidentes entre la estación objetivo y las referencias.");

  const residuals = rows.map((row) => row.residual);
  const residualCenter = median(residuals);
  const robustSigma = Math.max(0.05, 1.4826 * mad(residuals));
  const points: MagneticAnomalyPoint[] = [];
  let previous: typeof rows[number] | null = null;

  for (const row of rows) {
    const robustZ = (row.residual - residualCenter) / robustSigma;
    let dBdtNtPerMin = 0;
    if (previous) {
      const minutes = Math.max(1 / 60, (Date.parse(row.timeUtc) - Date.parse(previous.timeUtc)) / 60_000);
      dBdtNtPerMin = Math.hypot(row.rx - previous.rx, row.ry - previous.ry, row.rz - previous.rz) / minutes;
    }
    const horizontal = Math.hypot(row.rx, row.ry);
    const zhProxy = Math.abs(row.rz) / Math.max(0.5, horizontal);
    points.push({ timeUtc: row.timeUtc, residualNt: row.residual, robustZ, dBdtNtPerMin, zhProxy });
    previous = row;
  }

  const absCorrelations = [pearson(targetX, commonX), pearson(targetY, commonY), pearson(targetZ, commonZ)].map(Math.abs);
  const commonModeCorrelation = Math.max(0, Math.min(1, absCorrelations.reduce((sum, value) => sum + value, 0) / absCorrelations.length));
  const positiveZ = points.map((point) => Math.max(0, point.robustZ));
  const maxRobustZ = Math.max(...positiveZ);
  const p95RobustZ = percentile(positiveZ, 0.95);
  const anomalyFraction = points.filter((point) => point.robustZ >= 3).length / points.length;
  const maxResidualNt = Math.max(...points.map((point) => point.residualNt));
  const maxDbDtNtPerMin = Math.max(...points.map((point) => point.dBdtNtPerMin));
  const maxZhProxy = Math.max(...points.map((point) => point.zhProxy));
  const kpValues = finite(kp.map((sample) => sample.value));
  const maxKp = kpValues.length ? Math.max(...kpValues) : null;
  const meanKp = kpValues.length ? kpValues.reduce((sum, value) => sum + value, 0) / kpValues.length : null;
  const penalty = kpPenalty(maxKp);

  const zSignal = 1 - Math.exp(-Math.max(0, p95RobustZ - 1) / 3);
  const persistence = 1 - Math.exp(-anomalyFraction * 18);
  const locality = Math.max(0, 1 - commonModeCorrelation);
  const gradient = 1 - Math.exp(-maxDbDtNtPerMin / 8);
  const verticality = 1 - Math.exp(-Math.min(8, maxZhProxy) / 2.5);
  const raw = 100 * (0.34 * zSignal + 0.22 * persistence + 0.24 * locality + 0.12 * gradient + 0.08 * verticality);
  const localityScore = Math.round(Math.max(0, Math.min(100, raw * penalty)));

  const anomalies = points
    .filter((point) => point.robustZ >= 3)
    .sort((a, b) => b.robustZ - a.robustZ)
    .slice(0, 12);

  return {
    localityScore,
    maxRobustZ,
    p95RobustZ,
    anomalyFraction,
    maxResidualNt,
    maxDbDtNtPerMin,
    maxZhProxy,
    commonModeCorrelation,
    maxKp,
    meanKp,
    kpPenalty: penalty,
    alignedSamples: points.length,
    referenceCount: references.length,
    anomalies,
    plot: downsample(points, 1600),
  };
}
