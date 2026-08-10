import type { EarthquakeEvent } from "./earthquakes/types";
import type { CatalogProvider, CountryTarget } from "./types";

export type GlobeProjectionKind = "historical-country" | "regional-etas";

export interface GlobeProjection {
  id: string;
  projectionKind: GlobeProjectionKind;
  snapshotDate: string;
  generatedAt: string;
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
  analogsEvaluated?: number;
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
  viewDate: string;
  comparisonDate: string | null;
  observedWindowDays: number;
  observedMinimumMagnitude: number;
  observedTotal: number;
  observedEvents: EarthquakeEvent[];
  provider: CatalogProvider;
  providerStatus: string[];
  projectionsTotal: number;
  projections: GlobeProjection[];
  comparisonProjections: GlobeProjection[];
  target: CountryTarget;
  countries: CountryTarget[];
  databaseConfigured: boolean;
  databaseConnected: boolean;
  warnings: string[];
}
