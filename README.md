# RDSISMOS

Aplicación Next.js para monitoreo sísmico, pronóstico probabilístico regional, migración histórica y exploración del catálogo mundial USGS ComCat.

## Arquitectura

- Next.js 16 App Router y React 19.
- TypeScript estricto.
- Route Handlers en `app/api` como backend interno.
- Leaflet y React-Leaflet para mapas.
- CSS propio; no existe una librería de componentes.
- Gráficos SVG/CSS propios.
- PostgreSQL/PostGIS en Supabase para memoria durable del modelo.

## Pestañas

### Migración histórica

Pantalla principal. Compara un evento reciente con análogos de los últimos 50 años, utiliza ventanas posteriores y de control y desglosa recurrencias por país. Cada cápsula generada se guarda antes de conocer su resultado.

### Pronóstico sísmico

Mantiene el módulo ETAS regional, el mapa por capas, la selección de país y las cápsulas vinculadas a eventos padre.

### Eventos Sísmicos

Pantalla para consultar USGS ComCat con:

- filtros por fecha, magnitud, profundidad, coordenadas, radio, tipo, red, estado y texto;
- filtros rápidos de 24 horas a 50 años;
- filtros reflejados en la URL;
- paginación del lado del servidor;
- panel resumen y estadísticas;
- tabla sincronizada con mapa Leaflet;
- detalle completo del evento;
- exportación CSV, JSON y GeoJSON;
- división recursiva de intervalos cuando una consulta supera el límite de USGS;
- reintentos y backoff exponencial;
- importación histórica administrativa por lotes.

## API interna

- `GET /api/earthquakes`
- `GET /api/earthquakes/:id`
- `GET /api/earthquakes/stats`
- `GET /api/earthquakes/export`
- `POST /api/earthquakes/sync`
- `GET|POST /api/earthquakes/sync/status`
- `POST /api/migration/history`
- `GET /api/migration/learning/status`
- `POST /api/migration/learning/evaluate`

El frontend consume únicamente estas APIs internas.

## Límites y estrategia histórica

USGS limita los resultados de una consulta. El servicio consulta primero `count`; cuando el total supera 20,000 eventos divide el intervalo temporal en dos y repite recursivamente. Las consultas estadísticas están limitadas a 50,000 eventos y las exportaciones a 100,000 para proteger Vercel y evitar cargas excesivas en memoria.

Para comparaciones globales de largo plazo se recomienda usar M4.5 o M5.0, porque la detección de terremotos pequeños no es uniforme entre épocas y regiones.

## Persistencia

Ejecute en Supabase, en este orden:

1. `database/earthquakes.sql`
2. `database/learning.sql`

`database/earthquakes.sql` crea el catálogo sísmico y los jobs de sincronización. `database/learning.sql` crea:

- `migration_model_versions`;
- `migration_capsules`;
- `migration_country_predictions`;
- `migration_outcomes`;
- `migration_model_metrics`.

Las cápsulas se guardan con el modelo que las produjo, el evento origen, el periodo de vigilancia, el rango de magnitud y todas las probabilidades nacionales. Las predicciones históricas no se sobrescriben con información del futuro.

## Ciclo de aprendizaje: Fase 1

1. El usuario crea una cápsula mediante `POST /api/migration/history`.
2. La API guarda la cápsula y sus predicciones en Supabase.
3. Cuando termina la vigilancia, el evaluador consulta USGS.
4. Cada predicción recibe un resultado observado.
5. Se calculan Brier Score, Log Loss, frecuencia observada y precisión al umbral de 50%.
6. Las métricas quedan asociadas a la versión `migration-country-v2`.

Evaluar hasta cinco cápsulas vencidas:

```bash
curl -X POST https://rdsismos.vercel.app/api/migration/learning/evaluate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $EARTHQUAKE_ADMIN_TOKEN" \
  -d '{"limitCapsules":5}'
```

Consultar el estado de aprendizaje:

```bash
curl https://rdsismos.vercel.app/api/migration/learning/status
```

El evaluador es idempotente: una predicción con resultado guardado no se vuelve a evaluar. Puede ejecutarse periódicamente desde un cron o job externo.

## Importación histórica

Ejemplo protegido con token:

```bash
curl -X POST http://localhost:3000/api/earthquakes/sync \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $EARTHQUAKE_ADMIN_TOKEN" \
  -d '{"starttime":"1976-01-01","endtime":"2026-01-01","minmagnitude":4.5,"limit":20000,"offset":1}'
```

Consultar progreso:

```bash
curl "http://localhost:3000/api/earthquakes/sync/status?id=<JOB_ID>"
```

## Variables de entorno

```env
RASPBERRY_SHAKE_EVENTS_URL=https://quakelink.raspberryshake.org/events/query
EARTHQUAKE_ADMIN_TOKEN=un-token-largo-y-secreto
DATABASE_URL=postgresql://...
```

- `DATABASE_URL` debe usar una conexión server-side; nunca utilice el prefijo `NEXT_PUBLIC_`.
- `EARTHQUAKE_ADMIN_TOKEN` protege sincronización y evaluación cuando está definido.
- Con Transaction Pooler de Supabase, el cliente usa `prepare: false`.

## Desarrollo y pruebas

```bash
npm install
npm run dev
npm run lint
npm test
```

Abra `http://localhost:3000`.

## Despliegue en Vercel

1. Importe el repositorio como proyecto Next.js.
2. No configure una carpeta de salida estática.
3. Configure `DATABASE_URL` y `EARTHQUAKE_ADMIN_TOKEN`.
4. Ejecute ambas migraciones SQL en Supabase.
5. Despliegue nuevamente después de cambiar variables de entorno.
6. Programe la llamada protegida a `/api/migration/learning/evaluate` cuando quiera automatizar el cierre de cápsulas.

> RDSISMOS no sustituye las alertas ni recomendaciones de las autoridades sismológicas y de protección civil. Las asociaciones históricas no demuestran causalidad entre placas distantes.
