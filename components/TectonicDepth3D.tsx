"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { TectonicDepth3DResponse } from "@/lib/tectonicDepth3d";
import styles from "./TectonicDepth3D.module.css";

const TectonicDepth3DRenderer = dynamic(
  () => import("./TectonicDepth3DRenderer").then((module) => module.TectonicDepth3DRenderer),
  { ssr: false, loading: () => <div className={styles.loading}>Inicializando vista tectónica 3D…</div> },
);

const TectonicRelief3DRenderer = dynamic(
  () => import("./TectonicRelief3DRenderer").then((module) => module.TectonicRelief3DRenderer),
  { ssr: false, loading: () => <div className={styles.loading}>Inicializando relieve topobatimétrico…</div> },
);

const DAY_MS = 86_400_000;
type PeriodPreset = "7" | "15" | "30" | "60" | "custom";
type ViewMode = "globe" | "relief";

type DepthEventsResponse = {
  events: EarthquakeEvent[];
  total: number;
  warnings?: string[];
  error?: string;
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoKey(days: number, endKey = todayKey()) {
  const end = new Date(`${endKey}T23:59:59.999Z`);
  return new Date(end.getTime() - days * DAY_MS).toISOString().slice(0, 10);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

async function readJson<T>(response: Response) {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(raw || `HTTP ${response.status}`);
  }
}

async function loadEarthquakes({
  start,
  end,
  minMagnitude,
  signal,
}: {
  start: string;
  end: string;
  minMagnitude: number;
  signal: AbortSignal;
}) {
  const params = new URLSearchParams({
    starttime: start,
    endtime: end,
    minmagnitude: String(minMagnitude),
  });
  const response = await fetch(`/api/tectonic-depth-3d/events?${params}`, {
    cache: "no-store",
    signal,
  });
  const payload = await readJson<DepthEventsResponse>(response);
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return {
    events: payload.events ?? [],
    total: payload.total ?? payload.events?.length ?? 0,
    warnings: payload.warnings ?? [],
  };
}

export function TectonicDepth3D() {
  const today = todayKey();
  const [viewMode, setViewMode] = useState<ViewMode>("globe");
  const [tectonic, setTectonic] = useState<TectonicDepth3DResponse | null>(null);
  const [earthquakes, setEarthquakes] = useState<EarthquakeEvent[]>([]);
  const [eventTotal, setEventTotal] = useState(0);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("30");
  const [endDraft, setEndDraft] = useState(today);
  const [startDraft, setStartDraft] = useState(daysAgoKey(30, today));
  const [minMagnitude, setMinMagnitude] = useState(4.5);
  const [applied, setApplied] = useState({ start: daysAgoKey(30, today), end: today, minMagnitude: 4.5 });
  const [exploded, setExploded] = useState(true);
  const [depthExaggeration, setDepthExaggeration] = useState(4);
  const [reliefExaggeration, setReliefExaggeration] = useState(3.5);
  const [showPlates, setShowPlates] = useState(true);
  const [showFaults, setShowFaults] = useState(true);
  const [showSlabs, setShowSlabs] = useState(true);
  const [showEarthquakes, setShowEarthquakes] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [slabRegion, setSlabRegion] = useState("");
  const [loadingGeometry, setLoadingGeometry] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [geometryError, setGeometryError] = useState<string | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);
  const [eventWarnings, setEventWarnings] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    async function loadGeometry() {
      setLoadingGeometry(true);
      try {
        const response = await fetch("/api/tectonic-depth-3d", { cache: "force-cache", signal: controller.signal });
        const payload = await readJson<TectonicDepth3DResponse & { error?: string }>(response);
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        if (!disposed) {
          setTectonic(payload);
          setGeometryError(null);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (!disposed) setGeometryError(error instanceof Error ? error.message : "No fue posible cargar GPlates + Slab2.");
      } finally {
        if (!disposed) setLoadingGeometry(false);
      }
    }
    void loadGeometry();
    return () => { disposed = true; controller.abort(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    async function loadEvents() {
      setLoadingEvents(true);
      setEventError(null);
      try {
        const result = await loadEarthquakes({ ...applied, signal: controller.signal });
        if (!disposed) {
          setEarthquakes(result.events);
          setEventTotal(result.total);
          setEventWarnings(result.warnings);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (!disposed) {
          setEarthquakes([]);
          setEventTotal(0);
          setEventError(error instanceof Error ? error.message : "No fue posible cargar los sismos del período.");
        }
      } finally {
        if (!disposed) setLoadingEvents(false);
      }
    }
    void loadEvents();
    return () => { disposed = true; controller.abort(); };
  }, [applied]);

  const deepestEvent = useMemo(
    () => earthquakes.reduce<EarthquakeEvent | null>((deepest, event) => !deepest || event.depthKm > deepest.depthKm ? event : deepest, null),
    [earthquakes],
  );
  const strongestEvent = useMemo(
    () => earthquakes.reduce<EarthquakeEvent | null>((strongest, event) => !strongest || event.magnitude > strongest.magnitude ? event : strongest, null),
    [earthquakes],
  );

  function choosePreset(next: Exclude<PeriodPreset, "custom">) {
    setPeriodPreset(next);
    setStartDraft(daysAgoKey(Number(next), endDraft || today));
  }

  function applyPeriod() {
    const end = endDraft || today;
    const start = periodPreset === "custom" ? startDraft : daysAgoKey(Number(periodPreset), end);
    setStartDraft(start);
    setApplied({ start, end, minMagnitude });
  }

  const warnings = [...(tectonic?.warnings ?? []), ...eventWarnings];
  const isRelief = viewMode === "relief";

  return (
    <main className={styles.dashboard}>
      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>{isRelief ? "RELIEVE + GEM + GPLATES + SLAB2" : "GPLATES + USGS SLAB2 + HIPOCENTROS"}</span>
          <h1>Placas tectónicas en profundidad · 3D</h1>
          <p>
            {isRelief
              ? "Bloque topobatimétrico regional para leer el relieve del Caribe, las fallas activas, los límites de placa y los hipocentros bajo la superficie."
              : "Vista global explotada para comparar las placas actuales, las superficies de subducción Slab2 y los hipocentros del período seleccionado."}
          </p>
        </div>
        <div className={styles.modelChip}>
          <span>{isRelief ? "Región inicial" : "Modelo superficial"}</span>
          <strong>{isRelief ? "CARIBE" : tectonic?.gplatesModel ?? "ZAHIROVIC2022"}</strong>
          <small>{isRelief ? "Puerto Rico · La Española · Antillas" : "GPlates · presente (0 Ma)"}</small>
        </div>
      </header>

      <section className={styles.viewModePanel} aria-label="Modo de visualización 3D">
        <button type="button" className={!isRelief ? styles.activeViewMode : ""} onClick={() => setViewMode("globe")}>Globo</button>
        <button type="button" className={isRelief ? styles.activeViewMode : ""} onClick={() => setViewMode("relief")}>Relieve 3D</button>
        <span>{isRelief ? "Vista regional en bloque · optimizada para móvil" : "Vista tectónica global ligera"}</span>
      </section>

      <section className={styles.scienceNote}>
        {isRelief ? (
          <><strong>Cómo leer el bloque de relieve.</strong> La topografía y la batimetría usan elevación real, con exageración vertical únicamente visual. Las fallas GEM y los límites de GPlates se proyectan sobre el relieve; Slab2 y los hipocentros se muestran por debajo del nivel de referencia según su profundidad. La vista inicial está limitada al Caribe para mantener una sola malla WebGL y evitar sobrecargar el navegador móvil.</>
        ) : (
          <><strong>Cómo leer la vista explotada.</strong> Los valores en kilómetros conservan la profundidad física de Slab2 y de cada hipocentro. Para evitar que las capas internas queden ocultas dentro de la esfera, Exploded view las separa radialmente hacia afuera; esa separación y su exageración son únicamente visuales. GPlates representa todas las placas en superficie y Slab2 añade profundidad solo donde existe una losa modelada.</>
        )}
      </section>

      <section className={styles.periodPanel} aria-label="Período sísmico">
        <div className={styles.presetRow}>
          {(["7", "15", "30", "60"] as const).map((value) => (
            <button key={value} type="button" className={periodPreset === value ? styles.activePreset : ""} onClick={() => choosePreset(value)}>
              {value} días
            </button>
          ))}
          <button type="button" className={periodPreset === "custom" ? styles.activePreset : ""} onClick={() => setPeriodPreset("custom")}>Personalizado</button>
        </div>
        <label>
          <span>Desde</span>
          <input type="date" value={startDraft} disabled={periodPreset !== "custom"} onChange={(event) => setStartDraft(event.target.value)} />
        </label>
        <label>
          <span>Hasta</span>
          <input type="date" value={endDraft} max={today} onChange={(event) => {
            const next = event.target.value;
            setEndDraft(next);
            if (periodPreset !== "custom" && next) setStartDraft(daysAgoKey(Number(periodPreset), next));
          }} />
        </label>
        <label>
          <span>Magnitud mínima</span>
          <select value={minMagnitude} onChange={(event) => setMinMagnitude(Number(event.target.value))}>
            <option value={4.2}>M4.2+</option>
            <option value={4.5}>M4.5+</option>
            <option value={5}>M5.0+</option>
            <option value={5.5}>M5.5+</option>
            <option value={6}>M6.0+</option>
          </select>
        </label>
        <button type="button" className={styles.applyButton} onClick={applyPeriod} disabled={loadingEvents}>{loadingEvents ? "Cargando…" : "Aplicar período"}</button>
      </section>

      <section className={styles.metrics}>
        <article><span>Placas GPlates</span><strong>{tectonic?.platePolygons.features.length ?? "—"}</strong><small>{isRelief ? "límites proyectados sobre relieve" : "geometría global superficial"}</small></article>
        <article><span>Regiones Slab2</span><strong>{tectonic?.slabRegions.length ?? "—"}</strong><small>{tectonic ? `${tectonic.slabContours.length.toLocaleString("es-DO")} contornos` : "cargando"}</small></article>
        <article><span>Sismos 3D</span><strong>{loadingEvents ? "…" : earthquakes.length.toLocaleString("es-DO")}</strong><small>{loadingEvents ? "cargando hipocentros" : eventTotal > earthquakes.length ? `de ${eventTotal.toLocaleString("es-DO")}` : `M${applied.minMagnitude.toFixed(1)}+`}</small></article>
        <article><span>Máxima profundidad</span><strong>{loadingEvents ? "…" : deepestEvent ? `${deepestEvent.depthKm.toFixed(0)} km` : "—"}</strong><small>Slab2 hasta {tectonic?.slabDepthMaxKm?.toFixed(0) ?? "—"} km</small></article>
      </section>

      <section className={styles.layerPanel}>
        {!isRelief && <label><input type="checkbox" checked={exploded} onChange={(event) => setExploded(event.target.checked)} /><span><strong>Exploded view</strong><small>Separa las capas profundas para hacerlas visibles.</small></span></label>}
        <label><input type="checkbox" checked={showPlates} onChange={(event) => setShowPlates(event.target.checked)} /><span><strong>Placas GPlates</strong><small>{isRelief ? "Límites blancos sobre el relieve." : "Piezas superficiales globales."}</small></span></label>
        {isRelief && <label><input type="checkbox" checked={showFaults} onChange={(event) => setShowFaults(event.target.checked)} /><span><strong>Fallas activas</strong><small>GEM · trazas ajustadas al relieve.</small></span></label>}
        <label><input type="checkbox" checked={showSlabs} onChange={(event) => setShowSlabs(event.target.checked)} /><span><strong>Losas Slab2</strong><small>{isRelief ? "Contornos bajo el bloque topográfico." : "Superficie triangulada + isolíneas de profundidad."}</small></span></label>
        <label><input type="checkbox" checked={showEarthquakes} onChange={(event) => setShowEarthquakes(event.target.checked)} /><span><strong>Hipocentros</strong><small>Sismos del período aplicado.</small></span></label>
        {!isRelief && <label><input type="checkbox" checked={autoRotate} onChange={(event) => setAutoRotate(event.target.checked)} /><span><strong>Rotación</strong><small>Exploración automática lenta.</small></span></label>}
      </section>

      <section className={styles.depthControls}>
        {isRelief ? (
          <>
            <label>
              <span>Exageración del relieve <strong>{reliefExaggeration.toFixed(1)}×</strong></span>
              <input type="range" min="1" max="6" step="0.5" value={reliefExaggeration} onChange={(event) => setReliefExaggeration(Number(event.target.value))} />
              <small>Amplifica visualmente montañas, fosas y fondo oceánico; las elevaciones originales no cambian.</small>
            </label>
            <label>
              <span>Exageración de profundidad <strong>{depthExaggeration.toFixed(1)}×</strong></span>
              <input type="range" min="1" max="8" step="0.5" value={depthExaggeration} onChange={(event) => setDepthExaggeration(Number(event.target.value))} />
              <small>Separa visualmente hipocentros y contornos Slab2 bajo el bloque.</small>
            </label>
          </>
        ) : (
          <>
            <label>
              <span>Exageración visual de profundidad <strong>{depthExaggeration.toFixed(1)}×</strong></span>
              <input type="range" min="1" max="8" step="0.5" value={depthExaggeration} onChange={(event) => setDepthExaggeration(Number(event.target.value))} />
              <small>Modifica la separación de las capas en la vista explotada; no altera los kilómetros de profundidad de Slab2 ni de los sismos.</small>
            </label>
            <label>
              <span>Zona Slab2</span>
              <select value={slabRegion} onChange={(event) => setSlabRegion(event.target.value)} disabled={!tectonic}>
                <option value="">Todas las zonas de subducción</option>
                {tectonic?.slabRegions.map((region) => <option value={region} key={region}>{region}</option>)}
              </select>
              <small>Filtra solamente la losa; los sismos siguen mostrando el período global.</small>
            </label>
          </>
        )}
      </section>

      {(geometryError || eventError) && <div className={styles.error}>{geometryError ?? eventError}</div>}
      {warnings.length > 0 && <div className={styles.warning}>{[...new Set(warnings)].map((warning) => <div key={warning}>{warning}</div>)}</div>}

      <section className={styles.viewerPanel}>
        <div className={styles.viewerHead}>
          <div>
            <span className={styles.eyebrow}>{isRelief ? "BLOQUE TOPOBATIMÉTRICO" : "VISTA RADIAL EXPLOTADA"}</span>
            <h2>{isRelief ? "Relieve → fallas → Slab2 → hipocentros" : "Superficie → subducción → hipocentros"}</h2>
          </div>
          <div className={styles.legend}>
            <span><i className={styles.shallow} /> 0–70 km</span>
            <span><i className={styles.intermediate} /> 70–300 km</span>
            <span><i className={styles.deep} /> &gt;300 km</span>
          </div>
        </div>
        {loadingGeometry && !tectonic ? (
          <div className={styles.loading}>Descargando geometría GPlates y Slab2…</div>
        ) : tectonic ? (
          isRelief ? (
            <TectonicRelief3DRenderer
              tectonic={tectonic}
              earthquakes={earthquakes}
              reliefExaggeration={reliefExaggeration}
              depthExaggeration={depthExaggeration}
              showPlates={showPlates}
              showFaults={showFaults}
              showSlabs={showSlabs}
              showEarthquakes={showEarthquakes}
            />
          ) : (
            <TectonicDepth3DRenderer
              tectonic={tectonic}
              earthquakes={earthquakes}
              exploded={exploded}
              depthExaggeration={depthExaggeration}
              showPlates={showPlates}
              showSlabs={showSlabs}
              showEarthquakes={showEarthquakes}
              slabRegion={slabRegion}
              autoRotate={autoRotate}
            />
          )
        ) : null}
      </section>

      <section className={styles.summaryGrid}>
        <article>
          <span>Período aplicado</span>
          <strong>{formatDate(applied.start)} → {formatDate(applied.end)}</strong>
          <small>M{applied.minMagnitude.toFixed(1)}+ · catálogo RDSISMOS</small>
        </article>
        <article>
          <span>Sismo más fuerte</span>
          <strong>{loadingEvents ? "…" : strongestEvent ? `M${strongestEvent.magnitude.toFixed(1)}` : "—"}</strong>
          <small>{loadingEvents ? "cargando" : strongestEvent ? `${strongestEvent.place} · ${strongestEvent.depthKm.toFixed(0)} km` : "Sin eventos"}</small>
        </article>
        <article>
          <span>Fuentes geométricas</span>
          <strong>{isRelief ? "DEM + GEM + GPlates + Slab2" : "GPlates + Slab2"}</strong>
          <small>{isRelief ? "Terrarium elevation tiles · GEM Active Faults" : tectonic?.sources.slabs ?? "USGS Slab2"}</small>
        </article>
      </section>
    </main>
  );
}
