export type PolePoint = { year: number; lat: number; lon: number };
export type SeismicEventPoint = { year: number; magnitude: number };

export type AnnualCouplingPoint = {
  year: number;
  countM7: number;
  sumMomentNm: number;
  maxMagnitude: number | null;
  poleLat: number | null;
  poleLon: number | null;
  poleSpeedKmYr: number | null;
  poleAccelerationKmYr2: number | null;
  jerkIntensity: number;
};

export type PredictorKey = "poleSpeedKmYr" | "poleAccelerationKmYr2" | "jerkIntensity";
export type EndpointKey = "countM7" | "logMoment";

export type LagPoint = { lagYears: number; correlation: number; n: number };
export type CouplingAnalysis = {
  predictor: PredictorKey;
  endpoint: EndpointKey;
  bestLagYears: number;
  developmentCorrelation: number;
  lagCorrectedP: number;
  baselineOosLogLikelihood: number;
  geomagOosLogLikelihood: number;
  deltaOosLogLikelihood: number;
  informationGainBitsPerYear: number;
  nDevelopment: number;
  nTest: number;
  lagProfile: LagPoint[];
  interpretation: "sin-evidencia-robusta" | "senal-in-sample" | "ganancia-oos-exploratoria" | "asociacion-retrospectiva-replicada";
  causalClaim: false;
};

export type ProspectiveCountScore = {
  year: number;
  predictor: PredictorKey;
  lagYears: number;
  exposure: number;
  observedCount: number;
  baselineExpectedToDate: number;
  geomagExpectedToDate: number | null;
  predictorAvailable: boolean;
};

export const GEOMAGNETIC_JERKS = [
  { year: 1969, weight: 1, source: "Pinheiro et al. 2011" },
  { year: 1978, weight: 1, source: "Pinheiro et al. 2011" },
  { year: 1991, weight: 1, source: "Pinheiro et al. 2011" },
  { year: 1999, weight: 1, source: "Pinheiro et al. 2011" },
  { year: 2003, weight: 1, source: "Chulliat & Maus 2014" },
  { year: 2007, weight: 1, source: "Chulliat & Maus 2014" },
  { year: 2011, weight: 0.9, source: "Chulliat & Maus 2014" },
  { year: 2014, weight: 1, source: "Torta et al. 2015" },
  { year: 2017, weight: 0.85, source: "Whaler et al. 2022 (Pacific)" },
  { year: 2024, weight: 0.65, source: "reported 2026; provisional global status" },
] as const;

const EARTH_RADIUS_KM = 6371.0088;

export function mwToMomentNm(mw: number) {
  return 10 ** (1.5 * mw + 9.05);
}

function toUnit(latDeg: number, lonDeg: number) {
  const lat = latDeg * Math.PI / 180;
  const lon = lonDeg * Math.PI / 180;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)] as const;
}

function fromUnit(v: readonly number[]) {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  const x = v[0] / n, y = v[1] / n, z = v[2] / n;
  return { lat: Math.asin(Math.max(-1, Math.min(1, z))) * 180 / Math.PI, lon: Math.atan2(y, x) * 180 / Math.PI };
}

function angularDistanceKm(a: PolePoint, b: PolePoint) {
  const ua = toUnit(a.lat, a.lon), ub = toUnit(b.lat, b.lon);
  const dot = Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1] + ua[2] * ub[2]));
  return EARTH_RADIUS_KM * Math.acos(dot);
}

export function interpolatePoleYears(points: PolePoint[], startYear: number, endYear: number) {
  const sorted = [...points].filter(p => Number.isFinite(p.year + p.lat + p.lon)).sort((a, b) => a.year - b.year);
  const result: PolePoint[] = [];
  for (let year = startYear; year <= endYear; year++) {
    const exact = sorted.find(p => p.year === year);
    if (exact) { result.push(exact); continue; }
    let left: PolePoint | undefined, right: PolePoint | undefined;
    for (const p of sorted) {
      if (p.year < year) left = p;
      if (p.year > year) { right = p; break; }
    }
    if (!left || !right) continue;
    const f = (year - left.year) / (right.year - left.year);
    const a = toUnit(left.lat, left.lon), b = toUnit(right.lat, right.lon);
    const mixed = [a[0] * (1 - f) + b[0] * f, a[1] * (1 - f) + b[1] * f, a[2] * (1 - f) + b[2] * f];
    const ll = fromUnit(mixed);
    result.push({ year, ...ll });
  }
  return result;
}

