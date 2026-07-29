-- Phase 1 of the RDSISMOS learning loop.
-- Run this file in Supabase SQL Editor after database/earthquakes.sql.

CREATE TABLE IF NOT EXISTS migration_model_versions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'champion' CHECK (status IN ('champion', 'challenger', 'retired')),
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  training_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS migration_capsules (
  id TEXT PRIMARY KEY,
  model_version_id TEXT NOT NULL REFERENCES migration_model_versions(id),
  source_event_external_id TEXT NOT NULL,
  source_time TIMESTAMPTZ NOT NULL,
  source_magnitude DOUBLE PRECISION NOT NULL,
  source_depth_km DOUBLE PRECISION NOT NULL,
  source_latitude DOUBLE PRECISION NOT NULL,
  source_longitude DOUBLE PRECISION NOT NULL,
  source_place TEXT NOT NULL,
  target_country_code TEXT NOT NULL,
  target_country_name TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  surveillance_start TIMESTAMPTZ NOT NULL,
  surveillance_end TIMESTAMPTZ NOT NULL,
  forecast_magnitude_min DOUBLE PRECISION NOT NULL,
  forecast_magnitude_max DOUBLE PRECISION NOT NULL,
  confidence_pct DOUBLE PRECISION NOT NULL,
  analogs_found INTEGER NOT NULL,
  analogs_evaluated INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'due', 'evaluated', 'failed')),
  capsule_payload JSONB NOT NULL,
  evaluated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS migration_country_predictions (
  id TEXT PRIMARY KEY,
  capsule_id TEXT NOT NULL REFERENCES migration_capsules(id) ON DELETE CASCADE,
  zone_id TEXT NOT NULL,
  zone_name TEXT NOT NULL,
  country_code TEXT NOT NULL,
  country_name TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  radius_km DOUBLE PRECISION NOT NULL,
  probability_pct DOUBLE PRECISION NOT NULL CHECK (probability_pct >= 0 AND probability_pct <= 100),
  baseline_probability_pct DOUBLE PRECISION NOT NULL CHECK (baseline_probability_pct >= 0 AND baseline_probability_pct <= 100),
  excess_probability_pct DOUBLE PRECISION NOT NULL,
  analog_hits INTEGER NOT NULL,
  control_hits INTEGER NOT NULL,
  median_lead_days DOUBLE PRECISION,
  surveillance_start TIMESTAMPTZ NOT NULL,
  surveillance_end TIMESTAMPTZ NOT NULL,
  magnitude_min DOUBLE PRECISION NOT NULL,
  magnitude_max DOUBLE PRECISION NOT NULL,
  prediction_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (capsule_id, zone_id, country_code)
);

CREATE TABLE IF NOT EXISTS migration_outcomes (
  prediction_id TEXT PRIMARY KEY REFERENCES migration_country_predictions(id) ON DELETE CASCADE,
  occurred BOOLEAN NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  first_event_external_id TEXT,
  first_event_time TIMESTAMPTZ,
  first_event_magnitude DOUBLE PRECISION,
  first_event_depth_km DOUBLE PRECISION,
  first_event_place TEXT,
  first_event_latitude DOUBLE PRECISION,
  first_event_longitude DOUBLE PRECISION,
  strongest_event_external_id TEXT,
  strongest_event_magnitude DOUBLE PRECISION,
  days_to_first_event DOUBLE PRECISION,
  evaluation_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS migration_model_metrics (
  id BIGSERIAL PRIMARY KEY,
  model_version_id TEXT NOT NULL REFERENCES migration_model_versions(id),
  country_code TEXT,
  sample_count INTEGER NOT NULL,
  positive_count INTEGER NOT NULL,
  average_probability DOUBLE PRECISION NOT NULL,
  observed_rate DOUBLE PRECISION NOT NULL,
  brier_score DOUBLE PRECISION NOT NULL,
  log_loss DOUBLE PRECISION NOT NULL,
  accuracy_at_50 DOUBLE PRECISION NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS migration_capsules_status_end_idx
  ON migration_capsules (status, surveillance_end);
CREATE INDEX IF NOT EXISTS migration_capsules_source_event_idx
  ON migration_capsules (source_event_external_id);
CREATE INDEX IF NOT EXISTS migration_predictions_capsule_idx
  ON migration_country_predictions (capsule_id);
CREATE INDEX IF NOT EXISTS migration_predictions_country_end_idx
  ON migration_country_predictions (country_code, surveillance_end);
CREATE INDEX IF NOT EXISTS migration_outcomes_evaluated_idx
  ON migration_outcomes (evaluated_at DESC);
CREATE INDEX IF NOT EXISTS migration_metrics_model_country_idx
  ON migration_model_metrics (model_version_id, country_code, calculated_at DESC);

INSERT INTO migration_model_versions (id, name, status, parameters)
VALUES (
  'migration-country-v2',
  'Analogía histórica por país con ventana de control',
  'champion',
  '{"magnitudeWeight":0.42,"depthWeight":0.24,"distanceWeight":0.26,"magnitudeTypeWeight":0.08,"maxAnalogs":10,"controlGapDays":7}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  parameters = EXCLUDED.parameters,
  updated_at = NOW();
