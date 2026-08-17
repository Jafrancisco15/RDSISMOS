"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { HistoricalHeatmapResponse } from "@/lib/historicalHeatmap";
import styles from "./HistoricalHeatmap.module.css";

const HistoricalHeatmapGlobe = dynamic(
  () => import("./HistoricalHeatmapGlobe").then((module) => module.HistoricalHeatmapGlobe),
  { ssr: false, loading: () => <div className={styles.globeLoading}>Inicializando superficie sísmica 3D…</div> },
);

const MIN_YEAR = 1900;
const DB_NAME = "rdsismos-historical-heatmap-v2";
const STORE_NAME = "annual-surfaces";

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

function openCacheDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: "year" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("No fue posible abrir la caché histórica."));
  });
}

async function cacheRead(year: number) {
  if (typeof indexedDB === "undefined") return null;
  const database = await openCacheDb();
  return new Promise<HistoricalHeatmapResponse | null>((resolve) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(year);
    request.onsuccess = () => resolve((request.result as HistoricalHeatmapResponse | undefined) ?? null);
    request.onerror = () => resolve(null);
    transaction.oncomplete = () => database.close();
  });
}

async function cacheWrite(payload: HistoricalHeatmapResponse) {
  if (typeof indexedDB === "undefined") return;
  const database = await openCacheDb();
  await new Promise<void>((resolve) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(payload);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
  });
  database.close();
}

async function cachedYears() {
  if (typeof indexedDB === "undefined") return [] as number[];
  const database = await openCacheDb();
  return new Promise<number[]>((resolve) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAllKeys();
    request.onsuccess = () => resolve(request.result.map(Number).filter(Number.isFinite));
    request.onerror = () => resolve([]);
    transaction.oncomplete = () => database.close();
  });
}

function cacheIsFresh(payload: HistoricalHeatmapResponse, currentYear: number) {
  if (payload.year !== currentYear) return true;
  const generatedAt = Date.parse(payload.generatedAt);
  return Number.isFinite(generatedAt) && Date.now() - generatedAt < 30 * 60_000;
}

