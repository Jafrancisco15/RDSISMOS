export type DataProvider = "Raspberry Shake QuakeLink" | "USGS fallback";

export interface SeismicEvent {
  id: string;
  time: string;
  magnitude: number;
  magnitudeType: string;
  latitude: number;
  longitude: number;
  depthKm: number;
  place: string;
  agency: string;
  source: DataProvider;
  regionId?: string;
  isDominicanRegion?: boolean;
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

export interface ProjectionTarget {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  includesDominicanRepublic: boolean;
}

export interface MigrationProjection {
  id: string;
  status: ProjectionStatus;
  sourceEvent: SeismicEvent;
  sourceRegionName: string;
  startTime: string;
  expiresAt: string;
  maxDays: number;
  magnitudeMin: number;
  magnitudeMax: number;
  targets: ProjectionTarget[];
  matchedEvent: SeismicEvent | null;
  matchedTargetId: string | null;
  consistencyScore: number;
  rationale: string[];
}

export interface MigrationAnalysis {
  score: number;
  level: AlertLevel;
  label: string;
  summary: string;
  leadEvent: SeismicEvent | null;
  leadRegionName: string | null;
  sourceActivityRatio: number;
  caribbeanActivityRatio: number;
  distanceTrendKmPerDay: number;
  approachChainLength: number;
  evidence: string[];
  limitations: string[];
}

export interface EventsApiResponse {
  generatedAt: string;
  windowDays: number;
  refreshSeconds: number;
  provider: DataProvider;
  fallbackUsed: boolean;
  events: SeismicEvent[];
  analysis: MigrationAnalysis;
  projections: MigrationProjection[];
  watchedRegions: WatchedRegion[];
  warning?: string;
}
