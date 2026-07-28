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
  watchedRegions: WatchedRegion[];
  warning?: string;
}
