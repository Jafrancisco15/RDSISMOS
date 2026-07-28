# RDSISMOS

Aplicación Next.js para monitoreo sísmico, pronóstico probabilístico regional y exploración del catálogo mundial USGS ComCat.

## Arquitectura

- Next.js 16 App Router y React 19.
- TypeScript estricto.
- Route Handlers en `app/api` como backend interno.
- Leaflet y React-Leaflet para mapas.
- CSS propio; no existe una librería de componentes.
- Gráficos SVG/CSS propios para evitar introducir una dependencia adicional.
- No hay autenticación ni base de datos configurada en el despliegue actual.

## Pestañas

### Pronóstico sísmico

Mantiene el módulo ETAS existente, el mapa por capas, la selección de país y las cápsulas vinculadas a eventos padre.

### Eventos Sísmicos

Nueva pantalla para consultar USGS ComCat con:

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

El frontend no consulta USGS directamente.

## Límites y estrategia histórica

USGS limita los resultados de una consulta. El servicio consulta primero `count`; cuando el total supera 20,000 eventos divide el intervalo temporal en dos y repite recursivamente. Las consultas estadísticas están limitadas a 50,000 eventos y las exportaciones a 100,000 para proteger Vercel y evitar cargas excesivas en memoria.

Para comparaciones globales de largo plazo se recomienda usar M4.5 o M5.0, porque la detección de terremotos pequeños no es uniforme entre épocas y regiones.

## Persistencia

El repositorio no tenía base de datos. Se añadió `database/earthquakes.sql`, compatible con PostgreSQL/PostGIS, con:

- clave única `external_id`;
- índices por fecha, magnitud, profundidad y fuente;
- índice geoespacial;
- tabla de jobs de sincronización.

El endpoint de sincronización actual procesa lotes y mantiene el progreso en memoria. En Vercel este estado no es durable entre reinicios. Para una importación real de 50 años se debe aprovisionar PostgreSQL y un worker/cola, ejecutar el esquema y reemplazar el adaptador de memoria por upserts SQL. No se finge persistencia donde la infraestructura actual no la ofrece.

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
DATABASE_URL=postgresql://... # reservado para persistencia durable
```

`EARTHQUAKE_ADMIN_TOKEN` protege la creación de jobs cuando está definido.

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
3. Configure `EARTHQUAKE_ADMIN_TOKEN` si habilitará importaciones.
4. Para catálogo histórico persistente, conecte PostgreSQL/PostGIS y un worker externo o Vercel Functions con una cola adecuada.

> RDSISMOS no sustituye las alertas ni recomendaciones de las autoridades sismológicas y de protección civil.
