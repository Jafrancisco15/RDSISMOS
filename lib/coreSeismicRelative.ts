import {
  GEOMAGNETIC_JERKS,
  jerkIntensityAt,
  type BgsMonthlyPoint,
  type SeismicEventPoint,
  type StationSecularAcceleration,
} from "./coreSeismicMonitor";

export type MonthlySecularAccelerationPoint = {
  decimalYear: number;
  valueNtYr2: number;
  stationCount: number;
};

export type CoreSeismicRelativeBin = {
  relativeYear: number;
  saEventMedianNtYr2: number | null;
  saControlMedianNtYr2: number | null;
  saDifferenceNtYr2: number | null;
  saEventMedianZ: number | null;
  saControlMedianZ: number | null;
  saEffectZ: number | null;
  jerkEventMedian: number | null;
  jerkControlMedian: number | null;
  jerkDifference: number | null;
  eventSampleCount: number;
  controlSampleCount: number;
  eventClusterCount: number;
  controlClusterCount: number;
};

export type CoreSeismicRelativeEventRow = {
  id: string;
  timeUtc: string | null;
  year: number;
  magnitude: number;
  magnitudeType: string | null;
  lat: number | null;
  lon: number | null;
  controlTimeUtc: string | null;
  controlOffsetYears: number | null;
  eventCluster: string;
  controlCluster: string | null;
  saAvailableBins: number;
  preSaMedianNtYr2: number | null;
  eventSaMedianNtYr2: number | null;
  postSaMedianNtYr2: number | null;
  postMinusPreSaNtYr2: number | null;
  jerkAtEvent: number;
  jerkAfter2to5Peak: number;
  firstJerkAfter2to5Years: number | null;
  hasJerkAfter2to5: boolean;
};

export type CoreSeismicHistoricalReplication = {
  reference: string;
  lagWindowYears: { min: 2; max: 5 };
  thresholdMagnitude: 8;
  scaleUsed: "Ms" | "M≥8-USGS";
  scaleNote: string;
  candidateM8Events: number;
  exactMsCandidates: number;
  eventsConsidered: number;
  controlsConsidered: number;
  independentEventClusters: number;
  independentControlClusters: number;
  eventHitFraction: number | null;
  controlHitFraction: number | null;
  differenceFraction: number | null;
  eventMeanPeakJerk: number | null;
  controlMeanPeakJerk: number | null;
  permutationP: number | null;
};

export type CoreSeismicRelativeStudy = {
  status: "ready" | "partial" | "insufficient";
  statusMessage: string;
  windowYears: number;
  bins: CoreSeismicRelativeBin[];
  eventRows: CoreSeismicRelativeEventRow[];
  eligibleEvents: number;
  eligibleControls: number;
  independentEventClusters: number;
  independentControlClusters: number;
  magneticObservations: number;
  magneticFirstYear: number | null;
  magneticLastYear: number | null;
  prePost: {
    eventPreSaMedianNtYr2: number | null;
    eventAtEventSaMedianNtYr2: number | null;
    eventPostSaMedianNtYr2: number | null;
    controlPreSaMedianNtYr2: number | null;
    controlAtEventSaMedianNtYr2: number | null;
    controlPostSaMedianNtYr2: number | null;
    postMinusPreDifferenceNtYr2: number | null;
  };
  historicalReplication: CoreSeismicHistoricalReplication;
  warnings: string[];
};

function finite(values: number[]) {
  return values.filter(Number.isFinite);
}

