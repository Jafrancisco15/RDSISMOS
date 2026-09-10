# Núcleo–Sismicidad v0.5

## Cambio principal

La prueba principal ya no trata cada año calendario como una observación aislada. Cada terremoto natural M≥7 recibe su propio tiempo cero:

\[
\tau = t_{\text{observación magnética}} - t_{\text{sismo}}
\]

La serie se alinea en bins relativos de −5 a +5 años. Los bins negativos describen el tramo previo, 0 el entorno inmediato del evento y los positivos el tramo posterior. El análisis anual v0.4 permanece disponible como referencia secundaria.

## Señal geomagnética

- Se conserva la información mensual X/Y/Z de las medias BGS.
- Para cada observatorio se calcula una segunda derivada centrada que respeta el intervalo temporal real entre muestras.
- Se descartan diferencias que atraviesan huecos mayores de tres meses.
- La red combina los observatorios por mes mediante mediana robusta y exige al menos dos estaciones por mes.
- Para comparar eventos de distintas épocas, cada perfil de aceleración se estandariza contra su propio tramo previo; el valor bruto en nT/año² también se devuelve.
- Los jerks se representan como intensidad continua de un catálogo versionado. No se les inventan coordenadas ni simultaneidad global.

## Controles y dependencia temporal

Cada evento obtiene una época de control no sísmica, desplazada de forma determinista (±7, ±11, ±13, ±17, ±19 o ±23 años) y aceptada solo si su ventana completa tiene cobertura y no cae cerca de otro M7+. Esto conserva la cobertura temporal sin elegir controles después de observar el resultado.

Los terremotos individuales se conservan en 'eventRows', pero los resúmenes y la permutación usan bloques por año calendario. Así, varios eventos del mismo año o un único jerk posterior no se cuentan como confirmaciones independientes. El módulo reporta por separado el número de eventos y el número de bloques efectivos.

## Réplica histórica de 2–5 años

Se reevalúa la hipótesis descrita por Florindo & Alfonsi (1995) para terremotos muy grandes: presencia de un jerk catalogado entre 2 y 5 años después. Si hay al menos tres eventos con escala 'Ms' explícita, se usa ese subconjunto; de lo contrario se presenta 'M≥8-USGS' como análisis de sensibilidad. El campo de magnitud de USGS no se convierte ni se trata como equivalente a 'Ms'.

La comparación incluye el porcentaje de eventos y controles con jerk en esa ventana, la intensidad máxima media y una p permutacional apareada por bloques. Es una prueba exploratoria: no es predicción, alerta operacional ni evidencia de causalidad.

## Respuesta del endpoint

'GET /api/core-seismic-coupling' ahora devuelve:

- 'relativeStudy.status' y un mensaje de cobertura explícito;
- 'relativeStudy.bins', con aceleración secular y jerk de evento/control en cada τ;
- 'relativeStudy.eventRows', con una fila por terremoto elegible;
- 'relativeStudy.prePost', con medianas antes, alrededor y después;
- 'relativeStudy.historicalReplication', con la réplica 2–5 años y la escala realmente usada;
- diagnósticos de observaciones mensuales, controles y bloques independientes.

La interfaz coloca este estudio antes de la gráfica anual y deja claro cuándo la cobertura es completa, parcial o insuficiente. La ausencia de una serie anual de 50 años ya no oculta un perfil relativo de jerks ni se presenta como una conclusión negativa sobre la hipótesis.

## Verificación

Se añadieron pruebas para la segunda derivada mensual, la mediana mensual de red y la construcción de perfiles relativos con una serie menor de 50 años. CI debe ejecutar 'npm run lint', 'npm test' y 'npm run build' antes de aceptar el cambio.
