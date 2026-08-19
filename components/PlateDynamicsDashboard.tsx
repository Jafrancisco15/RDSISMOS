"use client";

import { useEffect, useMemo, useState } from "react";
import type { PlateDynamicsResponse, PlateStat } from "@/lib/plateDynamics";
import { PlateDynamicsMap } from "./PlateDynamicsMap";
import styles from "./PlateDynamicsDashboard.module.css";

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

  const selected = useMemo(
    () => data?.plates.find((plate) => plate.plateId === selectedPlateId) ?? null,
    [data, selectedPlateId],
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
                <div><span className={styles.eyebrow}>Geometría actual</span><h2>Placas, límites y sismicidad</h2></div>
                <button type="button" className={styles.ghostButton} onClick={() => setSelectedPlateId(null)}>Ver todas</button>
              </div>
              <PlateDynamicsMap
                polygons={data.platePolygons}
                boundaries={data.boundaries}
                events={data.mapEvents}
                selectedPlateId={selectedPlateId}
                onSelectPlate={setSelectedPlateId}
              />
              <p className={styles.mapNote}>
                La asignación es geométrica: relaciona el epicentro con el polígono superficial de GPlates. En subducción no implica que esa sea necesariamente la placa física que rompió en profundidad.
              </p>
            </div>

            <aside className={styles.detailPanel}>
              <span className={styles.eyebrow}>Placa seleccionada</span>
              {selected ? <PlateDetail plate={selected} /> : <p>Selecciona una placa en el mapa o en el ranking.</p>}
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
            Fuentes: USGS ComCat para sismicidad observada y GPlates Web Service/EarthByte para topología de placas. Modelo tectónico fijado explícitamente en {data.model} para reproducibilidad.
          </footer>
        </>
      )}

      {!data && loading && <div className={styles.loading}>Descargando topología GPlates y construyendo el histórico USGS…</div>}
    </main>
  );
}

function PlateDetail({ plate }: { plate: PlateStat }) {
  return (
    <div className={styles.detailBody}>
      <h2>{plate.plateName}</h2>
      <div className={styles.detailId}>GPlates ID {plate.plateId}</div>
      <div className={styles.probabilityBlock}>
        <span>≥M{plate.targetMagnitude.toFixed(1)} · próximos {plate.forecastDays} días</span>
        <strong>{pct(plate.probabilityPct)}</strong>
        <small>Poisson + Gutenberg–Richter sobre la tasa histórica</small>
      </div>
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
