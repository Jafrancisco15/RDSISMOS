# Núcleo–Sismicidad v0.4

## Problema y solución

El endpoint documentado de BGS devuelve un ZIP con `ESK_mm.dat` (y equivalentes por estación), aunque el cliente envíe Accept application/json. El código anterior llamaba response.text() sobre bytes comprimidos y descartaba las diez estaciones. Ahora se detecta y descomprime el ZIP en memoria usando fflate, con límites de tamaño y sin escribir entradas del archivo al disco. Se conserva soporte de respuestas de texto y JSON del adaptador anterior.

La interfaz presenta los errores por estación y diferencia falta de registros geomagnéticos de falta de terremotos. No reduce el mínimo de 50 años ni sustituye la aceleración secular con movimiento del polo.

## Globo

- Carga diferida del renderizador react-globe.gl, selector y deslizador de año, reproducción/pausa, enfoque Ártico y capas opcionales.
- Epicentros USGS, magnitud y fecha; vista anual o acumulada; M8+ diferenciado por color.
- Posición y trayectoria modelada del polo norte magnético, datos NOAA NCEI NP.xy, 1904–2025. No extrapola posición en 2026.
- Jerks como botones/hitos temporales, con fuente; no se les inventan coordenadas. La entrada 2024 del catálogo existente permanece marcada provisional.
- El gráfico rompe la línea de aceleración cuando falta un año.

## Evidencia de fuentes reales (2026-09-10)

GET local /api/core-seismic-coupling:

- 10 estaciones BGS utilizables, 0 fallos.
- 120 años de aceleración de red: 1906–2025; seis estaciones en 2025.
- 1,560 M7+ hasta 2025 y 11 en el año incompleto 2026.
- Aceleración secular: 83 años desarrollo, 33 evaluación, p corregido 0.2683.
- Jerks: p corregido 0.9639. Ambos se reportan sin evidencia robusta.

Archivo ESK real: 1,370 registros mensuales válidos, 111 años de aceleración, 1915–2025.

## Fuentes

- BGS: https://wdc.bgs.ac.uk/monthlymeans/
- Endpoint: https://wdcapi.bgs.ac.uk/monthly-means?obs_code=esk
- NOAA: https://www.ncei.noaa.gov/products/wandering-geomagnetic-poles
- Posiciones modeladas: https://www.ngdc.noaa.gov/geomag/data/poles/NP.xy
- Sismos: https://earthquake.usgs.gov/fdsnws/event/1/

BGS atribuye la compilación a los institutos operadores de observatorios, WDC, INTERMAGNET y TGO y limita sus datos a uso científico/académico. Se conservan las restricciones y metodología de análisis existentes. Esta corrección no es una validación científica independiente del modelo estadístico ni del catálogo de jerks.

## Verificación técnica

- `npm run lint`: correcto.
- `node --import tsx --test lib/bgsMonthly.test.ts lib/coreSeismicMonitor.test.ts`: 7 pruebas correctas, incluyendo ZIP y registros mensuales ausentes.
- `npm run build`: compilación de producción correcta.
- GET real ejecutado contra BGS y USGS con la respuesta descrita arriba.
- Revisión visual pendiente: agent-browser no inició; Chromium instalado con Playwright abortó con `socket() failed: Operation not permitted` en este entorno. No se afirma validación visual o de interacción del globo.
