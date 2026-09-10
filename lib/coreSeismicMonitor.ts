export type BgsMonthlyPoint = {
  decimalYear: number;
  xNt: number;
  yNt: number;
  zNt: number;
};

export type StationSecularAcceleration = {
  year: number;
  valueNtYr2: number;
};

export type SecularAccelerationYear = {
  year: number;
  valueNtYr2: number;
  stationCount: number;
};

export type SeismicEventPoint = {
  lat?: number;
  lon?: number;
  timeUtc?: string;
  year: number;
  magnitude: number;
};

export type CoreSeismicAnnualPoint = {
  year: number;
  countM7: number;
  secularAccelerationNtYr2: number | null;
  saStationCount: number;
  jerkIntensity: number;
  isJerkYear: boolean;
};

export type CoreSeismicPredictor = "secularAccelerationNtYr2" | "jerkIntensity";

export type CoreSeismicAnalysis = {
  predictor: CoreSeismicPredictor;
  throughYear: number;
  bestLagYears: number;
  developmentCorrelation: number;
  lagCorrectedP: number;
  baselineOosLogLikelihood: number;
  geomagOosLogLikelihood: number;
  deltaOosLogLikelihood: number;
  informationGainBitsPerYear: number;
  nDevelopment: number;
  nTest: number;
  splitYear: number;
  interpretation: "sin-evidencia-robusta" | "senal-in-sample" | "ganancia-oos-exploratoria" | "asociacion-retrospectiva-replicada";
  lagProfile: Array<{ lagYears: number; correlation: number; n: number }>;
  causalClaim: false;
};

export const GEOMAGNETIC_JERKS = [
  { year: 1969, weight: 1.00, source: "Pinheiro et al. 2011" },
  { year: 1978, weight: 1.00, source: "Pinheiro et al. 2011" },
  { year: 1991, weight: 1.00, source: "Pinheiro et al. 2011" },
  { year: 1999, weight: 1.00, source: "Pinheiro et al. 2011" },
  { year: 2003, weight: 1.00, source: "Chulliat & Maus 2014" },
  { year: 2007, weight: 1.00, source: "Chulliat & Maus 2014" },
  { year: 2011, weight: 0.90, source: "Chulliat & Maus 2014" },
  { year: 2014, weight: 1.00, source: "Torta et al. 2015" },
  { year: 2017, weight: 0.85, source: "Whaler et al. 2022 (Pacific)" },
  { year: 2024, weight: 0.65, source: "reported 2026; provisional global status" },
] as const;

function finite(values: number[]) {
  return values.filter(Number.isFinite);
}

function mean(values: number[]) {
  const v = finite(values);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}

function median(values: number[]) {
  const v = finite(values).sort((a, b) => a - b);
  if (!v.length) return Number.NaN;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function sd(values: number[]) {
  const v = finite(values);
  if (v.length < 2) return 1;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)) || 1;
}

