import styles from "./AboutRdsismos.module.css";

type ModuleGuide = {
  id: string;
  name: string;
  subtitle: string;
  what: string;
  how: string[];
  theory: string[];
  sources: string[];
  caution: string;
};

const MODULES: ModuleGuide[] = [
  {
    id: "mapa-3d",
    name: "Mapa 3D",
    subtitle: "Vista general del sistema sísmico y de las proyecciones activas",
    what: "Reúne en un globo interactivo los sismos observados, proyecciones guardadas, fallas, límites de placas y comparaciones entre fechas. Es la vista más rápida para entender qué estaba observando RDSISMOS en un momento determinado.",
    how: [
      "Elige el país y la fecha que quieres revisar.",
      "Activa o desactiva sismos observados, proyecciones, fallas, límites de placas y fronteras.",
      "Usa Comparar para enfrentar dos fechas y ver cómo cambiaron las proyecciones.",
      "Toca un punto para ver el evento o la cápsula que lo originó.",
    ],
    theory: [
      "El Mapa 3D no crea una teoría nueva por sí mismo: visualiza resultados de los modelos de RDSISMOS junto con observaciones reales.",
      "Las proyecciones pueden proceder del modelo histórico por país o del modelo regional ETAS; por eso cada punto debe interpretarse según el modelo que lo generó.",
      "La comparación temporal conserva el principio de trazabilidad: qué sabía el sistema en cada fecha y qué ocurrió después.",
    ],
    sources: ["USGS ComCat", "GEM Global Active Faults", "GPlates/EarthByte", "memoria prospectiva RDSISMOS"],
    caution: "Una concentración de puntos o una proyección elevada no identifica por sí sola el lugar, la hora ni la magnitud exacta de un futuro terremoto.",
  },
  {
    id: "scope",
    name: "Scope Projection",
    subtitle: "Análogos históricos ponderados por calidad de observación",
    what: "Parte de un terremoto real y busca eventos históricos comparables. Después observa qué regiones tuvieron actividad posterior y pondera cada análogo según la evidencia instrumental disponible en EarthScope.",
    how: [
      "Escoge un sismo reciente M5.9+ de la lista.",
      "RDSISMOS busca análogos históricos de características semejantes.",
      "Revisa los destinos con señal positiva, la línea base y el cambio respecto a esa línea base.",
      "Compara la calidad de evidencia: una observación histórica mejor documentada recibe más peso que una pobremente observada.",
    ],
    theory: [
      "Usa recurrencia histórica condicionada: qué ocurrió después de eventos parecidos frente a lo que normalmente ocurre sin ese antecedente.",
      "EarthScope no sustituye el catálogo de terremotos; modifica el peso de los análogos según la cobertura observacional disponible.",
      "El resultado es una recurrencia histórica ponderada, no una certeza física de causalidad entre dos regiones.",
    ],
    sources: ["USGS/NEIC", "EarthScope NSF SAGE"],
    caution: "Que una región aparezca con señal positiva significa que el patrón histórico ponderado supera su línea base; no significa que un sismo sea inminente.",
  },
  {
    id: "etas",
    name: "ETAS Projection",
    subtitle: "Agrupamiento sísmico en espacio y tiempo",
    what: "Estima cómo cambia temporalmente la tasa de sismicidad alrededor de terremotos precedentes. Es especialmente útil para estudiar secuencias, réplicas y agrupamientos regionales.",
    how: [
      "Revisa las cápsulas activas vinculadas a un evento padre.",
      "Observa la probabilidad condicional, rango de magnitud, plazo y conteo esperado.",
      "Abre los detalles del modelo para ver Mc, p, q y b.",
      "Consulta los eventos relacionados para comprobar qué ocurrió dentro de la ventana espacial, temporal y de magnitud.",
    ],
    theory: [
      "ETAS (Epidemic-Type Aftershock Sequence) trata cada terremoto como una posible fuente temporal de actividad posterior.",
      "Omori–Utsu describe cómo la tasa de réplicas suele disminuir con el tiempo después de un evento.",
      "Gutenberg–Richter describe la relación estadística entre frecuencia y magnitud; el parámetro b resume la pendiente de esa distribución.",
      "Un kernel espacial controla cómo disminuye la influencia al aumentar la distancia desde la fuente.",
    ],
    sources: ["USGS ComCat", "catálogo interno normalizado RDSISMOS"],
    caution: "ETAS modela tasas y agrupamientos estadísticos. No predice un epicentro exacto ni demuestra que toda actividad posterior fue causada por el evento padre.",
  },
  {
    id: "validacion",
    name: "Auto-Validación",
    subtitle: "Auditoría probabilística de los modelos",
    what: "Compara Mapa 3D, ETAS y Scope usando los mismos casos ya cerrados para medir si las probabilidades estuvieron bien calibradas y si aportaron información por encima de una referencia simple.",
    how: [
      "Selecciona cuántos casos recientes quieres evaluar.",
      "Compara los métodos con la misma muestra pareada.",
      "Da más importancia a métricas probabilísticas que al simple conteo de aciertos.",
      "Distingue los resultados prospectivos de los replay retrospectivos.",
    ],
    theory: [
      "Brier Score mide el error cuadrático de una probabilidad: menor es mejor.",
      "Log Loss penaliza con fuerza las probabilidades muy seguras cuando el resultado observado contradice al modelo.",
      "La calibración compara probabilidades emitidas con frecuencias observadas; ECE resume parte de esa diferencia.",
      "La climatología funciona como referencia: un modelo útil debería demostrar skill frente a una línea base razonable.",
    ],
    sources: ["predicciones persistidas por RDSISMOS", "USGS ComCat", "EarthScope NSF SAGE para replay Scope"],
    caution: "Una muestra pequeña puede cambiar mucho el ranking. La auditoría actual es diagnóstica y no equivale todavía a una evaluación prospectiva CSEP independiente de todos los modelos.",
  },
  {
    id: "historial",
    name: "Historial",
    subtitle: "Archivo auditable de proyecciones y resultados",
    what: "Guarda y consulta las proyecciones tal como fueron emitidas antes de conocer su resultado. Permite ver cuáles siguen activas, cuáles se cumplieron, cuáles vencieron y qué evento fue asociado posteriormente.",
    how: [
      "Filtra por estado, país, fecha o texto.",
      "Ordena por fecha, probabilidad, zona o estado.",
      "Abre una proyección para revisar sus parámetros y explicación.",
      "Compara la predicción original con el resultado observado después del vencimiento.",
    ],
    theory: [
      "Se basa en evaluación prospectiva: registrar primero la predicción y evaluar después evita reescribir el pasado con información futura.",
      "Las cápsulas conservan versión del modelo, evento fuente, ventana, rango de magnitud y probabilidades emitidas.",
      "La trazabilidad permite distinguir una coincidencia real de una explicación construida después de conocer el resultado.",
    ],
    sources: ["memoria persistente RDSISMOS", "USGS ComCat para resultados observados"],
    caution: "Un historial con coincidencias no demuestra causalidad física. Sirve para medir desempeño y conservar evidencia de lo que el modelo emitió realmente.",
  },
  {
    id: "heatmap",
    name: "Mapa de Calor Histórico",
    subtitle: "Dónde se ha concentrado la sismicidad registrada",
    what: "Descarga el catálogo de un año y agrupa los terremotos en celdas geográficas para mostrar densidad, magnitud máxima, magnitud media y profundidad media.",
    how: [
      "Selecciona un año desde 1900 hasta el presente.",
      "Espera a que se descarguen y agreguen los segmentos del catálogo.",
      "Activa nombres de países, placas, límites o fallas para comparar el patrón histórico con la tectónica.",
      "Recorre los años para observar cambios en cobertura y actividad registrada.",
    ],
    theory: [
      "Es estadística espacial descriptiva: los eventos se agrupan por celdas de latitud/longitud.",
      "Una celda intensa representa más eventos registrados o eventos mayores; no representa por sí sola peligro futuro.",
      "La comparación entre décadas debe considerar que la red instrumental y la capacidad de detectar sismos pequeños han mejorado con el tiempo.",
    ],
    sources: ["USGS ComCat"],
    caution: "No compares directamente el número de sismos pequeños de 1910 con el de 2026 como si la capacidad de detección hubiera sido la misma.",
  },
  {
    id: "eventos",
    name: "Eventos Sísmicos",
    subtitle: "Buscador y laboratorio del catálogo observado",
    what: "Permite consultar terremotos por fecha, magnitud, profundidad, país, radio, fuente y otros criterios, además de revisar estadísticas, mapas, gráficos y exportar los resultados.",
    how: [
      "Usa los accesos rápidos de 24 horas, 7 días, 30 días, 1 año, 10 años o 50 años.",
      "Refina por magnitud, profundidad, país, coordenadas, radio o fuente.",
      "Toca un evento para ver sus datos detallados y ubicación.",
      "Exporta CSV, JSON o GeoJSON cuando necesites analizar la muestra fuera de RDSISMOS.",
    ],
    theory: [
      "Este módulo es principalmente observacional y descriptivo: trabaja con catálogos sísmicos, no con una predicción.",
      "Las consultas recientes pueden combinar fuentes y eliminar duplicados; las búsquedas históricas largas priorizan USGS ComCat por estabilidad y cobertura.",
      "Magnitud, profundidad, distribución temporal y distribución espacial son variables básicas para caracterizar una muestra sísmica.",
    ],
    sources: ["USGS ComCat", "EMSC", "Raspberry Shake"],
    caution: "Diferentes redes pueden estimar de forma ligeramente distinta magnitud, profundidad o localización. RDSISMOS normaliza los datos, pero conserva la fuente original.",
  },
  {
    id: "gplates",
    name: "GPlates",
    subtitle: "Contexto tectónico, fallas, manto y balance de esfuerzos",
    what: "Relaciona los terremotos con placas tectónicas, límites, movimiento modelado, fallas activas, mecanismos focales, tomografía del manto y cambios de esfuerzo Coulomb. Sirve para pasar de ver un punto sísmico a estudiar el sistema tectónico que lo rodea.",
    how: [
      "Selecciona el histórico USGS, magnitud mínima, ventana futura y magnitud objetivo para el resumen por placa.",
      "Activa Vectores para ver dirección y velocidad media modelada de las placas.",
      "Activa Guías de interacción para distinguir subducción, convergencia, divergencia y transformantes.",
      "Activa Mecanismos P/T para ver compresión y extensión de sismos con solución focal USGS.",
      "Acerca el mapa y activa Fallas activas para comparar terremotos con trazas GEM.",
      "Activa Tomografía del manto y cambia la profundidad para ver anomalías dVs desde el manto superior hasta cerca de la frontera núcleo–manto.",
      "Dentro de Fallas activa Balance de esfuerzos Coulomb para ver carga positiva, relajación negativa, balance neto y porcentaje de cancelación.",
    ],
    theory: [
      "Gutenberg–Richter y una aproximación Poisson se usan para resumir frecuencia–magnitud y expectativa histórica por placa; es una proyección estadística, no una fecha de ocurrencia.",
      "Los vectores de placas se derivan de reconstrucciones GPlates y diferencias de posición a escala geológica; son cinemática modelada, no fuerzas en newtons ni velocidades GNSS observadas.",
      "Los ejes P y T proceden de mecanismos focales/tensores de momento y muestran orientaciones principales de compresión y extensión de la fuente.",
      "La asociación con fallas compara proximidad, orientación y estilo de mecanismo; una falla cercana no queda automáticamente identificada como la falla causal.",
      "La tomografía SEISGLOB2 usa anomalías de velocidad de onda S respecto a PREM. dVs rápida es compatible con material relativamente más frío/rígido y dVs lenta con material relativamente más caliente o diferente, pero dVs no es temperatura directa.",
      "El Balance Coulomb calcula un ΔCFS estático exploratorio sobre fallas receptoras. Contribuciones positivas y negativas se suman, por lo que varios eventos pueden reforzarse o cancelarse parcialmente. La primera versión usa una fuente double-couple puntual y un medio elástico simplificado, no un modelo finite-fault completo.",
    ],
    sources: ["USGS ComCat y moment tensors", "GPlates Web Service / EarthByte", "modelo ZAHIROVIC2022", "GEM Global Active Faults", "EarthScope EMC · SEISGLOB2", "PREM"],
    caution: "Las capas tectónicas aportan contexto físico y estadístico. Ni la tomografía, ni la cercanía a una falla, ni un ΔCFS positivo constituyen una predicción determinista de terremoto.",
  },
  {
    id: "simulador",
    name: "Simulador",
    subtitle: "Laboratorio para separar ondas, esfuerzo estático y susceptibilidad",
    what: "Permite escoger un terremoto real reciente o crear uno hipotético y estudiar, por separado, transferencia estática cerca de la fuente, llegada de ondas, susceptibilidad de estructuras tectónicas y una respuesta potencial combinada.",
    how: [
      "Escoge un sismo reciente M5.9+ o abre el modo manual.",
      "Si conoces el mecanismo, ajusta strike, dip y rake; si no, el sistema usa supuestos editables.",
      "Compara Coulomb local con las capas de Energía de llegada, Susceptibilidad tectónica y Respuesta potencial.",
      "Revisa tiempos de viaje P/S, estaciones EarthScope, fallas y límites de placas cercanos o remotos.",
    ],
    theory: [
      "La transferencia estática Coulomb aproxima cómo una ruptura modifica el estado de esfuerzo de estructuras cercanas; el efecto decae rápidamente con la distancia.",
      "Las ondas sísmicas transportan energía a grandes distancias. Los tiempos P y S se estiman con servicios EarthScope/TauP y el modelo iasp91 cuando están disponibles.",
      "La susceptibilidad tectónica es un índice propio de RDSISMOS que combina entorno, geometría y soporte de metadata; no es una probabilidad física de ruptura.",
      "La respuesta potencial combina perturbación de onda y susceptibilidad para explorar escenarios, no para afirmar que una falla responderá.",
    ],
    sources: ["USGS", "EarthScope NSF SAGE", "GEM Global Active Faults", "PB2002 / límites de placas"],
    caution: "Es un laboratorio de escenarios. Los índices 0–100 no son porcentajes de probabilidad y una onda que alcance una falla no implica que esa falla vaya a romperse.",
  },
];

