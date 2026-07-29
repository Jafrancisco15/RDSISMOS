"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  EventsApiResponse,
  HistoricalMigrationCapsule,
  SeismicEvent,
} from "@/lib/types";

const HistoricalMigrationMap = dynamic(
  () => import("./HistoricalMigrationMap").then((module) => module.HistoricalMigrationMap),
  { ssr: false, loading: () => <div className="map-loading">Preparando mapa histórico…</div> },
);

function formatUtc(value: string) {
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function HistoricalMigrationDashboard() {
  const [data, setData] = useState<EventsApiResponse | null>(null);
  const [countryCode, setCountryCode] = useState("DO");
  const [minimumMagnitude, setMinimumMagnitude] = useState(5.5);
  const [windowDays, setWindowDays] = useState(30);
  const [selectedSource, setSelectedSource] = useState<SeismicEvent | null>(null);
  const [capsule, setCapsule] = useState<HistoricalMigrationCapsule | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const analysisController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingCatalog(true);
    setError(null);
    fetch(`/api/events?country=${encodeURIComponent(countryCode)}&_=${Date.now()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail ?? payload.error ?? `HTTP ${response.status}`);
        return payload as EventsApiResponse;
      })
      .then((payload) => {
        setData(payload);
        setCountryCode(payload.target.code);
        const strongest = [...payload.events]
          .filter((event) => event.magnitude >= 4.5)
          .sort((a, b) => b.magnitude - a.magnitude || new Date(b.time).getTime() - new Date(a.time).getTime())[0];
        setSelectedSource(strongest ?? null);
        setCapsule(null);
      })
      .catch((fetchError: unknown) => {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
        setError(fetchError instanceof Error ? fetchError.message : "No fue posible cargar los eventos.");
      })
      .finally(() => setLoadingCatalog(false));
    return () => controller.abort();
  }, [countryCode]);

  const sourceEvents = useMemo(() => {
    if (!data) return [];
    const earliest = new Date(data.generatedAt).getTime() - windowDays * 86_400_000;
    return [...data.events]
      .filter(
        (event) =>
          event.magnitude >= minimumMagnitude &&
          new Date(event.time).getTime() >= earliest,
      )
      .sort((a, b) => b.magnitude - a.magnitude || new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 80);
  }, [data, minimumMagnitude, windowDays]);

  async function analyze(event: SeismicEvent) {
    analysisController.current?.abort();
    const controller = new AbortController();
    analysisController.current = controller;
    setSelectedSource(event);
    setCapsule(null);
    setAnalyzing(true);
    setError(null);
    try {
      const response = await fetch("/api/migration/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({ countryCode, sourceEvent: event }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `Error HTTP ${response.status}`);
      setCapsule(payload as HistoricalMigrationCapsule);
    } catch (analysisError) {
      if (analysisError instanceof DOMException && analysisError.name === "AbortError") return;
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "No fue posible construir la cápsula histórica.",
      );
    } finally {
      setAnalyzing(false);
    }
  }

  const zoneNames = useMemo(
    () => new Map(capsule?.destinations.map((destination) => [destination.zoneId, destination.name]) ?? []),
    [capsule],
  );

  return (
    <main className="historical-dashboard">
      <header className="historical-head">
        <div>
          <div className="brand-line"><span className="pulse-dot" /> RDSISMOS</div>
          <h1>Migración histórica</h1>
          <p>
            Compara cada sismo origen con análogos de los últimos 50 años y mide qué macrozonas registraron eventos similares después.
          </p>
        </div>
        <label className="country-control historical-country-control">
          País de intención
          <select
            value={countryCode}
            disabled={!data || loadingCatalog || analyzing}
            onChange={(event) => {
              setCapsule(null);
              setSelectedSource(null);
              setCountryCode(event.target.value);
            }}
          >
            {(data?.countries ?? []).map((country) => (
              <option key={country.code} value={country.code}>{country.name}</option>
            ))}
          </select>
        </label>
      </header>

      <div className="quality-warning">
        Este módulo produce asociaciones empíricas auditables, no predicciones deterministas. Un patrón entre regiones distantes no demuestra que un terremoto cause otro.
      </div>

      <section className="historical-method-grid">
        <article className="panel historical-method-card">
          <span className="eyebrow">Motor híbrido</span>
          <h2>50 años de análogos + contexto regional</h2>
          <p>
            El sistema busca terremotos parecidos en magnitud, profundidad y ubicación; después examina sus ventanas posteriores y pondera cada caso por similitud.
          </p>
          <div className="historical-method-steps">
            <span>1. Evento origen</span><span>2. Análogos independientes</span><span>3. Ventanas posteriores</span><span>4. Recurrencia por zona</span>
          </div>
        </article>
        <article className="panel historical-controls-card">
          <span className="eyebrow">Selección del origen</span>
          <div className="historical-filter-row">
            <label>
              Periodo reciente
              <select value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value))}>
                <option value={7}>7 días</option>
                <option value={30}>30 días</option>
                <option value={90}>90 días</option>
              </select>
            </label>
            <label>
              Magnitud mínima
              <select value={minimumMagnitude} onChange={(event) => setMinimumMagnitude(Number(event.target.value))}>
                <option value={4.5}>M4.5</option>
                <option value={5}>M5.0</option>
                <option value={5.5}>M5.5</option>
                <option value={6}>M6.0</option>
                <option value={6.5}>M6.5</option>
              </select>
            </label>
          </div>
          {selectedSource && (
            <div className="selected-historical-source">
              <strong>M{selectedSource.magnitude.toFixed(1)} · {selectedSource.place}</strong>
              <span>{formatUtc(selectedSource.time)} UTC · {selectedSource.depthKm.toFixed(0)} km</span>
              <button disabled={analyzing} onClick={() => void analyze(selectedSource)}>
                {analyzing ? "Analizando catálogo histórico…" : "Construir cápsula de 50 años"}
              </button>
            </div>
          )}
        </article>
      </section>

      {error && <div className="warning-banner historical-error">{error}</div>}

      <section className="historical-main-grid">
        <article className="panel historical-source-list">
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">Eventos origen disponibles</span>
              <h2>Eventos globales recientes</h2>
            </div>
            <strong>{sourceEvents.length}</strong>
          </div>
          {loadingCatalog ? (
            <div className="table-skeleton">Cargando catálogo reciente…</div>
          ) : sourceEvents.length ? (
            <div className="historical-event-list">
              {sourceEvents.map((event) => (
                <button
                  key={`${event.source}-${event.id}`}
                  className={selectedSource?.id === event.id ? "active" : ""}
                  onClick={() => setSelectedSource(event)}
                >
                  <span className="historical-event-mag">M{event.magnitude.toFixed(1)}</span>
                  <span>
                    <strong>{event.place}</strong>
                    <small>{formatUtc(event.time)} UTC · {event.depthKm.toFixed(0)} km</small>
                  </span>
                  <em onClick={(click) => { click.stopPropagation(); void analyze(event); }}>
                    Analizar
                  </em>
                </button>
              ))}
            </div>
          ) : (
            <p>No hay eventos para el periodo y magnitud seleccionados.</p>
          )}
        </article>

        <article className="panel historical-capsule-card">
          {!capsule ? (
            <div className="historical-empty-capsule">
              <span className="eyebrow">Cápsula histórica</span>
              <h2>{analyzing ? "Procesando los análogos…" : "Selecciona un evento origen"}</h2>
              <p>
                El análisis consulta el catálogo de USGS y puede tardar varios segundos porque evalúa ventanas posteriores de diferentes terremotos históricos.
              </p>
            </div>
          ) : (
            <>
              <div className="capsule-header">
                <div>
                  <span className="eyebrow">Cápsula de migración histórica</span>
                  <h2>M{capsule.sourceEvent.magnitude.toFixed(1)} · {capsule.sourceEvent.place}</h2>
                  <p className="capsule-origin">Origen: {formatUtc(capsule.sourceEvent.time)} UTC · país objetivo: {capsule.targetCountry.name}</p>
                </div>
                <div className="historical-confidence">
                  <strong>{capsule.confidencePct}%</strong><span>confianza muestral</span>
                </div>
              </div>

              <div className="historical-summary-grid">
                <div><span>Análogos encontrados</span><strong>{capsule.analogsFound.toLocaleString()}</strong></div>
                <div><span>Análogos evaluados</span><strong>{capsule.analogsEvaluated}</strong></div>
                <div><span>Ventana posterior</span><strong>{capsule.windowDays} días</strong></div>
                <div><span>Magnitud observada</span><strong>M{capsule.forecastMagnitudeMin.toFixed(1)}–{capsule.forecastMagnitudeMax.toFixed(1)}</strong></div>
                <div><span>Periodo histórico</span><strong>{formatDate(capsule.historyStart)}–{formatDate(capsule.historyEnd)}</strong></div>
              </div>

              <h3 className="historical-destination-title">Destinos con mayor recurrencia histórica</h3>
              <div className="historical-destinations">
                {capsule.destinations.length ? capsule.destinations.map((destination, index) => (
                  <article key={destination.zoneId} className={destination.targetOverlap ? "target-overlap" : ""}>
                    <div className="historical-destination-rank">{index + 1}</div>
                    <div>
                      <strong>{destination.name}</strong>
                      <span>
                        {destination.analogHits}/{capsule.analogsEvaluated} análogos · peso relativo {destination.relativeWeightPct}%
                        {destination.medianLeadDays !== null ? ` · mediana ${destination.medianLeadDays} días` : ""}
                      </span>
                      <div className="historical-probability-track"><i style={{ width: `${Math.min(100, destination.recurrencePct)}%` }} /></div>
                    </div>
                    <b>{destination.recurrencePct}%</b>
                  </article>
                )) : <p>No se obtuvo una concentración suficiente en las macrozonas configuradas.</p>}
              </div>

              <details className="model-details historical-details">
                <summary>Metodología y limitaciones</summary>
                <h3>{capsule.modelName}</h3>
                <ol>{capsule.methodology.map((item) => <li key={item}>{item}</li>)}</ol>
                <ul>{capsule.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
              </details>
            </>
          )}
        </article>
      </section>

      {capsule && (
        <>
          <section className="map-card historical-map-card">
            <div className="section-heading">
              <div><span className="eyebrow">Mapa de recurrencias</span><h2>Origen y destinos históricos ponderados</h2></div>
              <span>Verde: solapa con {capsule.targetCountry.name}</span>
            </div>
            <HistoricalMigrationMap capsule={capsule} />
          </section>

          <section className="panel historical-evidence-panel">
            <div className="section-heading compact">
              <div><span className="eyebrow">Evidencia histórica</span><h2>Análogos utilizados</h2></div>
              <strong>{capsule.analogsEvaluated} casos auditables</strong>
            </div>
            <div className="historical-evidence-table">
              <table>
                <thead><tr><th>Evento análogo</th><th>Fecha UTC</th><th>Similitud</th><th>Eventos posteriores</th><th>Zonas observadas</th><th>Más fuerte</th></tr></thead>
                <tbody>
                  {capsule.analogs.map((analog) => (
                    <tr key={analog.analogEvent.id}>
                      <td><strong>M{analog.analogEvent.magnitude.toFixed(1)}</strong> · {analog.analogEvent.place}</td>
                      <td>{formatUtc(analog.analogEvent.time)}</td>
                      <td>{analog.similarityPct}%</td>
                      <td>{analog.followerCount}</td>
                      <td>{analog.hitZoneIds.map((id) => zoneNames.get(id) ?? id).join(", ") || "Sin zona clasificada"}</td>
                      <td>{analog.strongestFollower ? `M${analog.strongestFollower.magnitude.toFixed(1)} · ${analog.strongestFollower.place}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <footer>
        Datos históricos y recientes: USGS ComCat. El módulo estima recurrencias empíricas y no sustituye información oficial ni permite anticipar con certeza fecha, lugar y magnitud de un terremoto.
      </footer>
    </main>
  );
}