function mean(values: number[]) {
  const clean = finite(values);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function median(values: number[]) {
  const clean = finite(values).sort((a, b) => a - b);
  if (!clean.length) return Number.NaN;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

function standardDeviation(values: number[]) {
  const clean = finite(values);
  if (clean.length < 2) return 1;
  const center = mean(clean);
  return Math.sqrt(clean.reduce((sum, value) => sum + (value - center) ** 2, 0) / (clean.length - 1)) || 1;
}

function robustScale(values: number[]) {
  const clean = finite(values);
  if (clean.length < 2) return 1;
  const center = median(clean);
  const mad = median(clean.map(value => Math.abs(value - center)));
  return Number.isFinite(mad) && mad > 1e-9 ? 1.4826 * mad : Math.max(1, standardDeviation(clean));
}

/**
 * Preserve monthly BGS resolution for the primary event-relative experiment.
 * The derivative is time-aware and ignores gaps larger than one quarter.
 */
export function deriveMonthlyStationSecularAcceleration(points: BgsMonthlyPoint[]): StationSecularAcceleration[] {
  const sorted = [...points]
    .filter(point => Number.isFinite(point.decimalYear + point.xNt + point.yNt + point.zNt))
    .sort((a, b) => a.decimalYear - b.decimalYear)
    .filter((point, index, values) => index === 0 || Math.abs(point.decimalYear - values[index - 1].decimalYear) > 1e-6);
  const result: StationSecularAcceleration[] = [];
  for (let index = 1; index < sorted.length - 1; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    const next = sorted[index + 1];
    const dtPrevious = current.decimalYear - previous.decimalYear;
    const dtNext = next.decimalYear - current.decimalYear;
    if (dtPrevious <= 0 || dtNext <= 0 || dtPrevious > 0.25 || dtNext > 0.25) continue;
    const secondDerivative = (before: number, at: number, after: number) =>
      2 * (((after - at) / dtNext) - ((at - before) / dtPrevious)) / (dtPrevious + dtNext);
    const valueNtYr2 = Math.hypot(
      secondDerivative(previous.xNt, current.xNt, next.xNt),
      secondDerivative(previous.yNt, current.yNt, next.yNt),
      secondDerivative(previous.zNt, current.zNt, next.zNt),
    );
    if (Number.isFinite(valueNtYr2)) result.push({ year: current.decimalYear, valueNtYr2 });
  }
  return result;
}

function monthKey(decimalYear: number) {
  const year = Math.floor(decimalYear);
  const month = Math.max(0, Math.min(11, Math.floor((decimalYear - year) * 12 + 1e-7)));
  return year * 12 + month;
}

export function combineMonthlyStationSecularAcceleration(
  series: StationSecularAcceleration[][],
  minStations = 2,
): MonthlySecularAccelerationPoint[] {
  const byMonth = new Map<number, number[]>();
  for (const station of series) {
    const seen = new Set<number>();
    for (const point of station) {
      const key = monthKey(point.year);
      if (seen.has(key)) continue;
      seen.add(key);
      const values = byMonth.get(key) ?? [];
      values.push(point.valueNtYr2);
      byMonth.set(key, values);
    }
  }
  return [...byMonth.entries()]
    .filter(([, values]) => values.length >= minStations)
    .map(([key, values]) => ({
      decimalYear: Math.floor(key / 12) + (key % 12 + 0.5) / 12,
      valueNtYr2: median(values),
      stationCount: values.length,
    }))
    .filter(point => Number.isFinite(point.valueNtYr2))
    .sort((a, b) => a.decimalYear - b.decimalYear);
}

function eventDecimalYear(event: SeismicEventPoint) {
  if (event.timeUtc) {
    const instant = Date.parse(event.timeUtc);
    if (Number.isFinite(instant)) {
      const date = new Date(instant);
      const year = date.getUTCFullYear();
      const start = Date.UTC(year, 0, 1);
      const end = Date.UTC(year + 1, 0, 1);
      return year + (instant - start) / (end - start);
    }
  }
  return event.year + 0.5;
}

function isoFromDecimalYear(decimalYear: number) {
  const year = Math.floor(decimalYear);
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  return new Date(start + Math.max(0, Math.min(1, decimalYear - year)) * (end - start)).toISOString();
}

function relativeBin(time: number, origin: number, windowYears: number) {
  const rounded = Math.round(time - origin);
  return rounded >= -windowYears && rounded <= windowYears && Math.abs(time - origin - rounded) <= 0.5000001 ? rounded : null;
}

function catalogJerkWindow(time: number, minYears: number, maxYears: number) {
  return GEOMAGNETIC_JERKS.filter(jerk => jerk.year >= time + minYears && jerk.year <= time + maxYears);
}

function jerkPeakAfter(time: number, minYears: number, maxYears: number) {
  const steps = Math.max(1, Math.ceil((maxYears - minYears) * 12));
  let peak = 0;
  for (let index = 0; index <= steps; index += 1) {
    peak = Math.max(peak, jerkIntensityAt(time + minYears + (index / steps) * (maxYears - minYears)));
  }
  return peak;
}

type Profile = {
  time: number;
  sa: Map<number, { raw: number; z: number; samples: number }>;
  jerk: Map<number, number>;
  preSa: number | null;
  eventSa: number | null;
  postSa: number | null;
  saAvailableBins: number;
  jerkAtEvent: number;
  jerkAfter2to5Peak: number;
  firstJerkAfter2to5Years: number | null;
  hasJerkAfter2to5: boolean;
};

function profileAtTime(time: number, monthly: MonthlySecularAccelerationPoint[], windowYears: number): Profile {
  const byBin = new Map<number, number[]>();
  for (const point of monthly) {
    const bin = relativeBin(point.decimalYear, time, windowYears);
    if (bin === null) continue;
    const values = byBin.get(bin) ?? [];
    values.push(point.valueNtYr2);
    byBin.set(bin, values);
  }
  const preValues = Array.from({ length: windowYears }, (_, index) => -(index + 1)).flatMap(bin => byBin.get(bin) ?? []);
  const baseline = median(preValues);
  const scale = robustScale(preValues);
  const sa = new Map<number, { raw: number; z: number; samples: number }>();
  for (let bin = -windowYears; bin <= windowYears; bin += 1) {
    const values = byBin.get(bin) ?? [];
    const raw = median(values);
    if (Number.isFinite(raw)) {
      sa.set(bin, {
        raw,
        z: Number.isFinite(baseline) ? (raw - baseline) / scale : Number.NaN,
        samples: values.length,
      });
    }
  }
  const jerk = new Map<number, number>();
  for (let bin = -windowYears; bin <= windowYears; bin += 1) jerk.set(bin, jerkIntensityAt(time + bin));
  const aggregate = (bins: number[]) => {
    const value = median(bins.flatMap(bin => byBin.get(bin) ?? []));
    return Number.isFinite(value) ? value : null;
  };
  const after = catalogJerkWindow(time, 2, 5);
  return {
    time,
    sa,
    jerk,
    preSa: aggregate(Array.from({ length: windowYears }, (_, index) => -(index + 1))),
    eventSa: sa.get(0)?.raw ?? null,
    postSa: aggregate(Array.from({ length: windowYears }, (_, index) => index + 1)),
    saAvailableBins: sa.size,
    jerkAtEvent: jerk.get(0) ?? 0,
    jerkAfter2to5Peak: jerkPeakAfter(time, 2, 5),
    firstJerkAfter2to5Years: after.length ? Math.min(...after.map(item => item.year - time)) : null,
    hasJerkAfter2to5: after.length > 0,
  };
}

type ProfileRecord = {
  event: SeismicEventPoint;
  eventTime: number;
  eventCluster: string;
  profile: Profile;
  controlTime: number | null;
  controlCluster: string | null;
  controlProfile: Profile | null;
};

function clusterMedian(records: Array<{ cluster: string; value: number | null }>) {
  const byCluster = new Map<string, number[]>();
  let sampleCount = 0;
  for (const record of records) {
    if (record.value === null || !Number.isFinite(record.value)) continue;
    sampleCount += 1;
    const values = byCluster.get(record.cluster) ?? [];
    values.push(record.value);
    byCluster.set(record.cluster, values);
  }
  const clusterValues = [...byCluster.values()].map(values => median(values)).filter(Number.isFinite);
  return { value: median(clusterValues), sampleCount, clusterCount: clusterValues.length };
}

function clusterMean(records: Array<{ cluster: string; value: number }>) {
  const byCluster = new Map<string, number[]>();
  for (const record of records) {
    const values = byCluster.get(record.cluster) ?? [];
    values.push(record.value);
    byCluster.set(record.cluster, values);
  }
  const values = [...byCluster.values()].map(items => mean(items));
  return values.length ? mean(values) : null;
}

function deterministicUnit(seed: number) {
  let state = (seed >>> 0) || 1;
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 4294967296;
}

function pairedPermutationP(differences: number[]) {
  if (differences.length < 4) return null;
  const observed = Math.abs(mean(differences));
  const permutations = 2048;
  let extreme = 0;
  for (let iteration = 0; iteration < permutations; iteration += 1) {
    const permuted = mean(differences.map((difference, index) =>
      deterministicUnit(iteration * 7919 + index * 104729) < 0.5 ? difference : -difference));
    if (Math.abs(permuted) >= observed - 1e-12) extreme += 1;
  }
  return (extreme + 1) / (permutations + 1);
}

function matchedControlTime(
  eventTime: number,
  eventTimes: number[],
  minTime: number,
  maxTime: number,
  windowYears: number,
  index: number,
) {
  const offsets = [7, -7, 11, -11, 13, -13, 17, -17, 19, -19, 23, -23];
  const rotation = index % offsets.length;
  const ordered = [...offsets.slice(rotation), ...offsets.slice(0, rotation)];
  for (const offset of ordered) {
    const candidate = eventTime + offset;
    if (candidate - windowYears < minTime - 0.01 || candidate + windowYears > maxTime + 0.01) continue;
    if (eventTimes.some(other => Math.abs(other - candidate) < 0.5)) continue;
    return candidate;
  }
  return null;
}

function exactMs(value: string | null | undefined) {
  return /(^|[^a-z])ms([^a-z]|$)/i.test(value ?? "");
}

function buildHistoricalReplication(records: ProfileRecord[]): CoreSeismicHistoricalReplication {
  const candidates = records.filter(record => record.event.magnitude >= 8);
  const exactMsCandidates = candidates.filter(record => exactMs(record.event.magnitudeType));
  const selected = exactMsCandidates.length >= 3 ? exactMsCandidates : candidates;
  const pairs = selected.filter(record => record.controlProfile !== null);
  const eventHitFraction = clusterMean(pairs.map(record => ({
    cluster: record.eventCluster,
    value: record.profile.hasJerkAfter2to5 ? 1 : 0,
  })));
  const controlHitFraction = clusterMean(pairs.map(record => ({
    cluster: record.controlCluster ?? "control-" + record.eventCluster,
    value: record.controlProfile?.hasJerkAfter2to5 ? 1 : 0,
  })));
  const eventMeanPeakJerk = clusterMean(pairs.map(record => ({
    cluster: record.eventCluster,
    value: record.profile.jerkAfter2to5Peak,
  })));
  const controlMeanPeakJerk = clusterMean(pairs.map(record => ({
    cluster: record.eventCluster,
    value: jerkPeakAfter(record.controlTime ?? record.eventTime, 2, 5),
  })));
  const pairsByCluster = new Map<string, { event: number[]; control: number[] }>();
  for (const record of pairs) {
    const pair = pairsByCluster.get(record.eventCluster) ?? { event: [], control: [] };
    pair.event.push(record.profile.hasJerkAfter2to5 ? 1 : 0);
    pair.control.push(record.controlProfile?.hasJerkAfter2to5 ? 1 : 0);
    pairsByCluster.set(record.eventCluster, pair);
  }
  const differences = [...pairsByCluster.values()].map(pair => mean(pair.event) - mean(pair.control));
  const scaleUsed = exactMsCandidates.length >= 3 ? "Ms" : "M≥8-USGS";
  return {
    reference: "Florindo & Alfonsi (1995), hipótesis de jerks entre 2 y 5 años después de terremotos muy grandes",
    lagWindowYears: { min: 2, max: 5 },
    thresholdMagnitude: 8,
    scaleUsed,
    scaleNote: scaleUsed === "Ms"
      ? "Se usó el subconjunto que USGS etiqueta explícitamente como Ms."
      : "El catálogo actual entrega la magnitud reportada por USGS; M≥8 no se trata como equivalente exacto a Ms. La réplica es de sensibilidad.",
    candidateM8Events: candidates.length,
    exactMsCandidates: exactMsCandidates.length,
    eventsConsidered: pairs.length,
    controlsConsidered: pairs.length,
    independentEventClusters: new Set(pairs.map(record => record.eventCluster)).size,
    independentControlClusters: new Set(pairs.map(record => record.controlCluster ?? "control-" + record.eventCluster)).size,
    eventHitFraction,
    controlHitFraction,
    differenceFraction: eventHitFraction === null || controlHitFraction === null ? null : eventHitFraction - controlHitFraction,
    eventMeanPeakJerk,
    controlMeanPeakJerk,
    permutationP: pairedPermutationP(differences),
  };
}

export function buildRelativeCoreSeismicStudy(
  events: SeismicEventPoint[],
  monthly: MonthlySecularAccelerationPoint[],
  windowYears = 5,
): CoreSeismicRelativeStudy {
  const normalizedEvents = events
    .filter(event => Number.isFinite(event.magnitude) && event.magnitude >= 7 && Number.isFinite(event.year))
    .map((event, index) => ({ event, index, time: eventDecimalYear(event) }))
    .sort((a, b) => a.time - b.time);
  const sortedMonthly = monthly
    .filter(point => Number.isFinite(point.decimalYear + point.valueNtYr2) && point.stationCount > 0)
    .sort((a, b) => a.decimalYear - b.decimalYear);
  const jerkCoverageStart = Math.min(1904, ...GEOMAGNETIC_JERKS.map(jerk => jerk.year - windowYears));
  const jerkCoverageEnd = Math.max(2025, ...GEOMAGNETIC_JERKS.map(jerk => jerk.year + windowYears));
  const minTime = sortedMonthly[0]?.decimalYear ?? jerkCoverageStart;
  const maxTime = sortedMonthly.at(-1)?.decimalYear ?? jerkCoverageEnd;
  const eventTimes = normalizedEvents.map(item => item.time);
  const records: ProfileRecord[] = [];
  for (const item of normalizedEvents) {
    if (item.time - windowYears < minTime - 0.01 || item.time + windowYears > maxTime + 0.01) continue;
    const controlTime = matchedControlTime(item.time, eventTimes, minTime, maxTime, windowYears, item.index);
    records.push({
      event: item.event,
      eventTime: item.time,
      eventCluster: String(item.event.year),
      profile: profileAtTime(item.time, sortedMonthly, windowYears),
      controlTime,
      controlCluster: controlTime === null ? null : String(Math.floor(controlTime)),
      controlProfile: controlTime === null ? null : profileAtTime(controlTime, sortedMonthly, windowYears),
    });
  }
  const eventRecords = records;
  const controlRecords = records.filter(record => record.controlProfile !== null);
  const bins: CoreSeismicRelativeBin[] = [];
  for (let relativeYear = -windowYears; relativeYear <= windowYears; relativeYear += 1) {
    const eventSa = clusterMedian(eventRecords.map(record => ({
      cluster: record.eventCluster,
      value: record.profile.sa.get(relativeYear)?.raw ?? null,
    })));
    const controlSa = clusterMedian(controlRecords.map(record => ({
      cluster: record.controlCluster ?? "control-" + record.eventCluster,
      value: record.controlProfile?.sa.get(relativeYear)?.raw ?? null,
    })));
    const eventZ = clusterMedian(eventRecords.map(record => ({
      cluster: record.eventCluster,
      value: record.profile.sa.get(relativeYear)?.z ?? null,
    })));
    const controlZ = clusterMedian(controlRecords.map(record => ({
      cluster: record.controlCluster ?? "control-" + record.eventCluster,
      value: record.controlProfile?.sa.get(relativeYear)?.z ?? null,
    })));
    const eventJerk = clusterMedian(eventRecords.map(record => ({
      cluster: record.eventCluster,
      value: record.profile.jerk.get(relativeYear) ?? null,
    })));
    const controlJerk = clusterMedian(controlRecords.map(record => ({
      cluster: record.controlCluster ?? "control-" + record.eventCluster,
      value: record.controlProfile?.jerk.get(relativeYear) ?? null,
    })));
    bins.push({
      relativeYear,
      saEventMedianNtYr2: Number.isFinite(eventSa.value) ? eventSa.value : null,
      saControlMedianNtYr2: Number.isFinite(controlSa.value) ? controlSa.value : null,
      saDifferenceNtYr2: Number.isFinite(eventSa.value) && Number.isFinite(controlSa.value) ? eventSa.value - controlSa.value : null,
      saEventMedianZ: Number.isFinite(eventZ.value) ? eventZ.value : null,
      saControlMedianZ: Number.isFinite(controlZ.value) ? controlZ.value : null,
      saEffectZ: Number.isFinite(eventZ.value) && Number.isFinite(controlZ.value) ? eventZ.value - controlZ.value : null,
      jerkEventMedian: Number.isFinite(eventJerk.value) ? eventJerk.value : null,
      jerkControlMedian: Number.isFinite(controlJerk.value) ? controlJerk.value : null,
      jerkDifference: Number.isFinite(eventJerk.value) && Number.isFinite(controlJerk.value) ? eventJerk.value - controlJerk.value : null,
      eventSampleCount: eventSa.sampleCount,
      controlSampleCount: controlSa.sampleCount,
      eventClusterCount: eventSa.clusterCount,
      controlClusterCount: controlSa.clusterCount,
    });
  }
  const eventPre = clusterMedian(eventRecords.map(record => ({ cluster: record.eventCluster, value: record.profile.preSa })));
  const eventAt = clusterMedian(eventRecords.map(record => ({ cluster: record.eventCluster, value: record.profile.eventSa })));
  const eventPost = clusterMedian(eventRecords.map(record => ({ cluster: record.eventCluster, value: record.profile.postSa })));
  const controlPre = clusterMedian(controlRecords.map(record => ({ cluster: record.controlCluster ?? "control-" + record.eventCluster, value: record.controlProfile?.preSa ?? null })));
  const controlAt = clusterMedian(controlRecords.map(record => ({ cluster: record.controlCluster ?? "control-" + record.eventCluster, value: record.controlProfile?.eventSa ?? null })));
  const controlPost = clusterMedian(controlRecords.map(record => ({ cluster: record.controlCluster ?? "control-" + record.eventCluster, value: record.controlProfile?.postSa ?? null })));
  const postPreDifference = Number.isFinite(eventPre.value) && Number.isFinite(eventPost.value) && Number.isFinite(controlPre.value) && Number.isFinite(controlPost.value)
    ? (eventPost.value - eventPre.value) - (controlPost.value - controlPre.value)
    : null;
  const eventRows: CoreSeismicRelativeEventRow[] = eventRecords.map((record, index) => ({
    id: record.event.id ?? (record.event.timeUtc ?? record.event.year + "") + "-" + record.event.magnitude.toFixed(1) + "-" + index,
    timeUtc: record.event.timeUtc ?? null,
    year: record.event.year,
    magnitude: record.event.magnitude,
    magnitudeType: record.event.magnitudeType ?? null,
    lat: typeof record.event.lat === "number" && Number.isFinite(record.event.lat) ? record.event.lat : null,
    lon: typeof record.event.lon === "number" && Number.isFinite(record.event.lon) ? record.event.lon : null,
    controlTimeUtc: record.controlTime === null ? null : isoFromDecimalYear(record.controlTime),
    controlOffsetYears: record.controlTime === null ? null : record.controlTime - record.eventTime,
    eventCluster: record.eventCluster,
    controlCluster: record.controlCluster,
    saAvailableBins: record.profile.saAvailableBins,
    preSaMedianNtYr2: record.profile.preSa,
    eventSaMedianNtYr2: record.profile.eventSa,
    postSaMedianNtYr2: record.profile.postSa,
    postMinusPreSaNtYr2: record.profile.postSa === null || record.profile.preSa === null ? null : record.profile.postSa - record.profile.preSa,
    jerkAtEvent: record.profile.jerkAtEvent,
    jerkAfter2to5Peak: record.profile.jerkAfter2to5Peak,
    firstJerkAfter2to5Years: record.profile.firstJerkAfter2to5Years,
    hasJerkAfter2to5: record.profile.hasJerkAfter2to5,
  }));
  const historicalReplication = buildHistoricalReplication(records);
  const warnings: string[] = [];
  if (!sortedMonthly.length) warnings.push("No hubo observaciones BGS mensuales utilizables; el perfil de magnetic jerks sí puede calcularse, pero la aceleración secular queda sin cobertura.");
  if (eventRecords.length && controlRecords.length < eventRecords.length) warnings.push((eventRecords.length - controlRecords.length) + " evento(s) no obtuvieron una época de control con cobertura equivalente y se excluyen de la comparación apareada.");
  if (eventRecords.length > new Set(eventRecords.map(record => record.eventCluster)).size) warnings.push("Los terremotos del mismo año comparten un bloque temporal; los conteos de eventos no se interpretan como observaciones independientes.");
  if (historicalReplication.scaleUsed === "M≥8-USGS") warnings.push("La réplica histórica usa M≥8 de USGS como sensibilidad porque el catálogo actual no aporta suficientes eventos etiquetados Ms; no se equipara Mw/Ms.");
  const eligibleEvents = eventRecords.length;
  const eligibleControls = controlRecords.length;
  const independentEventClusters = new Set(eventRecords.map(record => record.eventCluster)).size;
  const independentControlClusters = new Set(controlRecords.map(record => record.controlCluster ?? "control-" + record.eventCluster)).size;
  let status: CoreSeismicRelativeStudy["status"] = "ready";
  if (independentEventClusters < 5 || eligibleControls < 5) status = "insufficient";
  else if (!sortedMonthly.length) status = "partial";
  const statusMessage = status === "ready"
    ? "Listo: " + eligibleEvents.toLocaleString() + " M7+ con ventana ±" + windowYears + " años y " + eligibleControls.toLocaleString() + " controles; la incertidumbre se resume en " + independentEventClusters + " bloques temporales."
    : status === "partial"
      ? "Perfil relativo disponible para " + eligibleEvents.toLocaleString() + " M7+ y jerks; falta cobertura BGS mensual para medir la aceleración secular."
      : "La ventana ±" + windowYears + " años deja " + independentEventClusters + " bloques de eventos y " + eligibleControls + " controles; se muestra como exploración insuficiente, no como una prueba confirmatoria.";
  return {
    status,
    statusMessage,
    windowYears,
    bins,
    eventRows,
    eligibleEvents,
    eligibleControls,
    independentEventClusters,
    independentControlClusters,
    magneticObservations: sortedMonthly.length,
    magneticFirstYear: sortedMonthly[0]?.decimalYear ?? null,
    magneticLastYear: sortedMonthly.at(-1)?.decimalYear ?? null,
    prePost: {
      eventPreSaMedianNtYr2: Number.isFinite(eventPre.value) ? eventPre.value : null,
      eventAtEventSaMedianNtYr2: Number.isFinite(eventAt.value) ? eventAt.value : null,
      eventPostSaMedianNtYr2: Number.isFinite(eventPost.value) ? eventPost.value : null,
      controlPreSaMedianNtYr2: Number.isFinite(controlPre.value) ? controlPre.value : null,
      controlAtEventSaMedianNtYr2: Number.isFinite(controlAt.value) ? controlAt.value : null,
      controlPostSaMedianNtYr2: Number.isFinite(controlPost.value) ? controlPost.value : null,
      postMinusPreDifferenceNtYr2: postPreDifference,
    },
    historicalReplication,
    warnings: [...new Set(warnings)],
  };
}
