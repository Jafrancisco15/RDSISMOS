-- RDSISMOS · Geomagnetismo prospectivo v2
-- Experimento primario fijo: SJG, M>=4.5, <=200 km, próximos 7 días.
-- El ledger anterior M3/72h se conserva separado y no se mezcla con estas métricas.

CREATE TABLE IF NOT EXISTS geomagnetic_prob_model (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  weights JSONB NOT NULL DEFAULT '{}'::jsonb,
  learning_rate DOUBLE PRECISION NOT NULL DEFAULT 0.05,
  l2 DOUBLE PRECISION NOT NULL DEFAULT 0.002,
  evaluated_forecasts INTEGER NOT NULL DEFAULT 0,
  last_update_reason TEXT NOT NULL DEFAULT 'Modelo inicial.',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS geomagnetic_prob_forecasts (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  model_version INTEGER NOT NULL,
  station_code TEXT NOT NULL,
  station_name TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  radius_km DOUBLE PRECISION NOT NULL,
  magnitude_min DOUBLE PRECISION NOT NULL,
  baseline_probability DOUBLE PRECISION NOT NULL,
  combined_probability DOUBLE PRECISION NOT NULL,
  baseline_expected_count DOUBLE PRECISION NOT NULL,
  geomag_log_odds_delta DOUBLE PRECISION NOT NULL,
  features_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  weights_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  diagnostics_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','evaluated')),
  occurred BOOLEAN,
  event_count INTEGER NOT NULL DEFAULT 0,
  first_event_external_id TEXT,
  first_event_time TIMESTAMPTZ,
  first_event_magnitude DOUBLE PRECISION,
  first_event_depth_km DOUBLE PRECISION,
  first_event_place TEXT,
  strongest_event_external_id TEXT,
  strongest_event_magnitude DOUBLE PRECISION,
  brier_baseline DOUBLE PRECISION,
  brier_combined DOUBLE PRECISION,
  information_gain_bits DOUBLE PRECISION,
  evaluated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS geomagnetic_prob_due_idx ON geomagnetic_prob_forecasts(status, window_end);
CREATE INDEX IF NOT EXISTS geomagnetic_prob_issue_idx ON geomagnetic_prob_forecasts(issued_at DESC);

INSERT INTO geomagnetic_prob_model (
  id, version, weights, learning_rate, l2, evaluated_forecasts, last_update_reason
) VALUES (
  'sjg-etas-geomag-v2',
  1,
  '{"locality":0,"p95RobustZ":0,"dBdt":0,"ulfEnergy":0,"sqResidual":0,"trend27d":0,"spatialIndependence":0}'::jsonb,
  0.05,
  0.002,
  0,
  'Pesos iniciales nulos: ETAS+Geomag comienza exactamente igual al baseline ETAS.'
)
ON CONFLICT (id) DO NOTHING;