async function fetchAnnualSurface(year: number, signal?: AbortSignal) {
  const response = await fetch(`/api/historical-heatmap?year=${year}`, {
    cache: "force-cache",
    signal,
  });
  const payload = await readPayload(response);
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

export function HistoricalHeatmap() {
  const currentYear = new Date().getUTCFullYear();
  const totalYears = currentYear - MIN_YEAR + 1;
  const memoryCache = useRef(new Map<number, HistoricalHeatmapResponse>());
  const preloadStarted = useRef(false);
  const [year, setYear] = useState(currentYear);
  const [data, setData] = useState<HistoricalHeatmapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [showCountryNames, setShowCountryNames] = useState(true);
  const [showPlateAreas, setShowPlateAreas] = useState(true);
  const [showPlateNames, setShowPlateNames] = useState(true);
  const [showPlateBoundaries, setShowPlateBoundaries] = useState(false);
  const [showFaults, setShowFaults] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [preloadedYears, setPreloadedYears] = useState(0);
  const [preloadActive, setPreloadActive] = useState(false);
  const [preloadError, setPreloadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const inMemory = memoryCache.current.get(year);
        if (inMemory && cacheIsFresh(inMemory, currentYear)) {
          if (!disposed) setData(inMemory);
          return;
        }
        const persisted = await cacheRead(year).catch(() => null);
        if (persisted && cacheIsFresh(persisted, currentYear)) {
          memoryCache.current.set(year, persisted);
          if (!disposed) setData(persisted);
          return;
        }
        const payload = await fetchAnnualSurface(year, controller.signal);
        memoryCache.current.set(year, payload);
        void cacheWrite(payload);
        if (!disposed) setData(payload);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        if (!disposed) setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el año seleccionado.");
      } finally {
        if (!disposed) setLoading(false);
      }
    }

    void load();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [currentYear, year]);

  useEffect(() => {
    if (preloadStarted.current) return;
    preloadStarted.current = true;
    let cancelled = false;

    async function preloadHistory() {
      setPreloadActive(true);
      try {
        const existing = new Set(await cachedYears());
        if (cancelled) return;
        setPreloadedYears(existing.size);
        const queue = Array.from({ length: totalYears }, (_, index) => MIN_YEAR + index)
          .filter((candidate) => !existing.has(candidate))
          .sort((a, b) => Math.abs(a - currentYear) - Math.abs(b - currentYear));

        for (const candidate of queue) {
          if (cancelled) return;
          try {
            const payload = await fetchAnnualSurface(candidate);
            if (cancelled) return;
            memoryCache.current.set(candidate, payload);
            await cacheWrite(payload);
            existing.add(candidate);
            setPreloadedYears(existing.size);
            setPreloadError(null);
          } catch (preloadFailure) {
            if (!cancelled) {
              setPreloadError(preloadFailure instanceof Error ? preloadFailure.message : `No fue posible precargar ${candidate}.`);
            }
          }
          await new Promise((resolve) => window.setTimeout(resolve, 120));
        }
      } finally {
        if (!cancelled) setPreloadActive(false);
      }
    }

    void preloadHistory();
    return () => { cancelled = true; };
  }, [currentYear, totalYears]);

  useEffect(() => {
    if (!playing || loading || !data || data.year !== year) return;
    const timer = window.setTimeout(() => {
      setYear((value) => value >= currentYear ? MIN_YEAR : value + 1);
    }, 1_050);
    return () => window.clearTimeout(timer);
  }, [currentYear, data, loading, playing, year]);

  const preloadPercent = Math.min(100, Math.round((preloadedYears / totalYears) * 100));
  const tectonicLayersActive = showPlateAreas || showPlateNames || showPlateBoundaries || showFaults;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>RDSISMOS · USGS HISTORICAL SURFACE</span>
          <h1>Mapa de Calor Histórico</h1>
          <p>
            Superficie sísmica mundial por año basada en USGS ComCat. No dibuja cilindros ni epicentros individuales:
            agrupa el catálogo en celdas geográficas y colorea cada área por la magnitud máxima registrada allí.
          </p>
        </div>
        <div className={styles.yearBadge}>
          <span>Año visualizado</span>
          <strong>{year}</strong>
          <small>{data?.provider ?? "USGS ComCat"} · M2.5+ · malla 1.5°</small>
        </div>
      </header>

      <section className={styles.preloadPanel}>
        <div>
          <strong>{preloadedYears >= totalYears ? "Historia precargada" : "Precarga histórica"}</strong>
          <span>{preloadedYears} de {totalYears} años guardados localmente · {preloadPercent}%</span>
        </div>
        <div className={styles.preloadTrack}><i style={{ width: `${preloadPercent}%` }} /></div>
        <small>{preloadActive ? "Continúa en segundo plano mientras exploras el globo." : "La precarga está completa o detenida."}{preloadError ? ` Último aviso: ${preloadError}` : ""}</small>
      </section>

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
        <p>El color representa magnitud máxima local; la opacidad aumenta con la cantidad de eventos registrados en esa área.</p>
      </section>

      {tectonicLayersActive && (
        <section className={styles.tectonicLegend} aria-label="Leyenda tectónica">
          <div className={styles.tectonicLegendHead}>
            <strong>Contexto tectónico</strong>
            <span>Las áreas de placas PB2002 tienen colores distintos y permanecen debajo de la superficie sísmica.</span>
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
          {showFaults && <p className={styles.faultLegendText}>Las fallas GEM se dibujan sobre el mapa; al pasar el cursor muestra la cinemática disponible.</p>}
        </section>
      )}

      <section className={styles.globeStage}>
        {loading && (!data || data.year !== year) && <div className={styles.loadingOverlay}>Preparando superficie USGS para {year}…</div>}
        {data && (
          <HistoricalHeatmapGlobe
            cells={data.cells}
            showCountryNames={showCountryNames}
            showPlateAreas={showPlateAreas}
            showPlateNames={showPlateNames}
            showPlateBoundaries={showPlateBoundaries}
            showFaults={showFaults}
            autoRotate={autoRotate}
          />
        )}
      </section>

      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.metrics}>
        <article><span>Eventos agregados</span><strong>{data?.totalEvents.toLocaleString() ?? "—"}</strong><small>{data?.cells.length.toLocaleString() ?? "—"} áreas activas de 1.5°</small></article>
        <article><span>Mayor magnitud</span><strong>{data?.strongestEvent ? `M${data.strongestEvent.magnitude.toFixed(1)}` : "—"}</strong><small>{data?.strongestEvent?.place ?? "Sin evento destacado"}</small></article>
        <article><span>Magnitud media</span><strong>{data?.averageMagnitude?.toFixed(2) ?? "—"}</strong><small>sobre todo el catálogo M2.5+ del año</small></article>
        <article><span>Profundidad media</span><strong>{data?.averageDepthKm === null || data?.averageDepthKm === undefined ? "—" : `${data.averageDepthKm.toFixed(0)} km`}</strong><small>{data ? `${formatDate(data.startTime)} → ${formatDate(data.endTime)}` : "Año seleccionado"}</small></article>
      </section>

      {(data?.warnings.length ?? 0) > 0 && (
        <section className={styles.notice}>
          <strong>Lectura científica:</strong> {data?.warnings.join(" ")}
          {" "}La escala de color representa magnitud observada, no riesgo ni probabilidad futura.
        </section>
      )}

      <section className={styles.explanation}>
        <article>
          <span>Color = magnitud</span>
          <h2>Frío para sismos pequeños, rojo para M7+</h2>
          <p>La magnitud máxima observada dentro de cada celda determina el color. Un M7+ vuelve roja esa área aunque no exista una gran cantidad de sismos pequeños alrededor.</p>
        </article>
        <article>
          <span>Opacidad = actividad</span>
          <h2>La densidad sigue estando presente</h2>
          <p>La cantidad de terremotos de la celda modifica la opacidad, no el color. Así se separa visualmente la severidad del evento de la frecuencia de ocurrencia.</p>
        </article>
      </section>
    </main>
  );
}
