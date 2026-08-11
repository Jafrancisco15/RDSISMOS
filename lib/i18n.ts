import { COUNTRIES } from "./countries";

export type SiteLocale = "es" | "en";

type Pair = readonly [es: string, en: string];

const PHRASES: Pair[] = [
  ["Navegación principal", "Main navigation"],
  ["Mapa 3D", "3D Map"],
  ["Proyección Scope", "Scope Projection"],
  ["Eventos Sísmicos", "Seismic Events"],
  ["Evento sísmico", "Seismic event"],
  ["Evento fuente", "Source event"],
  ["Evento precedente", "Preceding event"],
  ["Sismo precedente", "Preceding earthquake"],
  ["Sismos precedentes", "Preceding earthquakes"],
  ["Proyección cumplida", "Fulfilled projection"],
  ["Proyecciones cumplidas", "Fulfilled projections"],
  ["Proyección activa", "Active projection"],
  ["Proyecciones activas", "Active projections"],
  ["Historial de proyecciones", "Projection history"],
  ["Actividad sísmica", "Seismic activity"],
  ["Actividad posterior", "Subsequent activity"],
  ["Actividad local", "Local activity"],
  ["Línea base", "Baseline"],
  ["Actividad base", "Baseline activity"],
  ["Diferencia vs. base", "Difference vs. baseline"],
  ["Exceso vs. base", "Excess vs. baseline"],
  ["Calidad de evidencia del escenario", "Scenario evidence quality"],
  ["Calidad de evidencia", "Evidence quality"],
  ["Probabilidad estimada", "Estimated probability"],
  ["Probabilidad empírica", "Empirical probability"],
  ["Probabilidad Scope", "Scope probability"],
  ["Base Scope", "Scope baseline"],
  ["Evidencia EarthScope", "EarthScope evidence"],
  ["Evidencia histórica", "Historical evidence"],
  ["Análogos históricos", "Historical analogs"],
  ["Análogo histórico", "Historical analog"],
  ["Ventana de control", "Control window"],
  ["Ventana posterior", "Post-event window"],
  ["Ventana temporal", "Time window"],
  ["Rango de magnitud", "Magnitude range"],
  ["Magnitud proyectada", "Projected magnitude"],
  ["Fecha del precedente", "Preceding event date"],
  ["Lugar del precedente", "Preceding event location"],
  ["Cumplida por", "Fulfilled by"],
  ["Se cumplió", "Fulfilled"],
  ["No cumplida", "Not fulfilled"],
  ["Pendiente de evaluación", "Pending evaluation"],
  ["Fuera de rango", "Out of range"],
  ["Sin señal", "No signal"],
  ["Sin datos", "No data"],
  ["Sin resultados", "No results"],
  ["Sin proyecciones", "No projections"],
  ["Sin coincidencias", "No matches"],
  ["Sin evidencia", "No evidence"],
  ["No disponible", "Unavailable"],
  ["Abrir detalle", "Open details"],
  ["Cerrar detalle", "Close details"],
  ["Ver detalle", "View details"],
  ["Ver proyección", "View projection"],
  ["Abrir proyección", "Open projection"],
  ["Abrir análisis regional complementario", "Open complementary regional analysis"],
  ["análisis regional complementario", "complementary regional analysis"],
  ["Análisis regional", "Regional analysis"],
  ["contexto regional", "regional context"],
  ["contexto tectónico", "tectonic context"],
  ["Mapa tectónico", "Tectonic map"],
  ["placas tectónicas", "tectonic plates"],
  ["límites de placas", "plate boundaries"],
  ["fallas geológicas", "geological faults"],
  ["falla geológica", "geological fault"],
  ["respuesta dinámica", "dynamic response"],
  ["respuesta estática", "static response"],
  ["respuesta instrumental", "instrumental response"],
  ["ondas sísmicas", "seismic waves"],
  ["ondas superficiales", "surface waves"],
  ["tiempos de viaje", "travel times"],
  ["tiempo de llegada", "arrival time"],
  ["estaciones sísmicas", "seismic stations"],
  ["estación sísmica", "seismic station"],
  ["estaciones EarthScope", "EarthScope stations"],
  ["formas de onda", "waveforms"],
  ["forma de onda", "waveform"],
  ["datos observados", "observed data"],
  ["evento observado", "observed event"],
  ["movimiento observado", "observed motion"],
  ["movimiento del suelo", "ground motion"],
  ["respuesta instrumental corregida", "corrected instrumental response"],
  ["respuesta corregida", "corrected response"],
  ["cobertura instrumental", "instrumental coverage"],
  ["cobertura azimutal", "azimuthal coverage"],
  ["cobertura espacial", "spatial coverage"],
  ["Fuente primaria", "Primary source"],
  ["Productos EarthScope", "EarthScope products"],
  ["Datos relacionados con el evento", "Event-related data"],
  ["Acceso a datos del evento", "Event data access"],
  ["Interpretación científica", "Scientific interpretation"],
  ["Seguridad científica", "Scientific safeguards"],
  ["Avisos de cobertura/datos", "Coverage/data notices"],
  ["avisos de cobertura/datos", "coverage/data notices"],
  ["Consultando EarthScope", "Querying EarthScope"],
  ["Recalcular Scope", "Recalculate Scope"],
  ["Selecciona un terremoto", "Select an earthquake"],
  ["Fuente seleccionada", "Selected source"],
  ["País seleccionado", "Selected country"],
  ["Todos los países", "All countries"],
  ["Todos los estados", "All statuses"],
  ["Ordenar por", "Sort by"],
  ["Orden ascendente", "Ascending order"],
  ["Orden descendente", "Descending order"],
  ["Registros por página", "Rows per page"],
  ["Página anterior", "Previous page"],
  ["Página siguiente", "Next page"],
  ["Primera página", "First page"],
  ["Última página", "Last page"],
  ["de un total de", "of a total of"],
  ["Fecha de generación", "Generation date"],
  ["Última actualización", "Last updated"],
  ["Último evento", "Latest event"],
  ["Último precedente", "Latest preceding event"],
  ["hace unos segundos", "a few seconds ago"],
  ["La vista principal combina la proyección histórica por país con el contexto regional. El análisis regional detallado queda disponible como sección complementaria para evitar duplicar controles y cifras.", "The main view combines the historical country projection with regional context. Detailed regional analysis remains available as a complementary section to avoid duplicating controls and figures."],
  ["ETAS espacio-tiempo, actividad local y evidencia técnica detallada.", "ETAS space-time analysis, local activity and detailed technical evidence."],
  ["al norte de", "north of"],
  ["al sur de", "south of"],
  ["al este de", "east of"],
  ["al oeste de", "west of"],
  ["cerca de", "near"],
  ["mar adentro", "offshore"],
  ["República Democrática", "Democratic Republic"],
  ["Estados Unidos", "United States"],
  ["República Dominicana", "Dominican Republic"],
  ["Nueva Zelanda", "New Zealand"],
  ["Corea del Norte", "North Korea"],
  ["Corea del Sur", "South Korea"],
  ["Costa de Marfil", "Côte d’Ivoire"],
  ["Arabia Saudí", "Saudi Arabia"],
  ["Emiratos Árabes Unidos", "United Arab Emirates"],
];

