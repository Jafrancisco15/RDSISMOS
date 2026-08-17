"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { HistoricalHeatmapResponse } from "@/lib/historicalHeatmap";
import styles from "./HistoricalHeatmap.module.css";

const HistoricalHeatmapGlobe = dynamic(
  () => import("./HistoricalHeatmapGlobe").then((module) => module.HistoricalHeatmapGlobe),
  { ssr: false, loading: () => <div className={styles.globeLoading}>Inicializando globo histórico 3D…</div> },
);

const MIN_YEAR = 1900;
const MAGNITUDE_FILTERS = [2.5, 4, 5, 6] as const;
type HeatMode = "density" | "magnitude";

async function readPayload(response: Response) {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as HistoricalHeatmapResponse & { error?: string };
  } catch {
    throw new Error(raw || `HTTP ${response.status}`);
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function HistoricalHeatmap() {
  const currentYear = new Date().getUTCFullYear();
  const cacheRef = useRef(new Map<number, HistoricalHeatmapResponse>());
  const [year, setYear] = useState(currentYear);
  const [data, setData] = useState<HistoricalHeatmapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<HeatMode>("magnitude");
  const [minimumMagnitude, setMinimumMagnitude] = useState<number>(2.5);
  const [showCountryNames, setShowCountryNames] = useState(true);
  const [showStrongEvents, setShowStrongEvents] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);

  useEffect(() => {
    const cached = cacheRef.current.get(year);
    if (cached) {
      setData(cached);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const debounce = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/historical-heatmap?year=${year}`, {
          cache: "force-cache",
          signal: controller.signal,
        });
        const payload = await readPayload(response);
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        cacheRef.current.set(year, payload);
        setData(payload);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el año seleccionado.");
      } finally {
        setLoading(false);
      }
    }, 170);

    return () => {
      window.clearTimeout(debounce);
      controller.abort();
    };
  }, [year]);

  useEffect(() => {
    if (!data || data.year !== year) return;
    const neighbors = [year - 1, year + 1].filter((candidate) => candidate >= MIN_YEAR && candidate <= currentYear);
    neighbors.forEach((candidate) => {
      if (cacheRef.current.has(candidate)) return;
      void fetch(`/api/historical-heatmap?year=${candidate}`, { cache: "force-cache" })
        .then(async (response) => {
          if (!response.ok) return null;
          return readPayload(response);
        })
        .then((payload) => {
          if (payload && !payload.error) cacheRef.current.set(candidate, payload);
        })
        .catch(() => undefined);
    });
  }, [currentYear, data, year]);

  useEffect(() => {
    if (!playing || loading || !data || data.year !== year) return;
    const timer = window.setTimeout(() => {
      setYear((value) => value >= currentYear ? MIN_YEAR : value + 1);
    }, 1_450);
    return () => window.clearTimeout(timer);
  }, [currentYear, data, loading, playing, year]);

  const visibleEvents = useMemo(
    () => (data?.events ?? []).filter((event) => event.magnitude >= minimumMagnitude),
    [data, minimumMagnitude],
  );

  const stats = useMemo(() => {
    if (!visibleEvents.length) return { strongest: null, averageMagnitude: null, averageDepth: null };
    const strongest = [...visibleEvents].sort((a, b) => b.magnitude - a.magnitude)[0];
    return {
      strongest,
      averageMagnitude: visibleEvents.reduce((sum, event) => sum + event.magnitude, 0) / visibleEvents.length,
      averageDepth: visibleEvents.reduce((sum, event) => sum + event.depthKm, 0) / visibleEvents.length,
    };
  }, [visibleEvents]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>RDSISMOS · USGS HISTORICAL VIEW</span>
          <h1>Historical Heatmap</h1>
          <p>
            Recorre año por año la distribución mundial de terremotos registrados por USGS ComCat.
            El globo conserva la posición geográfica del catálogo y transforma la actividad en una superficie dinámica de calor.
          </p>
        </div>
        <div className={styles.yearBadge}>
          <span>Año visualizado</span>
          <strong>{year}</strong>
          <small>{data?.provider ?? "USGS ComCat"} · M2.5+ cargado</small>
        </div>
      </header>

      <section className={styles.timelinePanel}>
        <div className={styles.timelineTop}>
          <button type="button" onClick={() => setPlaying((value) => !value)} className={playing ? styles.playing : ""}>
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
        <div>
          <span>Lectura del calor</span>
          <div className={styles.buttonGroup}>
            <button type="button" className={mode === "density" ? styles.active : ""} onClick={() => setMode("density")}>Densidad</button>
            <button type="button" className={mode === "magnitude" ? styles.active : ""} onClick={() => setMode("magnitude")}>Magnitud</button>
          </div>
        </div>
        <div>
          <span>Magnitud mínima visible</span>
          <div className={styles.buttonGroup}>
            {MAGNITUDE_FILTERS.map((magnitude) => (
              <button key={magnitude} type="button" className={minimumMagnitude === magnitude ? styles.active : ""} onClick={() => setMinimumMagnitude(magnitude)}>
                M{magnitude.toFixed(magnitude % 1 ? 1 : 0)}+
              </button>
            ))}
          </div>
        </div>
        <label><input type="checkbox" checked={showCountryNames} onChange={(event) => setShowCountryNames(event.target.checked)} /> Nombres de países</label>
        <label><input type="checkbox" checked={showStrongEvents} onChange={(event) => setShowStrongEvents(event.target.checked)} /> Sismos M5.5+ individuales</label>
        <label><input type="checkbox" checked={autoRotate} onChange={(event) => setAutoRotate(event.target.checked)} /> Rotación automática</label>
      </section>

      <section className={styles.legendPanel}>
        <div><span className={styles.legendBlue} /> Baja señal</div>
        <div><span className={styles.legendCyan} /> Actividad intermedia</div>
        <div><span className={styles.legendYellow} /> Alta</div>
        <div><span className={styles.legendOrange} /> Muy alta</div>
        <div><span className={styles.legendRed} /> Máxima concentración</div>
        <p>{mode === "density" ? "Densidad: cada terremoto visible aporta el mismo peso." : "Magnitud: la densidad se pondera visualmente por magnitud; no representa energía sísmica absoluta."}</p>
      </section>

      <section className={styles.globeStage}>
        {loading && (!data || data.year !== year) && <div className={styles.loadingOverlay}>Consultando USGS para {year}…</div>}
        {data && (
          <HistoricalHeatmapGlobe
            events={visibleEvents}
            mode={mode}
            showCountryNames={showCountryNames}
            showStrongEvents={showStrongEvents}
            autoRotate={autoRotate}
          />
        )}
      </section>

      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.metrics}>
        <article><span>Eventos visibles</span><strong>{visibleEvents.length.toLocaleString()}</strong><small>de {data?.totalEvents.toLocaleString() ?? "—"} eventos M2.5+ cargados</small></article>
        <article><span>Mayor magnitud</span><strong>{stats.strongest ? `M${stats.strongest.magnitude.toFixed(1)}` : "—"}</strong><small>{stats.strongest?.place ?? "Sin eventos para el filtro"}</small></article>
        <article><span>Magnitud media</span><strong>{stats.averageMagnitude === null ? "—" : stats.averageMagnitude.toFixed(2)}</strong><small>sobre el filtro actualmente visible</small></article>
        <article><span>Profundidad media</span><strong>{stats.averageDepth === null ? "—" : `${stats.averageDepth.toFixed(0)} km`}</strong><small>{data ? `${formatDate(data.startTime)} → ${formatDate(data.endTime)}` : "Año seleccionado"}</small></article>
      </section>

      {(data?.warnings.length ?? 0) > 0 && (
        <section className={styles.notice}>
          <strong>Lectura científica:</strong> {data?.warnings.join(" ")}
          {" "}El slider muestra lo que existe en el catálogo, no una corrección por cambios históricos en la capacidad de detección de las redes.
        </section>
      )}

      <section className={styles.explanation}>
        <article>
          <span>Densidad</span>
          <h2>¿Dónde ocurrieron más sismos?</h2>
          <p>Usa todos los epicentros visibles con el mismo peso. Las zonas más calientes representan mayor concentración espacial de ocurrencias registradas durante el año.</p>
        </article>
        <article>
          <span>Magnitud</span>
          <h2>¿Dónde se concentraron los eventos más fuertes?</h2>
          <p>Usa los mismos epicentros, pero aumenta de forma moderada el peso visual de los terremotos de mayor magnitud para hacerlos destacar sin convertir el mapa en una escala de energía física.</p>
        </article>
      </section>
    </main>
  );
}