const DATA_SOURCES = [
  ["USGS / NEIC · ComCat", "Catálogo global, detalles de eventos, mecanismos focales y tensores de momento."],
  ["EarthScope NSF SAGE", "Estaciones, metadatos, tiempos de viaje y Earth Model Collaboration/SEISGLOB2."],
  ["EMSC", "Fuente adicional para eventos sísmicos recientes."],
  ["Raspberry Shake", "Fuente instrumental adicional para el catálogo reciente cuando está disponible."],
  ["GEM Global Active Faults", "Trazas y propiedades de fallas activas de interés sismogénico."],
  ["GPlates / EarthByte", "Geometría y reconstrucción cinemática de placas; RDSISMOS fija el modelo tectónico usado cuando corresponde."],
  ["PB2002", "Conjunto científico de límites de placas utilizado como contexto tectónico en el simulador."],
] as const;

export function AboutRdsismos() {
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>RDSISMOS · GUÍA Y METODOLOGÍA</span>
          <h1>Acerca de RDSISMOS</h1>
          <p>
            Esta sección explica qué hace cada pestaña, cómo usarla, qué base teórica utiliza y cuáles son sus límites.
            RDSISMOS separa deliberadamente <strong>observación</strong>, <strong>estadística</strong>, <strong>modelado físico</strong> y <strong>simulación</strong> para evitar presentar una inferencia como si fuera un dato medido.
          </p>
        </div>
        <div className={styles.badge}>
          <span>Principio central</span>
          <strong>Analizar ≠ predecir exactamente</strong>
          <small>Probabilidades, patrones y modelos deben leerse con su incertidumbre.</small>
        </div>
      </header>

      <section className={styles.quickStart}>
        <div>
          <span className={styles.eyebrow}>POR DÓNDE EMPEZAR</span>
          <h2>Una ruta sencilla para un usuario nuevo</h2>
        </div>
        <div className={styles.quickGrid}>
          <article><b>1</b><strong>Mira qué ocurrió</strong><span>Eventos Sísmicos y Mapa de Calor.</span></article>
          <article><b>2</b><strong>Busca contexto</strong><span>Mapa 3D y GPlates.</span></article>
          <article><b>3</b><strong>Explora escenarios</strong><span>ETAS, Scope y Simulador.</span></article>
          <article><b>4</b><strong>Comprueba el modelo</strong><span>Historial y Auto-Validación.</span></article>
        </div>
      </section>

      <section className={styles.modules} aria-label="Guía de módulos">
        {MODULES.map((module, index) => (
          <article className={styles.moduleCard} key={module.id} id={module.id}>
            <div className={styles.moduleHead}>
              <span className={styles.number}>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h2>{module.name}</h2>
                <p>{module.subtitle}</p>
              </div>
            </div>

            <p className={styles.what}>{module.what}</p>

            <div className={styles.columns}>
              <section>
                <h3>Cómo se usa</h3>
                <ol>{module.how.map((item) => <li key={item}>{item}</li>)}</ol>
              </section>
              <section>
                <h3>Base teórica</h3>
                <ul>{module.theory.map((item) => <li key={item}>{item}</li>)}</ul>
              </section>
            </div>

            <div className={styles.sources}>
              <strong>Datos / referencias:</strong>
              <div>{module.sources.map((source) => <span key={source}>{source}</span>)}</div>
            </div>
            <div className={styles.caution}><strong>Importante:</strong> {module.caution}</div>
          </article>
        ))}
      </section>

      <section className={styles.sourceSection}>
        <div className={styles.sectionTitle}>
          <span className={styles.eyebrow}>FUENTES</span>
          <h2>De dónde salen los datos</h2>
          <p>RDSISMOS intenta consultar directamente la fuente primaria de cada conjunto de datos y conserva la procedencia en los módulos donde corresponde.</p>
        </div>
        <div className={styles.sourceGrid}>
          {DATA_SOURCES.map(([name, description]) => (
            <article key={name}><strong>{name}</strong><span>{description}</span></article>
          ))}
        </div>
      </section>

      <section className={styles.finalNote}>
        <span>NOTA METODOLÓGICA</span>
        <h2>Qué es —y qué no es— RDSISMOS</h2>
        <p>
          <strong>RDSISMOS es una herramienta de análisis.</strong> Trabaja con datos procedentes de las fuentes oficiales y repositorios científicos primarios indicados arriba, y aplica sobre ellos modelos estadísticos, geométricos y físicos documentados dentro de cada módulo.
        </p>
        <p>
          Sus resultados sirven para explorar patrones, comparar hipótesis, estudiar contexto tectónico y auditar modelos. No sustituyen los boletines, alertas, mapas oficiales de amenaza ni las recomendaciones de los organismos sismológicos y de protección civil. Ninguna pestaña de RDSISMOS debe interpretarse como una predicción determinista del día, hora y lugar de un terremoto futuro.
        </p>
      </section>
    </main>
  );
}
