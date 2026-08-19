"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { PlateDynamicsResponse, PlateStat } from "@/lib/plateDynamics";
import type { SeismicMechanismResponse } from "@/lib/seismicMechanisms";
import type { TectonicVector, TectonicVectorResponse } from "@/lib/tectonicVectors";
import styles from "./PlateDynamicsDashboard.module.css";
import vectorStyles from "./PlateDynamicsVectors.module.css";

const PlateDynamicsMap = dynamic(
  () => import("./PlateDynamicsMap").then((module) => module.PlateDynamicsMap),
  { ssr: false, loading: () => <div className={styles.loading}>Inicializando mapa tectónico…</div> },
);

function pct(value: number | null, digits = 1) {
  return value === null ? "—" : `${value.toFixed(digits)}%`;
}

function number(value: number | null, digits = 1) {
  return value === null ? "—" : value.toFixed(digits);
}

function ratioLabel(value: number | null) {
  if (value === null) return "Sin base comparable";
  if (value >= 1.5) return `${value.toFixed(2)}× · acelerada`;
  if (value <= 0.67) return `${value.toFixed(2)}× · reducida`;
  return `${value.toFixed(2)}× · estable`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-DO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function PlateDynamicsDashboard() {
  const [data, setData] = useState<PlateDynamicsResponse | null>(null);
  const [years, setYears] = useState(10);
  const [minMagnitude, setMinMagnitude] = useState(5);
  const [forecastDays, setForecastDays] = useState(90);
  const [targetMagnitude, setTargetMagnitude] = useState(6);
  const [applied, setApplied] = useState({ years: 10, minMagnitude: 5, forecastDays: 90, targetMagnitude: 6 });
  const [selectedPlateId, setSelectedPlateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showVectors, setShowVectors] = useState(false);
  const [showBoundaryGuides, setShowBoundaryGuides] = useState(false);
  const [showMechanisms, setShowMechanisms] = useState(false);
  const [vectorData, setVectorData] = useState<TectonicVectorResponse | null>(null);
  const [vectorLoading, setVectorLoading] = useState(false);
  const [vectorError, setVectorError] = useState<string | null>(null);
  const [mechanismData, setMechanismData] = useState<SeismicMechanismResponse | null>(null);
  const [mechanismLoading, setMechanismLoading] = useState(false);
  const [mechanismError, setMechanismError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;

    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          years: String(applied.years),
          minMagnitude: String(applied.minMagnitude),
          forecastDays: String(applied.forecastDays),
          targetMagnitude: String(applied.targetMagnitude),
        });
        const response = await fetch(`/api/plate-dynamics?${params}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as PlateDynamicsResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        if (!disposed) {
          setData(payload);
          setError(null);
          setSelectedPlateId((current) => current && payload.plates.some((plate) => plate.plateId === current)
            ? current
            : payload.plates[0]?.plateId ?? null);
        }
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        if (!disposed) setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el modelo de placas.");
      } finally {
        if (!disposed) setLoading(false);
      }
    }

    void load();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [applied]);

  useEffect(() => {
    if (!showVectors || vectorData) return;
    const controller = new AbortController();
    let disposed = false;

    async function loadVectors() {
      setVectorLoading(true);
      setVectorError(null);
      try {
        const response = await fetch("/api/plate-vectors", { cache: "force-cache", signal: controller.signal });
        const payload = await response.json() as TectonicVectorResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        if (!disposed) setVectorData(payload);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        if (!disposed) setVectorError(loadError instanceof Error ? loadError.message : "No fue posible calcular los vectores tectónicos.");
      } finally {
        if (!disposed) setVectorLoading(false);
      }
    }

    void loadVectors();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [showVectors, vectorData]);

  useEffect(() => {
    if (!showMechanisms) return;
    const controller = new AbortController();
    let disposed = false;

    async function loadMechanisms() {
      setMechanismLoading(true);
      setMechanismError(null);
      setMechanismData(null);
      try {
        const mechanismMinMagnitude = Math.max(6, applied.minMagnitude);
        const params = new URLSearchParams({
          days: "365",
          minMagnitude: String(mechanismMinMagnitude),
          limit: "28",
        });
        const response = await fetch(`/api/seismic-mechanisms?${params}`, {
          cache: "force-cache",
          signal: controller.signal,
        });
        const payload = await response.json() as SeismicMechanismResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        if (!disposed) setMechanismData(payload);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        if (!disposed) setMechanismError(loadError instanceof Error ? loadError.message : "No fue posible cargar mecanismos focales.");
      } finally {
        if (!disposed) setMechanismLoading(false);
      }
    }

    void loadMechanisms();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [showMechanisms, applied.minMagnitude]);

  const selected = useMemo(
    () => data?.plates.find((plate) => plate.plateId === selectedPlateId) ?? null,
    [data, selectedPlateId],
  );
  const selectedVector = useMemo(
    () => vectorData?.vectors.find((vector) => vector.plateId === selectedPlateId) ?? null,
    [selectedPlateId, vectorData],
  );
  const ranked = data?.plates.slice(0, 40) ?? [];
  const highest = data?.plates.find((plate) => plate.probabilityPct !== null) ?? null;

  function runModel() {
    setApplied({
      years,
      minMagnitude,
      forecastDays,
      targetMagnitude: Math.max(targetMagnitude, minMagnitude),
    });
  }

  return (
    <main className={styles.dashboard}>
      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>GPlates + USGS ComCat</span>
          <h1>Dinámica sísmica por placas</h1>
          <p>
            Cruza los polígonos tectónicos actuales de GPlates con el catálogo histórico de USGS y modela la tasa sísmica,
            cambio reciente y distribución frecuencia–magnitud de cada placa.
          </p>
        </div>
        <div className={styles.modelChip}>
          <span>Modelo tectónico</span>
          <strong>{data?.model ?? "ZAHIROVIC2022"}</strong>
          <small>Tiempo tectónico: 0 Ma · presente</small>
        </div>
      </header>

      <section className={styles.notice}>
        <strong>Proyección probabilística, no predicción determinista.</strong> La probabilidad mostrada es una expectativa estadística
        de al menos un evento ≥M objetivo dentro de la ventana elegida, calculada desde la tasa histórica y Gutenberg–Richter.
        No identifica día, hora ni epicentro futuro y no sustituye una evaluación oficial de peligro sísmico.
      </section>

      <section className={styles.controls}>
        <label>
          <span>Histórico USGS</span>
          <select value={years} onChange={(event) => setYears(Number(event.target.value))}>
            <option value={1}>1 año</option>
            <option value={3}>3 años</option>
            <option value={5}>5 años</option>
            <option value={10}>10 años</option>
          </select>
        </label>
        <label>
          <span>Magnitud mínima</span>
          <select value={minMagnitude} onChange={(event) => {
            const next = Number(event.target.value);
            setMinMagnitude(next);
            if (targetMagnitude < next) setTargetMagnitude(next);
          }}>
            <option value={5}>M5.0+</option>
            <option value={5.5}>M5.5+</option>
            <option value={6}>M6.0+</option>
          </select>
        </label>
        <label>
          <span>Ventana futura</span>
          <select value={forecastDays} onChange={(event) => setForecastDays(Number(event.target.value))}>
            <option value={30}>30 días</option>
            <option value={90}>90 días</option>
            <option value={180}>180 días</option>
            <option value={365}>365 días</option>
          </select>
        </label>
        <label>
          <span>Magnitud objetivo</span>
          <select value={targetMagnitude} onChange={(event) => setTargetMagnitude(Number(event.target.value))}>
            <option value={5.5}>M5.5+</option>
            <option value={6}>M6.0+</option>
            <option value={6.5}>M6.5+</option>
            <option value={7}>M7.0+</option>
            <option value={7.5}>M7.5+</option>
          </select>
        </label>
        <button type="button" onClick={runModel} disabled={loading}>{loading ? "Modelando…" : "Recalcular modelo"}</button>
      </section>

      <section className={vectorStyles.layerPanel} aria-label="Capas tectónicas adicionales">
        <label className={vectorStyles.layerToggle}>
          <input type="checkbox" checked={showVectors} onChange={(event) => setShowVectors(event.target.checked)} />
          <span>
            <strong>Vectores de movimiento de placas</strong>
            <small>Dirección y velocidad media modelada con GPlates entre 1 Ma y el presente.</small>
          </span>
        </label>
        <label className={vectorStyles.layerToggle}>
          <input type="checkbox" checked={showBoundaryGuides} onChange={(event) => setShowBoundaryGuides(event.target.checked)} />
          <span>
            <strong>Guías de interacción en bordes</strong>
            <small>Símbolos para subducción, convergencia, divergencia y deslizamiento transformante.</small>
          </span>
        </label>
        <label className={vectorStyles.layerToggle}>
          <input type="checkbox" checked={showMechanisms} onChange={(event) => setShowMechanisms(event.target.checked)} />
          <span>
            <strong>Mecanismos focales P/T</strong>
            <small>Ejes de compresión P y extensión T para sismos fuertes con productos de mecanismo USGS.</small>
          </span>
        </label>
        {showVectors && (
          <div className={`${vectorStyles.vectorStatus} ${vectorError ? vectorStyles.vectorStatusError : ""}`}>
            {vectorLoading && "Calculando cinemática de placas con el modelo de rotaciones de GPlates…"}
            {!vectorLoading && vectorError && `Vectores no disponibles: ${vectorError}. El modelo sísmico principal sigue funcionando.`}
            {!vectorLoading && !vectorError && vectorData && (
              <>
                {vectorData.vectors.length} vectores · intervalo {vectorData.intervalMa} Ma · anchor plate {vectorData.anchorPlateId}.
                La flecha indica movimiento modelado de la placa; no representa una fuerza generada por los sismos.
                {vectorData.warnings.length > 0 ? ` ${vectorData.warnings.join(" ")}` : ""}
              </>
            )}
          </div>
        )}
        {showMechanisms && (
          <div className={`${vectorStyles.vectorStatus} ${mechanismError ? vectorStyles.vectorStatusError : ""}`}>
            {mechanismLoading && "Consultando tensores de momento y mecanismos focales USGS…"}
            {!mechanismLoading && mechanismError && `Mecanismos no disponibles: ${mechanismError}. Las demás capas siguen funcionando.`}
            {!mechanismLoading && !mechanismError && mechanismData && (
              <>
                {mechanismData.mechanisms.length} mecanismos · últimos {mechanismData.days} días · M{mechanismData.minMagnitude.toFixed(1)}+.
                Rojo = eje P de máxima compresión; azul = eje T de máxima extensión. La longitud mostrada es simbólica y se reduce cuando el eje tiene gran plunge.
                {mechanismData.warnings.length > 0 ? ` ${mechanismData.warnings.join(" ")}` : ""}
              </>
            )}
          </div>
        )}
      </section>

      {error && <div className={styles.error}>{error}</div>}
      {data && (
        <>
          <section className={styles.metrics}>
            <article><span>Eventos analizados</span><strong>{data.matchedEvents.toLocaleString("es-DO")}</strong><small>de {data.totalEvents.toLocaleString("es-DO")} USGS M{data.minMagnitude.toFixed(1)}+</small></article>
            <article><span>Placas con actividad</span><strong>{data.plates.length}</strong><small>{formatDate(data.startTime)}–{formatDate(data.endTime)}</small></article>
            <article><span>Mayor expectativa</span><strong>{highest ? pct(highest.probabilityPct) : "—"}</strong><small>{highest ? `${highest.plateName} · ≥M${data.targetMagnitude.toFixed(1)}` : "Datos insuficientes"}</small></article>
            <article><span>Asignación geométrica</span><strong>{data.totalEvents ? pct(100 * data.matchedEvents / data.totalEvents) : "—"}</strong><small>{data.unmatchedEvents} fuera de polígonos</small></article>
          </section>

          {data.warnings.length > 0 && (
            <div className={styles.warning}>{data.warnings.map((warning) => <div key={warning}>{warning}</div>)}</div>
          )}

          <section className={styles.mainGrid}>
            <div className={styles.mapPanel}>
              <div className={styles.sectionHead}>
                <div><span className={styles.eyebrow}>Geometría actual</span><h2>Placas, límites, sismicidad y cinemática</h2></div>
                <button type="button" className={styles.ghostButton} onClick={() => setSelectedPlateId(null)}>Ver todas</button>
              </div>
              <PlateDynamicsMap
                polygons={data.platePolygons}
                boundaries={data.boundaries}
                events={data.mapEvents}
                vectors={vectorData?.vectors ?? []}
                mechanisms={mechanismData?.mechanisms ?? []}
                showVectors={showVectors && Boolean(vectorData)}
                showBoundaryGuides={showBoundaryGuides}
                showMechanisms={showMechanisms && Boolean(mechanismData)}
                selectedPlateId={selectedPlateId}
                onSelectPlate={setSelectedPlateId}
              />
              <p className={styles.mapNote}>
                La asignación sísmica es geométrica: relaciona el epicentro con el polígono superficial de GPlates. En subducción no implica que esa sea necesariamente la placa física que rompió en profundidad. Las flechas cinemáticas son un promedio modelado 0–1 Ma y su longitud está amplificada para hacerlas visibles. Los ejes P/T son la proyección horizontal de los ejes principales publicados por USGS; indican orientación de compresión/extensión del mecanismo, no magnitud de una fuerza en newtons.
              </p>
            </div>

            <aside className={styles.detailPanel}>
              <span className={styles.eyebrow}>Placa seleccionada</span>
              {selected ? <PlateDetail plate={selected} vector={selectedVector} /> : <p>Selecciona una placa en el mapa o en el ranking.</p>}
            </aside>
          </section>

          <section className={styles.rankingPanel}>
            <div className={styles.sectionHead}>
              <div><span className={styles.eyebrow}>Modelo histórico</span><h2>Comportamiento por placa</h2></div>
              <small>Ordenado por probabilidad histórica ≥M{data.targetMagnitude.toFixed(1)} en {data.forecastDays} días</small>
            </div>
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>Placa</th><th>Eventos</th><th>Tasa/año</th><th>Actividad reciente</th><th>b</th><th>Máx.</th><th>Prof. media</th><th>Prob. histórica</th><th>Evidencia</th></tr></thead>
                <tbody>
                  {ranked.map((plate) => (
                    <tr key={plate.plateId} className={selectedPlateId === plate.plateId ? styles.selectedRow : undefined} onClick={() => setSelectedPlateId(plate.plateId)}>
                      <td><strong>{plate.plateName}</strong><small>ID {plate.plateId}</small></td>
                      <td>{plate.eventCount.toLocaleString("es-DO")}</td>
                      <td>{plate.annualRate.toFixed(1)}</td>
                      <td>{ratioLabel(plate.activityRatio)}</td>
                      <td>{number(plate.bValue, 2)}</td>
                      <td>M{plate.maxMagnitude.toFixed(1)}</td>
                      <td>{plate.meanDepthKm.toFixed(0)} km</td>
                      <td><strong>{pct(plate.probabilityPct)}</strong></td>
                      <td><span className={`${styles.evidence} ${styles[plate.evidence]}`}>{plate.evidence === "high" ? "Alta" : plate.evidence === "medium" ? "Media" : "Baja"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <footer className={styles.sourceNote}>
            Fuentes: USGS ComCat para sismicidad observada y productos de tensor de momento/mecanismo focal; GPlates Web Service/EarthByte para topología y cinemática de placas. Modelo tectónico fijado explícitamente en {data.model} para reproducibilidad. Las guías de borde describen el tipo de límite; no son un cálculo de fuerza en newtons.
          </footer>
        </>
      )}

      {!data && loading && <div className={styles.loading}>Descargando topología GPlates y construyendo el histórico USGS…</div>}
    </main>
  );
}

function PlateDetail({ plate, vector }: { plate: PlateStat; vector: TectonicVector | null }) {
  return (
    <div className={styles.detailBody}>
      <h2>{plate.plateName}</h2>
      <div className={styles.detailId}>GPlates ID {plate.plateId}</div>
      <div className={styles.probabilityBlock}>
        <span>≥M{plate.targetMagnitude.toFixed(1)} · próximos {plate.forecastDays} días</span>
        <strong>{pct(plate.probabilityPct)}</strong>
        <small>Poisson + Gutenberg–Richter sobre la tasa histórica</small>
      </div>
      {vector && (
        <div className={vectorStyles.vectorReadout}>
          <span>Cinemática de la placa · 0–{vector.intervalMa.toFixed(0)} Ma</span>
          <strong>{vector.speedMmYr.toFixed(1)} mm/año · {vector.bearingDeg.toFixed(0)}°</strong>
          <small>Velocidad media por diferencia de posición reconstruida en GPlates. No equivale a fuerza sísmica ni a medición GNSS instantánea.</small>
        </div>
      )}
      <dl>
        <div><dt>Eventos históricos</dt><dd>{plate.eventCount.toLocaleString("es-DO")}</dd></div>
        <div><dt>Tasa anual M base+</dt><dd>{plate.annualRate.toFixed(1)}</dd></div>
        <div><dt>Últimos {plate.recentWindowDays} días</dt><dd>{plate.recentCount} eventos</dd></div>
        <div><dt>Actividad vs. etapa previa</dt><dd>{ratioLabel(plate.activityRatio)}</dd></div>
        <div><dt>b-value</dt><dd>{number(plate.bValue, 2)}</dd></div>
        <div><dt>Magnitud máxima</dt><dd>M{plate.maxMagnitude.toFixed(1)}</dd></div>
        <div><dt>Magnitud media</dt><dd>M{plate.meanMagnitude.toFixed(2)}</dd></div>
        <div><dt>Profundidad media</dt><dd>{plate.meanDepthKm.toFixed(0)} km</dd></div>
        <div><dt>Sismos &lt;70 km</dt><dd>{pct(plate.shallowPct)}</dd></div>
        <div><dt>Eventos esperados ≥M objetivo</dt><dd>{number(plate.expectedTargetEvents, 3)}</dd></div>
      </dl>
    </div>
  );
}
