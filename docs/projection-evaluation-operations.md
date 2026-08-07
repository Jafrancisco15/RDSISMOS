# Operación del evaluador de proyecciones

## Qué mantiene actualizado

`GET /api/migration/learning/evaluate` cierra y audita dos familias de pronóstico:

- migración estadística histórica;
- ETAS regional persistente.

El Mapa 3D consulta datos en vivo y vuelve a solicitar `/api/globe` cada 10 minutos mientras se visualiza la fecha actual. El Historial también se vuelve a cargar cada 10 minutos. La evaluación de resultados depende del job programado o de una llamada administrativa manual.

## Autenticación de Vercel Cron

Configure `CRON_SECRET` en el entorno **Production** del proyecto Vercel. Vercel Cron envía automáticamente ese valor como `Authorization: Bearer <CRON_SECRET>`.

`EARTHQUAKE_ADMIN_TOKEN` sigue siendo válido para ejecuciones administrativas manuales, pero no sustituye a `CRON_SECRET` para el cron nativo de Vercel.

Puede comprobar la configuración sin revelar el secreto en:

```text
GET /api/migration/learning/status
```

La respuesta incluye `cronSecretConfigured` y `cronSchedule`.

## Frecuencia

El repositorio mantiene el cron compatible con Vercel Hobby:

```text
15 3 * * *
```

Esto ejecuta una evaluación diaria alrededor de las 03:15 UTC. En Hobby, Vercel no admite intervalos menores a un día. En Pro o Enterprise puede cambiarse a una frecuencia horaria, por ejemplo:

```text
15 * * * *
```

La lógica de evaluación ya es incremental y conserva una superposición de seguridad al revisar ventanas activas.

## Ejecución manual

```bash
curl -X POST https://rdsismos.vercel.app/api/migration/learning/evaluate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $EARTHQUAKE_ADMIN_TOKEN" \
  -d '{"activeLimit":8,"dueLimit":8,"etasLimit":200}'
```

La respuesta incluye el resumen histórico, el resumen ETAS y un bloque `scheduler` con la hora de evaluación.

## Efectividad estricta

`GET /api/migration/projections/effectiveness` calcula únicamente sobre pronósticos operacionales resueltos:

- Brier Score del pronóstico;
- Brier Score de su línea base;
- Brier Skill Score contra esa línea base;
- tasa observada;
- probabilidad media emitida;
- brecha de calibración;
- precisión al umbral de 50%.

Un Brier menor es mejor. Un Brier Skill Score positivo significa que el pronóstico supera la referencia de fondo; un valor negativo significa que rinde peor.

Las emisiones ETAS anteriores al arreglo de inmutabilidad se excluyen del scoring estricto, porque podían haber sido recalculadas después de su emisión. Las nuevas emisiones quedan marcadas como inmutables en `projection_payload` y conservan la probabilidad realmente publicada para evaluación posterior.