const WORDS: Pair[] = [
  ["el", "the"], ["la", "the"], ["los", "the"], ["las", "the"], ["un", "a"], ["una", "a"],
  ["de", "of"], ["del", "of the"], ["al", "to the"], ["en", "in"], ["con", "with"], ["sin", "without"], ["para", "for"], ["por", "by"],
  ["y", "and"], ["o", "or"], ["pero", "but"], ["que", "that"], ["como", "as"], ["cuando", "when"], ["donde", "where"], ["según", "according to"],
  ["este", "this"], ["esta", "this"], ["estos", "these"], ["estas", "these"], ["ese", "that"], ["esa", "that"], ["cada", "each"], ["otro", "other"], ["otra", "other"],
  ["su", "its"], ["sus", "their"], ["se", "is"], ["es", "is"], ["son", "are"], ["fue", "was"], ["fueron", "were"], ["ser", "be"], ["está", "is"], ["están", "are"],
  ["ha", "has"], ["han", "have"], ["hay", "there are"], ["tiene", "has"], ["tienen", "have"], ["puede", "can"], ["pueden", "can"], ["debe", "must"], ["deben", "must"],
  ["usa", "uses"], ["usar", "use"], ["utiliza", "uses"], ["utilizar", "use"], ["muestra", "shows"], ["muestran", "show"], ["incluye", "includes"], ["incluyen", "include"],
  ["calcula", "calculates"], ["calcular", "calculate"], ["compara", "compares"], ["comparar", "compare"], ["evalúa", "evaluates"], ["evaluar", "evaluate"], ["detecta", "detects"], ["registró", "recorded"],
  ["ocurre", "occurs"], ["ocurren", "occur"], ["ocurrido", "occurred"], ["ocurridos", "occurred"], ["ocurrió", "occurred"], ["aparece", "appears"], ["aparecen", "appear"],
  ["después", "after"], ["antes", "before"], ["dentro", "within"], ["fuera", "outside"], ["lejos", "far"], ["entre", "between"], ["sobre", "about"],
  ["solo", "only"], ["sólo", "only"], ["también", "also"], ["aún", "still"], ["ya", "already"], ["no", "no"], ["sí", "yes"], ["más", "more"], ["menos", "less"],
  ["posible", "possible"], ["posibles", "possible"], ["real", "real"], ["reales", "real"], ["nuevo", "new"], ["nueva", "new"], ["nuevos", "new"], ["nuevas", "new"],
  ["mismo", "same"], ["misma", "same"], ["diferente", "different"], ["diferentes", "different"], ["actual", "current"], ["actuales", "current"],
  ["reciente", "recent"], ["recientes", "recent"], ["antiguo", "old"], ["antiguos", "old"], ["aproximado", "approximate"], ["aproximada", "approximate"], ["aproximadamente", "approximately"],
  ["directamente", "directly"], ["relativamente", "relatively"], ["principal", "main"], ["complementario", "complementary"], ["detallado", "detailed"], ["detallada", "detailed"],
  ["técnica", "technical"], ["técnico", "technical"], ["científica", "scientific"], ["científico", "scientific"], ["operacional", "operational"],
  ["automática", "automatic"], ["automático", "automatic"], ["manual", "manual"], ["completa", "complete"], ["completo", "complete"], ["parcial", "partial"],
  ["válido", "valid"], ["válida", "valid"], ["inválido", "invalid"], ["inválida", "invalid"], ["suficiente", "sufficient"], ["suficientes", "sufficient"],
  ["limitada", "limited"], ["limitado", "limited"], ["confirmado", "confirmed"], ["confirmada", "confirmed"], ["guardado", "saved"], ["guardada", "saved"], ["almacenado", "stored"],
  ["proyección", "projection"], ["proyecciones", "projections"], ["predicción", "prediction"], ["predicciones", "predictions"], ["historial", "history"], ["simulador", "simulator"],
  ["evento", "event"], ["eventos", "events"], ["precedente", "preceding event"], ["precedentes", "preceding events"], ["sismo", "earthquake"], ["sismos", "earthquakes"], ["terremoto", "earthquake"], ["terremotos", "earthquakes"],
  ["sísmico", "seismic"], ["sísmica", "seismic"], ["sísmicos", "seismic"], ["sísmicas", "seismic"], ["tectónico", "tectonic"], ["tectónica", "tectonic"], ["tectónicos", "tectonic"], ["tectónicas", "tectonic"],
  ["actividad", "activity"], ["probabilidad", "probability"], ["confianza", "confidence"], ["base", "baseline"], ["diferencia", "difference"], ["exceso", "excess"],
  ["evidencia", "evidence"], ["calidad", "quality"], ["recurrencia", "recurrence"], ["análogo", "analog"], ["análogos", "analogs"], ["control", "control"],
  ["modelo", "model"], ["método", "method"], ["metodología", "methodology"], ["limitación", "limitation"], ["limitaciones", "limitations"], ["resultado", "result"], ["resultados", "results"],
  ["criterio", "criterion"], ["criterios", "criteria"], ["parámetro", "parameter"], ["parámetros", "parameters"], ["ventana", "window"], ["inicio", "start"], ["fin", "end"],
  ["desde", "from"], ["hasta", "to"], ["anterior", "previous"], ["siguiente", "next"], ["histórico", "historical"], ["histórica", "historical"], ["históricos", "historical"], ["históricas", "historical"],
  ["observado", "observed"], ["observada", "observed"], ["proyectado", "projected"], ["proyectada", "projected"], ["estimado", "estimated"], ["estimada", "estimated"], ["experimental", "experimental"],
  ["cumplida", "fulfilled"], ["cumplidas", "fulfilled"], ["cumplido", "fulfilled"], ["cumplidos", "fulfilled"], ["activa", "active"], ["activo", "active"], ["expirada", "expired"], ["expirado", "expired"],
  ["evaluada", "evaluated"], ["evaluado", "evaluated"], ["pendiente", "pending"], ["pendientes", "pending"], ["fallida", "failed"], ["fallido", "failed"], ["resuelta", "resolved"], ["resuelto", "resolved"],
  ["global", "global"], ["local", "local"], ["regional", "regional"], ["dinámica", "dynamic"], ["dinámico", "dynamic"], ["estática", "static"], ["estático", "static"], ["instrumental", "instrumental"],
  ["relativa", "relative"], ["relativo", "relative"], ["ponderada", "weighted"], ["ponderado", "weighted"], ["posterior", "subsequent"], ["posteriores", "subsequent"],
  ["independiente", "independent"], ["independientes", "independent"], ["similar", "similar"], ["similares", "similar"], ["similitud", "similarity"], ["coincidencia", "match"], ["coincidencias", "matches"],
  ["cumplimiento", "fulfillment"], ["ocurrencia", "occurrence"], ["ocurrencias", "occurrences"], ["riesgo", "risk"], ["certeza", "certainty"], ["causalidad", "causality"], ["asociación", "association"],
  ["conexión", "connection"], ["conectividad", "connectivity"], ["estructura", "structure"], ["estructuras", "structures"], ["placa", "plate"], ["placas", "plates"], ["falla", "fault"], ["fallas", "faults"],
  ["onda", "wave"], ["ondas", "waves"], ["estación", "station"], ["estaciones", "stations"], ["canal", "channel"], ["canales", "channels"], ["muestras", "samples"], ["señal", "signal"], ["señales", "signals"],
  ["soporte", "support"], ["calibración", "calibration"], ["corregida", "corrected"], ["corregido", "corrected"], ["comparables", "comparable"], ["disponible", "available"], ["disponibles", "available"],
  ["seleccionado", "selected"], ["seleccionada", "selected"], ["seleccionar", "select"], ["mostrar", "show"], ["ocultar", "hide"], ["abrir", "open"], ["cerrar", "close"], ["reproducir", "play"], ["pausar", "pause"],
  ["detener", "stop"], ["reiniciar", "restart"], ["actualizar", "refresh"], ["recalcular", "recalculate"], ["buscar", "search"], ["filtrar", "filter"], ["ordenar", "sort"], ["ver", "view"],
  ["alto", "high"], ["alta", "high"], ["bajo", "low"], ["baja", "low"], ["intermedio", "intermediate"], ["intermedia", "intermediate"], ["fuerte", "strong"], ["débil", "weak"],
  ["mayor", "highest"], ["menor", "lowest"], ["máximo", "maximum"], ["máxima", "maximum"], ["mínimo", "minimum"], ["mínima", "minimum"], ["promedio", "average"], ["media", "average"], ["total", "total"],
  ["conteo", "count"], ["cantidad", "count"], ["precisión", "precision"], ["exactitud", "accuracy"], ["error", "error"], ["errores", "errors"], ["aviso", "notice"], ["avisos", "notices"], ["advertencia", "warning"],
  ["advertencias", "warnings"], ["información", "information"], ["detalle", "details"], ["detalles", "details"], ["explicación", "explanation"], ["interpretación", "interpretation"], ["referencia", "reference"],
  ["referencias", "references"], ["estudio", "study"], ["estudios", "studies"], ["geología", "geology"], ["geológico", "geological"], ["geológica", "geological"], ["física", "physics"], ["físico", "physical"],
  ["probabilístico", "probabilistic"], ["empírica", "empirical"], ["empírico", "empirical"], ["comparación", "comparison"], ["país", "country"], ["países", "countries"], ["zona", "zone"], ["zonas", "zones"],
  ["estado", "status"], ["fecha", "date"], ["nombre", "name"], ["lugar", "place"], ["ubicación", "location"], ["coordenadas", "coordinates"], ["latitud", "latitude"], ["longitud", "longitude"],
  ["magnitud", "magnitude"], ["profundidad", "depth"], ["distancia", "distance"], ["radio", "radius"], ["epicentro", "epicenter"], ["hipocentro", "hypocenter"], ["profundo", "deep"], ["profunda", "deep"], ["superficial", "shallow"],
  ["subducción", "subduction"], ["convergente", "convergent"], ["divergente", "divergent"], ["transformante", "transform"], ["desplazamiento", "displacement"], ["velocidad", "velocity"], ["aceleración", "acceleration"],
  ["amplitud", "amplitude"], ["esfuerzo", "stress"], ["peso", "weight"], ["pesos", "weights"], ["índice", "index"], ["tasa", "rate"], ["registro", "record"], ["registros", "records"], ["fila", "row"], ["filas", "rows"],
  ["tabla", "table"], ["listado", "list"], ["lista", "list"], ["página", "page"], ["páginas", "pages"], ["selector", "selector"], ["filtro", "filter"], ["filtros", "filters"], ["botón", "button"], ["botones", "buttons"],
  ["red", "network"], ["redes", "networks"], ["archivo", "archive"], ["archivada", "archived"], ["archivadas", "archived"], ["servicio", "service"], ["servicios", "services"], ["consulta", "query"], ["consultas", "queries"],
  ["respuesta", "response"], ["respuestas", "responses"], ["código", "code"], ["disponibilidad", "availability"], ["cobertura", "coverage"], ["distribución", "distribution"], ["cercanía", "proximity"], ["rango", "range"],
  ["valor", "value"], ["valores", "values"], ["porcentaje", "percentage"], ["porcentajes", "percentages"], ["puntos", "points"], ["punto", "point"],
  ["norte", "north"], ["sur", "south"], ["oeste", "west"], ["central", "central"], ["oriental", "eastern"], ["occidental", "western"], ["costa", "coast"], ["isla", "island"], ["islas", "islands"], ["mar", "sea"], ["océano", "ocean"],
  ["días", "days"], ["día", "day"], ["horas", "hours"], ["hora", "hour"], ["minutos", "minutes"], ["minuto", "minute"], ["segundos", "seconds"], ["segundo", "second"], ["años", "years"], ["año", "year"],
  ["enero", "January"], ["febrero", "February"], ["marzo", "March"], ["abril", "April"], ["mayo", "May"], ["junio", "June"], ["julio", "July"], ["agosto", "August"],
  ["septiembre", "September"], ["octubre", "October"], ["noviembre", "November"], ["diciembre", "December"], ["ene", "Jan"], ["feb", "Feb"], ["abr", "Apr"], ["ago", "Aug"], ["dic", "Dec"],
];

