"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EarthquakeEvent, EarthquakePage } from "@/lib/earthquakes/types";
import type { ScopeProjectionResponse } from "@/lib/scopeProjection";
import { tectonicRegimeLabel } from "@/lib/slab2";
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

function pct(value: number) {
  return `${value.toFixed(2)}%`;
}

function signedPct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)} pp`;
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
            magnitudeType: event.magnitudeType,
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

  const topDestinations = useMemo(() => projection?.destinations.slice(0, 8) ?? [], [projection]);

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
            Proyección de ocurrencia posterior basada en analogía histórica, contexto tectónico 3D Slab2
            y evidencia observacional disponible en EarthScope.
          </p>
        </div>
        <div className={styles.modelBadge}>
          <span>Modelo independiente</span>
          <strong>Historical + Slab2 + EarthScope</strong>
          <small>USGS/NEIC eventos · USGS Slab2 geometría · EarthScope observabilidad</small>
        </div>
      </header>

      <section className={styles.notice}>
        <strong>Cómo leer Scope Projection:</strong> el porcentaje es recurrencia histórica ponderada.
        Slab2 evita tratar automáticamente como equivalentes un sismo de interfaz, uno intraslab y uno de placa superior;
        EarthScope modifica el peso según la observabilidad histórica. La cifra no es certeza de que ocurrirá un sismo.
      </section>

      <section className={styles.eventsSection}>
        <div className={styles.eventsHeader}>
          <div>
            <span>Evento precedente real · M5.9+</span>
            <h2>Selecciona el sismo que inicia la proyección</h2>
            <p>El sistema busca análogos históricos comparables y observa qué países tuvieron actividad posterior dentro de la ventana calculada.</p>
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
            <span>Evento precedente</span>
            <h2>M{selectedEvent.magnitude.toFixed(1)} · {selectedEvent.place}</h2>
            <p>{formatDate(selectedEvent.timeUtc, true)} UTC · profundidad {selectedEvent.depthKm.toFixed(1)} km</p>
          </div>
          {projection?.sourceTectonicContext && (
            <div>
              <span>Contexto hipocentral Slab2</span>
              <strong>{tectonicRegimeLabel(projection.sourceTectonicContext.regime)}</strong>
              <small>
                {projection.sourceTectonicContext.slabDepthKm === null
                  ? projection.sourceTectonicContext.warning ?? "Sin losa próxima modelada"
                  : `losa ≈${projection.sourceTectonicContext.slabDepthKm.toFixed(0)} km · Δprof ${projection.sourceTectonicContext.depthOffsetKm?.toFixed(0) ?? "—"} km · confianza ${projection.sourceTectonicContext.confidence}`}
              </small>
            </div>
          )}
          <button type="button" onClick={() => void runProjection(selectedEvent)} disabled={loading}>
            {loading ? "Evaluando historia + Slab2 + EarthScope…" : "Recalcular Scope"}
          </button>
        </section>
      )}

      {error && <div className={styles.error}>{error}</div>}
      {loading && !projection && <div className={styles.loading}>Buscando análogos, contexto Slab2 y evidencia histórica EarthScope…</div>}

      {projection && (
        <>
          <section className={styles.metrics}>
            <article>
              <span>Destinos con señal positiva</span>
              <strong>{projection.destinations.length}</strong>
              <small>Probabilidad Scope mayor que la línea base</small>
            </article>
            <article>
              <span>Análogos evaluados</span>
              <strong>{projection.analogsEvaluated}</strong>
              <small>{projection.analogsFound.toLocaleString()} candidatos históricos encontrados</small>
            </article>
            <article>
              <span>Régimen tectónico fuente</span>
              <strong>{projection.sourceTectonicContext ? tectonicRegimeLabel(projection.sourceTectonicContext.regime) : "—"}</strong>
              <small>{projection.sourceTectonicContext?.available ? `Slab2 · confianza ${projection.sourceTectonicContext.confidence}` : "sin geometría Slab2 resuelta"}</small>
            </article>
            <article>
              <span>Soporte EarthScope</span>
              <strong>{projection.earthScopeSupportedAnalogs}/{projection.analogsEvaluated}</strong>
              <small>{projection.waveformConfirmedAnalogs} con forma de onda confirmada en la muestra</small>
            </article>
            <article>
              <span>Calidad de evidencia Scope</span>
              <strong>{projection.evidenceQualityPct}%</strong>
              <small>calidad del conjunto; no probabilidad de ocurrencia</small>
            </article>
          </section>

          <section className={styles.visualSection}>
            <div className={styles.visualHeader}>
              <div>
                <span>Mapa 3D de proyección</span>
                <h2>Evento precedente → posibles destinos</h2>
              </div>
              <p>Ventana {projection.windowDays} días · M{projection.forecastMagnitudeMin.toFixed(1)}–M{projection.forecastMagnitudeMax.toFixed(1)}</p>
            </div>
            <div className={styles.visualGrid}>
              <div className={styles.globeWrap}><ScopeProjectionGlobe data={projection} /></div>
              <aside className={styles.sideList}>
                <div className={styles.sideHead}>
                  <span>Mayor señal histórica Scope</span>
                  <strong>{topDestinations.length}</strong>
                </div>
                {topDestinations.map((destination) => (
                  <article key={destination.id}>
                    <div><strong>{destination.name}</strong><b>{pct(destination.probabilityPct)}</b></div>
                    <span>{signedPct(destination.liftPct)} sobre base {pct(destination.baselinePct)}</span>
                    <small>EarthScope {destination.earthScopeEvidencePct}% · {destination.analogHits}/{projection.analogsEvaluated} análogos con hit</small>
                    <small>M{destination.magnitudeMin.toFixed(1)}–M{destination.magnitudeMax.toFixed(1)} · hasta {formatDate(destination.surveillanceEnd)}</small>
                  </article>
                ))}
                {!topDestinations.length && <div className={styles.empty}>No aparece una señal positiva sobre la línea base después de ponderar la evidencia EarthScope.</div>}
              </aside>
            </div>
          </section>

          <section className={styles.tableSection}>
            <div className={styles.tableHeader}>
              <div><span>Proyección Scope</span><h2>Países proyectados</h2></div>
              <p>Un país aparece una sola vez. Prob. y Base usan la misma ventana; Dif. es el exceso en puntos porcentuales.</p>
            </div>
            <div className={styles.tableScroll}>
              <table>
                <thead><tr><th>País</th><th>Prob. Scope</th><th>Base</th><th>Dif.</th><th>Evidencia ES</th><th>Hits</th><th>Magnitud</th><th>Ventana</th></tr></thead>
                <tbody>
                  {projection.destinations.map((destination) => (
                    <tr key={`destination:${destination.id}`}>
                      <td><strong>{destination.name}</strong><small>{destination.zoneNames.join(" · ") || destination.countryCode}</small></td>
                      <td><strong>{pct(destination.probabilityPct)}</strong></td>
                      <td>{pct(destination.baselinePct)}</td>
                      <td>{signedPct(destination.liftPct)}</td>
                      <td>{destination.earthScopeEvidencePct}%<small>{destination.waveformConfirmedHits} hit(s) con waveform confirmada</small></td>
                      <td>{destination.analogHits}/{projection.analogsEvaluated}<small>control {destination.controlHits}</small></td>
                      <td>M{destination.magnitudeMin.toFixed(1)}–M{destination.magnitudeMax.toFixed(1)}</td>
                      <td>{formatDate(destination.surveillanceStart)} → {formatDate(destination.surveillanceEnd)}</td>
                    </tr>
                  ))}
                  {!projection.destinations.length && <tr><td colSpan={8}>Sin destinos con exceso positivo sobre la línea base.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.tableSection}>
            <div className={styles.tableHeader}>
              <div><span>Evidencia histórica</span><h2>Análogos + Slab2 + EarthScope</h2></div>
              <p>Slab2 ajusta compatibilidad tectónica; EarthScope pondera observabilidad. Ninguno decide por sí solo si habrá un terremoto posterior.</p>
            </div>
            <div className={styles.tableScroll}>
              <table>
                <thead><tr><th>Análogo</th><th>Similitud</th><th>Régimen 3D</th><th>Evidencia EarthScope</th><th>Estaciones</th><th>Waveform</th><th>Países posteriores</th></tr></thead>
                <tbody>
                  {projection.analogs.map((analog) => (
                    <tr key={`analog:${analog.event.id}`}>
                      <td><strong>M{analog.event.magnitude.toFixed(1)} · {analog.event.place}</strong><small>{formatDate(analog.event.time)}</small></td>
                      <td>{analog.similarityPct}%<small>{analog.baseSimilarityPct === null ? "base no separada" : `base ${analog.baseSimilarityPct}% · tectónica ${analog.tectonicSimilarityPct ?? "—"}%`}</small></td>
                      <td>
                        <strong>{analog.tectonicRegime ? tectonicRegimeLabel(analog.tectonicRegime) : "—"}</strong>
                        <small>{analog.slabContext?.available ? `losa ${analog.slabContext.slabDepthKm?.toFixed(0) ?? "—"} km · confianza ${analog.slabContext.confidence}` : analog.slabContext?.warning ?? "sin Slab2"}</small>
                      </td>
                      <td><strong>{analog.earthScopeEvidencePct}%</strong><small>{analog.earthScopeStatus}</small></td>
                      <td>{analog.stationCount}<small>{analog.azimuthSectors}/8 sectores · cercana {analog.nearestStationKm === null ? "—" : `${analog.nearestStationKm.toFixed(0)} km`}</small></td>
                      <td>{analog.waveformConfirmed ? `Sí · ${analog.waveformStation}` : analog.waveformChecked ? "No confirmada" : "No sondeada"}</td>
                      <td>{analog.hitCountryCodes.length ? analog.hitCountryCodes.join(", ") : "Ninguno"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {projection.warnings.length > 0 && (
            <details className={styles.warnings}>
              <summary>{projection.warnings.length} aviso(s) metodológico(s)</summary>
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
              <h2>Qué no significa</h2>
              <ul>{projection.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
          </section>

          <section className={styles.notice}>
            <strong>Fuentes:</strong> {projection.providers.eventCatalog} aporta el catálogo de ocurrencias históricas;
            {" "}{projection.providers.tectonicGeometry} aporta geometría 3D de subducción;
            {" "}{projection.providers.historicalObservation} aporta cobertura instrumental y archivo de formas de onda.
            {" "}{projection.providers.note}
          </section>
        </>
      )}
    </main>
  );
}
