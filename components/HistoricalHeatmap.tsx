"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import {
  aggregateHistoricalHeatmap,
  historicalCoverageNote,
  HISTORICAL_HEATMAP_CELL_SIZE_DEG,
  type HistoricalHeatmapCell,
  type HistoricalHeatmapEvent,
  type HistoricalHeatmapResponse,
} from "@/lib/historicalHeatmap";
import styles from "./HistoricalHeatmap.module.css";

const HistoricalHeatmapGlobe = dynamic(
  () => import("./HistoricalHeatmapGlobe").then((module) => module.HistoricalHeatmapGlobe),
  { ssr: false, loading: () => <div className={styles.globeLoading}>Inicializando globo 3D…</div> },
);

const MIN_YEAR = 1900;
const MIN_MAGNITUDE = 2.5;
const USGS_QUERY = "https://earthquake.usgs.gov/fdsnws/event/1/query";
const QUERY_LIMIT = 20_000;
const DOWNLOAD_CONCURRENCY = 2;

interface UsgsFeature {
  id?: string;
  geometry?: { coordinates?: [number, number, number] };
  properties?: Record<string, unknown>;
}

function normalizeFeature(feature: UsgsFeature): HistoricalHeatmapEvent | null {
  const coordinates = feature.geometry?.coordinates;
  const properties = feature.properties ?? {};
  const magnitude = Number(properties.mag);
  const time = new Date(Number(properties.time));
  if (!feature.id || !coordinates || coordinates.length < 3 || !Number.isFinite(magnitude) || Number.isNaN(time.getTime())) return null;
  const longitude = Number(coordinates[0]);
  const latitude = Number(coordinates[1]);
  const depthKm = Number(coordinates[2]);
  if (![latitude, longitude, depthKm].every(Number.isFinite)) return null;
  return {
    id: feature.id,
    latitude,
    longitude,
    magnitude,
    depthKm,
    timeUtc: time.toISOString(),
    place: typeof properties.place === "string" && properties.place.trim() ? properties.place.trim() : "Región no especificada",
  };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}

function monthRanges(year: number, endTime: Date) {
  const ranges: Array<[Date, Date]> = [];
  for (let month = 0; month < 12; month += 1) {
    const start = new Date(Date.UTC(year, month, 1));
    if (start >= endTime) break;
    const nextMonth = new Date(Date.UTC(year, month + 1, 1));
    const naturalEnd = new Date(nextMonth.getTime() - 1);
    ranges.push([start, naturalEnd < endTime ? naturalEnd : endTime]);
  }
  return ranges;
}

