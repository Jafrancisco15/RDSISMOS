-- Persistent registry for regional ETAS projections.
-- Run once in Supabase SQL Editor after database/learning.sql.

CREATE TABLE IF NOT EXISTS regional_etas_projections (
  id TEXT PRIMARY KEY,
  source_event_fingerprint TEXT NOT NULL,
  source_event_external_id TEXT NOT NULL,
  source_time TIMESTAMPTZ NOT NULL,
  source_magnitude DOUBLE PRECISION NOT NULL,
  source_depth_km DOUBLE PRECISION NOT NULL,
  source_latitude DOUBLE PRECISION NOT NULL,
  source_longitude DOUBLE PRECISION NOT NULL,
  source_place TEXT NOT NULL,
  target_country_code TEXT NOT NULL,
  target_country_name TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  last_recomputed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  surveillance_start TIMESTAMPTZ NOT NULL,
  surveillance_end TIMESTAMPTZ NOT NULL,
  zone_name TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  radius_km DOUBLE PRECISION NOT NULL,
  probability_pct DOUBLE PRECISION NOT NULL CHECK (probability_pct >= 0 AND probability_pct <= 100),
  baseline_probability_pct DOUBLE PRECISION NOT NULL CHECK (baseline_probability_pct >= 0 AND baseline_probability_pct <= 100),
  excess_probability_pct DOUBLE PRECISION NOT NULL,
  expected_count DOUBLE PRECISION NOT NULL,
  background_expected_count DOUBLE PRECISION NOT NULL,
  magnitude_min DOUBLE PRECISION NOT NULL,
  magnitude_max DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'fulfilled', 'not_fulfilled')),
  association_class TEXT NOT NULL DEFAULT 'none'
    CHECK (association_class IN ('none', 'migration_compatible', 'possible_association', 'background_likely')),
  migration_compatibility_pct DOUBLE PRECISION,
  matched_event_external_id TEXT,
  matched_event_time TIMESTAMPTZ,
  matched_event_magnitude DOUBLE PRECISION,
  matched_event_depth_km DOUBLE PRECISION,
  matched_event_place TEXT,
  matched_event_latitude DOUBLE PRECISION,
  matched_event_longitude DOUBLE PRECISION,
  projection_payload JSONB NOT NULL,
  evaluation_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (target_country_code, source_event_fingerprint)
);

CREATE INDEX IF NOT EXISTS regional_etas_active_end_idx
  ON regional_etas_projections (status, surveillance_end);
CREATE INDEX IF NOT EXISTS regional_etas_country_issued_idx
  ON regional_etas_projections (target_country_code, issued_at DESC);
CREATE INDEX IF NOT EXISTS regional_etas_source_time_idx
  ON regional_etas_projections (source_time DESC);
CREATE INDEX IF NOT EXISTS regional_etas_resolved_idx
  ON regional_etas_projections (resolved_at DESC)
  WHERE resolved_at IS NOT NULL;

COMMENT ON TABLE regional_etas_projections IS
  'Immutable issuance and lifecycle registry for regional ETAS forecasts. Outside events are contextual background and never count as forecast errors.';
COMMENT ON COLUMN regional_etas_projections.migration_compatibility_pct IS
  'Statistical ETAS-vs-background association score. It is not proof of physical causation.';
