export interface EarthquakeFilters {
  startTime: string;
  endTime: string;
  minMagnitude?: number;
  maxMagnitude?: number;
  minDepth?: number;
  maxDepth?: number;
  latitude?: number;
  longitude?: number;
  maxRadiusKm?: number;
  countryCode?: string;
  magnitudeType?: string;
  eventType?: string;
  source?: string;
  reviewedOnly?: boolean;
  search?: string;
  orderBy?: "time" | "time-asc" | "magnitude" | "magnitude-asc";
  limit: number;
  offset: number;
}

export type TectonicRegime =
  | "subduction"
  | "strike_slip"
  | "rift_normal"
  | "collision"
  | "mixed";

export type SequenceClassification =
  | "sequence_likely"
  | "ambiguous"
  | "background_likely";

export interface EarthquakeEvent {
  id: string;
  externalId: string;
  sourceCatalog: string;
  timeUtc: string;
  updatedUtc: string;
  latitude: number;
  longitude: number;
  depthKm: number;
  magnitude: number;
  magnitudeType: string;
  place: string;
  countryOrRegion: string;
  eventType: string;
  status: string;
  network: string;
  locationSource?: string;
  magnitudeSource?: string;
  stationCount?: number;
  gap?: number;
  dmin?: number;
  rms?: number;
  horizontalError?: number;
  depthError?: number;
  magnitudeError?: number;
  magnitudeStationCount?: number;
  sourceUrl?: string;

  /** Homogenized Mw estimate when a reported Mw or supported conversion exists. */
  magnitudeMw?: number | null;
  magnitudeNormalizationMethod?: string;
  magnitudeNormalizationUncertainty?: number | null;
  magnitudeNormalizationWithinRange?: boolean;

  /** Coarse tectonic receiver corridor; not yet an individual mapped fault. */
  receiverZoneId?: string;
  receiverZoneName?: string;
  tectonicRegime?: TectonicRegime;
  receiverZoneDistanceKm?: number;
  receiverZoneInsideCore?: boolean;
  receiverZoneConfidence?: "high" | "medium" | "low";

  /** Experimental causal nearest-neighbour sequence features. */
  parentCandidateId?: string | null;
  parentCandidateTime?: string | null;
  parentCandidateMagnitudeMw?: number | null;
  parentDistanceKm?: number | null;
  parentLagDays?: number | null;
  nearestNeighborLogEta?: number | null;
  sequenceAssociationScorePct?: number;
  backgroundScorePct?: number;
  sequenceClassification?: SequenceClassification;
  sequenceMethod?: "nearest_neighbor_proxy_v1";
  sequenceScoreCalibrated?: false;
}

export interface EarthquakePage {
  events: EarthquakeEvent[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  generatedAt: string;
  provider?: string;
  providerStatus?: string[];
  warnings?: string[];
  catalogMode?: "multisource" | "historical-usgs";
}

export interface EarthquakeStats {
  total: number;
  maxMagnitude: number | null;
  averageMagnitude: number | null;
  averageDepthKm: number | null;
  last24Hours: number;
  last7Days: number;
  last30Days: number;
  latestEvent: EarthquakeEvent | null;
  strongestEvent: EarthquakeEvent | null;
  byYear: Array<{ key: string; count: number; maxMagnitude: number }>;
  byMonth: Array<{ key: string; count: number }>;
  magnitudeBuckets: Array<{ key: string; count: number }>;
  depthBuckets: Array<{ key: string; count: number }>;
  byRegion: Array<{ key: string; count: number }>;
  scatter: Array<{ magnitude: number; depthKm: number; timeUtc: string }>;
}

export interface SyncStatus {
  id: string;
  state: "idle" | "running" | "paused" | "completed" | "failed";
  startTime?: string;
  endTime?: string;
  currentStart?: string;
  currentEnd?: string;
  processed: number;
  inserted: number;
  updated: number;
  errors: string[];
  startedAt?: string;
  updatedAt: string;
  stopped: boolean;
}
