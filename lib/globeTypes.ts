import type { EarthquakeEvent } from "./earthquakes/types";

export interface GlobeProjection {
  id: string;
  countryCode: string;
  countryName: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  probabilityPct: number;
  baselinePct: number;
  liftPct: number;
  surveillanceStart: string;
  surveillanceEnd: string;
  magnitudeMin: number;
  magnitudeMax: number;
  analogHits: number;
  controlHits: number;
  medianLeadDays: number | null;
  sourceEvent: {
    id: string;
    time: string;
    magnitude: number;
    latitude: number;
    longitude: number;
    place: string;
  };
  confidencePct: number;
}

export interface SeismicGlobeResponse {
  generatedAt: string;
  observedWindowDays: number;
  observedMinimumMagnitude: number;
  observedTotal: number;
  observedEvents: EarthquakeEvent[];
  projectionsTotal: number;
  projections: GlobeProjection[];
  databaseConfigured: boolean;
  databaseConnected: boolean;
  warnings: string[];
}