async function fetchRange(start: Date, end: Date, signal: AbortSignal, depth = 0): Promise<HistoricalHeatmapEvent[]> {
  const params = new URLSearchParams({
    format: "geojson",
    starttime: start.toISOString(),
    endtime: end.toISOString(),
    minmagnitude: String(MIN_MAGNITUDE),
    eventtype: "earthquake",
    orderby: "time-asc",
    limit: String(QUERY_LIMIT),
  });
  const response = await fetch(`${USGS_QUERY}?${params}`, { signal, mode: "cors", cache: "no-store" });

  if (response.status === 400 && depth < 6 && end.getTime() - start.getTime() > 2 * 86_400_000) {
    const midpointMs = Math.floor((start.getTime() + end.getTime()) / 2);
    const leftEnd = new Date(midpointMs);
    const rightStart = new Date(midpointMs + 1);
    const [left, right] = await Promise.all([
      fetchRange(start, leftEnd, signal, depth + 1),
      fetchRange(rightStart, end, signal, depth + 1),
    ]);
    return [...left, ...right];
  }

  if (!response.ok) {
    const detail = (await response.text()).trim().replace(/\s+/g, " ").slice(0, 180);
    throw new Error(`USGS HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  const payload = await response.json() as { features?: UsgsFeature[] };
  return (payload.features ?? []).map(normalizeFeature).filter((event): event is HistoricalHeatmapEvent => Boolean(event));
}

interface MergedCell {
  count: number;
  magnitudeSum: number;
  depthSum: number;
  maximumMagnitude: number;
  sample: HistoricalHeatmapCell;
}

function mergeCells(target: Map<string, MergedCell>, cells: HistoricalHeatmapCell[]) {
  for (const cell of cells) {
    const existing = target.get(cell.id);
    if (!existing) {
      target.set(cell.id, {
        count: cell.eventCount,
        magnitudeSum: cell.averageMagnitude * cell.eventCount,
        depthSum: cell.averageDepthKm * cell.eventCount,
        maximumMagnitude: cell.maximumMagnitude,
        sample: cell,
      });
      continue;
    }
    existing.count += cell.eventCount;
    existing.magnitudeSum += cell.averageMagnitude * cell.eventCount;
    existing.depthSum += cell.averageDepthKm * cell.eventCount;
    existing.maximumMagnitude = Math.max(existing.maximumMagnitude, cell.maximumMagnitude);
  }
}

function finalizeCells(cells: Map<string, MergedCell>): HistoricalHeatmapCell[] {
  return [...cells.values()].map((entry) => ({
    ...entry.sample,
    eventCount: entry.count,
    maximumMagnitude: Number(entry.maximumMagnitude.toFixed(2)),
    averageMagnitude: Number((entry.magnitudeSum / entry.count).toFixed(2)),
    averageDepthKm: Number((entry.depthSum / entry.count).toFixed(1)),
  })).sort((a, b) => b.maximumMagnitude - a.maximumMagnitude || b.eventCount - a.eventCount);
}

async function loadYearDirect(
  year: number,
  currentYear: number,
  signal: AbortSignal,
  setProgress: (value: number) => void,
  setStage: (value: string) => void,
): Promise<HistoricalHeatmapResponse> {
  const startTime = new Date(Date.UTC(year, 0, 1));
  const now = new Date();
  const nextYear = new Date(Date.UTC(year + 1, 0, 1));
  const endTime = year === currentYear ? now : new Date(nextYear.getTime() - 1);
  const ranges = monthRanges(year, endTime);
  const mergedCells = new Map<string, MergedCell>();
  let cursor = 0;
  let completed = 0;
  let totalEvents = 0;
  let totalMagnitude = 0;
  let totalDepth = 0;
  let strongestEvent: HistoricalHeatmapEvent | null = null;

  setProgress(2);
  setStage(`Conectando directamente con USGS · ${ranges.length} segmentos`);

  async function worker() {
    while (cursor < ranges.length) {
      const index = cursor;
      cursor += 1;
      const [start, end] = ranges[index];
      const events = await fetchRange(start, end, signal);
      if (signal.aborted) return;
      totalEvents += events.length;
      for (const event of events) {
        totalMagnitude += event.magnitude;
        totalDepth += event.depthKm;
        if (!strongestEvent || event.magnitude > strongestEvent.magnitude) strongestEvent = event;
      }
      mergeCells(mergedCells, aggregateHistoricalHeatmap(events));
      completed += 1;
      setProgress(Math.min(84, Math.round(5 + (completed / Math.max(1, ranges.length)) * 79)));
      setStage(`Descargando USGS · ${completed}/${ranges.length} segmentos`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, ranges.length) }, () => worker()));
  setProgress(88);
  setStage("Agregando sismicidad por áreas…");
  const cells = finalizeCells(mergedCells);
  setProgress(94);
  setStage("Preparando textura del globo…");

  return {
    year,
    generatedAt: new Date().toISOString(),
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    provider: "USGS ComCat",
    minimumMagnitude: MIN_MAGNITUDE,
    totalEvents,
    cellSizeDeg: HISTORICAL_HEATMAP_CELL_SIZE_DEG,
    cells,
    strongestEvent,
    averageMagnitude: totalEvents ? Number((totalMagnitude / totalEvents).toFixed(2)) : null,
    averageDepthKm: totalEvents ? Number((totalDepth / totalEvents).toFixed(1)) : null,
    warnings: [historicalCoverageNote(year)],
  };
}

export function HistoricalHeatmap() {
  const currentYear = new Date().getUTCFullYear();
  const [year, setYear] = useState(currentYear);
  const [data, setData] = useState<HistoricalHeatmapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("Preparando consulta…");
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showCountryNames, setShowCountryNames] = useState(true);
  const [showPlateAreas, setShowPlateAreas] = useState(true);
  const [showPlateNames, setShowPlateNames] = useState(true);
  const [showPlateBoundaries, setShowPlateBoundaries] = useState(false);
  const [showFaults, setShowFaults] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setLoading(true);
    setProgress(0);
    setStage("Preparando consulta directa a USGS…");
    setError(null);
    setData(null);

    loadYearDirect(year, currentYear, controller.signal, setProgress, setStage)
      .then((payload) => {
        if (!disposed) setData(payload);
      })
      .catch((loadError) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        if (!disposed) {
          setLoading(false);
          setError(loadError instanceof Error ? loadError.message : "No fue posible cargar USGS directamente.");
          setStage("Carga detenida");
        }
      });

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [currentYear, retryToken, year]);

  useEffect(() => {
    if (!playing || loading || !data || data.year !== year) return;
    const timer = window.setTimeout(() => setYear((value) => value >= currentYear ? MIN_YEAR : value + 1), 1_250);
    return () => window.clearTimeout(timer);
  }, [currentYear, data, loading, playing, year]);

  const tectonicLayersActive = showPlateAreas || showPlateNames || showPlateBoundaries || showFaults;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>RDSISMOS · USGS DIRECT HISTORICAL MAP</span>
          <h1>Mapa de Calor Histórico</h1>
          <p>
            El navegador consulta USGS ComCat directamente y construye una superficie de calor rasterizada para el globo.
            No depende de una función pesada de Vercel ni de una precarga persistente en IndexedDB.
          </p>
        </div>
        <div className={styles.yearBadge}>
          <span>Año visualizado</span>
          <strong>{year}</strong>
          <small>USGS ComCat · M2.5+ · malla 1.5°</small>
        </div>
      </header>

      <section className={styles.preloadPanel} aria-live="polite">
        <div>
          <strong>{progress >= 100 && !loading ? `Año ${year} listo` : `Cargando ${year}`}</strong>
          <span>{progress}% · {stage}</span>
        </div>
        <div className={styles.preloadTrack}><i style={{ width: `${progress}%` }} /></div>
        <small>Este porcentaje corresponde a la carga real del año seleccionado. No se descargan 127 años silenciosamente ni se usa almacenamiento local obligatorio.</small>
      </section>

      <section className={styles.timelinePanel}>
        <div className={styles.timelineTop}>
          <button type="button" onClick={() => setPlaying((value) => !value)} disabled={loading} className={playing ? styles.playing : ""}>
            {playing ? "Pausar recorrido" : "Reproducir años"}
          </button>
          <div className={styles.currentYear}>{year}</div>
          <button type="button" onClick={() => setYear(currentYear)}>Ir a {currentYear}</button>
        </div>
        <input
          className={styles.yearSlider}
          type="range"
          min={MIN_YEAR}
          max={currentYear}
          step={1}
          value={year}
          onChange={(event) => {
            setPlaying(false);
            setYear(Number(event.target.value));
          }}
          aria-label="Año del mapa sísmico histórico"
        />
        <div className={styles.yearTicks}>
          <span>1900</span><span>1930</span><span>1960</span><span>1990</span><span>2020</span><span>{currentYear}</span>
        </div>
      </section>

      <section className={styles.controls}>
        <label><input type="checkbox" checked={showCountryNames} onChange={(event) => setShowCountryNames(event.target.checked)} /> Nombres de países</label>
        <label className={styles.tectonicToggle}><input type="checkbox" checked={showPlateAreas} onChange={(event) => setShowPlateAreas(event.target.checked)} /> Áreas de placas</label>
        <label className={styles.tectonicToggle}><input type="checkbox" checked={showPlateNames} onChange={(event) => setShowPlateNames(event.target.checked)} /> Nombres de placas</label>
        <label className={styles.tectonicToggle}><input type="checkbox" checked={showPlateBoundaries} onChange={(event) => setShowPlateBoundaries(event.target.checked)} /> Límites + tipos</label>
        <label className={styles.tectonicToggle}><input type="checkbox" checked={showFaults} onChange={(event) => setShowFaults(event.target.checked)} /> Fallas activas</label>
        <label><input type="checkbox" checked={autoRotate} onChange={(event) => setAutoRotate(event.target.checked)} /> Rotación automática</label>
      </section>

      <section className={styles.legendPanel}>
        <div><span className={styles.legendBlue} /> M≤3 · frío</div>
        <div><span className={styles.legendCyan} /> M3–4</div>
        <div><span className={styles.legendGreen} /> M4–5</div>
        <div><span className={styles.legendYellow} /> M5–6</div>
        <div><span className={styles.legendOrange} /> M6–7</div>
        <div><span className={styles.legendRed} /> M7+ · máximo calor</div>
        <p>Color = magnitud máxima local. Extensión/opacidad = cantidad de eventos dentro de esa zona.</p>
      </section>

      {tectonicLayersActive && (
        <section className={styles.tectonicLegend} aria-label="Leyenda tectónica">
          <div className={styles.tectonicLegendHead}>
            <strong>Contexto tectónico</strong>
            <span>Las áreas de placas PB2002 se rasterizan dentro de la misma textura del globo para reducir carga WebGL.</span>
          </div>
          {showPlateBoundaries && (
            <div className={styles.tectonicItems}>
              <span><i className={styles.subduction} /> SUB · Subducción</span>
              <span><i className={styles.oceanRidge} /> OSR · Dorsal oceánica</span>
              <span><i className={styles.oceanTransform} /> OTF · Transformante oceánica</span>
              <span><i className={styles.oceanConvergent} /> OCB · Convergente oceánica</span>
              <span><i className={styles.continentalRift} /> CRB · Rift continental</span>
              <span><i className={styles.continentalTransform} /> CTF · Transformante continental</span>
              <span><i className={styles.continentalConvergent} /> CCB · Convergente continental</span>
            </div>
          )}
          {showFaults && <p className={styles.faultLegendText}>Las fallas GEM solo se solicitan cuando activas esta capa.</p>}
        </section>
      )}

      <section className={styles.globeStage}>
        {loading && <div className={styles.loadingOverlay}>Cargando {progress}% · {stage}</div>}
        {data && (
          <HistoricalHeatmapGlobe
            cells={data.cells}
            showCountryNames={showCountryNames}
            showPlateAreas={showPlateAreas}
            showPlateNames={showPlateNames}
            showPlateBoundaries={showPlateBoundaries}
            showFaults={showFaults}
            autoRotate={autoRotate}
            onTextureReady={() => {
              setProgress(100);
              setStage("Mapa listo");
              setLoading(false);
            }}
          />
        )}
      </section>

      {error && (
        <div className={styles.error}>
          <strong>No se pudo completar la carga directa desde USGS.</strong> {error}
          <button type="button" onClick={() => setRetryToken((value) => value + 1)} style={{ marginLeft: 10, padding: "7px 12px", borderRadius: 999, cursor: "pointer" }}>Reintentar</button>
        </div>
      )}

      <section className={styles.metrics}>
        <article><span>Eventos agregados</span><strong>{data?.totalEvents.toLocaleString() ?? "—"}</strong><small>{data?.cells.length.toLocaleString() ?? "—"} áreas activas de 1.5°</small></article>
        <article><span>Mayor magnitud</span><strong>{data?.strongestEvent ? `M${data.strongestEvent.magnitude.toFixed(1)}` : "—"}</strong><small>{data?.strongestEvent?.place ?? "Sin evento destacado"}</small></article>
        <article><span>Magnitud media</span><strong>{data?.averageMagnitude?.toFixed(2) ?? "—"}</strong><small>catálogo M2.5+ del año</small></article>
        <article><span>Profundidad media</span><strong>{data?.averageDepthKm === null || data?.averageDepthKm === undefined ? "—" : `${data.averageDepthKm.toFixed(0)} km`}</strong><small>{data ? `${formatDate(data.startTime)} → ${formatDate(data.endTime)}` : "Año seleccionado"}</small></article>
      </section>

      {(data?.warnings.length ?? 0) > 0 && (
        <section className={styles.notice}>
          <strong>Lectura científica:</strong> {data?.warnings.join(" ")} La escala representa el catálogo observado, no riesgo ni probabilidad futura.
        </section>
      )}

      <section className={styles.explanation}>
        <article>
          <span>Sin función histórica de Vercel</span>
          <h2>USGS → navegador → globo</h2>
          <p>El año seleccionado se divide en segmentos mensuales para respetar el límite del catálogo USGS. Cada segmento terminado avanza el porcentaje visible.</p>
        </article>
        <article>
          <span>Render ligero</span>
          <h2>Una sola textura en lugar de miles de objetos 3D</h2>
          <p>La sismicidad y las áreas de placas se rasterizan en un canvas equirectangular. El WebGL solo recibe una textura, nombres y las capas lineales que actives.</p>
        </article>
      </section>
    </main>
  );
}
