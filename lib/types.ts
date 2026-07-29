export type EventSource =
  | "Raspberry Shake QuakeLink"
  | "USGS ComCat"
  | "USGS real-time";

export type CatalogProvider =
  | "Raspberry Shake + USGS"
  | "Raspberry Shake"
  | "USGS";

export interface CountryTarget {
  code: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
}

export interface SeismicEvent {
  id: string;
  time: string;
  updatedAt?: string;
  magnitude: number;
  magnitudeType: string;
  latitude: number;
  longitude: number;
  depthKm: number;
  place: string;
  agency: string;
  source: EventSource;
  detailUrl?: string;
  regionId?: string;
  isTargetRegion?: boolean;
}

export interface WatchedRegion {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  historicalNote: string;
}

export type AlertLevel = "green" | "yellow" | "orange" | "red";
export type ProjectionStatus = "active" | "fulfilled" | "expired";

export interface EtasModelParameters {
  modelName: string;
  magnitudeCompleteness: number;
  productivityK: number;
  productivityAlpha: number;
  omoriC: number;
  omoriP: number;
  spatialQ: number;
  gutenbergRichterB: number;
  calibration: string;
}

export interface ProjectedZone {
  latitude: number;
  longitude: number;
  radiusKm: number;
  name: string;
}

export interface MigrationProjection {
  id: string;
  parentEventId: string;
  status: ProjectionStatus;
  sourceEvent: SeismicEvent;
  sourceRegionName: string;
  targetCountry: CountryTarget;
  projectedZone: ProjectedZone;
  startTime: string;
  expiresAt: string;
  maxDays: number;
  magnitudeMin: number;
  magnitudeMax: number;
  probabilityPct: number;
  expectedCount: number;
  matchedEvent: SeismicEvent | null;
  model: EtasModelParameters;
  rationale: string[];
}

export interface HistoricalMigrationDestination {
  zoneId: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  recurrencePct: number;
  relativeWeightPct: number;
  analogHits: number;
  weightedHits: number;
  targetOverlap: boolean;
  medianLeadDays: number | null;
  strongestObservedMagnitude: number | null;
}

export interface HistoricalAnalogEvidence {
  analogEvent: SeismicEvent;
  similarityPct: number;
  followerCount: number;
  hitZoneIds: string[];
  strongestFollower: SeismicEvent | null;
}

export interface HistoricalMigrationCapsule {
  id: string;
  generatedAt: string;
  sourceEvent: SeismicEvent;
  targetCountry: CountryTarget;
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
  confidencePct: number;
  destinations: HistoricalMigrationDestination[];
  analogs: HistoricalAnalogEvidence[];
  modelName: string;
  methodology: string[];
  limitations: string[];
}

export interface MigrationAnalysis {
  score: number;
  level: AlertLevel;
  label: string;
  summary: string;
  targetActivityRatio: number;
  recentRatePerDay: number;
  baselineRatePerDay: number;
  activeCapsules: number;
  maxCapsuleProbabilityPct: number;
  evidence: string[];
  limitations: string[];
}

export interface EventsApiResponse {
  generatedAt: string;
  windowDays: number;
  refreshSeconds: number;
  provider: CatalogProvider;
  providerStatus: string[];
  events: SeismicEvent[];
  analysis: MigrationAnalysis;
  projections: MigrationProjection[];
  watchedRegions: WatchedRegion[];
  target: CountryTarget;
  countries: CountryTarget[];
  warning?: string;
}

export interface MapLayerVisibility {
  occurred: boolean;
  faults: boolean;
  projected: boolean;
  preceding: boolean;
  historical: boolean;
}
