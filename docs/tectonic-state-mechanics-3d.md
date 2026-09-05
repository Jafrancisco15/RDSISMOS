# Tectonic State 4D: Estado mecánico 3D, MVP 1.0

La pestaña es una línea experimental independiente. No reemplaza las Fases 1–4, Placas 3D, GPlates, ETAS ni los módulos de geomagnetismo. No estima dónde o cuándo ocurrirá el siguiente terremoto.

## Caso reproducible

`public/tectonic-mechanics/puerto-rico-2020.json` contiene una captura de ComCat del 1 al 31 de enero de 2020, M≥4.2, en 70–64° O / 16–20° N. El evento de referencia es el M6.4 del 7 de enero. ComCat actualmente resuelve el alias `us70006vll` como `pr2020007007`; los IDs canónicos publicados se conservan.

Incluye 63 eventos, 32 productos de fuente consultados (26 tensores), 118 polígonos GPlates, 21 isobatas Slab2 regionales, 47 trazas GEM y 8 estaciones GNSS con series ENU de NGL. Las cantidades corresponden a la captura, no son constantes del motor. Las velocidades MIDAS son contexto cinemático de sus propias épocas; no se retrotraen a enero de 2020 para evaluar predicciones.

Para regenerar la captura desde las fuentes:

```sh
npm install
node --import tsx scripts/capture-tectonic-mechanics.ts
# También puede consultar un servidor de desarrollo:
node --import tsx scripts/capture-tectonic-mechanics.ts http://localhost:3000
```

El script sin URL ejecuta los mismos handlers directamente. En entornos que requieren proxy HTTP, Node 24 admite `--use-env-proxy`. No son necesarias credenciales. Los hashes SHA256 identifican respuestas de ingestión; la exportación desde el visor incluye todas las entradas, parámetros, selección, instante y resultados, por lo que permite recalcular aun si los proveedores revisan los datos. No se guardan automáticamente los experimentos en una base de datos.

## Qué representa cada familia

| Familia | Implementación | Restricción científica |
|---|---|---|
| Observación | Catálogo ComCat, series GNSS, waveforms Z/N/E cargables | No se fabrican observaciones ausentes |
| Geometría | GPlates 0 Ma ZAHIROVIC2022, celdas esféricas volumétricas, isobatas Slab2, fallas GEM | Espesores de corteza y LAB supuestos; no hay CRUST1.0 regional integrado |
| Ruptura | NP1 y NP2 orientados, centroide cuando está publicado, vector de slip | Son planos nodales candidatos; no se afirma cuál rompió |
| Cinemática | v=ω×r, Euler y MIDAS ENU, residual observado−modelo | Solo se resta si coinciden los marcos; asignar una placa a un microbloque sigue siendo una hipótesis |
| Elasticidad | Tensor de momento completo, desplazamiento, strain y stress Kelvin | Medio infinito homogéneo: sin superficie libre, estratificación, topografía, anisotropía ni contacto entre placas |
| ΔCFS | Tracción proyectada sobre receptor con strike/dip/rake y μ′ | Orientación y profundidad de receptores deben declararse; el receptor uniforme es una assumption visible |
| Reaction vectors | Desplazamiento modelado proyectado en el plano receptor | La dirección no es la del próximo sismo; el color representa ΔCFS, no la longitud |
| Postsísmico | Afterslip prescrito **o** relajación Maxwell local | No es un solver de deformación viscoelástica espacial; Burgers no implementado |
| Tomografía | Adaptador de Fase 3, gate y estabilidad por P/S, opacidad según resolución | No se convierte δV en stress ni se cambia GNSS. Sin datos que pasen el gate, se dibuja vacío |
| Ondas | Raypaths IASP91 asociados a estaciones con waveforms reales | Brillo/alcance es visual; no es dynamic stress calibrado en Pa. PP/SS no disponibles en el trazador existente |
| InSAR | Contrato de puntos LOS importables con look vector y fechas | Sin carga automática GeoTIFF ni fusión GNSS–LOS; no convierte un LOS en ENU único |
| Validación | Ventanas disjuntas, campo congelado, log-likelihood gain, ROC/AP y matriz de confusión | Retrospectiva exploratoria; ninguna validación prospectiva. Deformación–actividad no evaluada sin pares independientes |

## Coordenadas, unidades y ecuaciones

La geometría usa una Tierra esférica de radio 6371 km. `Location.depth` es km positivos hacia abajo. Los vectores y tensores físicos usan **ENU local**: x=este, y=norte, z=arriba. Las posiciones se convierten a ECEF y los tensores se rotan desde el ENU del centroide al ENU del receptor; no se suman componentes expresadas en bases diferentes.

