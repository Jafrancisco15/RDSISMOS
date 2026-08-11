import type { ScopeHistoricalEvidence } from "@/lib/scopeHistoricalEvidence";
import type {
  HistoricalMigrationCapsule,
  HistoricalMigrationDestination,
  SeismicEvent,
} from "@/lib/types";

export interface ScopeProjectionAnalog {
  event: SeismicEvent;
  similarityPct: number;
  earthScopeEvidencePct: number;
  earthScopeStatus: ScopeHistoricalEvidence["status"];
  stationCount: number;
  azimuthSectors: number;
  nearestStationKm: number | null;
  waveformChecked: boolean;
  waveformConfirmed: boolean;
  waveformStation: string | null;
  weightedSimilarity: number;
  hitCountryCodes: string[];
  controlHitCountryCodes: string[];
  strongestFollower: SeismicEvent | null;
  note: string;
}

export interface ScopeProjectionDestination {
  id: string;
  countryCode: string;
  name: string;
  zoneNames: string[];
  latitude: number;
  longitude: number;
  radiusKm: number;
  probabilityPct: number;
  baselinePct: number;
  liftPct: number;
  analogHits: number;
  controlHits: number;
  earthScopeEvidencePct: number;
  waveformConfirmedHits: number;
  medianLeadDays: number | null;
  strongestObservedMagnitude: number | null;
  surveillanceStart: string;
  surveillanceEnd: string;
  magnitudeMin: number;
  magnitudeMax: number;
}