let countryMaps: { esToEn: Map<string, string>; enToEs: Map<string, string> } | null = null;

function getCountryMaps() {
  if (countryMaps) return countryMaps;
  const esToEn = new Map<string, string>();
  const enToEs = new Map<string, string>();
  let display: Intl.DisplayNames | null = null;
  try {
    display = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en"], { type: "region" }) : null;
  } catch {
    display = null;
  }
  for (const country of COUNTRIES) {
    const english = display?.of(country.code) || country.name;
    esToEn.set(country.name, english);
    enToEs.set(english, country.name);
  }
  countryMaps = { esToEn, enToEs };
  return countryMaps;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function preserveCase(source: string, translated: string) {
  if (!source) return translated;
  if (source === source.toUpperCase() && /\p{L}/u.test(source)) return translated.toUpperCase();
  if (source[0] === source[0]?.toUpperCase()) return translated.charAt(0).toUpperCase() + translated.slice(1);
  return translated;
}

function replacePairs(text: string, locale: SiteLocale, pairs: Pair[]) {
  const sourceIndex = locale === "en" ? 0 : 1;
  const targetIndex = locale === "en" ? 1 : 0;
  let result = text;
  const ordered = [...pairs].sort((a, b) => b[sourceIndex].length - a[sourceIndex].length);
  for (const pair of ordered) {
    const source = pair[sourceIndex];
    const target = pair[targetIndex];
    if (!source || source.toLocaleLowerCase() === target.toLocaleLowerCase()) continue;
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(source)}(?![\\p{L}\\p{N}])`, "giu");
    result = result.replace(pattern, (match) => preserveCase(match, target));
  }
  return result;
}

function replaceCountries(text: string, locale: SiteLocale) {
  const maps = getCountryMaps();
  const dictionary = locale === "en" ? maps.esToEn : maps.enToEs;
  let result = text;
  const entries = [...dictionary.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [source, target] of entries) {
    if (!source || source === target) continue;
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(source)}(?![\\p{L}\\p{N}])`, "giu");
    result = result.replace(pattern, (match) => preserveCase(match, target));
  }
  return result;
}

