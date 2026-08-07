-- RDSISMOS: automatización operacional de generación + evaluación
-- Ejecutar una vez en Supabase SQL Editor.
-- Requiere pg_cron, pg_net y el secreto Vault `rdsismos_cron_secret` ya usado por RDSISMOS.

-- Evita duplicar nuestras tareas si este script se vuelve a ejecutar.
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname IN (
  'rdsismos-hourly-generation',
  'rdsismos-hourly-evaluation-v2'
);

-- 1) Busca eventos precedentes nuevos y crea como máximo una cápsula por hora.
-- El lookback de 14 días permite recuperar automáticamente días perdidos.
SELECT cron.schedule(
  'rdsismos-hourly-generation',
  '5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://rdsismos.vercel.app/api/migration/learning/generate',
    headers := jsonb_build_object(
      'X-Cron-Secret', (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'rdsismos_cron_secret'
        LIMIT 1
      ),
      'Content-Type', 'application/json',
      'Accept', 'application/json'
    ),
    body := jsonb_build_object(
      'lookbackDays', 14,
      'minimumMagnitude', 4.5,
      'sourceLimit', 1,
      'candidateLimit', 12
    ),
    timeout_milliseconds := 50000
  );
  $cron$
);

-- 2) Treinta minutos después, revisa una tanda pequeña y rotatoria de proyecciones.
-- El lote pequeño evita que la conexión de pg_net agote el límite antes de guardar resultados.
SELECT cron.schedule(
  'rdsismos-hourly-evaluation-v2',
  '35 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://rdsismos.vercel.app/api/migration/learning/evaluate',
    headers := jsonb_build_object(
      'X-Cron-Secret', (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'rdsismos_cron_secret'
        LIMIT 1
      ),
      'Content-Type', 'application/json',
      'Accept', 'application/json'
    ),
    body := jsonb_build_object(
      'activeLimit', 4,
      'dueLimit', 4,
      'etasLimit', 60
    ),
    timeout_milliseconds := 50000
  );
  $cron$
);

-- Comprobación:
-- SELECT jobid, jobname, schedule, active FROM cron.job
-- WHERE jobname LIKE 'rdsismos-%'
-- ORDER BY jobname;