Unidades del estado: u en m, strain adimensional, Δσ y ΔCFS en Pa, μ en Pa, η en Pa·s. MIDAS y Euler se muestran en mm/año; GNSS detrended en mm. `deltaVpPct/deltaVsPct` de Fase 3 son porcentajes. `uncertainty: null` significa **sin incertidumbre cuantificada**, nunca cero.

El tensor ComCat usa r=arriba, θ=sur, φ=este. Se convierte mediante `M_ENU=R M_rθφ Rᵀ`. Se conserva el tensor completo; no se multiplica por un porcentaje de doble par. Si solo existe mecanismo focal, se permite `M₀(s⊗n+n⊗s)`, etiquetado. Si solo hay magnitud Mw, `log10 M₀=1.5 Mw+9.1`; mb/ml/md no se convierten silenciosamente a M₀.

El kernel estático es el Green de Kelvin:

```
Gij = [(3−4ν) δij/r + xi xj/r³] / [16π μ(1−ν)]
ui  = −Mjk ∂Gij/∂xk
εij = (∂ui/∂xj + ∂uj/∂xi)/2
σij = 2μ εij + λ tr(ε) δij
λ   = 2μν/(1−2ν)
ΔCFS = s · (Δσ n) + μ′ n · (Δσ n)
```

La normal positiva es tensión/unclamping. Los gradientes se calculan por diferencias centrales con paso relativo 1e−4; se prueban contra la solución analítica independiente de un momento isotrópico. La geometría de ruptura usa escalas all-slip de Wells & Coppersmith (1994), longitud subsuperficial `10^(−2.44+0.59Mw)` km, ancho `10^(−1.01+0.32Mw)` km. Slip es un proxy `M₀/(30 GPa × área)`, no una inversión finite-fault.

**Máscara de validez**: el kernel no se evalúa a menos de `max(15 km, 2 × longitud de ruptura)` ni a más de 700 km de la fuente. No se suaviza la singularidad para fabricar valores en la ruptura. Si una fuente activa carece de tensor/geometría o cae fuera del dominio de un nodo, el estado acumulado de ese nodo se marca insuficiente; no se presenta la suma parcial como suma completa. Los eventos de catálogo cuyo producto no se consultó no entran en la suma; el visor reporta esa limitación.

`ReactionVector = u − (u·n)n`, en metros. Las flechas para fallas GEM usan el receptor explícito o inferido con sus assumptions. Las flechas de la malla representan receptores uniformes experimentales. Se renderiza una de cada doce flechas de malla para legibilidad; la exportación contiene todas. Las escalas de dibujo y el exploded view no entran en el cálculo físico.

## Maxwell y afterslip

El experimento Maxwell usa `τ=η/μ`. Bajo la base litosférica supuesta, mantiene deformación total fija y relaja el stress desviador por `exp(−t/τ)`, preservando la parte hidrostática. `viscousStrainTensor=(σ_elastic−σ_relaxed)/(2μ)`. No se genera desplazamiento superficial adicional: hacerlo requeriría resolver equilibrio, compatibilidad y condiciones de frontera espacialmente. La deformación animada de la malla muestra desplazamiento coseísmico/afterslip amplificado e interpolado dentro de la celda.

El afterslip es un escenario prescrito `A(1−exp(−t/T))` en la misma fuente. A inicia en cero. No se combina con Maxwell: el motor lo rechaza, porque la combinación exige convolucionar el historial de carga. No hay Burgers ni FEM/BEM en esta versión.

## Confianza y desacoplamiento

Los scores mecánicos son **heurísticos**, acotados a support=45 y resolution=30 para un kernel utilizable, no probabilidades, errores estándar ni resolución medida. La opacidad se mantiene baja. Fuera del dominio, ambos son cero y los campos numéricos son null.

Las resoluciones de tomografía siguen siendo las de Fase 3: gate del evento, resolution≥42, consistencia de signo≥0.67 y una incertidumbre disponible para cada componente. P estable no permite importar S inestable. No se rellenan voxeles vecinos. Los campos `vp/vs/deltaVp/deltaVs` del **estado mecánico** permanecen null hasta existir un solver con propiedades materiales heterogéneas; la tomografía aceptada se exporta y visualiza como familia separada.

GNSS usa las series detrended de Fase 4/NGL independientemente de Fase 3. Solo se visualiza la última solución diaria anterior al instante y de menos de 36h de antigüedad. Una solución diaria no resuelve la ruptura en segundos. Después de su cobertura, la flecha desaparece; no se extrapola. El cambio pre/post no se atribuye exclusivamente al evento si hubo otros eventos en esa ventana.

