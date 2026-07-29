"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  EventsApiResponse,
  HistoricalMigrationCapsule,
  HistoricalMigrationDestination,
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

function formatDate(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-DO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function signed(value: number) {
  return `${value > 0 ? "+" : ""}${value}%`;
}

function CountryForecastCard({
  destination,
  analogsEvaluated,
}: {
  destination: HistoricalMigrationDestination;
  analogsEvaluated: number;
}) {
  const baseline = destination.baselinePct ?? 0;
  const lift = destination.liftPct ?? destination.recurrencePct - baseline;
  const magnitudeMin = destination.magnitudeMin ?? 0;
  const magnitudeMax = destination.magnitudeMax ?? 0;
  const hasSignal = destination.analogHits > 0;

  return (
    <article className={`country-forecast-card ${destination.targetOverlap ? "country-target" : ""}`}>
      <div className="country-forecast-head">
        <div>
          <div className="country-name-line">
            <strong>{destination.name}</strong>
            {destination.targetOverlap && <span>País de intención</span>}
          </div>
          <small>{destination.zoneName}</small>
        </div>
        <div className="country-probability">
          <strong>{destination.recurrencePct}%</strong>
          <span>probabilidad empírica</span>
        </div>
      </div>

      <div className="country-signal-track" aria-hidden="true">
        <i style={{ width: `${Math.min(100, destination.recurrencePct)}%` }} />
        <b style={{ left: `${Math.min(100, baseline)}%` }} />
      </div>

      <div className="country-metrics-grid">
        <div>
          <span>Línea base</span>
          <strong>{baseline}%</strong>
        </div>
        <div>
          <span>Diferencia</span>
          <strong className={lift > 0 ? "positive-lift" : lift < 0 ? "negative-lift" : ""}>{signed(lift)}</strong>
        </div>
        <div>
          <span>Evidencia</span>
          <strong>{destination.analogHits}/{analogsEvaluated} análogos</strong>
        </div>
        <div>
          <span>Tiempo típico</span>
          <strong>{destination.medianLeadDays === null ? "Sin dato" : `${destination.medianLeadDays} días`}</strong>
        </div>
      </div>

      <div className="country-watch-grid">
        <div>
          <span>Periodo de vigilancia</span>
          <strong>{formatDate(destination.surveillanceStart)} – {formatDate(destination.surveillanceEnd)}</strong>
        </div>
        <div>
          <span>Magnitud orientativa</span>
          <strong>{magnitudeMin ? `M${magnitudeMin.toFixed(1)}–${magnitudeMax.toFixed(1)}` : "Sin rango"}</strong>
        </div>
      </div>

      <p className="country-forecast-note">
        {hasSignal
          ? `En ${destination.analogHits} de ${analogsEvaluated} casos históricos comparables apareció al menos un evento compatible. La ventana de control registró ${destination.controlHits ?? 0} coincidencias.`
          : "No se observó una coincidencia posterior en la muestra evaluada; el país se muestra porque pertenece a una de las zonas principales analizadas."}
      </p>
    </article>
  );
}

export function HistoricalMigrationDashboardV2() {
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
      .filter((event) => event.magnitude >= minimumMagnitude && new Date(event.time).getTime() >= earliest)
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
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (analysisError) {
      if (analysisError instanceof DOMException && analysisError.name === "AbortError") return;
      setError(analysisError instanceof Error ? analysisError.message : "No fue posible construir la cápsula histórica.");
    } finally {
      setAnalyzing(false);
    }
  }

  const groupedDestinations = useMemo(() => {
    const groups = new Map<string, HistoricalMigrationDestination[]>();
    for (const destination of capsule?.destinations ?? []) {
      const key = destination.zoneName ?? destination.zoneId;
      groups.set(key, [...(groups.get(key) ?? []), destination]);
    }
    return [...groups.entries()].sort((a, b) => {
      const aTarget = a[1].some((item) => item.targetOverlap);
      const bTarget = b[1].some((item) => item.targetOverlap);
      if (aTarget !== bTarget) return aTarget ? -1 : 1;
      const aScore = Math.max(...a[1].map((item) => item.liftPct ?? 0));
      const bScore = Math.max(...b[1].map((item) => item.liftPct ?? 0));
      return bScore - aScore;
    });
  }, [capsule]);

  const countryNames = useMemo(
    () => new Map((capsule?.destinations ?? []).map((item) => [`${item.zoneId}:${item.countryCode}`, item.name])),
    [capsule],
  );

  return (
    <main className="historical-dashboard country-migration-dashboard">
      <header className="historical-head">
        <div>
          <div className="brand-line"><span className="pulse-dot" /> RDSISMOS</div>
          <h1>Migración sísmica histórica por país</h1>
          <p>La pantalla principal compara un evento reciente con 50 años de análogos y desglosa la recurrencia país por país.</p>
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
            {(data?.countries ?? []).map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
          </select>
        </label>
      </header>

      <div className="quality-warning">
        “Probabilidad empírica” significa recurrencia ponderada en análogos históricos. La línea base compara ventanas anteriores equivalentes; ninguna cifra garantiza un evento futuro.
      </div>

      <section className="country-origin-panel panel">
        <div>
          <span className="eyebrow">Evento que origina la cápsula</span>
          {selectedSource ? (
            <>
              <h2>M{selectedSource.magnitude.toFixed(1)} · {selectedSource.place}</h2>
              <p>{formatUtc(selectedSource.time)} UTC · profundidad {selectedSource.depthKm.toFixed(0)} km</p>
            </>
          ) : <h2>Selecciona un evento reciente</h2>}
        </div>
        <div className="country-origin-actions">
          <label>Periodo reciente<select value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value))}><option value={7}>7 días</option><option value={30}>30 días</option><option value={90}>90 días</option></select></label>
          <label>Magnitud mínima<select value={minimumMagnitude} onChange={(event) => setMinimumMagnitude(Number(event.target.value))}><option value={4.5}>M4.5</option><option value={5}>M5.0</option><option value={5.5}>M5.5</option><option value={6}>M6.0</option><option value={6.5}>M6.5</option></select></label>
          <button disabled={!selectedSource || analyzing} onClick={() => selectedSource && void analyze(selectedSource)}>
            {analyzing ? "Calculando países…" : "Construir cápsula"}
          </button>
        </div>
      </section>

      {error && <div className="warning-banner historical-error">{error}</div>}

      <section className="panel country-capsule-primary">
        {!capsule ? (
          <div className="historical-empty-capsule">
            <span className="eyebrow">Resultado principal</span>
            <h2>{analyzing ? "Comparando ventanas históricas…" : "La cápsula aparecerá aquí"}</h2>
            <p>Selecciona un sismo y construye la cápsula. El proceso analiza análogos, ventanas posteriores y periodos de control.</p>
          </div>
        ) : (
          <>
            <div className="capsule-header country-capsule-header">
              <div>
                <span className="eyebrow">Cápsula de vigilancia por países</span>
                <h2>M{capsule.sourceEvent.magnitude.toFixed(1)} · {capsule.sourceEvent.place}</h2>
                <p>País de intención: <strong>{capsule.targetCountry.name}</strong> · muestra: {capsule.analogsEvaluated} análogos independientes.</p>
              </div>
              <div className="historical-confidence"><strong>{capsule.confidencePct}%</strong><span>confianza muestral</span></div>
            </div>

            <div className="historical-summary-grid country-summary-grid">
              <div><span>Análogos encontrados</span><strong>{capsule.analogsFound.toLocaleString()}</strong></div>
              <div><span>Análogos evaluados</span><strong>{capsule.analogsEvaluated}</strong></div>
              <div><span>Vigilancia</span><strong>{capsule.windowDays} días</strong></div>
              <div><span>Rango general</span><strong>M{capsule.forecastMagnitudeMin.toFixed(1)}–{capsule.forecastMagnitudeMax.toFixed(1)}</strong></div>
              <div><span>Historia analizada</span><strong>{formatDate(capsule.historyStart)}–{formatDate(capsule.historyEnd)}</strong></div>
            </div>

            <div className="country-zone-list">
              {groupedDestinations.map(([zoneName, countries], zoneIndex) => {
                const targetZone = countries.some((country) => country.targetOverlap);
                const maxRecurrence = Math.max(...countries.map((country) => country.recurrencePct));
                return (
                  <details key={zoneName} className={targetZone ? "country-zone target-zone" : "country-zone"} open={targetZone || zoneIndex === 0}>
                    <summary>
                      <div><strong>{zoneName}</strong><span>{countries.length} países detallados{targetZone ? ` · incluye ${capsule.targetCountry.name}` : ""}</span></div>
                      <b>máx. {maxRecurrence}%</b>
                    </summary>
                    <div className="country-card-grid">
                      {countries.map((destination) => (
                        <CountryForecastCard
                          key={`${destination.zoneId}-${destination.countryCode}-${destination.name}`}
                          destination={destination}
                          analogsEvaluated={capsule.analogsEvaluated}
                        />
                      ))}
                    </div>
                  </details>
                );
              })}
            </div>

            <details className="model-details historical-details">
              <summary>Cómo se calcularon estos países</summary>
              <h3>{capsule.modelName}</h3>
              <ol>{capsule.methodology.map((item) => <li key={item}>{item}</li>)}</ol>
              <ul>{capsule.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
            </details>
          </>
        )}
      </section>

      <section className="panel country-source-section">
        <div className="section-heading compact">
          <div><span className="eyebrow">Cambiar evento origen</span><h2>Eventos globales recientes</h2></div>
          <strong>{sourceEvents.length}</strong>
        </div>
        {loadingCatalog ? <div className="table-skeleton">Cargando catálogo reciente…</div> : (
          <div className="country-source-grid">
            {sourceEvents.map((event) => (
              <button key={`${event.source}-${event.id}`} className={selectedSource?.id === event.id ? "active" : ""} onClick={() => setSelectedSource(event)}>
                <span>M{event.magnitude.toFixed(1)}</span>
                <div><strong>{event.place}</strong><small>{formatUtc(event.time)} UTC · {event.depthKm.toFixed(0)} km</small></div>
                <em onClick={(click) => { click.stopPropagation(); void analyze(event); }}>Analizar</em>
              </button>
            ))}
          </div>
        )}
      </section>

      {capsule && (
        <>
          <section className="map-card historical-map-card">
            <div className="section-heading"><div><span className="eyebrow">Mapa por países</span><h2>Origen y áreas nacionales con recurrencia</h2></div><span>Verde: país de intención</span></div>
            <HistoricalMigrationMap capsule={capsule} />
          </section>

          <section className="panel historical-evidence-panel">
            <div className="section-heading compact"><div><span className="eyebrow">Evidencia histórica</span><h2>Análogos y controles utilizados</h2></div><strong>{capsule.analogsEvaluated} casos</strong></div>
            <div className="historical-evidence-table">
              <table>
                <thead><tr><th>Evento análogo</th><th>Fecha UTC</th><th>Similitud</th><th>Posteriores / control</th><th>Países posteriores</th><th>Más fuerte</th></tr></thead>
                <tbody>
                  {capsule.analogs.map((analog) => (
                    <tr key={analog.analogEvent.id}>
                      <td><strong>M{analog.analogEvent.magnitude.toFixed(1)}</strong> · {analog.analogEvent.place}</td>
                      <td>{formatUtc(analog.analogEvent.time)}</td>
                      <td>{analog.similarityPct}%</td>
                      <td>{analog.followerCount} / {analog.controlFollowerCount ?? 0}</td>
                      <td>{(analog.hitCountryCodes ?? []).map((id) => countryNames.get(id) ?? id).join(", ") || "Sin país clasificado"}</td>
                      <td>{analog.strongestFollower ? `M${analog.strongestFollower.magnitude.toFixed(1)} · ${analog.strongestFollower.place}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <footer>Datos: USGS ComCat. Los porcentajes son asociaciones históricas ponderadas y no sustituyen alertas oficiales ni permiten anticipar con certeza un terremoto.</footer>
    </main>
  );
}
