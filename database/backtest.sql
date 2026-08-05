-- RDSISMOS: registro de validaciones retrospectivas.
-- Ejecutar una sola vez en Supabase SQL Editor después de database/learning.sql.

CREATE TABLE IF NOT EXISTS public.migration_backtest_runs (
  id TEXT PRIMARY KEY,
  model_version_id TEXT NOT NULL,
  cohort_start TIMESTAMPTZ NOT NULL,
  cohort_end TIMESTAMPTZ NOT NULL,
  issued_delay_hours DOUBLE PRECISION NOT NULL DEFAULT 1,
  source_magnitude_min DOUBLE PRECISION NOT NULL,
  source_limit INTEGER NOT NULL,
  sources_available INTEGER NOT NULL,
  sources_processed INTEGER NOT NULL,
  projections_scored INTEGER NOT NULL,
  fulfilled_count INTEGER NOT NULL,
  possible_association_count INTEGER NOT NULL,
  background_likely_count INTEGER NOT NULL,
  no_event_count INTEGER NOT NULL,
  average_probability DOUBLE PRECISION NOT NULL,
  observed_rate DOUBLE PRECISION NOT NULL,
  brier_score DOUBLE PRECISION NOT NULL,
  baseline_brier_score DOUBLE PRECISION NOT NULL,
  brier_skill_score DOUBLE PRECISION,
  log_loss DOUBLE PRECISION NOT NULL,
  accuracy_at_50 DOUBLE PRECISION NOT NULL,
  result_payload JSONB NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS migration_backtest_runs_calculated_idx
  ON public.migration_backtest_runs (calculated_at DESC);

COMMENT ON TABLE public.migration_backtest_runs IS
  'Validaciones retrospectivas sin fuga temporal: cada pronóstico usa solo información anterior a su evento precedente y se evalúa en una ventana ya cerrada.';