El archivo legado MIDAS IGS08 dejó de responder. El MVP usa MIDAS IGS20. Para CA, recupera el Euler **que NGL resta** usando diferencias entre sus tablas MIDAS absoluta y de placa con épocas idénticas. Se ajusta en la mitad de las filas y se exige RMS≤0.05 mm/año en la otra mitad. Es reconstrucción de la definición de marco NGL, no calibración tectónica independiente. Si falla (NA en esta captura), se conserva GSRM IGS08 y se bloquea su resta con GNSS IGS20.

Geomagnetismo, actividad solar y luna no figuran como inputs del motor mecánico.

## Validación retrospectiva

Se congela el campo después de la última fuente seleccionada. Las fuentes no pueden ser eventos de calibración, validación o control. Se rechazan ventanas solapadas, eventos duplicados y fuentes posteriores al corte. La evaluación actual proyecta actividad sobre columnas de 0.5° con receptor a 10 km: debe restringirse a sismicidad somera; no equivale a validación volumétrica global.

Se ajusta solo en calibración una hipótesis de tasa `baseline × exp(β ΔCFS/10kPa)` normalizada por área. β se busca en [−2,2] con paso 0.1; se recortan los scores a ±5 para estabilidad. El baseline y umbral se fijan desde calibración. La validación devuelve ganancia de log-verosimilitud Poisson espacial, ganancia por evento, ROC con empates, average precision, TP/FP/TN/FN y correlación descriptiva. El control anterior es un placebo espacial sobre el mismo campo congelado. Sin al menos cinco eventos elegibles por ventana y diez celdas, no se publican métricas. No hay conversión a predicción operacional.

La captura contiene productos revisados después de t₀. Para validación prospectiva harán falta versiones disponibles-en-t₀, registro previo de parámetros, completitud del catálogo, corrección de dependencia espacial/temporal, pruebas de sensibilidad al plano receptor y múltiples controles. Una correlación por sí sola no prueba transferencia causal.

## Arquitectura y extensión global

`types.ts` define contratos versionados; `physics.ts` es puro y no importa datos externos; `adapters.ts` convierte ComCat/NGL/Fases 2–3; `geometry.ts` maneja celdas y polígonos; `validation.ts` separa ajuste/evaluación. El componente de navegación se carga dinámicamente y dispone buffers, materiales y controles al salir.

Para escalar: particionar el globo en teselas ECEF con halo de fuentes, cachear kernels por hash de tensor/material/geometría, mover kernels a workers o servicio científico, almacenar snapshots por versión, conservar máscaras de dominio y covarianzas por propiedad. Integrar CRUST1.0/LAB, grids Slab2 completos, tomografía estructural y FEM/Okada/PyLith requerirá nuevos adaptadores/solvers declarados y benchmarks; no debe reutilizarse el kernel regional de 700 km como solución global.

## Referencias y licencias

- [USGS ComCat, evento de Puerto Rico](https://earthquake.usgs.gov/earthquakes/eventpage/us70006vll/executive).
- [USGS Coulomb 3.3](https://pubs.usgs.gov/of/2011/1060/). Referencia de convención/alcance; este MVP no implementa Okada.
- [Slab2, Hayes et al. 2018](https://www.usgs.gov/data/slab2-a-comprehensive-subduction-zone-geometry-model), DOI 10.5066/F7PV6JNV. Geometría USGS distribuida también por el mirror ArcGIS usado por RDSISMOS.
- [GPlates Web Service](https://gws.gplates.org/), modelo ZAHIROVIC2022, 0 Ma; conservar atribución EarthByte/GPlates al reutilizar geometría.
- [GEM Global Active Faults, Styron & Pagani 2020](https://github.com/GEMScienceTools/gem-global-active-faults), **CC BY-SA 4.0**. Las trazas derivadas de la captura conservan esa licencia y atribución.
- [NGL productos y procedencia](https://geodesy.unr.edu/PlugNPlayPortal.php), Blewitt et al. (2018), DOI 10.1029/2018EO104623. MIDAS: Blewitt et al. (2016), DOI 10.1002/2015JB012552; comprobar también la atribución original de cada estación.
- [GSRM, Euler poles IGS08](https://geodesy.unr.edu/GSRM/poles.IGS08), Kreemer et al. (2014), DOI 10.1002/2014GC005407.
- Wells & Coppersmith (1994), DOI 10.1785/BSSA0840040974.
- [PyLith: reología Maxwell](https://pylith.readthedocs.io/en/latest/user/governingeqns/elasticity/bulk-rheologies/linear-maxwell.html).

## Verificación

`lib/tectonicMechanics.test.ts` comprueba soluciones elásticas analíticas, escalas espaciales y de M₀, convenciones ENU/RTP, signo de Coulomb, Maxwell, exclusión del campo cercano, temporalidad/múltiples fuentes, pares de marco GNSS, gate P/S y separación retrospectiva. Ejecutar `npm run lint`, `npm test` y `npm run build` junto con la suite existente. Los tests del kernel no son validación física prospectiva.