function replaceWords(text: string, locale: SiteLocale) {
  const sourceIndex = locale === "en" ? 0 : 1;
  const targetIndex = locale === "en" ? 1 : 0;
  const dictionary = new Map<string, string>();
  for (const pair of WORDS) dictionary.set(pair[sourceIndex].toLocaleLowerCase(), pair[targetIndex]);
  return text.replace(/\p{L}+(?:[-’']\p{L}+)?/gu, (word) => {
    const translated = dictionary.get(word.toLocaleLowerCase());
    return translated ? preserveCase(word, translated) : word;
  });
}

function looksLikeCodeOrUrl(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return /^(https?:\/\/|www\.|[A-Z0-9]{1,6}\.[A-Z0-9]{1,6}(?:\.[A-Z0-9]{1,6})?)$/i.test(trimmed);
}

export function translateText(text: string, locale: SiteLocale): string {
  if (!text || looksLikeCodeOrUrl(text)) return text;
  let result = replaceCountries(text, locale);
  result = replacePairs(result, locale, PHRASES);
  result = replaceWords(result, locale);
  return result;
}

export function detectPreferredLocale(): SiteLocale {
  if (typeof window === "undefined") return "es";
  const stored = window.localStorage.getItem("rdsismos-language");
  if (stored === "es" || stored === "en") return stored;
  const preferred = window.navigator.languages?.[0] || window.navigator.language || "es";
  return preferred.toLocaleLowerCase().startsWith("es") ? "es" : "en";
}

export const localeMeta: Record<SiteLocale, { title: string; description: string }> = {
  es: {
    title: "RDSISMOS | Observatorio sísmico experimental",
    description: "Mapa experimental de actividad sísmica, proyecciones probabilísticas, recurrencia histórica y simulación tectónica.",
  },
  en: {
    title: "RDSISMOS | Experimental Seismic Observatory",
    description: "Experimental map of seismic activity, probabilistic projections, historical recurrence and tectonic simulation.",
  },
};
