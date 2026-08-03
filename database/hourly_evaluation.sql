-- RDSISMOS: evaluación incremental horaria
-- Ejecutar una sola vez en Supabase SQL Editor después de database/learning.sql.

ALTER TABLE public.migration_country_predictions
  ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;

COMMENT ON COLUMN public.migration_country_predictions.last_checked_at IS
  'Último instante hasta el que la proyección fue revisada por el evaluador en vivo.';

CREATE INDEX IF NOT EXISTS idx_migration_country_predictions_last_checked
  ON public.migration_country_predictions (last_checked_at)
  WHERE last_checked_at IS NOT NULL;

-- Las filas existentes quedan en NULL intencionalmente. La primera revisión
-- volverá a comprobar toda su ventana activa y, desde la segunda, utilizará
-- consultas incrementales con una superposición de seguridad de 48 horas.
