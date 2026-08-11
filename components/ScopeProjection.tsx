"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EarthquakeEvent, EarthquakePage } from "@/lib/earthquakes/types";
import type { ScopeProjectionResponse } from "@/lib/scopeProjection";
import styles from "./ScopeProjection.module.css";

const ScopeProjectionGlobe = dynamic(
  () => import("./ScopeProjectionGlobe").then((module) => module.ScopeProjectionGlobe),
  { ssr: false },
);

type RecentDays = 7 | 30 | 90 | 365;

function formatDate(value: string, withTime = false) {
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const } : {}),
    timeZone: "UTC",
  }).format(new Date(value));
}

function startDateFor(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function minutes(value: number | null) {
  if (value === null) return "—";
  return `${value.toFixed(value < 10 ? 1 : 0)} min`;
}

function indexLabel(value: number) {
  if (value >= 80) return "Muy alta";
  if (value >= 60) return "Alta";
  if (value >= 40) return "Intermedia";
  if (value >= 20) return "Baja";
  return "Muy baja";
}

async function readJson<T>(response: Response): Promise<T> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(raw || `HTTP ${response.status}`);
  }
}

export function ScopeProjection() {
  const [recentDays, setRecentDays] = useState<RecentDays>(90);
  const [recentEvents, setRecentEvents] = useState<EarthquakeEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<EarthquakeEvent | null>(null);
  const [projection, setProjection] = useState<ScopeProjectionResponse | null>(null);
  const [recentLoading, setRecentLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runProjection = useCallback(async (event: EarthquakeEvent) => {
    setSelectedEvent(event);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/scope-projection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceEvent: {
            id: event.externalId || event.id,
            timeUtc: event.timeUtc,
            latitude: event.latitude,
            longitude: event.longitude,
            magnitude: event.magnitude,
            depthKm: event.depthKm,
            place: event.place,
          },
          sourceCatalog: event.sourceCatalog,
          sourceUrl: event.sourceUrl,
        }),
        cache: "no-store",
      });
      const payload = await readJson<ScopeProjectionResponse & { error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setProjection(payload);
    } catch (loadError) {
      setProjection(null);
      setError(loadError instanceof Error ? loadError.message : "No fue posible construir Scope Projection.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRecent = useCallback(async (days: RecentDays, autoSelect = false) => {
    setRecentLoading(true);
    setRecentError(null);
    try {
      const params = new URLSearchParams({
        starttime: startDateFor(days),
        endtime: new Date().toISOString().slice(0, 10),
        minmagnitude: "5.9",
        eventtype: "earthquake",
        orderby: "time",
        limit: "100",
      });
      const response = await fetch(`/api/earthquakes?${params}`, { cache: "no-store" });
      const payload = await readJson<EarthquakePage & { error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setRecentEvents(payload.events);
      if (autoSelect && payload.events[0]) void runProjection(payload.events[0]);
    } catch (loadError) {
      setRecentError(loadError instanceof Error ? loadError.message : "No fue posible cargar eventos recientes.");
    } finally {
      setRecentLoading(false);
    }
  }, [runProjection]);

  useEffect(() => {
    void loadRecent(90, true);
  }, [loadRecent]);

  const strongestZone = projection?.zones[0] ?? null;
  const strongestZones = useMemo(() => projection?.zones.slice(0, 8) ?? [], [projection]);

  function changeRange(days: RecentDays) {
    setRecentDays(days);
    void loadRecent(days, false);
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className={styles.brand}><span /> RDSISMOS · EARTHSCOPE LAB</div>
          <h1>Scope Projection</h1>
          <p>
            Proyección instrumental 3D construida con estaciones y formas de onda de EarthScope NSF SAGE.
            Separa lo que fue realmente observado de cualquier extrapolación espacial alrededor de las estaciones.
          </p>
        </div>
        <div className={styles.modelBadge}>
          <span>Fuente primaria</span>
          <strong>EarthScope NSF SAGE</strong>
          <small>FDSN Station · IRISWS Timeseries · Traveltime</small>
        </div>
      </header>

      <section className={styles.notice}>
        <strong>Qué significa “proyección” aquí:</strong> Scope Projection no asigna probabilidad de un nuevo terremoto.
        Proyecta espacialmente la <b>respuesta dinámica instrumental observada</b> alrededor de estaciones con velocidad físicamente comparable.
        El Índice Scope 0–100 es relativo a las estaciones disponibles para el mismo evento.
      </section>

      <section className={styles.eventsSection}>
        <div className={styles.eventsHeader}>
          <div>
            <span>Evento fuente real · M5.9+</span>
            <h2>Selecciona un terremoto</h2>
            <p>Al escogerlo, EarthScope se consulta directamente y se reconstruye una vista independiente de la proyección operacional de RDSISMOS.</p>
          </div>
          <div className={styles.rangeButtons}>
            {([7, 30, 90, 365] as RecentDays[]).map((days) => (
              <button
                type="button"
                key={days}
                className={recentDays === days ? styles.activeRange : ""}
                onClick={() => changeRange(days)}
                disabled={recentLoading}
              >
                {days === 365 ? "1 año" : `${days} días`}
              </button>
            ))}
            <button type="button" onClick={() => void loadRecent(recentDays, false)} disabled={recentLoading}>
              {recentLoading ? "Cargando…" : "Actualizar"}
            </button>
          </div>
        </div>
        {recentError && <div className={styles.warning}>{recentError}</div>}
        <div className={styles.eventList}>
          {recentEvents.map((event) => (
            <button
              type="button"
              key={event.id}
              className={selectedEvent?.id === event.id ? styles.selectedEvent : ""}
              onClick={() => void runProjection(event)}
              disabled={loading && selectedEvent?.id === event.id}
            >
              <strong>M{event.magnitude.toFixed(1)}</strong>
              <span>{event.place}</span>
              <small>{formatDate(event.timeUtc, true)} UTC · {event.depthKm.toFixed(0)} km · {event.sourceCatalog}</small>
            </button>
          ))}
        </div>
      </section>

      {selectedEvent && (
        <section className={styles.selectedSource}>
          <div>
            <span>Fuente seleccionada</span>
            <h2>M{selectedEvent.magnitude.toFixed(1)} · {selectedEvent.place}</h2>
            <p>{formatDate(selectedEvent.timeUtc, true)} UTC · profundidad {selectedEvent.depthKm.toFixed(1)} km</p>
          </div>
          <button type="button" onClick={() => void runProjection(selectedEvent)} disabled={loading}>
            {loading ? "Consultando EarthScope…" : "Recalcular Scope"}
          </button>
        </section>
      )}

      {error && <div className={styles.error}>{error}</div>}
      {loading && !projection && <div className={styles.loading}>Descargando metadata y formas de onda de EarthScope…</div>}

      {projection && (
        <>
          <section className={styles.metrics}>
            <article>
              <span>Estaciones EarthScope</span>
              <strong>{projection.stationMetadataCount}</strong>
              <small>metadata FDSN disponible en la ventana del evento</small>
            </article>
            <article>
              <span>Trazas observadas</span>
              <strong>{projection.observedTraceCount}</strong>
              <small>{projection.quantitativeTraceCount} comparables en velocidad</small>
            </article>
            <article>
              <span>Mayor Índice Scope</span>
              <strong>{strongestZone ? `${strongestZone.scopeIndex}/100` : "—"}</strong>
              <small>{strongestZone ? `${strongestZone.network}.${strongestZone.station} · ${indexLabel(strongestZone.scopeIndex)}` : "Sin velocidad comparable"}</small>
            </article>
            <article>
              <span>PGV observado máximo</span>
              <strong>{strongestZone ? `${strongestZone.pgvMmS.toExponential(2)} mm/s` : "—"}</strong>
              <small>solo respuesta instrumental corregida</small>
            </article>
          </section>

          <section className={styles.visualSection}>
            <div className={styles.visualHeader}>
              <div>
                <span>Mapa 3D instrumental</span>
                <h2>Observación EarthScope → zonas Scope</h2>
              </div>
              <p>{projection.zones.length} zona(s) cuantitativa(s) · P/S EarthScope {projection.travelTimeModel}</p>
            </div>
            <div className={styles.visualGrid}>
              <div className={styles.globeWrap}>
                <ScopeProjectionGlobe data={projection} />
              </div>
              <aside className={styles.sideList}>
                <div className={styles.sideHead}>
                  <span>Mayor respuesta observada</span>
                  <strong>{strongestZones.length}</strong>
                </div>
                {strongestZones.map((zone) => (
                  <article key={zone.id}>
                    <div><strong>{zone.network}.{zone.station}</strong><b>{zone.scopeIndex}/100</b></div>
                    <span>{zone.siteName}</span>
                    <small>PGV {zone.pgvMmS.toExponential(2)} mm/s · cobertura {zone.coveragePct}%</small>
                    <small>P {minutes(zone.pMinutes)} · S {minutes(zone.sMinutes)} · {zone.distanceKm.toFixed(0)} km del evento</small>
                  </article>
                ))}
                {!strongestZones.length && <div className={styles.empty}>EarthScope no devolvió suficientes trazas de velocidad corregida para construir zonas cuantitativas.</div>}
              </aside>
            </div>
          </section>

          <section className={styles.tableSection}>
            <div className={styles.tableHeader}>
              <div><span>Proyección instrumental</span><h2>Zonas Scope</h2></div>
              <p>Ordenadas por respuesta relativa observada. El radio indica soporte espacial aproximado de la estación, no alcance de un próximo terremoto.</p>
            </div>
            <div className={styles.tableScroll}>
              <table>
                <thead>
                  <tr><th>Estación</th><th>Índice Scope</th><th>PGV</th><th>Cobertura</th><th>Radio</th><th>Distancia</th><th>P</th><th>S</th></tr>
                </thead>
                <tbody>
                  {projection.zones.map((zone) => (
                    <tr key={`row:${zone.id}`}>
                      <td><strong>{zone.network}.{zone.station}</strong><small>{zone.siteName} · {zone.channel}</small></td>
                      <td><strong>{zone.scopeIndex}/100</strong><small>{indexLabel(zone.scopeIndex)}</small></td>
                      <td>{zone.pgvMmS.toExponential(3)} mm/s</td>
                      <td>{zone.coveragePct}% · {zone.supportStations} soporte</td>
                      <td>{zone.radiusKm} km</td>
                      <td>{zone.distanceKm.toFixed(0)} km</td>
                      <td>{minutes(zone.pMinutes)}</td>
                      <td>{minutes(zone.sMinutes)}</td>
                    </tr>
                  ))}
                  {!projection.zones.length && <tr><td colSpan={8}>Sin zonas cuantitativas para este evento.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.tableSection}>
            <div className={styles.tableHeader}>
              <div><span>Auditoría de datos</span><h2>Trazas EarthScope utilizadas</h2></div>
              <p>Las trazas sin velocidad corregida permanecen visibles, pero no participan en el Índice Scope.</p>
            </div>
            <div className={styles.tableScroll}>
              <table>
                <thead><tr><th>Estación</th><th>Canal</th><th>Máximo</th><th>Calibración</th><th>Uso cuantitativo</th></tr></thead>
                <tbody>
                  {projection.traces.map((trace) => (
                    <tr key={`trace:${trace.network}:${trace.station}:${trace.channel}`}>
                      <td><strong>{trace.network}.{trace.station}</strong><small>{trace.siteName}</small></td>
                      <td>{trace.channel}</td>
                      <td>{trace.maxAbs.toExponential(3)} {trace.units}</td>
                      <td>{trace.calibration === "response-corrected" ? "Respuesta corregida" : "Sensibilidad / fallback"}</td>
                      <td>{trace.quantitative ? "Sí" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {(projection.products.eventPageUrl || projection.products.gmvUrl || projection.products.dataAccessUrl) && (
            <section className={styles.products}>
              <div><span>Productos EarthScope</span><h2>Datos relacionados con el evento</h2></div>
              <div className={styles.productLinks}>
                {projection.products.eventPageUrl && <a href={projection.products.eventPageUrl} target="_blank" rel="noreferrer">Evento en EarthScope</a>}
                {projection.products.gmvUrl && <a href={projection.products.gmvUrl} target="_blank" rel="noreferrer">Ground Motion Visualization</a>}
                {projection.products.dataAccessUrl && <a href={projection.products.dataAccessUrl} target="_blank" rel="noreferrer">Event Data Access</a>}
              </div>
            </section>
          )}

          {(projection.warnings.length > 0) && (
            <details className={styles.warnings}>
              <summary>{projection.warnings.length} avisos de cobertura/datos</summary>
              <ul>{projection.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </details>
          )}

          <section className={styles.scienceGrid}>
            <article>
              <span>Metodología</span>
              <h2>Qué usa Scope Projection</h2>
              <ul>{projection.methodology.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
            <article>
              <span>Limitaciones</span>
              <h2>Qué no significa esta vista</h2>
              <ul>{projection.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
          </section>
        </>
      )}
    </main>
  );
}
