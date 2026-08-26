"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import { buildPlateOptions, preferredReliefPlateId } from "@/lib/plateRelief";
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
  const [globePlateId, setGlobePlateId] = useState("");
  const [reliefPlateIds, setReliefPlateIds] = useState<string[]>([]);
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
  const plateOptions = useMemo(
    () => buildPlateOptions(tectonic?.platePolygons.features ?? []),
    [tectonic],
  );
  const globePlate = plateOptions.find((plate) => plate.id === globePlateId) ?? null;
  const reliefPlates = useMemo(
    () => reliefPlateIds.map((id) => plateOptions.find((plate) => plate.id === id)).filter((plate): plate is NonNullable<typeof plate> => Boolean(plate)),
    [plateOptions, reliefPlateIds],
  );
  const reliefNames = reliefPlates.map((plate) => plate.name).join(" + ");

  useEffect(() => {
    if (!plateOptions.length) return;
    const valid = reliefPlateIds.filter((id) => plateOptions.some((plate) => plate.id === id)).slice(0, 4);
    if (!valid.length) {
      const preferred = preferredReliefPlateId(plateOptions);
      if (preferred) setReliefPlateIds([preferred]);
      return;
    }
    if (valid.length !== reliefPlateIds.length || valid.some((id, index) => id !== reliefPlateIds[index])) setReliefPlateIds(valid);
  }, [plateOptions, reliefPlateIds]);

  const selectGlobePlate = useCallback((plateId: string) => {
    setGlobePlateId(plateId);
  }, []);

  const openPlateInRelief = useCallback((plateId: string) => {
    if (!plateId) return;
    setGlobePlateId(plateId);
    setReliefPlateIds([plateId]);
    setViewMode("relief");
  }, []);

  function addReliefPlate(plateId: string) {
    if (!plateId) return;
    setReliefPlateIds((current) => current.includes(plateId) || current.length >= 4 ? current : [...current, plateId]);
  }

  function removeReliefPlate(plateId: string) {
    setReliefPlateIds((current) => current.length <= 1 ? current : current.filter((id) => id !== plateId));
  }

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
          <span className={styles.eyebrow}>{isRelief ? "RELIEVE + GEM + GPLATES + SLAB2" : "MAPA MUNDIAL + GPLATES + SLAB2 + HIPOCENTROS"}</span>
          <h1>Placas tectónicas en profundidad · 3D</h1>
          <p>
            {isRelief
              ? "Bloque topobatimétrico dinámico para comparar hasta cuatro placas simultáneamente junto a fallas activas, Slab2 e hipocentros bajo la superficie."
              : "Globo mundial con países, límites tectónicos y selección directa de placas. Toca una placa para aislar su contexto sísmico o abrirla en relieve."}
          </p>
        </div>
        <div className={styles.modelChip}>
          <span>{isRelief ? "Placas en relieve" : "Placa seleccionada"}</span>
          <strong>{isRelief ? reliefNames || "Seleccionando…" : globePlate?.name ?? "Todas"}</strong>
          <small>{isRelief ? `${reliefPlateIds.length}/4 placas activas` : globePlate ? `GPlates · ${globePlate.id}` : "Toca una placa en el globo"}</small>
        </div>
      </header>

      <section className={styles.viewModePanel} aria-label="Modo de visualización 3D">
        <button type="button" className={!isRelief ? styles.activeViewMode : ""} onClick={() => setViewMode("globe")}>Globo</button>
        <button type="button" className={isRelief ? styles.activeViewMode : ""} onClick={() => setViewMode("relief")}>Relieve 3D</button>
        <span>{isRelief ? "1–4 placas en un mismo bloque topobatimétrico" : "Países visibles · toca una placa para seleccionarla"}</span>
      </section>

      <section className={styles.scienceNote}>
        {isRelief ? (
          <><strong>Cómo leer el bloque de relieve.</strong> La extensión se calcula a partir del conjunto de placas seleccionado. Cada placa activa se superpone con un color diferente sobre la misma topografía/batimetría; fallas GEM, Slab2 e hipocentros se recortan al área común. Si eliges placas muy alejadas, el DEM reduce automáticamente su resolución para proteger WebGL en móvil.</>
        ) : (
          <><strong>Cómo usar el globo.</strong> Los países y costas sirven de referencia geográfica. Las placas permanecen visibles simultáneamente; al tocar una, queda resaltada y Slab2/hipocentros se enfocan en su entorno. Puedes abrir esa selección directamente en Relieve 3D.</>
        )}
      </section>

      <section className={styles.periodPanel} aria-label="Período sísmico">
        <div className={styles.presetRow}>
          {(["7", "15", "30", "60"] as const).map((value) => (
            <button key={value} type="button" className={periodPreset === value ? styles.activePreset : ""} onClick={() => choosePreset(value)}>{value} días</button>
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
            <option value={4.2}>M4.2+</option><option value={4.5}>M4.5+</option><option value={5}>M5.0+</option><option value={5.5}>M5.5+</option><option value={6}>M6.0+</option>
          </select>
        </label>
        <button type="button" className={styles.applyButton} onClick={applyPeriod} disabled={loadingEvents}>{loadingEvents ? "Cargando…" : "Aplicar período"}</button>
      </section>

      <section className={styles.metrics}>
        <article><span>Placas GPlates</span><strong>{plateOptions.length || "—"}</strong><small>{isRelief ? `${reliefPlateIds.length} seleccionadas` : globePlate ? `seleccionada: ${globePlate.name}` : "todas visibles"}</small></article>
        <article><span>Regiones Slab2</span><strong>{tectonic?.slabRegions.length ?? "—"}</strong><small>{tectonic ? `${tectonic.slabContours.length.toLocaleString("es-DO")} contornos` : "cargando"}</small></article>
        <article><span>Sismos 3D</span><strong>{loadingEvents ? "…" : earthquakes.length.toLocaleString("es-DO")}</strong><small>{loadingEvents ? "cargando hipocentros" : eventTotal > earthquakes.length ? `de ${eventTotal.toLocaleString("es-DO")}` : `M${applied.minMagnitude.toFixed(1)}+`}</small></article>
        <article><span>Máxima profundidad</span><strong>{loadingEvents ? "…" : deepestEvent ? `${deepestEvent.depthKm.toFixed(0)} km` : "—"}</strong><small>Slab2 hasta {tectonic?.slabDepthMaxKm?.toFixed(0) ?? "—"} km</small></article>
      </section>

      <section className={styles.layerPanel}>
        {!isRelief && <label><input type="checkbox" checked={exploded} onChange={(event) => setExploded(event.target.checked)} /><span><strong>Exploded view</strong><small>Separa las capas profundas para hacerlas visibles.</small></span></label>}
        <label><input type="checkbox" checked={showPlates} onChange={(event) => setShowPlates(event.target.checked)} /><span><strong>Placas GPlates</strong><small>{isRelief ? `${reliefPlateIds.length} placas resaltadas por color.` : "Todas visibles; toca una para seleccionarla."}</small></span></label>
        {isRelief && <label><input type="checkbox" checked={showFaults} onChange={(event) => setShowFaults(event.target.checked)} /><span><strong>Fallas activas</strong><small>GEM · trazas ajustadas al relieve.</small></span></label>}
        <label><input type="checkbox" checked={showSlabs} onChange={(event) => setShowSlabs(event.target.checked)} /><span><strong>Losas Slab2</strong><small>{isRelief ? "Contornos presentes en la región combinada." : "Superficie triangulada + isolíneas de profundidad."}</small></span></label>
        <label><input type="checkbox" checked={showEarthquakes} onChange={(event) => setShowEarthquakes(event.target.checked)} /><span><strong>Hipocentros</strong><small>Sismos del período aplicado.</small></span></label>
        {!isRelief && <label><input type="checkbox" checked={autoRotate} onChange={(event) => setAutoRotate(event.target.checked)} /><span><strong>Rotación</strong><small>Exploración automática lenta.</small></span></label>}
      </section>

      <section className={styles.depthControls}>
        {isRelief ? (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: "#dbeafe" }}>Placas en Relieve 3D · {reliefPlateIds.length}/4</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {reliefPlates.map((plate, index) => (
                  <span key={plate.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 8px", borderRadius: 999, background: "rgba(30,64,90,.68)", color: "#eaf6ff", fontSize: 10, border: "1px solid rgba(125,211,252,.24)" }}>
                    <b>{index + 1}.</b> {plate.name}
                    <button type="button" disabled={reliefPlateIds.length <= 1} onClick={() => removeReliefPlate(plate.id)} style={{ border: 0, background: "transparent", color: reliefPlateIds.length <= 1 ? "#64748b" : "#fda4af", cursor: reliefPlateIds.length <= 1 ? "default" : "pointer", padding: 0 }}>×</button>
                  </span>
                ))}
              </div>
              <select value="" onChange={(event) => addReliefPlate(event.target.value)} disabled={!plateOptions.length || reliefPlateIds.length >= 4}>
                <option value="">{reliefPlateIds.length >= 4 ? "Máximo 4 placas" : "+ Añadir otra placa"}</option>
                {plateOptions.filter((plate) => !reliefPlateIds.includes(plate.id)).map((plate) => <option value={plate.id} key={plate.id}>{plate.name}</option>)}
              </select>
              <small>Selecciona hasta cuatro placas. Conviene elegir placas vecinas para conservar mayor detalle del relieve.</small>
            </div>
            <label>
              <span>Exageración del relieve <strong>{reliefExaggeration.toFixed(1)}×</strong></span>
              <input type="range" min="1" max="6" step="0.5" value={reliefExaggeration} onChange={(event) => setReliefExaggeration(Number(event.target.value))} />
              <small>Amplifica visualmente montañas, fosas y fondo oceánico.</small>
            </label>
            <label>
              <span>Exageración de profundidad <strong>{depthExaggeration.toFixed(1)}×</strong></span>
              <input type="range" min="1" max="8" step="0.5" value={depthExaggeration} onChange={(event) => setDepthExaggeration(Number(event.target.value))} />
              <small>Separa hipocentros y contornos Slab2 bajo el bloque.</small>
            </label>
          </>
        ) : (
          <>
            <label>
              <span>Placa seleccionada</span>
              <select value={globePlateId} onChange={(event) => setGlobePlateId(event.target.value)} disabled={!plateOptions.length}>
                <option value="">Ninguna · ver contexto global</option>
                {plateOptions.map((plate) => <option value={plate.id} key={plate.id}>{plate.name}</option>)}
              </select>
              <small>También puedes tocar directamente una placa sobre el globo.</small>
            </label>
            <label>
              <span>Exageración visual de profundidad <strong>{depthExaggeration.toFixed(1)}×</strong></span>
              <input type="range" min="1" max="8" step="0.5" value={depthExaggeration} onChange={(event) => setDepthExaggeration(Number(event.target.value))} />
              <small>Modifica la separación visual; no altera los kilómetros de profundidad.</small>
            </label>
            <label>
              <span>Zona Slab2</span>
              <select value={slabRegion} onChange={(event) => setSlabRegion(event.target.value)} disabled={!tectonic}>
                <option value="">Todas las zonas de subducción</option>
                {tectonic?.slabRegions.map((region) => <option value={region} key={region}>{region}</option>)}
              </select>
              <small>Filtra solamente la losa.</small>
            </label>
          </>
        )}
      </section>

      {(geometryError || eventError) && <div className={styles.error}>{geometryError ?? eventError}</div>}
      {warnings.length > 0 && <div className={styles.warning}>{[...new Set(warnings)].map((warning) => <div key={warning}>{warning}</div>)}</div>}

      <section className={styles.viewerPanel}>
        <div className={styles.viewerHead}>
          <div>
            <span className={styles.eyebrow}>{isRelief ? "BLOQUE TOPOBATIMÉTRICO MULTIPLACA" : "GLOBO TECTÓNICO INTERACTIVO"}</span>
            <h2>{isRelief ? `${reliefNames || "Placas"} · relieve → fallas → Slab2 → hipocentros` : globePlate ? `${globePlate.name} · toca otra placa o abre Relieve 3D` : "Países → placas → subducción → hipocentros"}</h2>
          </div>
          <div className={styles.legend}>
            <span><i className={styles.shallow} /> 0–70 km</span><span><i className={styles.intermediate} /> 70–300 km</span><span><i className={styles.deep} /> &gt;300 km</span>
          </div>
        </div>
        {loadingGeometry && !tectonic ? (
          <div className={styles.loading}>Descargando geometría GPlates y Slab2…</div>
        ) : tectonic ? (
          isRelief ? (
            reliefPlateIds.length ? (
              <TectonicRelief3DRenderer
                tectonic={tectonic}
                earthquakes={earthquakes}
                plateIds={reliefPlateIds}
                reliefExaggeration={reliefExaggeration}
                depthExaggeration={depthExaggeration}
                showPlates={showPlates}
                showFaults={showFaults}
                showSlabs={showSlabs}
                showEarthquakes={showEarthquakes}
              />
            ) : <div className={styles.loading}>Selecciona al menos una placa para el relieve…</div>
          ) : (
            <TectonicDepth3DRenderer
              tectonic={tectonic}
              earthquakes={earthquakes}
              plateId={globePlateId}
              exploded={exploded}
              depthExaggeration={depthExaggeration}
              showPlates={showPlates}
              showSlabs={showSlabs}
              showEarthquakes={showEarthquakes}
              slabRegion={slabRegion}
              autoRotate={autoRotate}
              onPlateSelect={selectGlobePlate}
              onOpenRelief={openPlateInRelief}
            />
          )
        ) : null}
      </section>

      <section className={styles.summaryGrid}>
        <article><span>Período aplicado</span><strong>{formatDate(applied.start)} → {formatDate(applied.end)}</strong><small>M{applied.minMagnitude.toFixed(1)}+ · catálogo RDSISMOS</small></article>
        <article><span>Sismo más fuerte</span><strong>{loadingEvents ? "…" : strongestEvent ? `M${strongestEvent.magnitude.toFixed(1)}` : "—"}</strong><small>{loadingEvents ? "cargando" : strongestEvent ? `${strongestEvent.place} · ${strongestEvent.depthKm.toFixed(0)} km` : "Sin eventos"}</small></article>
        <article><span>Fuentes geométricas</span><strong>{isRelief ? "DEM + GEM + GPlates + Slab2" : "Natural Earth + GPlates + Slab2"}</strong><small>{isRelief ? "Terrarium elevation tiles · GEM Active Faults" : "Natural Earth 110m · GPlates · USGS Slab2"}</small></article>
      </section>
    </main>
  );
}
