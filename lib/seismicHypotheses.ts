import { haversineKm } from "./regions";

const DAY_MS = 86_400_000;
const YEAR_DAYS = 365.25;

export type HypothesisVerdict = "supported" | "not-supported" | "inconclusive";

export type HypothesisCatalogEvent = {
  id: string;
  timeUtc: string;
  latitude: number;
  longitude: number;
  depthKm: number;
  magnitude: number;
  place: string;
  plateId?: string;
  plateName?: string;
};

export type CatalogWindow = {
  anchor: HypothesisCatalogEvent;
  events: HypothesisCatalogEvent[];
  kind: "trigger" | "random-date";
};

export type RateTest = {
  postCount: number;
  controlCount: number;
  postRatePerDay: number;
  controlRatePerDay: number;
  rateRatio: number;
  effectPercent: number;
  ci95: [number, number];
  z: number;
  pValue: number;
};

export type DynamicTriggeringResult = {
  status: "ready" | "partial" | "insufficient";
  verdict: HypothesisVerdict;
  conclusion: string;
  configuration: {
    triggerMagnitude: number;
    responseMagnitude: number;
    sensitivityMagnitude: number;
    minimumDistanceKm: number;
    surfaceWaveVelocityKmS: number;
    windowDays: number;
    bootstrapIterations: number;
    regionalGrid: string;
  };
  candidateTriggerCount: number;
  analyzedTriggerCount: number;
  randomDateCount: number;
  observed: RateTest;
  sensitivity: RateTest;
  bootstrap: {
    empiricalPValue: number;
    falsePositiveRate: number;
    observedClusterCi95: [number, number];
    iterations: number;
  };
  relativeRate: Array<{
    startDay: number;
    endDay: number;
    midpointDay: number;
    count: number;
    ratePerTriggerDay: number;
  }>;
  regions: Array<{
    id: string;
    label: string;
    centerLatitude: number;
    centerLongitude: number;
    triggerExposure: number;
    postCount: number;
    controlCount: number;
    rateRatio: number;
    ci95: [number, number];
    pValue: number;
    qValue: number;
    significant: boolean;
  }>;
  significantRegionCount: number;
  triggerRows: Array<{
    id: string;
    timeUtc: string;
    magnitude: number;
    place: string;
    remotePostCount: number;
    remoteControlCount: number;
    rateRatio: number;
  }>;
  limitations: string[];
};

export type IntraplateRelaxationResult = {
  status: "ready" | "partial" | "insufficient";
  verdict: HypothesisVerdict;
  conclusion: string;
  configuration: {
    minimumMagnitude: number;
    minimumDistanceKm: number;
    minimumDelayDays: number;
    maximumDelayYears: number;
    monteCarloIterations: number;
    staticStressThresholdKPa: number;
    rigidityGPa: number;
    plateModel: string;
    nullModel: string;
  };
  catalogEventCount: number;
  assignedEventCount: number;
  assignmentRate: number;
  plateCount: number;
  spatialCellCount: number;
  spatialPairsConsidered: number;
  sampledPairCount: number;
  contributingPairCount: number;
  staticStress: {
    method: string;
    thresholdKPa: number;
    medianUpperBoundKPa: number | null;
    p95UpperBoundKPa: number | null;
    maximumUpperBoundKPa: number | null;
    fractionBelowThreshold: number;
  };
  maxwell: {
    bestRelaxationYears: number | null;
    impliedViscosityPaS: number | null;
    amplitude: number | null;
    devianceImprovement: number | null;
    pValue: number | null;
    rateRatio: number | null;
    effectPercent: number | null;
    ci95: [number, number] | null;
  };
  lagDistribution: Array<{
    label: string;
    startYears: number;
    endYears: number;
    observed: number;
    expected: number;
    observedPer10kPairs: number;
    expectedPer10kPairs: number;
  }>;
  plateSummary: Array<{
    plateId: string;
    plateName: string;
    eventCount: number;
  }>;
  limitations: string[];
};

export type SeismicHypothesesResponse = {
  generatedAtUtc: string;
  experimentVersion: string;
  catalog: {
    source: string;
    startTime: string;
    endTime: string;
    triggerCandidates: number;
    m65Events: number;
    plateModel: string;
    plateModelUrl: string;
  };
  hypothesisA: DynamicTriggeringResult;
  hypothesisB: IntraplateRelaxationResult;
  warnings: string[];
  sources: Array<{ name: string; url: string; use: string }>;
};