export function derivePoleKinematics(points: PolePoint[]) {
  const sorted = [...points].sort((a, b) => a.year - b.year);
  return sorted.map((p, i) => {
    if (i === 0) return { ...p, speedKmYr: null as number | null, accelerationKmYr2: null as number | null };
    const prev = sorted[i - 1];
    const dt = p.year - prev.year;
    const speed = dt > 0 ? angularDistanceKm(prev, p) / dt : null;
    if (speed === null || i < 2) return { ...p, speedKmYr: speed, accelerationKmYr2: null as number | null };
    const before = sorted[i - 2];
    const prevDt = prev.year - before.year;
    const prevSpeed = prevDt > 0 ? angularDistanceKm(before, prev) / prevDt : null;
    const acceleration = prevSpeed === null ? null : (speed - prevSpeed) / Math.max(1e-9, (dt + prevDt) / 2);
    return { ...p, speedKmYr: speed, accelerationKmYr2: acceleration };
  });
}

export function jerkIntensityAt(year: number) {
  const sigma = 1.25;
  return GEOMAGNETIC_JERKS.reduce((sum, jerk) => sum + jerk.weight * Math.exp(-0.5 * ((year - jerk.year) / sigma) ** 2), 0);
}

export function buildAnnualCoupling(poles: PolePoint[], events: SeismicEventPoint[], startYear: number, endYear: number) {
  const annualPoles = interpolatePoleYears(poles, startYear - 2, endYear);
  const kin = derivePoleKinematics(annualPoles);
  const poleMap = new Map(kin.map(p => [p.year, p]));
  const eventMap = new Map<number, SeismicEventPoint[]>();
  for (const event of events) {
    if (event.year < startYear || event.year > endYear || event.magnitude < 7 || !Number.isFinite(event.magnitude)) continue;
    const list = eventMap.get(event.year) ?? [];
    list.push(event); eventMap.set(event.year, list);
  }
  const out: AnnualCouplingPoint[] = [];
  for (let year = startYear; year <= endYear; year++) {
    const list = eventMap.get(year) ?? [];
    const p = poleMap.get(year);
    out.push({
      year,
      countM7: list.length,
      sumMomentNm: list.reduce((s, e) => s + mwToMomentNm(e.magnitude), 0),
      maxMagnitude: list.length ? Math.max(...list.map(e => e.magnitude)) : null,
      poleLat: p?.lat ?? null,
      poleLon: p?.lon ?? null,
      poleSpeedKmYr: p?.speedKmYr ?? null,
      poleAccelerationKmYr2: p?.accelerationKmYr2 ?? null,
      jerkIntensity: jerkIntensityAt(year),
    });
  }
  return out;
}

function finite(values: number[]) { return values.filter(Number.isFinite); }
function mean(values: number[]) { const v = finite(values); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; }
function sd(values: number[]) { const v = finite(values); if (v.length < 2) return 1; const m = mean(v); return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)) || 1; }

function detrend(values: number[]) {
  const n = values.length; if (n < 3) return values.map(() => 0);
  const xs = Array.from({ length: n }, (_, i) => i);
  const mx = mean(xs), my = mean(values);
  const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0) || 1;
  const slope = xs.reduce((s, x, i) => s + (x - mx) * (values[i] - my), 0) / den;
  const residuals = values.map((y, i) => y - (my + slope * (xs[i] - mx)));
  const scale = sd(residuals);
  return residuals.map(v => v / scale);
}

function pearson(a: number[], b: number[]) {
  if (a.length !== b.length || a.length < 4) return 0;
  const ma = mean(a), mb = mean(b), sa = sd(a), sb = sd(b);
  if (!sa || !sb) return 0;
  return a.reduce((s, x, i) => s + ((x - ma) / sa) * ((b[i] - mb) / sb), 0) / (a.length - 1);
}

function predictorValue(row: AnnualCouplingPoint, key: PredictorKey) { return row[key]; }
function endpointValue(row: AnnualCouplingPoint, key: EndpointKey) {
  return key === "countM7" ? row.countM7 : row.sumMomentNm > 0 ? Math.log10(row.sumMomentNm) : Number.NaN;
}

function lagCorr(x: number[], y: number[], lag: number) {
  const a: number[] = [], b: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const j = i + lag;
    if (j < 0 || j >= y.length) continue;
    a.push(x[i]); b.push(y[j]);
  }
  return { correlation: pearson(a, b), n: a.length };
}