export function parseBgsMonthlyMeansText(text: string): BgsMonthlyPoint[] {
  const points: BgsMonthlyPoint[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("|") || line.startsWith("%")) continue;
    const tokens = line.split(/[\s,;]+/).filter(Boolean);
    if (tokens.length < 4) continue;
    const decimalYear = Number(tokens[0]);
    if (!Number.isFinite(decimalYear) || decimalYear < 1800 || decimalYear > 2100) continue;
    const numeric: number[] = [];
    for (const token of tokens.slice(1)) {
      const value = Number(token);
      if (Number.isFinite(value)) numeric.push(value);
      if (numeric.length >= 3) break;
    }
    if (numeric.length < 3) continue;
    const [xNt, yNt, zNt] = numeric;
    if ([xNt, yNt, zNt].some(value => Math.abs(value) >= 99990)) continue;
    points.push({ decimalYear, xNt, yNt, zNt });
  }
  const seen = new Set<string>();
  return points
    .sort((a, b) => a.decimalYear - b.decimalYear)
    .filter(point => {
      const key = point.decimalYear.toFixed(4);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function deriveStationSecularAcceleration(points: BgsMonthlyPoint[]): StationSecularAcceleration[] {
  const byYear = new Map<number, BgsMonthlyPoint[]>();
  for (const point of points) {
    const year = Math.floor(point.decimalYear);
    const list = byYear.get(year) ?? [];
    list.push(point);
    byYear.set(year, list);
  }
  const annual = new Map<number, { x: number; y: number; z: number }>();
  for (const [year, list] of byYear) {
    if (list.length < 10) continue;
    annual.set(year, {
      x: mean(list.map(p => p.xNt)),
      y: mean(list.map(p => p.yNt)),
      z: mean(list.map(p => p.zNt)),
    });
  }
  const years = [...annual.keys()].sort((a, b) => a - b);
  const result: StationSecularAcceleration[] = [];
  for (const year of years) {
    const current = annual.get(year);
    if (!current) continue;
    const prev = annual.get(year - 1);
    const next = annual.get(year + 1);
    const prev2 = annual.get(year - 2);
    let ax: number | null = null, ay: number | null = null, az: number | null = null;
    if (prev && next) {
      ax = next.x - 2 * current.x + prev.x;
      ay = next.y - 2 * current.y + prev.y;
      az = next.z - 2 * current.z + prev.z;
    } else if (prev && prev2) {
      ax = current.x - 2 * prev.x + prev2.x;
      ay = current.y - 2 * prev.y + prev2.y;
      az = current.z - 2 * prev.z + prev2.z;
    }
    if (ax === null || ay === null || az === null) continue;
    result.push({ year, valueNtYr2: Math.hypot(ax, ay, az) });
  }
  return result;
}

export function combineStationSecularAcceleration(series: StationSecularAcceleration[][], minStations = 2): SecularAccelerationYear[] {
  const byYear = new Map<number, number[]>();
  for (const station of series) {
    for (const point of station) {
      const list = byYear.get(point.year) ?? [];
      list.push(point.valueNtYr2);
      byYear.set(point.year, list);
    }
  }
  return [...byYear.entries()]
    .filter(([, values]) => values.length >= minStations)
    .map(([year, values]) => ({ year, valueNtYr2: median(values), stationCount: values.length }))
    .filter(point => Number.isFinite(point.valueNtYr2))
    .sort((a, b) => a.year - b.year);
}

export function jerkIntensityAt(year: number) {
  const sigmaYears = 1.25;
  return GEOMAGNETIC_JERKS.reduce(
    (sum, jerk) => sum + jerk.weight * Math.exp(-0.5 * ((year - jerk.year) / sigmaYears) ** 2),
    0,
  );
}

export function buildAnnualCoreSeismic(
  events: SeismicEventPoint[],
  secularAcceleration: SecularAccelerationYear[],
  startYear: number,
  endYear: number,
): CoreSeismicAnnualPoint[] {
  const eventCounts = new Map<number, number>();
  for (const event of events) {
    if (!Number.isFinite(event.year + event.magnitude) || event.magnitude < 7 || event.year < startYear || event.year > endYear) continue;
    eventCounts.set(event.year, (eventCounts.get(event.year) ?? 0) + 1);
  }
  const sa = new Map(secularAcceleration.map(point => [point.year, point]));
  const jerkYears = new Set(GEOMAGNETIC_JERKS.map(jerk => jerk.year));
  const rows: CoreSeismicAnnualPoint[] = [];
  for (let year = startYear; year <= endYear; year++) {
    const saPoint = sa.get(year);
    rows.push({
      year,
      countM7: eventCounts.get(year) ?? 0,
      secularAccelerationNtYr2: saPoint?.valueNtYr2 ?? null,
      saStationCount: saPoint?.stationCount ?? 0,
      jerkIntensity: jerkIntensityAt(year),
      isJerkYear: jerkYears.has(year as typeof GEOMAGNETIC_JERKS[number]["year"]),
    });
  }
  return rows;
}

function predictorValue(row: CoreSeismicAnnualPoint, predictor: CoreSeismicPredictor) {
  return predictor === "secularAccelerationNtYr2" ? row.secularAccelerationNtYr2 : row.jerkIntensity;
}

function detrend(values: number[]) {
  const n = values.length;
  if (n < 3) return values.map(() => 0);
  const xs = Array.from({ length: n }, (_, i) => i);
  const mx = mean(xs), my = mean(values);
  const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0) || 1;
  const slope = xs.reduce((s, x, i) => s + (x - mx) * (values[i] - my), 0) / den;
  const residuals = values.map((y, i) => y - (my + slope * (xs[i] - mx)));
  const scale = sd(residuals);
  return residuals.map(value => value / scale);
}

function pearson(a: number[], b: number[]) {
  if (a.length !== b.length || a.length < 4) return 0;
  const ma = mean(a), mb = mean(b), sa = sd(a), sb = sd(b);
  return a.reduce((sum, value, index) => sum + ((value - ma) / sa) * ((b[index] - mb) / sb), 0) / (a.length - 1);
}

function lagCorrelation(x: number[], y: number[], lag: number) {
  const a: number[] = [], b: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const j = i + lag;
    if (j < 0 || j >= y.length) continue;
    a.push(x[i]);
    b.push(y[j]);
  }
  return { correlation: pearson(a, b), n: a.length };
}