type DynamicOptions = {
  candidateTriggerCount?: number;
  responseMagnitude?: number;
  sensitivityMagnitude?: number;
  minimumDistanceKm?: number;
  surfaceWaveVelocityKmS?: number;
  windowDays?: number;
  bootstrapIterations?: number;
  seed?: number;
};

type WindowSummary = {
  post: number;
  control: number;
  bins: number[];
  regions: Map<string, { post: number; control: number; magnitudes: number[] }>;
  row: DynamicTriggeringResult["triggerRows"][number];
};

type RegionDefinition = {
  id: string;
  label: string;
  centerLatitude: number;
  centerLongitude: number;
};

type LagBin = { start: number; end: number; label: string };

const LAG_BINS: LagBin[] = [
  { start: 30 / YEAR_DAYS, end: 0.25, label: "1–3 meses" },
  { start: 0.25, end: 0.5, label: "3–6 meses" },
  { start: 0.5, end: 1, label: "6–12 meses" },
  { start: 1, end: 2, label: "1–2 años" },
  { start: 2, end: 3, label: "2–3 años" },
  { start: 3, end: 5, label: "3–5 años" },
  { start: 5, end: 10, label: "5–10 años" },
];

function erf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - polynomial * Math.exp(-x * x));
}

function normalCdf(value: number) {
  return 0.5 * (1 + erf(value / Math.SQRT2));
}