function solveLinear(a: number[][], b: number[]) {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    if (Math.abs(m[col][col]) < 1e-10) m[col][col] += 1e-6;
    const d = m[col][col];
    for (let c = col; c <= n; c++) m[col][c] /= d;
    for (let r = 0; r < n; r++) if (r !== col) {
      const f = m[r][col]; for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map(row => row[n]);
}

function weightedLeastSquares(x: number[][], z: number[], w: number[]) {
  const p = x[0]?.length ?? 0;
  const a = Array.from({ length: p }, () => Array(p).fill(0));
  const b = Array(p).fill(0);
  for (let i = 0; i < x.length; i++) for (let r = 0; r < p; r++) {
    b[r] += w[i] * x[i][r] * z[i];
    for (let c = 0; c < p; c++) a[r][c] += w[i] * x[i][r] * x[i][c];
  }
  for (let i = 0; i < p; i++) a[i][i] += 1e-6;
  return solveLinear(a, b);
}

function fitPoisson(x: number[][], y: number[]) {
  let beta = Array(x[0]?.length ?? 0).fill(0);
  if (!beta.length) return beta;
  beta[0] = Math.log(Math.max(0.1, mean(y)));
  for (let iter = 0; iter < 35; iter++) {
    const eta = x.map(row => Math.max(-15, Math.min(15, row.reduce((s, v, j) => s + v * beta[j], 0))));
    const mu = eta.map(Math.exp);
    const z = eta.map((e, i) => e + (y[i] - mu[i]) / Math.max(mu[i], 1e-8));
    const next = weightedLeastSquares(x, z, mu);
    const delta = Math.max(...next.map((v, i) => Math.abs(v - beta[i])));
    beta = next; if (delta < 1e-7) break;
  }
  return beta;
}

function logFactorial(n: number) { let s = 0; for (let i = 2; i <= Math.max(0, Math.round(n)); i++) s += Math.log(i); return s; }
function poissonLL(x: number[][], y: number[], beta: number[]) {
  return x.reduce((s, row, i) => {
    const eta = Math.max(-15, Math.min(15, row.reduce((v, q, j) => v + q * beta[j], 0)));
    const mu = Math.exp(eta); return s + y[i] * eta - mu - logFactorial(y[i]);
  }, 0);
}

function fitOls(x: number[][], y: number[]) { return weightedLeastSquares(x, y, x.map(() => 1)); }
function gaussianLL(x: number[][], y: number[], beta: number[], variance: number) {
  const v = Math.max(1e-6, variance);
  return x.reduce((s, row, i) => { const mu = row.reduce((q, z, j) => q + z * beta[j], 0); return s - 0.5 * (Math.log(2 * Math.PI * v) + (y[i] - mu) ** 2 / v); }, 0);
}

function modelRows(annual: AnnualCouplingPoint[], predictor: PredictorKey, endpoint: EndpointKey, lag: number) {
  const byYear = new Map(annual.map(r => [r.year, r]));
  const rows: { year: number; y: number; prev: number; x: number }[] = [];
  for (const row of annual) {
    const pred = byYear.get(row.year - lag);
    const prev = byYear.get(row.year - 1);
    if (!pred || !prev) continue;
    const x = predictorValue(pred, predictor), y = endpointValue(row, endpoint), p = endpointValue(prev, endpoint);
    if (typeof x !== "number" || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(p)) continue;
    rows.push({ year: row.year, y, prev: p, x });
  }
  return rows;
}

function scoreOos(rows: ReturnType<typeof modelRows>, endpoint: EndpointKey, splitYear = 1990) {
  const train = rows.filter(r => r.year < splitYear), test = rows.filter(r => r.year >= splitYear);
  if (train.length < 25 || test.length < 10) return { base: 0, mag: 0, nTrain: train.length, nTest: test.length };
  const yearMean = mean(train.map(r => r.year)), yearSd = sd(train.map(r => r.year));
  const xMean = mean(train.map(r => r.x)), xSd = sd(train.map(r => r.x));
  const make = (r: typeof train[number], magnetic: boolean) => {
    const core = [1, (r.year - yearMean) / yearSd, endpoint === "countM7" ? Math.log1p(r.prev) : r.prev];
    return magnetic ? [...core, (r.x - xMean) / xSd] : core;
  };
  const xb = train.map(r => make(r, false)), xm = train.map(r => make(r, true));
  const tb = test.map(r => make(r, false)), tm = test.map(r => make(r, true));
  const yt = train.map(r => r.y), yv = test.map(r => r.y);
  if (endpoint === "countM7") {
    const bb = fitPoisson(xb, yt), bm = fitPoisson(xm, yt);
    return { base: poissonLL(tb, yv, bb), mag: poissonLL(tm, yv, bm), nTrain: train.length, nTest: test.length };
  }
  const bb = fitOls(xb, yt), bm = fitOls(xm, yt);
  const residual = yt.map((y, i) => y - xb[i].reduce((s, v, j) => s + v * bb[j], 0));
  const variance = residual.reduce((s, r) => s + r * r, 0) / Math.max(1, residual.length - bb.length);
  return { base: gaussianLL(tb, yv, bb, variance), mag: gaussianLL(tm, yv, bm, variance), nTrain: train.length, nTest: test.length };
}

export function analyzeCoupling(annual: AnnualCouplingPoint[], predictor: PredictorKey, endpoint: EndpointKey, developmentEnd = 1989, testStart = 1990): CouplingAnalysis | null {
  const dev = annual.filter(r => r.year <= developmentEnd && Number.isFinite(Number(predictorValue(r, predictor))) && Number.isFinite(endpointValue(r, endpoint)));
  if (dev.length < 35) return null;
  const x = detrend(dev.map(r => Number(predictorValue(r, predictor))));
  const y = detrend(dev.map(r => endpointValue(r, endpoint)));
  const lagProfile: LagPoint[] = [];
  for (let lag = -20; lag <= 20; lag++) { const q = lagCorr(x, y, lag); lagProfile.push({ lagYears: lag, ...q }); }
  const best = lagProfile.reduce((a, b) => Math.abs(b.correlation) > Math.abs(a.correlation) ? b : a);
  let extreme = 0, permutations = 0;
  for (let shift = 2; shift < x.length - 1; shift++) {
    const shifted = x.map((_, i) => x[(i + shift) % x.length]);
    let maxAbs = 0;
    for (let lag = -20; lag <= 20; lag++) maxAbs = Math.max(maxAbs, Math.abs(lagCorr(shifted, y, lag).correlation));
    if (maxAbs >= Math.abs(best.correlation) - 1e-12) extreme++;
    permutations++;
  }
  const correctedP = (extreme + 1) / (permutations + 1);
  const rows = modelRows(annual.filter(r => r.year <= 2025), predictor, endpoint, best.lagYears);
  const scored = scoreOos(rows, endpoint, testStart);
  const delta = scored.mag - scored.base;
  const ig = scored.nTest ? delta / (scored.nTest * Math.log(2)) : 0;
  let interpretation: CouplingAnalysis["interpretation"] = "sin-evidencia-robusta";
  if (correctedP < 0.05 && delta > 0 && scored.nTest >= 10) interpretation = "asociacion-retrospectiva-replicada";
  else if (correctedP < 0.05) interpretation = "senal-in-sample";
  else if (delta > 0 && scored.nTest >= 10) interpretation = "ganancia-oos-exploratoria";
  return {
    predictor, endpoint, bestLagYears: best.lagYears, developmentCorrelation: best.correlation, lagCorrectedP: correctedP,
    baselineOosLogLikelihood: scored.base, geomagOosLogLikelihood: scored.mag, deltaOosLogLikelihood: delta,
    informationGainBitsPerYear: ig, nDevelopment: scored.nTrain, nTest: scored.nTest, lagProfile, interpretation, causalClaim: false,
  };
}

export function prospectiveCountScore(annual: AnnualCouplingPoint[], predictor: PredictorKey, lag: number, year: number, exposure: number): ProspectiveCountScore | null {
  const history = annual.filter(r => r.year < year);
  const rows = modelRows(history, predictor, "countM7", lag);
  const current = annual.find(r => r.year === year), prev = annual.find(r => r.year === year - 1), source = annual.find(r => r.year === year - lag);
  if (!current || !prev || rows.length < 30) return null;
  const train = rows;
  const yearMean = mean(train.map(r => r.year)), yearSd = sd(train.map(r => r.year));
  const xMean = mean(train.map(r => r.x)), xSd = sd(train.map(r => r.x));
  const baseX = train.map(r => [1, (r.year - yearMean) / yearSd, Math.log1p(r.prev)]);
  const magX = train.map(r => [...[1, (r.year - yearMean) / yearSd, Math.log1p(r.prev)], (r.x - xMean) / xSd]);
  const y = train.map(r => r.y);
  const bb = fitPoisson(baseX, y), bm = fitPoisson(magX, y);
  const t = (year - yearMean) / yearSd;
  const bx = [1, t, Math.log1p(prev.countM7)];
  const etaB = bx.reduce((s, v, i) => s + v * bb[i], 0);
  const rawX = source ? predictorValue(source, predictor) : null;
  const predictorAvailable = typeof rawX === "number" && Number.isFinite(rawX);
  const mx = predictorAvailable ? [...bx, (Number(rawX) - xMean) / xSd] : null;
  const etaM = mx ? mx.reduce((s, v, i) => s + v * bm[i], 0) : null;
  return {
    year, predictor, lagYears: lag, exposure: Math.max(0, Math.min(1, exposure)), observedCount: current.countM7,
    baselineExpectedToDate: Math.exp(Math.max(-15, Math.min(15, etaB))) * exposure,
    geomagExpectedToDate: etaM === null ? null : Math.exp(Math.max(-15, Math.min(15, etaM))) * exposure,
    predictorAvailable,
  };
}