export interface ScopeProjectionResponse {
  model: "scope-projection-v2";
  generatedAt: string;
  source: SeismicEvent;
  targetCountry: HistoricalMigrationCapsule["targetCountry"];
  providers: {
    eventCatalog: "USGS/NEIC";
    historicalObservation: "EarthScope NSF SAGE";
    note: string;
  };
  historyStart: string;
  historyEnd: string;
  sourceRadiusKm: number;
  analogMagnitudeMin: number;
  analogMagnitudeMax: number;
  analogsFound: number;
  analogsEvaluated: number;
  windowDays: number;
  forecastMagnitudeMin: number;
  forecastMagnitudeMax: number;
  evidenceQualityPct: number;
  earthScopeSupportedAnalogs: number;
  waveformConfirmedAnalogs: number;
  destinations: ScopeProjectionDestination[];
  analogs: ScopeProjectionAnalog[];
  warnings: string[];
  methodology: string[];
  limitations: string[];
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function countryCodeFromKey(value: string) {
  const clean = value.trim();
  if (!clean) return "";
  const parts = clean.split(":");
  return (parts[parts.length - 1] ?? clean).toUpperCase();
}

function normalizedCodes(values: string[] | undefined) {
  return [...new Set((values ?? []).map(countryCodeFromKey).filter(Boolean))];
}

function representativeDestination(items: HistoricalMigrationDestination[]) {
  return [...items].sort((a, b) => (
    (b.analogHits ?? 0) - (a.analogHits ?? 0)
    || (b.liftPct ?? 0) - (a.liftPct ?? 0)
    || b.recurrencePct - a.recurrencePct
  ))[0];
}

function weightedAverage(
  rows: Array<{ value: number; weight: number }>,
  fallback = 0,
) {
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  if (totalWeight <= 0) return fallback;
  return rows.reduce((sum, row) => sum + row.value * row.weight, 0) / totalWeight;
}

export function buildScopeProjection(
  capsule: HistoricalMigrationCapsule,
  evidence: ScopeHistoricalEvidence[],
): ScopeProjectionResponse {
  const evidenceById = new Map(evidence.map((item) => [item.analogEventId, item]));
  const analogs: ScopeProjectionAnalog[] = capsule.analogs.map((analog) => {
    const scopeEvidence = evidenceById.get(analog.analogEvent.id) ?? {
      analogEventId: analog.analogEvent.id,
      stationCount: 0,
      azimuthSectors: 0,
      nearestStationKm: null,
      waveformChecked: false,
      waveformConfirmed: false,
      waveformStation: null,
      evidencePct: 0,
      weightFactor: 0.35,
      status: "limited" as const,
      note: "Sin verificación EarthScope disponible para este análogo.",
    };
    const similarityWeight = clamp(analog.similarityPct / 100, 0.01, 1);
    return {
      event: analog.analogEvent,
      similarityPct: analog.similarityPct,
      earthScopeEvidencePct: scopeEvidence.evidencePct,
      earthScopeStatus: scopeEvidence.status,
      stationCount: scopeEvidence.stationCount,
      azimuthSectors: scopeEvidence.azimuthSectors,
      nearestStationKm: scopeEvidence.nearestStationKm,
      waveformChecked: scopeEvidence.waveformChecked,
      waveformConfirmed: scopeEvidence.waveformConfirmed,
      waveformStation: scopeEvidence.waveformStation,
      weightedSimilarity: similarityWeight * scopeEvidence.weightFactor,
      hitCountryCodes: normalizedCodes(analog.hitCountryCodes),
      controlHitCountryCodes: normalizedCodes(analog.controlHitCountryCodes),
      strongestFollower: analog.strongestFollower,
      note: scopeEvidence.note,
    };
  });

  const totalWeight = analogs.reduce((sum, analog) => sum + analog.weightedSimilarity, 0);
  const grouped = new Map<string, HistoricalMigrationDestination[]>();
  for (const destination of capsule.destinations) {
    const countryCode = (destination.countryCode ?? "").toUpperCase();
    if (!countryCode) continue;
    grouped.set(countryCode, [...(grouped.get(countryCode) ?? []), destination]);
  }

  const destinations: ScopeProjectionDestination[] = [];
  for (const [countryCode, candidates] of grouped) {
    const representative = representativeDestination(candidates);
    if (!representative) continue;
    const hitAnalogs = analogs.filter((analog) => analog.hitCountryCodes.includes(countryCode));
    const controlAnalogs = analogs.filter((analog) => analog.controlHitCountryCodes.includes(countryCode));
    if (!hitAnalogs.length || totalWeight <= 0) continue;

    const weightedHits = hitAnalogs.reduce((sum, analog) => sum + analog.weightedSimilarity, 0);
    const weightedControlHits = controlAnalogs.reduce((sum, analog) => sum + analog.weightedSimilarity, 0);
    const probabilityPct = round2(weightedHits / totalWeight * 100);
    const baselinePct = round2(weightedControlHits / totalWeight * 100);
    const liftPct = round2(probabilityPct - baselinePct);
    if (probabilityPct <= 0 || liftPct <= 0) continue;

    const earthScopeEvidencePct = Math.round(weightedAverage(
      hitAnalogs.map((analog) => ({ value: analog.earthScopeEvidencePct, weight: Math.max(0.01, analog.similarityPct / 100) })),
      0,
    ));
    const zoneNames = [...new Set(candidates.map((item) => item.zoneName).filter((value): value is string => Boolean(value)))];
    const surveillanceStart = representative.surveillanceStart ?? capsule.sourceEvent.time;
    const surveillanceEnd = representative.surveillanceEnd
      ?? new Date(Date.parse(capsule.sourceEvent.time) + capsule.windowDays * 86_400_000).toISOString();

    destinations.push({
      id: `scope-country:${countryCode}:${capsule.sourceEvent.id}`,
      countryCode,
      name: representative.name,
      zoneNames,
      latitude: representative.latitude,
      longitude: representative.longitude,
      radiusKm: representative.radiusKm,
      probabilityPct,
      baselinePct,
      liftPct,
      analogHits: hitAnalogs.length,
      controlHits: controlAnalogs.length,
      earthScopeEvidencePct,
      waveformConfirmedHits: hitAnalogs.filter((analog) => analog.waveformConfirmed).length,
      medianLeadDays: representative.medianLeadDays,
      strongestObservedMagnitude: representative.strongestObservedMagnitude,
      surveillanceStart,
      surveillanceEnd,
      magnitudeMin: representative.magnitudeMin ?? capsule.forecastMagnitudeMin,
      magnitudeMax: representative.magnitudeMax ?? capsule.forecastMagnitudeMax,
    });
  }

  destinations.sort((a, b) => (
    b.liftPct - a.liftPct
    || b.probabilityPct - a.probabilityPct
    || b.earthScopeEvidencePct - a.earthScopeEvidencePct
  ));

  const averageSimilarity = analogs.length
    ? analogs.reduce((sum, analog) => sum + analog.similarityPct, 0) / analogs.length
    : 0;
  const averageScopeEvidence = analogs.length
    ? analogs.reduce((sum, analog) => sum + analog.earthScopeEvidencePct, 0) / analogs.length
    : 0;
  const evidenceQualityPct = Math.round(clamp(
    12 + analogs.length * 3.8 + averageSimilarity * 0.24 + averageScopeEvidence * 0.24,
    20,
    90,
  ));
  const earthScopeSupportedAnalogs = analogs.filter((analog) => analog.earthScopeEvidencePct >= 35).length;
  const waveformConfirmedAnalogs = analogs.filter((analog) => analog.waveformConfirmed).length;
  const warnings: string[] = [];
  if (earthScopeSupportedAnalogs < 3) {
    warnings.push("EarthScope aporta cobertura histórica limitada para varios análogos; la proyección conserva esos casos con peso reducido en lugar de descartarlos.");
  }
  if (!destinations.length) {
    warnings.push("Los análogos evaluados no producen destinos con exceso positivo sobre la línea base después de ponderar la evidencia EarthScope.");
  }

  return {
    model: "scope-projection-v2",
    generatedAt: new Date().toISOString(),
    source: capsule.sourceEvent,
    targetCountry: capsule.targetCountry,
    providers: {
      eventCatalog: "USGS/NEIC",
      historicalObservation: "EarthScope NSF SAGE",
      note: "EarthScope retiró su servicio FDSN Event en 2026; RDSISMOS usa el catálogo NEIC/USGS para la ocurrencia histórica y el archivo EarthScope para ponderar qué tan bien observado estuvo cada análogo.",
    },
    historyStart: capsule.historyStart,
    historyEnd: capsule.historyEnd,
    sourceRadiusKm: capsule.sourceRadiusKm,
    analogMagnitudeMin: capsule.analogMagnitudeMin,
    analogMagnitudeMax: capsule.analogMagnitudeMax,
    analogsFound: capsule.analogsFound,
    analogsEvaluated: analogs.length,
    windowDays: capsule.windowDays,
    forecastMagnitudeMin: capsule.forecastMagnitudeMin,
    forecastMagnitudeMax: capsule.forecastMagnitudeMax,
    evidenceQualityPct,
    earthScopeSupportedAnalogs,
    waveformConfirmedAnalogs,
    destinations,
    analogs,
    warnings,
    methodology: [
      `Se buscan análogos históricos del evento fuente con la misma lógica del Mapa 3D: hasta ${capsule.analogsEvaluated} análogos independientes dentro de ${capsule.sourceRadiusKm.toLocaleString()} km y M${capsule.analogMagnitudeMin.toFixed(1)}–M${capsule.analogMagnitudeMax.toFixed(1)}.`,
      `Para cada análogo se compara una ventana posterior de ${capsule.windowDays} días con una ventana de control anterior de igual duración.`,
      "La ocurrencia de eventos posteriores proviene del catálogo USGS/NEIC. Cada análogo recibe además un peso de observabilidad EarthScope basado en estaciones activas, cobertura azimutal y, para una muestra prioritaria, confirmación de forma de onda archivada.",
      "Probabilidad Scope = suma de similitud × peso EarthScope de los análogos que tuvieron actividad posterior en el país / suma total de pesos de los análogos.",
      "Base Scope usa la misma fórmula en las ventanas de control. Solo se muestran destinos con Probabilidad Scope mayor que la Base Scope.",
      "Un mismo país se consolida una sola vez aunque pertenezca a varias zonas sísmicas internas.",
    ],
    limitations: [
      "La Probabilidad Scope es recurrencia histórica ponderada, no una certeza ni una probabilidad física determinista de ruptura.",
      "EarthScope no mantiene actualmente un catálogo global de eventos FDSN; su papel aquí es aportar evidencia observacional histórica del archivo de estaciones y formas de onda.",
      "La red EarthScope fue más escasa en décadas antiguas y en algunas regiones; por eso la falta de cobertura reduce peso pero no convierte un análogo en falso.",
      "Una forma de onda registrada demuestra observabilidad instrumental del análogo, no causalidad entre el evento fuente y un terremoto posterior distante.",
    ],
  };
}