export function poissonRateTest(
  postCount: number,
  controlCount: number,
  postExposureDays: number,
  controlExposureDays = postExposureDays,
): RateTest {
  const postRate = postExposureDays > 0 ? postCount / postExposureDays : 0;
  const controlRate = controlExposureDays > 0 ? controlCount / controlExposureDays : 0;
  const variance = postCount / Math.max(postExposureDays ** 2, Number.EPSILON) +
    controlCount / Math.max(controlExposureDays ** 2, Number.EPSILON);
  const z = variance > 0 ? (postRate - controlRate) / Math.sqrt(variance) : 0;
  const correctedPost = postCount === 0 ? 0.5 : postCount;
  const correctedControl = controlCount === 0 ? 0.5 : controlCount;
  const rateRatio = (correctedPost / postExposureDays) / (correctedControl / controlExposureDays);
  const standardError = Math.sqrt(1 / correctedPost + 1 / correctedControl);
  const logRatio = Math.log(rateRatio);
  return {
    postCount,
    controlCount,
    postRatePerDay: postRate,
    controlRatePerDay: controlRate,
    rateRatio,
    effectPercent: 100 * (rateRatio - 1),
    ci95: [Math.exp(logRatio - 1.96 * standardError), Math.exp(logRatio + 1.96 * standardError)],
    z,
    pValue: Math.max(0, Math.min(1, 1 - normalCdf(z))),
  };
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function percentile(values: number[], probability: number) {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * probability;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

function bootstrapRateStats(
  summaries: Array<{ post: number; control: number }>,
  sampleSize: number,
  iterations: number,
  seed: number,
) {
  if (!summaries.length || sampleSize <= 0) return [];
  const random = mulberry32(seed);
  const results: Array<{ ratio: number; pValue: number }> = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let post = 0;
    let control = 0;
    for (let index = 0; index < sampleSize; index += 1) {
      const sample = summaries[Math.floor(random() * summaries.length)];
      post += sample.post;
      control += sample.control;
    }
    results.push({
      ratio: (post + 0.5) / (control + 0.5),
      pValue: poissonRateTest(post, control, Math.max(1, sampleSize)).pValue,
    });
  }
  return results;
}

function gridRegion(latitude: number, longitude: number): RegionDefinition {
  const latitudeSize = 15;
  const longitudeSize = 20;
  const latStart = Math.max(-90, Math.min(75, Math.floor((latitude + 90) / latitudeSize) * latitudeSize - 90));
  const normalizedLon = ((longitude + 180) % 360 + 360) % 360 - 180;
  const lonStart = Math.max(-180, Math.min(160, Math.floor((normalizedLon + 180) / longitudeSize) * longitudeSize - 180));
  const latEnd = latStart + latitudeSize;
  const lonEnd = lonStart + longitudeSize;
  const hemisphereLat = latStart >= 0 ? `${latStart}–${latEnd}°N` : `${Math.abs(latEnd)}–${Math.abs(latStart)}°S`;
  const hemisphereLon = lonStart >= 0 ? `${lonStart}–${lonEnd}°E` : `${Math.abs(lonEnd)}–${Math.abs(lonStart)}°W`;
  return {
    id: `${latStart}:${lonStart}`,
    label: `${hemisphereLat}, ${hemisphereLon}`,
    centerLatitude: latStart + latitudeSize / 2,
    centerLongitude: lonStart + longitudeSize / 2,
  };
}

function summarizeDynamicWindow(
  window: CatalogWindow,
  threshold: number,
  minimumDistanceKm: number,
  velocityKmS: number,
  windowDays: number,
): WindowSummary {
  const anchorTime = Date.parse(window.anchor.timeUtc);
  const bins = Array.from({ length: windowDays * 2 }, () => 0);
  const regions = new Map<string, { post: number; control: number; magnitudes: number[] }>();
  let post = 0;
  let control = 0;

  for (const event of window.events) {
    if (event.magnitude < threshold) continue;
    const distanceKm = haversineKm(
      window.anchor.latitude,
      window.anchor.longitude,
      event.latitude,
      event.longitude,
    );
    if (!Number.isFinite(distanceKm) || distanceKm <= minimumDistanceKm) continue;
    const arrivalTime = anchorTime + (distanceKm / velocityKmS) * 1_000;
    const relativeDays = (Date.parse(event.timeUtc) - arrivalTime) / DAY_MS;
    if (relativeDays < -windowDays || relativeDays >= windowDays) continue;
    const bin = Math.floor(relativeDays + windowDays);
    if (bin >= 0 && bin < bins.length) bins[bin] += 1;
    const region = gridRegion(event.latitude, event.longitude);
    const counts = regions.get(region.id) ?? { post: 0, control: 0, magnitudes: [] };
    counts.magnitudes.push(event.magnitude);
    if (relativeDays >= 0) {
      post += 1;
      counts.post += 1;
    } else {
      control += 1;
      counts.control += 1;
    }
    regions.set(region.id, counts);
  }

  return {
    post,
    control,
    bins,
    regions,
    row: {
      id: window.anchor.id,
      timeUtc: window.anchor.timeUtc,
      magnitude: window.anchor.magnitude,
      place: window.anchor.place,
      remotePostCount: post,
      remoteControlCount: control,
      rateRatio: (post + 0.5) / (control + 0.5),
    },
  };
}

function benjaminiHochberg<T extends { pValue: number }>(rows: T[]) {
  const ordered = rows.map((row, index) => ({ row, index })).sort((a, b) => a.row.pValue - b.row.pValue);
  const qValues = Array(rows.length).fill(1) as number[];
  let previous = 1;
  for (let rankIndex = ordered.length - 1; rankIndex >= 0; rankIndex -= 1) {
    const rank = rankIndex + 1;
    const q = Math.min(previous, ordered[rankIndex].row.pValue * ordered.length / rank);
    qValues[ordered[rankIndex].index] = Math.min(1, q);
    previous = q;
  }
  return rows.map((row, index) => ({ ...row, qValue: qValues[index] }));
}

export function analyzeDynamicTriggering(
  triggerWindows: CatalogWindow[],
  randomDateWindows: CatalogWindow[],
  options: DynamicOptions = {},
): DynamicTriggeringResult {
  const responseMagnitude = options.responseMagnitude ?? 2;
  const sensitivityMagnitude = options.sensitivityMagnitude ?? 4.5;
  const minimumDistanceKm = options.minimumDistanceKm ?? 1_000;
  const surfaceWaveVelocityKmS = options.surfaceWaveVelocityKmS ?? 3.75;
  const windowDays = options.windowDays ?? 5;
  const bootstrapIterations = Math.max(1_000, options.bootstrapIterations ?? 1_000);
  const seed = options.seed ?? 0x524453;
  const summaries = triggerWindows.map((window) => summarizeDynamicWindow(
    window,
    responseMagnitude,
    minimumDistanceKm,
    surfaceWaveVelocityKmS,
    windowDays,
  ));
  const sensitivitySummaries = triggerWindows.map((window) => summarizeDynamicWindow(
    window,
    sensitivityMagnitude,
    minimumDistanceKm,
    surfaceWaveVelocityKmS,
    windowDays,
  ));
  const randomSummaries = randomDateWindows.map((window) => summarizeDynamicWindow(
    window,
    responseMagnitude,
    minimumDistanceKm,
    surfaceWaveVelocityKmS,
    windowDays,
  ));
  const exposureDays = summaries.length * windowDays;
  const post = summaries.reduce((sum, item) => sum + item.post, 0);
  const control = summaries.reduce((sum, item) => sum + item.control, 0);
  const sensitivityPost = sensitivitySummaries.reduce((sum, item) => sum + item.post, 0);
  const sensitivityControl = sensitivitySummaries.reduce((sum, item) => sum + item.control, 0);
  const observed = poissonRateTest(post, control, exposureDays || 1);
  const sensitivity = poissonRateTest(sensitivityPost, sensitivityControl, exposureDays || 1);

  const observedBootstrap = bootstrapRateStats(summaries, summaries.length, bootstrapIterations, seed);
  const nullBootstrap = bootstrapRateStats(
    randomSummaries,
    Math.max(1, summaries.length),
    bootstrapIterations,
    seed ^ 0x9e3779b9,
  );
  const empiricalPValue = nullBootstrap.length
    ? (1 + nullBootstrap.filter((result) => result.ratio >= observed.rateRatio).length) / (nullBootstrap.length + 1)
    : 1;
  const falsePositiveRate = nullBootstrap.length
    ? nullBootstrap.filter((result) => result.pValue < 0.05).length / nullBootstrap.length
    : 1;
  const observedRatios = observedBootstrap.map((result) => result.ratio);
  const observedClusterCi95: [number, number] = observedRatios.length
    ? [percentile(observedRatios, 0.025), percentile(observedRatios, 0.975)]
    : observed.ci95;

  const binCounts = Array.from({ length: windowDays * 2 }, (_, index) =>
    summaries.reduce((sum, item) => sum + item.bins[index], 0));
  const relativeRate = binCounts.map((count, index) => ({
    startDay: index - windowDays,
    endDay: index - windowDays + 1,
    midpointDay: index - windowDays + 0.5,
    count,
    ratePerTriggerDay: summaries.length ? count / summaries.length : 0,
  }));

  const regionDefinitions = new Map<string, RegionDefinition>();
  const regionCounts = new Map<string, { post: number; control: number }>();
  for (const window of triggerWindows) {
    for (const event of window.events) {
      const region = gridRegion(event.latitude, event.longitude);
      regionDefinitions.set(region.id, region);
    }
  }
  for (const summary of summaries) {
    for (const [id, counts] of summary.regions) {
      const aggregate = regionCounts.get(id) ?? { post: 0, control: 0 };
      aggregate.post += counts.post;
      aggregate.control += counts.control;
      regionCounts.set(id, aggregate);
    }
  }
  const rawRegions: Array<Omit<DynamicTriggeringResult["regions"][number], "qValue" | "significant"> & { pValue: number }> = [];
  for (const [id, counts] of regionCounts) {
    const definition = regionDefinitions.get(id);
    if (!definition) continue;
    const triggerExposure = triggerWindows.filter((window) =>
      haversineKm(
        window.anchor.latitude,
        window.anchor.longitude,
        definition.centerLatitude,
        definition.centerLongitude,
      ) > minimumDistanceKm,
    ).length;
    if (triggerExposure < Math.max(6, Math.ceil(triggerWindows.length * 0.35))) continue;
    if (counts.post + counts.control < 20) continue;
    const test = poissonRateTest(
      counts.post,
      counts.control,
      triggerExposure * windowDays,
    );
    rawRegions.push({
      ...definition,
      triggerExposure,
      postCount: counts.post,
      controlCount: counts.control,
      rateRatio: test.rateRatio,
      ci95: test.ci95,
      pValue: test.pValue,
    });
  }
  const correctedRegions = benjaminiHochberg(rawRegions)
    .map((region) => ({
      ...region,
      significant: region.qValue < 0.05 && region.ci95[0] > 1 && falsePositiveRate <= 0.1,
    }))
    .sort((a, b) => a.qValue - b.qValue || b.rateRatio - a.rateRatio);
  const regions = correctedRegions.slice(0, 40);

  const enoughData = summaries.length >= 8 && randomSummaries.length >= 8 && post + control >= 100;
  const supported = enoughData && observed.pValue < 0.05 && empiricalPValue < 0.05 &&
    observedClusterCi95[0] > 1 && falsePositiveRate <= 0.1 && sensitivity.rateRatio > 1;
  const verdict: HypothesisVerdict = !enoughData ? "inconclusive" : supported ? "supported" : "not-supported";
  const conclusion = verdict === "supported"
    ? "La tasa remota posterior supera el control y también el nulo de fechas aleatorias. La asociación se sostiene en esta ejecución, pero por sí sola no demuestra causalidad dinámica."
    : verdict === "not-supported"
      ? "La hipótesis no supera conjuntamente el test de tasa, el control de fechas aleatorias y el intervalo por evento; no se sostiene con estos datos."
      : "La cobertura recuperada no alcanza el mínimo predefinido para aceptar o rechazar la hipótesis.";

  return {
    status: !enoughData ? "insufficient" : "ready",
    verdict,
    conclusion,
    configuration: {
      triggerMagnitude: 7.5,
      responseMagnitude,
      sensitivityMagnitude,
      minimumDistanceKm,
      surfaceWaveVelocityKmS,
      windowDays,
      bootstrapIterations,
      regionalGrid: "15° latitud × 20° longitud; FDR Benjamini–Hochberg",
    },
    candidateTriggerCount: options.candidateTriggerCount ?? triggerWindows.length,
    analyzedTriggerCount: triggerWindows.length,
    randomDateCount: randomDateWindows.length,
    observed,
    sensitivity,
    bootstrap: {
      empiricalPValue,
      falsePositiveRate,
      observedClusterCi95,
      iterations: bootstrapIterations,
    },
    relativeRate,
    regions,
    significantRegionCount: correctedRegions.filter((region) => region.significant).length,
    triggerRows: summaries.map((summary) => summary.row).sort((a, b) => b.timeUtc.localeCompare(a.timeUtc)),
    limitations: [
      "ComCat M≥2 no es homogéneamente completo en todo el planeta ni desde 1990; por eso se informa además la sensibilidad M≥4.5.",
      "El test usa conteos Poisson y bootstrap por evento. Enjambres, réplicas y cambios de red pueden producir sobredispersión residual.",
      "La velocidad de onda superficial se aproxima con 3.75 km/s; la dispersión real depende del periodo y de la trayectoria.",
      "Una asociación temporal posterior al paso de la onda no identifica por sí sola el mecanismo físico de disparo.",
    ],
  };
}

type IntraplateOptions = {
  minimumMagnitude?: number;
  minimumDistanceKm?: number;
  minimumDelayDays?: number;
  maximumDelayYears?: number;
  monteCarloIterations?: number;
  staticStressThresholdKPa?: number;
  rigidityGPa?: number;
  maxSampledPairs?: number;
  plateModel?: string;
  seed?: number;
};

type Cell = {
  id: string;
  plateId: string;
  plateName: string;
  centerLatitude: number;
  centerLongitude: number;
  eventIndexes: number[];
};

type SampledPair = {
  firstIndex: number;
  secondIndex: number;
  firstCell: number;
  secondCell: number;
  distanceKm: number;
  firstStressKPa: number;
  secondStressKPa: number;
};

function cellForEvent(event: HypothesisCatalogEvent) {
  const size = 5;
  const lat = Math.max(-90, Math.min(85, Math.floor((event.latitude + 90) / size) * size - 90));
  const normalizedLon = ((event.longitude + 180) % 360 + 360) % 360 - 180;
  const lon = Math.max(-180, Math.min(175, Math.floor((normalizedLon + 180) / size) * size - 180));
  return {
    id: `${event.plateId}:${lat}:${lon}`,
    centerLatitude: lat + size / 2,
    centerLongitude: lon + size / 2,
  };
}

export function staticStressUpperBoundKPa(magnitude: number, distanceKm: number) {
  if (!Number.isFinite(magnitude) || !Number.isFinite(distanceKm) || distanceKm <= 0) return Number.NaN;
  const seismicMomentNm = 10 ** (1.5 * magnitude + 9.1);
  const distanceMeters = distanceKm * 1_000;
  return seismicMomentNm / (4 * Math.PI * distanceMeters ** 3) / 1_000;
}

function lagBinIndex(delayYears: number) {
  return LAG_BINS.findIndex((bin) => delayYears >= bin.start && delayYears < bin.end);
}

function poissonLogLikelihood(observed: number[], expected: number[]) {
  let value = 0;
  for (let index = 0; index < observed.length; index += 1) {
    const mu = Math.max(1e-9, expected[index]);
    value += observed[index] * Math.log(mu) - mu;
  }
  return value;
}

function fitMaxwellKernel(observed: number[], expected: number[]) {
  const tauCandidates = [0.25, 0.5, 1, 2, 3, 5, 8];
  const midpoints = LAG_BINS.map((bin) => (bin.start + bin.end) / 2);
  const baseline = poissonLogLikelihood(observed, expected);
  let best = { tau: tauCandidates[0], amplitude: 0, deviance: 0 };
  for (const tau of tauCandidates) {
    const kernel = midpoints.map((midpoint) => Math.exp(-midpoint / tau));
    for (let step = 0; step <= 100; step += 1) {
      const amplitude = step * 0.05;
      const modeled = expected.map((value, index) => Math.max(1e-9, value * (1 + amplitude * kernel[index])));
      const deviance = Math.max(0, 2 * (poissonLogLikelihood(observed, modeled) - baseline));
      if (deviance > best.deviance) best = { tau, amplitude, deviance };
    }
  }
  return best;
}

function histogramForTimes(
  pairs: SampledPair[],
  events: HypothesisCatalogEvent[],
  times: Float64Array,
  staticThresholdKPa: number,
) {
  const histogram = Array(LAG_BINS.length).fill(0) as number[];
  let contributing = 0;
  const stresses: number[] = [];
  for (const pair of pairs) {
    const firstTime = times[pair.firstIndex];
    const secondTime = times[pair.secondIndex];
    const delayYears = Math.abs(secondTime - firstTime) / DAY_MS / YEAR_DAYS;
    const bin = lagBinIndex(delayYears);
    if (bin < 0) continue;
    const firstIsSource = firstTime <= secondTime;
    const stress = firstIsSource ? pair.firstStressKPa : pair.secondStressKPa;
    if (!Number.isFinite(stress) || stress > staticThresholdKPa) continue;
    histogram[bin] += 1;
    contributing += 1;
    stresses.push(stress);
  }
  return { histogram, contributing, stresses };
}

export function analyzeIntraplateRelaxation(
  inputEvents: HypothesisCatalogEvent[],
  options: IntraplateOptions = {},
): IntraplateRelaxationResult {
  const minimumMagnitude = options.minimumMagnitude ?? 6.5;
  const minimumDistanceKm = options.minimumDistanceKm ?? 500;
  const minimumDelayDays = options.minimumDelayDays ?? 30;
  const maximumDelayYears = options.maximumDelayYears ?? 10;
  const monteCarloIterations = Math.max(1_000, options.monteCarloIterations ?? 1_000);
  const staticStressThresholdKPa = options.staticStressThresholdKPa ?? 10;
  const rigidityGPa = options.rigidityGPa ?? 30;
  const maxSampledPairs = options.maxSampledPairs ?? 60_000;
  const seed = options.seed ?? 0x4d415857;
  const plateModel = options.plateModel ?? "PB2002 (Bird, 2003)";
  const events = inputEvents.filter((event) => event.magnitude >= minimumMagnitude && event.plateId);
  const originalTimes = new Float64Array(events.map((event) => Date.parse(event.timeUtc)));
  const cellsById = new Map<string, Cell>();
  events.forEach((event, eventIndex) => {
    const grid = cellForEvent(event);
    const cell = cellsById.get(grid.id) ?? {
      ...grid,
      plateId: event.plateId as string,
      plateName: event.plateName ?? `Placa ${event.plateId}`,
      eventIndexes: [],
    };
    cell.eventIndexes.push(eventIndex);
    cellsById.set(cell.id, cell);
  });
  const cells = [...cellsById.values()];
  const cellIndex = new Map(cells.map((cell, index) => [cell.id, index]));
  const eligibleCellPairs: Array<[Cell, Cell]> = [];
  let spatialPairsConsidered = 0;
  for (let first = 0; first < cells.length; first += 1) {
    for (let second = first + 1; second < cells.length; second += 1) {
      const a = cells[first];
      const b = cells[second];
      if (a.plateId !== b.plateId) continue;
      const centerDistance = haversineKm(a.centerLatitude, a.centerLongitude, b.centerLatitude, b.centerLongitude);
      if (centerDistance <= minimumDistanceKm) continue;
      spatialPairsConsidered += a.eventIndexes.length * b.eventIndexes.length;
      eligibleCellPairs.push([a, b]);
    }
  }
  const sampleStride = Math.max(1, Math.ceil(spatialPairsConsidered / maxSampledPairs));
  const sampledPairs: SampledPair[] = [];
  outer: for (const [firstCellValue, secondCellValue] of eligibleCellPairs) {
    for (const firstIndex of firstCellValue.eventIndexes) {
      for (const secondIndex of secondCellValue.eventIndexes) {
        const firstEvent = events[firstIndex];
        const secondEvent = events[secondIndex];
        if (hashString(`${firstEvent.id}|${secondEvent.id}`) % sampleStride !== 0) continue;
        const distanceKm = haversineKm(
          firstEvent.latitude,
          firstEvent.longitude,
          secondEvent.latitude,
          secondEvent.longitude,
        );
        if (distanceKm <= minimumDistanceKm) continue;
        sampledPairs.push({
          firstIndex,
          secondIndex,
          firstCell: cellIndex.get(firstCellValue.id) as number,
          secondCell: cellIndex.get(secondCellValue.id) as number,
          distanceKm,
          firstStressKPa: staticStressUpperBoundKPa(firstEvent.magnitude, distanceKm),
          secondStressKPa: staticStressUpperBoundKPa(secondEvent.magnitude, distanceKm),
        });
        if (sampledPairs.length >= maxSampledPairs) break outer;
      }
    }
  }

  const observed = histogramForTimes(sampledPairs, events, originalTimes, staticStressThresholdKPa);
  const finiteTimes = [...originalTimes].filter(Number.isFinite);
  const startTime = finiteTimes.length ? Math.min(...finiteTimes) : 0;
  const endTime = finiteTimes.length ? Math.max(...finiteTimes) + DAY_MS : DAY_MS;
  const duration = Math.max(DAY_MS, endTime - startTime);
  const random = mulberry32(seed);
  const nullHistograms: number[][] = [];
  for (let iteration = 0; iteration < monteCarloIterations; iteration += 1) {
    const cellOffsets = new Float64Array(cells.length);
    for (let index = 0; index < cellOffsets.length; index += 1) cellOffsets[index] = random() * duration;
    const shiftedTimes = new Float64Array(events.length);
    for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
      const cell = cellForEvent(events[eventIndex]);
      const index = cellIndex.get(cell.id) as number;
      shiftedTimes[eventIndex] = startTime + ((originalTimes[eventIndex] - startTime + cellOffsets[index]) % duration);
    }
    nullHistograms.push(histogramForTimes(sampledPairs, events, shiftedTimes, staticStressThresholdKPa).histogram);
  }
  const expected = Array.from({ length: LAG_BINS.length }, (_, bin) =>
    nullHistograms.reduce((sum, histogram) => sum + histogram[bin], 0) / Math.max(1, nullHistograms.length));
  const best = fitMaxwellKernel(observed.histogram, expected);
  const nullDeviances = nullHistograms.map((histogram) => fitMaxwellKernel(histogram, expected).deviance);
  const pValue = (1 + nullDeviances.filter((value) => value >= best.deviance).length) /
    (nullDeviances.length + 1);
  const effectBins = LAG_BINS.map((bin, index) => ({ bin, index }))
    .filter(({ bin }) => (bin.start + bin.end) / 2 <= best.tau)
    .map(({ index }) => index);
  const selectedBins = effectBins.length ? effectBins : [0];
  const observedEffectCount = selectedBins.reduce((sum, index) => sum + observed.histogram[index], 0);
  const expectedEffectCount = selectedBins.reduce((sum, index) => sum + expected[index], 0);
  const correctedObserved = observedEffectCount || 0.5;
  const correctedExpected = expectedEffectCount || 0.5;
  const rateRatio = correctedObserved / correctedExpected;
  const logStandardError = Math.sqrt(1 / correctedObserved + 1 / correctedExpected);
  const ci95: [number, number] = [
    Math.exp(Math.log(rateRatio) - 1.96 * logStandardError),
    Math.exp(Math.log(rateRatio) + 1.96 * logStandardError),
  ];
  const stresses = observed.stresses.filter(Number.isFinite).sort((a, b) => a - b);
  const allPotentialStresses = sampledPairs.flatMap((pair) => [pair.firstStressKPa, pair.secondStressKPa]).filter(Number.isFinite);
  const fractionBelowThreshold = allPotentialStresses.length
    ? allPotentialStresses.filter((value) => value <= staticStressThresholdKPa).length / allPotentialStresses.length
    : 0;
  const enoughData = events.length >= 100 && sampledPairs.length >= 1_000 && observed.contributing >= 100;
  const supported = enoughData && pValue < 0.05 && ci95[0] > 1 && best.amplitude > 0;
  const verdict: HypothesisVerdict = !enoughData ? "inconclusive" : supported ? "supported" : "not-supported";
  const conclusion = verdict === "supported"
    ? "La concentración temporal entre celdas distantes de una misma placa excede el nulo de desplazamientos circulares y es compatible con un tiempo de Maxwell. Es consistencia estadística, no identificación causal del manto."
    : verdict === "not-supported"
      ? "La distribución de retrasos no mejora de forma significativa sobre el catálogo temporalmente aleatorizado; la hipótesis no se sostiene en esta ejecución."
      : "La cantidad de eventos asignados o de pares independientes es insuficiente para decidir esta hipótesis.";
  const plateMap = new Map<string, { plateId: string; plateName: string; eventCount: number }>();
  for (const event of events) {
    const plateId = event.plateId as string;
    const row = plateMap.get(plateId) ?? { plateId, plateName: event.plateName ?? `Placa ${plateId}`, eventCount: 0 };
    row.eventCount += 1;
    plateMap.set(plateId, row);
  }

  return {
    status: !enoughData ? "insufficient" : inputEvents.length === events.length ? "ready" : "partial",
    verdict,
    conclusion,
    configuration: {
      minimumMagnitude,
      minimumDistanceKm,
      minimumDelayDays,
      maximumDelayYears,
      monteCarloIterations,
      staticStressThresholdKPa,
      rigidityGPa,
      plateModel,
      nullModel: "Desplazamiento temporal circular independiente por celda de 5°, preservando la secuencia local",
    },
    catalogEventCount: inputEvents.length,
    assignedEventCount: events.length,
    assignmentRate: inputEvents.length ? events.length / inputEvents.length : 0,
    plateCount: plateMap.size,
    spatialCellCount: cells.length,
    spatialPairsConsidered,
    sampledPairCount: sampledPairs.length,
    contributingPairCount: observed.contributing,
    staticStress: {
      method: "Cota escalar de campo lejano M₀/(4πr³); no es ΔCFS firmado sin mecanismo focal y geometría receptora",
      thresholdKPa: staticStressThresholdKPa,
      medianUpperBoundKPa: stresses.length ? percentile(stresses, 0.5) : null,
      p95UpperBoundKPa: stresses.length ? percentile(stresses, 0.95) : null,
      maximumUpperBoundKPa: stresses.length ? stresses.at(-1) ?? null : null,
      fractionBelowThreshold,
    },
    maxwell: {
      bestRelaxationYears: enoughData ? best.tau : null,
      impliedViscosityPaS: enoughData ? best.tau * YEAR_DAYS * DAY_MS / 1_000 * rigidityGPa * 1e9 : null,
      amplitude: enoughData ? best.amplitude : null,
      devianceImprovement: enoughData ? best.deviance : null,
      pValue: enoughData ? pValue : null,
      rateRatio: enoughData ? rateRatio : null,
      effectPercent: enoughData ? 100 * (rateRatio - 1) : null,
      ci95: enoughData ? ci95 : null,
    },
    lagDistribution: LAG_BINS.map((bin, index) => ({
      label: bin.label,
      startYears: bin.start,
      endYears: bin.end,
      observed: observed.histogram[index],
      expected: expected[index],
      observedPer10kPairs: sampledPairs.length ? observed.histogram[index] / sampledPairs.length * 10_000 : 0,
      expectedPer10kPairs: sampledPairs.length ? expected[index] / sampledPairs.length * 10_000 : 0,
    })),
    plateSummary: [...plateMap.values()].sort((a, b) => b.eventCount - a.eventCount).slice(0, 12),
    limitations: [
      "Sin strike, dip, rake y geometría de la falla receptora no puede calcularse un Coulomb firmado; se usa una cota de esfuerzo para descartar pares claramente no estáticos.",
      "Un semi-espacio de Maxwell resume el tiempo de relajación, pero no sustituye un modelo 3D con estructura lateral, afterslip y poroelasticidad.",
      "Los pares comparten eventos y no son observaciones totalmente independientes; el nulo conserva la secuencia temporal dentro de cada celda para reducir ese sesgo.",
      "Compatibilidad con un tiempo de Maxwell no demuestra que la relajación viscoelástica haya causado el segundo sismo.",
    ],
  };
}
