-- Prospective geomagnetic experiment ledger.
-- Forecasts are immutable snapshots: recalibration only changes future trials.

CREATE TABLE IF NOT EXISTS geomagnetic_model_state (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  emission_threshold DOUBLE PRECISION NOT NULL DEFAULT 60,
  window_hours INTEGER NOT NULL DEFAULT 72,
  radius_km DOUBLE PRECISION NOT NULL DEFAULT 200,
  magnitude_min DOUBLE PRECISION NOT NULL DEFAULT 3,
  evaluated_trials INTEGER NOT NULL DEFAULT 0,
  hits INTEGER NOT NULL DEFAULT 0,
  misses INTEGER NOT NULL DEFAULT 0,
  omissions INTEGER NOT NULL DEFAULT 0,
  correct_rejections INTEGER NOT NULL DEFAULT 0,
  previous_threshold DOUBLE PRECISION,
  calibration_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS geomagnetic_trials (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL REFERENCES geomagnetic_model_state(id),
  model_version INTEGER NOT NULL,
  station_code TEXT NOT NULL,
  station_name TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  surveillance_start TIMESTAMPTZ NOT NULL,
  surveillance_end TIMESTAMPTZ NOT NULL,
  radius_km DOUBLE PRECISION NOT NULL,
  magnitude_min DOUBLE PRECISION NOT NULL,
  locality_score DOUBLE PRECISION NOT NULL,
  threshold_snapshot DOUBLE PRECISION NOT NULL,
  emitted BOOLEAN NOT NULL,
  reference_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  metrics_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','evaluated')),
  occurred BOOLEAN,
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('hit','miss','omission','correct_rejection')),
  event_count INTEGER NOT NULL DEFAULT 0,
  first_event_external_id TEXT,
  first_event_time TIMESTAMPTZ,
  first_event_magnitude DOUBLE PRECISION,
  first_event_depth_km DOUBLE PRECISION,
  first_event_place TEXT,
  strongest_event_external_id TEXT,
  strongest_event_magnitude DOUBLE PRECISION,
  evaluated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS geomagnetic_trials_due_idx ON geomagnetic_trials(status, surveillance_end);
CREATE INDEX IF NOT EXISTS geomagnetic_trials_station_issued_idx ON geomagnetic_trials(station_code, issued_at DESC);
CREATE INDEX IF NOT EXISTS geomagnetic_trials_outcome_idx ON geomagnetic_trials(outcome, evaluated_at DESC);

INSERT INTO geomagnetic_model_state (
  id, version, emission_threshold, window_hours, radius_km, magnitude_min,
  calibration_reason
) VALUES (
  'geomagnetic-locality-v1', 1, 60, 72, 200, 3,
  'Parámetros iniciales del experimento prospectivo.'
)
ON CONFLICT (id) DO NOTHING;