function solveLinear(a: number[][], b: number[]) {
  const n = b.length;
  const matrix = a.map((row, index) => [...row, b[index]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    if (Math.abs(matrix[col][col]) < 1e-10) matrix[col][col] += 1e-6;
    const divisor = matrix[col][col];
    for (let c = col; c <= n; c++) matrix[col][c] /= divisor;
    for (let row = 0; row < n; row++) if (row !== col) {
      const factor = matrix[row][col];
      for (let c = col; c <= n; c++) matrix[row][c] -= factor * matrix[col][c];
    }
  }
  return matrix.map(row => row[n]);
}

function weightedLeastSquares(x: number[][], z: number[], w: number[]) {
  const p = x[0]?.length ?? 0;
  const a = Array.from({ length: p }, () => Array(p).fill(0));
  const b = Array(p).fill(0);
  for (let i = 0; i < x.length; i++) {
    for (let r = 0; r < p; r++) {
      b[r] += w[i] * x[i][r] * z[i];
      for (let c = 0; c < p; c++) a[r][c] += w[i] * x[i][r] * x[i][c];
    }
  }
  for (let i = 0; i < p; i++) a[i][i] += 1e-6;
  return solveLinear(a, b);
}

function fitPoisson(x: number[][], y: number[]) {
  let beta = Array(x[0]?.length ?? 0).fill(0);
  if (!beta.length) return beta;
  beta[0] = Math.log(Math.max(0.1, mean(y)));
  for (let iteration = 0; iteration < 35; iteration++) {
    const eta = x.map(row => Math.max(-15, Math.min(15, row.reduce((sum, value, j) => sum + value * beta[j], 0))));
    const mu = eta.map(Math.exp);
    const z = eta.map((value, i) => value + (y[i] - mu[i]) / Math.max(mu[i], 1e-8));
    const next = weightedLeastSquares(x, z, mu);
    const delta = Math.max(...next.map((value, i) => Math.abs(value - beta[i])));
    beta = next;
    if (delta < 1e-7) break;
  }
  return beta;
}

function logFactorial(n: number) {
  let sum = 0;
  for (let i = 2; i <= Math.max(0, Math.round(n)); i++) sum += Math.log(i);
  return sum;
}

function poissonLogLikelihood(x: number[][], y: number[], beta: number[]) {
  return x.reduce((sum, row, i) => {
    const eta = Math.max(-15, Math.min(15, row.reduce((value, item, j) => value + item * beta[j], 0)));
    const mu = Math.exp(eta);
    return sum + y[i] * eta - mu - logFactorial(y[i]);
  }, 0);
}

function buildLaggedRows(annual: CoreSeismicAnnualPoint[], predictor: CoreSeismicPredictor, lag: number) {
  const byYear = new Map(annual.map(row => [row.year, row]));
  const rows: Array<{ year: number; count: number; previousCount: number; predictor: number }> = [];
  for (const row of annual) {
    const source = byYear.get(row.year - lag);
    const previous = byYear.get(row.year - 1);
    if (!source || !previous) continue;
    const value = predictorValue(source, predictor);
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    rows.push({ year: row.year, count: row.countM7, previousCount: previous.countM7, predictor: value });
  }
  return rows;
}

function scoreChronologicalOos(rows: ReturnType<typeof buildLaggedRows>, splitYear: number) {
  const train = rows.filter(row => row.year < splitYear);
  const test = rows.filter(row => row.year >= splitYear);
  if (train.length < 25 || test.length < 10) return { base: 0, magnetic: 0, nTrain: train.length, nTest: test.length };
  const yearMean = mean(train.map(row => row.year));
  const yearSd = sd(train.map(row => row.year));
  const predictorMean = mean(train.map(row => row.predictor));
  const predictorSd = sd(train.map(row => row.predictor));
  const design = (row: typeof train[number], magnetic: boolean) => {
    const base = [1, (row.year - yearMean) / yearSd, Math.log1p(row.previousCount)];
    return magnetic ? [...base, (row.predictor - predictorMean) / predictorSd] : base;
  };
  const xb = train.map(row => design(row, false));
  const xm = train.map(row => design(row, true));
  const tb = test.map(row => design(row, false));
  const tm = test.map(row => design(row, true));
  const yTrain = train.map(row => row.count);
  const yTest = test.map(row => row.count);
  const betaBase = fitPoisson(xb, yTrain);
  const betaMagnetic = fitPoisson(xm, yTrain);
  return {
    base: poissonLogLikelihood(tb, yTest, betaBase),
    magnetic: poissonLogLikelihood(tm, yTest, betaMagnetic),
    nTrain: train.length,
    nTest: test.length,
  };
}

export function analyzeHistoricalAssociation(
  annual: CoreSeismicAnnualPoint[],
  predictor: CoreSeismicPredictor,
  throughYear: number,
): CoreSeismicAnalysis | null {
  const available = annual.filter(row => {
    const value = predictorValue(row, predictor);
    return row.year <= throughYear && typeof value === "number" && Number.isFinite(value);
  });
  if (available.length < 50) return null;
  const splitIndex = Math.max(30, Math.min(available.length - 12, Math.floor(available.length * 0.7)));
  const splitYear = available[splitIndex]?.year ?? throughYear;
  const development = available.filter(row => row.year < splitYear);
  if (development.length < 35) return null;
  const x = detrend(development.map(row => Number(predictorValue(row, predictor))));
  const y = detrend(development.map(row => row.countM7));
  const lagProfile = Array.from({ length: 41 }, (_, index) => {
    const lagYears = index - 20;
    return { lagYears, ...lagCorrelation(x, y, lagYears) };
  });
  const best = lagProfile.reduce((a, b) => Math.abs(b.correlation) > Math.abs(a.correlation) ? b : a);
  let extreme = 0, permutations = 0;
  for (let shift = 2; shift < x.length - 1; shift++) {
    const shifted = x.map((_, index) => x[(index + shift) % x.length]);
    let maxAbs = 0;
    for (let lag = -20; lag <= 20; lag++) maxAbs = Math.max(maxAbs, Math.abs(lagCorrelation(shifted, y, lag).correlation));
    if (maxAbs >= Math.abs(best.correlation) - 1e-12) extreme++;
    permutations++;
  }
  const lagCorrectedP = (extreme + 1) / (permutations + 1);
  const rows = buildLaggedRows(available, predictor, best.lagYears);
  const scored = scoreChronologicalOos(rows, splitYear);
  const delta = scored.magnetic - scored.base;
  const informationGainBitsPerYear = scored.nTest ? delta / (scored.nTest * Math.log(2)) : 0;
  let interpretation: CoreSeismicAnalysis["interpretation"] = "sin-evidencia-robusta";
  if (lagCorrectedP < 0.05 && delta > 0 && scored.nTest >= 10) interpretation = "asociacion-retrospectiva-replicada";
  else if (lagCorrectedP < 0.05) interpretation = "senal-in-sample";
  else if (delta > 0 && scored.nTest >= 10) interpretation = "ganancia-oos-exploratoria";
  return {
    predictor,
    throughYear,
    bestLagYears: best.lagYears,
    developmentCorrelation: best.correlation,
    lagCorrectedP,
    baselineOosLogLikelihood: scored.base,
    geomagOosLogLikelihood: scored.magnetic,
    deltaOosLogLikelihood: delta,
    informationGainBitsPerYear,
    nDevelopment: scored.nTrain,
    nTest: scored.nTest,
    splitYear,
    interpretation,
    lagProfile,
    causalClaim: false,
  };
}
