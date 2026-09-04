import type { CometInSarCatalog } from "./cometInSAR";
import type { GnssEventSource, NglGnssResult, Phase4GnssStation } from "./nglGnss";
import { greatCircleDistanceKm } from "./nglGnss";
import type { TectonicStatePhase4Seed } from "./tectonicStatePhase4Bridge";

export type Phase4ReadinessLabel = "insufficient" | "provisional" | "ready";

export interface Phase4DeformationCell {
  id: string;
  latitude: number;
  longitude: number;
  sizeDeg: number;
  uxMm: number;
  uyMm: number;
  uzMm: number;
  horizontalMm: number;
  vectorMm: number;
  uncertaintyMm: number;
  supportScore: number;
  stationCount: number;
  meanDistanceKm: number;
  phase3ConstraintCount: number;
  structureResolutionScore: number | null;
}

export interface Phase4ReadinessCheck {
  id: "gnss" | "geometry" | "precision" | "field" | "phase3" | "insar";
  label: string;
  pass: boolean;
  required: boolean;
  value: string;
  note: string;
}

export interface Phase4Readiness {
  readyForPhase5: boolean;
  score: number;
  label: Phase4ReadinessLabel;
  checks: Phase4ReadinessCheck[];
  meaning: string;
}

export interface TectonicStatePhase4Result {
  phase: 4;
  version: "0.1";
  mode: "observed-geodetic-deformation";
  available: boolean;
  generatedAt: string;
  sourceEventId: string;
  phase3GatePassed: boolean;
  phase3ConstraintCount: number;
  gnss: NglGnssResult;
  insar: CometInSarCatalog;
  cells: Phase4DeformationCell[];
  stationCount: number;
  azimuthCoverageDeg: number;
  azimuthGapDeg: number;
  maxVectorMm: number | null;
  medianVectorMm: number | null;
  medianUncertaintyMm: number | null;
  strongCellCount: number;
  readiness: Phase4Readiness;
  note: string;
  warnings: string[];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
function normalizeLongitude(value: number) {
  let result = value;
  while (result > 180) result -= 360;
  while (result < -180) result += 360;
  return result;
}

function azimuthGeometry(stations: Phase4GnssStation[]) {
  const azimuths = stations.map((station) => ((station.azimuthDeg % 360) + 360) % 360).sort((a, b) => a - b);
  if (azimuths.length < 2) return { coverageDeg: 0, gapDeg: 360 };
  const gaps = azimuths.map((value, index) => {
    const next = index === azimuths.length - 1 ? (azimuths[0] ?? 0) + 360 : azimuths[index + 1] ?? value;
    return next - value;
  });
  const gapDeg = Math.max(...gaps);
  return { coverageDeg: 360 - gapDeg, gapDeg };
}

function structureAt(latitude: number, longitude: number, seed: TectonicStatePhase4Seed) {
  const nearby = seed.constraints.map((constraint) => ({
    constraint,
    distanceKm: greatCircleDistanceKm(latitude, longitude, constraint.latitude, constraint.longitude),
  })).filter((item) => item.distanceKm <= 500);
  if (!nearby.length) return { count: 0, resolution: null as number | null };
  let numerator = 0;
  let denominator = 0;
  for (const item of nearby) {
    const weight = 1 / (1 + (item.distanceKm / 180) ** 2);
    numerator += item.constraint.resolutionScore * weight;
    denominator += weight;
  }
  return { count: nearby.length, resolution: denominator > 0 ? Math.round(numerator / denominator) : null };
}

export function buildPhase4DeformationField(
  source: Pick<GnssEventSource, "latitude" | "longitude">,
  stations: Phase4GnssStation[],
  seed: TectonicStatePhase4Seed,
  options: { stepDeg?: number; halfSpanDeg?: number } = {},
): Phase4DeformationCell[] {
  const usable = stations.filter((station) => station.qualityScore >= 25 && Number.isFinite(station.vectorMm));
  if (!usable.length) return [];
  const stepDeg = clamp(options.stepDeg ?? 1.5, 0.5, 4);
  const halfSpanDeg = clamp(options.halfSpanDeg ?? 7.5, 3, 12);
  const cells: Phase4DeformationCell[] = [];

  for (let latitude = source.latitude - halfSpanDeg; latitude <= source.latitude + halfSpanDeg + 1e-6; latitude += stepDeg) {
    if (latitude < -88 || latitude > 88) continue;
    for (let longitude = source.longitude - halfSpanDeg; longitude <= source.longitude + halfSpanDeg + 1e-6; longitude += stepDeg) {
      const lon = normalizeLongitude(longitude);
      const nearby = usable.map((station) => ({
        station,
        distanceKm: greatCircleDistanceKm(latitude, lon, station.latitude, station.longitude),
      })).filter((item) => item.distanceKm <= 1600);
      const minimumStations = usable.length >= 2 ? 2 : 1;
      if (nearby.length < minimumStations) continue;

      let totalWeight = 0;
      let ux = 0;
      let uy = 0;
      let uz = 0;
      let uncertaintyWeighted = 0;
      let distanceWeighted = 0;
      let qualityWeighted = 0;
      for (const item of nearby) {
        const quality01 = clamp(item.station.qualityScore / 100, 0.05, 1);
        const distanceWeight = 1 / (1 + (item.distanceKm / 400) ** 2);
        const precisionWeight = 1 / (1 + (item.station.vectorUncertaintyMm / 25) ** 2);
        const weight = quality01 * distanceWeight * precisionWeight;
        totalWeight += weight;
        ux += item.station.eastMm * weight;
        uy += item.station.northMm * weight;
        uz += item.station.upMm * weight;
        uncertaintyWeighted += item.station.vectorUncertaintyMm * weight;
        distanceWeighted += item.distanceKm * weight;
        qualityWeighted += item.station.qualityScore * weight;
      }
      if (!(totalWeight > 0)) continue;
      ux /= totalWeight;
      uy /= totalWeight;
      uz /= totalWeight;
      const meanDistanceKm = distanceWeighted / totalWeight;
      const meanQuality = qualityWeighted / totalWeight;
      const uncertaintyMm = (uncertaintyWeighted / totalWeight) / Math.sqrt(Math.max(1, nearby.length));
      const horizontalMm = Math.hypot(ux, uy);
      const vectorMm = Math.hypot(horizontalMm, uz);
      const supportScore = Math.round(100 * clamp(
        0.34 * Math.min(1, nearby.length / 4)
        + 0.28 * (meanQuality / 100)
        + 0.22 * Math.exp(-meanDistanceKm / 850)
        + 0.16 * Math.exp(-uncertaintyMm / 35),
        0, 1,
      ));
      const structure = structureAt(latitude, lon, seed);
      cells.push({
        id: `${latitude.toFixed(2)}:${lon.toFixed(2)}`,
        latitude: Number(latitude.toFixed(4)),
        longitude: Number(lon.toFixed(4)),
        sizeDeg: stepDeg,
        uxMm: Number(ux.toFixed(2)),
        uyMm: Number(uy.toFixed(2)),
        uzMm: Number(uz.toFixed(2)),
        horizontalMm: Number(horizontalMm.toFixed(2)),
        vectorMm: Number(vectorMm.toFixed(2)),
        uncertaintyMm: Number(uncertaintyMm.toFixed(2)),
        supportScore,
        stationCount: nearby.length,
        meanDistanceKm: Number(meanDistanceKm.toFixed(1)),
        phase3ConstraintCount: structure.count,
        structureResolutionScore: structure.resolution,
      });
    }
  }
  return cells.sort((a, b) => b.supportScore - a.supportScore || b.vectorMm - a.vectorMm).slice(0, 600);
}

function readiness(
  stations: Phase4GnssStation[],
  cells: Phase4DeformationCell[],
  seed: TectonicStatePhase4Seed,
  insar: CometInSarCatalog,
): Phase4Readiness {
  const geometry = azimuthGeometry(stations);
  const medianUncertainty = median(stations.map((station) => station.vectorUncertaintyMm));
  const strongCells = cells.filter((cell) => cell.supportScore >= 42).length;
  const checks: Phase4ReadinessCheck[] = [
    {
      id: "gnss", label: "GNSS observado", required: true, pass: stations.length >= 3,
      value: `${stations.length} estaciones`, note: "Se requieren al menos tres estaciones con solución pre/post para resolver un campo espacial básico.",
    },
    {
      id: "geometry", label: "Geometría", required: true, pass: stations.length >= 3 && geometry.coverageDeg >= 120,
      value: `${geometry.coverageDeg.toFixed(0)}° cubiertos · gap ${geometry.gapDeg.toFixed(0)}°`, note: "Cobertura azimutal alrededor del evento; una red concentrada en un solo lado limita la interpretación espacial.",
    },
    {
      id: "precision", label: "Precisión", required: true, pass: medianUncertainty !== null && medianUncertainty <= 40,
      value: medianUncertainty === null ? "N/D" : `${medianUncertainty.toFixed(1)} mm mediana`, note: "Incertidumbre combinada de los saltos E/N/U después de retirar tendencia pre-evento.",
    },
    {
      id: "field", label: "Campo U", required: true, pass: strongCells >= 5,
      value: `${strongCells} celdas soporte ≥42`, note: "Cantidad de celdas Ux/Uy/Uz con soporte geométrico útil.",
    },
    {
      id: "phase3", label: "Estructura Fase 3", required: true, pass: seed.gatePassed && seed.acceptedConstraintCount > 0,
      value: seed.gatePassed ? `${seed.acceptedConstraintCount} constraints` : "gate no superado", note: "La deformación GNSS puede existir sin este check, pero la futura Fase 5 no debe acoplarla a estructura interna débil.",
    },
    {
      id: "insar", label: "InSAR", required: false, pass: insar.coseismicCount > 0,
      value: `${insar.coseismicCount} coseísmicos catalogados`, note: "Control complementario. En v0.1 se descubre el catálogo; LOS raster aún no entra al campo numérico.",
    },
  ];
  const weights: Record<Phase4ReadinessCheck["id"], number> = { gnss: 28, geometry: 20, precision: 18, field: 18, phase3: 16, insar: 0 };
  const score = checks.reduce((sum, check) => sum + (check.pass ? weights[check.id] : 0), 0);
  const requiredPass = checks.filter((check) => check.required).every((check) => check.pass);
  const readyForPhase5 = requiredPass && score >= 75;
  const label: Phase4ReadinessLabel = readyForPhase5 ? "ready" : stations.length >= 2 ? "provisional" : "insufficient";
  return {
    readyForPhase5,
    score,
    label,
    checks,
    meaning: readyForPhase5
      ? "Fase 4 tiene deformación GNSS, geometría, precisión y estructura Fase 3 suficientes para preparar el acoplamiento mecánico de Fase 5."
      : "La deformación observada sigue siendo válida como observación, pero faltan controles requeridos antes de usarla como entrada mecánica de Fase 5.",
  };
}

export function buildTectonicStatePhase4Result(
  source: GnssEventSource,
  seed: TectonicStatePhase4Seed,
  gnss: NglGnssResult,
  insar: CometInSarCatalog,
): TectonicStatePhase4Result {
  const stations = gnss.stations;
  const cells = buildPhase4DeformationField(source, stations, seed);
  const geometry = azimuthGeometry(stations);
  const stationVectors = stations.map((station) => station.vectorMm);
  const stationUncertainty = stations.map((station) => station.vectorUncertaintyMm);
  const strongCellCount = cells.filter((cell) => cell.supportScore >= 42).length;
  const ready = readiness(stations, cells, seed, insar);
  const warnings = [...gnss.warnings, ...insar.warnings];
  if (!seed.gatePassed) warnings.push("Fase 3 no pasó su gate: GNSS se muestra, pero ningún constraint δVp/δVs se fusiona con el campo de deformación.");
  if (!insar.available) warnings.push("InSAR no está disponible para este evento o no fue reconocido; Fase 4 continúa en modo GNSS.");

  return {
    phase: 4,
    version: "0.1",
    mode: "observed-geodetic-deformation",
    available: gnss.available,
    generatedAt: new Date().toISOString(),
    sourceEventId: source.id,
    phase3GatePassed: seed.gatePassed,
    phase3ConstraintCount: seed.acceptedConstraintCount,
    gnss,
    insar,
    cells,
    stationCount: stations.length,
    azimuthCoverageDeg: Number(geometry.coverageDeg.toFixed(1)),
    azimuthGapDeg: Number(geometry.gapDeg.toFixed(1)),
    maxVectorMm: stationVectors.length ? Number(Math.max(...stationVectors).toFixed(2)) : null,
    medianVectorMm: stationVectors.length ? Number((median(stationVectors) ?? 0).toFixed(2)) : null,
    medianUncertaintyMm: stationUncertainty.length ? Number((median(stationUncertainty) ?? 0).toFixed(2)) : null,
    strongCellCount,
    readiness: ready,
    note: "Fase 4 v0.1 reconstruye un campo Ux/Uy/Uz desde desplazamientos GNSS observados después de retirar tendencia pre-evento. Los constraints de Fase 3 solo anotan soporte estructural; nunca modifican el desplazamiento medido. InSAR es catálogo independiente hasta incorporar LOS raster validado.",
    warnings: [...new Set(warnings)].slice(0, 32),
  };
}
