-- RDSISMOS: laboratorio aislado de calibración fondo/secuencia.
-- No modifica proyecciones, mapa, historial ni resultados operacionales.

CREATE TABLE IF NOT EXISTS public.sequence_calibration_runs (
  id TEXT PRIMARY KEY,
  model_version_id TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  lookback_days INTEGER NOT NULL,
  minimum_magnitude DOUBLE PRECISION NOT NULL,
  max_events INTEGER NOT NULL,
  events_loaded INTEGER NOT NULL,
  samples_built INTEGER NOT NULL,
  result_payload JSONB NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sequence_calibration_runs_calculated_idx
  ON public.sequence_calibration_runs (calculated_at DESC);

CREATE TABLE IF NOT EXISTS public.sequence_calibration_models (
  run_id TEXT NOT NULL REFERENCES public.sequence_calibration_runs(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (
    scope IN (
      'global',
      'subduction',
      'strike_slip',
      'rift_normal',
      'collision',
      'mixed'
    )
  ),
  sample_count INTEGER NOT NULL,
  train_sample_count INTEGER NOT NULL,
  test_sample_count INTEGER NOT NULL,
  positive_count INTEGER NOT NULL,
  negative_count INTEGER NOT NULL,
  fitted_independently BOOLEAN NOT NULL,
  fallback_scope TEXT,
  intercept DOUBLE PRECISION,
  slope DOUBLE PRECISION,
  feature_mean DOUBLE PRECISION,
  feature_scale DOUBLE PRECISION,
  raw_brier_score DOUBLE PRECISION,
  calibrated_brier_score DOUBLE PRECISION,
  brier_skill_vs_raw DOUBLE PRECISION,
  model_payload JSONB,
  raw_metrics JSONB,
  calibrated_metrics JSONB,
  PRIMARY KEY (run_id, scope)
);

CREATE INDEX IF NOT EXISTS sequence_calibration_models_scope_idx
  ON public.sequence_calibration_models (scope, run_id);

COMMENT ON TABLE public.sequence_calibration_runs IS
  'Resultados de investigación para calibrar el proxy fondo/secuencia por régimen tectónico. No alimentan el pronóstico operacional.';

COMMENT ON TABLE public.sequence_calibration_models IS
  'Modelos logísticos de calibración y métricas fuera de muestra por régimen tectónico. Los labels son proxies, no causalidad física demostrada.';
