"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildCountryOutlook,
  rankOutlookSourceEvents,
  type CountryOutlook,
} from "@/lib/countryOutlook";
import type {
  CountryTarget,
  EventsApiResponse,
  HistoricalMigrationCapsule,
  SeismicEvent,
} from "@/lib/types";

const CountryOutlookMap = dynamic(
  () => import("./CountryOutlookMap").then((module) => module.CountryOutlookMap),
  { ssr: false, loading: () => <div className="map-loading">Preparando mapa de proyección…</div> },
);

interface StoredOutlookResponse {
  generatedAt: string;
  target: CountryTarget;
  capsules: HistoricalMigrationCapsule[];
  outlook: CountryOutlook | null;
  databaseConfigured: boolean;
  databaseConnected: boolean;
  warning?: string;
}

function formatUtc(value: string) {
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatDate(value: string) {
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

function dedupeCapsules(capsules: HistoricalMigrationCapsule[]) {
  const map = new Map<string, HistoricalMigrationCapsule>();
  for (const capsule of capsules) {
    const key = `${capsule.targetCountry.code}:${capsule.sourceEvent.id}`;
    const current = map.get(key);
    if (!current || new Date(capsule.generatedAt).getTime() > new Date(current.generatedAt).getTime()) {
      map.set(key, capsule);
    }
  }
  return [...map.values()];
}

export function AutomaticCountryOutlookDashboard() {
  const [countryCode, setCountryCode] = useState("DO");
  const [catalog, setCatalog] = useState<EventsApiResponse | null>(null);
  const [storedTarget, setStoredTarget] = useState<CountryTarget | null>(null);
  const [capsules, setCapsules] = useState<HistoricalMigrationCapsule[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingStored, setLoadingStored] = useState(true);
  const [analysisTotal, setAnalysisTotal] = useState(0);
  const [analysisCompleted, setAnalysisCompleted] = useState(0);
  const [analysisWarnings, setAnalysisWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const attemptedRef = useRef(new Set<string>());
  const analysisControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    attemptedRef.current.clear();
    analysisControllerRef.current?.abort();
    setCatalog(null);
    setCapsules([]);
    setStoredTarget(null);
    setAnalysisWarnings([]);
    setAnalysisTotal(0);
    setAnalysisCompleted(0);
    setError(null);

    const controller = new AbortController();
    let disposed = false;

    async function loadStored() {
      setLoadingStored(true);
      try {
        const response = await fetch(`/api/migration/outlook?country=${encodeURIComponent(countryCode)}&_=${Date.now()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json() as StoredOutlookResponse;
        if (!response.ok) throw new Error(payload.warning ?? `HTTP ${response.status}`);
        if (disposed) return;
        setStoredTarget(payload.target);
        setCapsules(dedupeCapsules(payload.capsules ?? []));
        if (payload.warning && !payload.databaseConnected) setAnalysisWarnings([payload.warning]);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        if (!disposed) setAnalysisWarnings([loadError instanceof Error ? loadError.message : "No fue posible cargar la memoria del modelo."]);
      } finally {
        if (!disposed) setLoadingStored(false);
      }
    }

    async function loadCatalog(showLoader: boolean) {
      if (showLoader) setLoadingCatalog(true);
      try {
        const response = await fetch(`/api/events?country=${encodeURIComponent(countryCode)}&_=${Date.now()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail ?? payload.error ?? `HTTP ${response.status}`);
        if (!disposed) setCatalog(payload as EventsApiResponse);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        if (!disposed) setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el catálogo reciente.");
      } finally {
        if (!disposed && showLoader) setLoadingCatalog(false);
      }
    }

    void Promise.all([loadStored(), loadCatalog(true)]);
    const interval = window.setInterval(() => void loadCatalog(false), 60_000);
    return () => {
      disposed = true;
      controller.abort();
      analysisControllerRef.current?.abort();
      window.clearInterval(interval);
    };
  }, [countryCode]);

  const target = catalog?.target ?? storedTarget;
  const rankedSources = useMemo(() => {
    if (!catalog || !target) return [];
    return rankOutlookSourceEvents(
      catalog.events,
      target,
      new Date(catalog.generatedAt),
      3,
    );
  }, [catalog, target]);
  const candidateEvents = useMemo(() => rankedSources.map((item) => item.event), [rankedSources]);
  const candidateKey = candidateEvents.map((event) => event.id).join("|");

  useEffect(() => {
    if (!target || !candidateEvents.length) return;
    const existingIds = new Set(capsules.map((capsule) => capsule.sourceEvent.id));
    const missing = candidateEvents.filter(
      (event) => !existingIds.has(event.id) && !attemptedRef.current.has(`${countryCode}:${event.id}`),
    );
    if (!missing.length) return;

    const controller = new AbortController();
    analysisControllerRef.current?.abort();
    analysisControllerRef.current = controller;
    missing.forEach((event) => attemptedRef.current.add(`${countryCode}:${event.id}`));
    setAnalysisTotal(missing.length);
    setAnalysisCompleted(0);

    let cursor = 0;
    async function worker() {
      while (cursor < missing.length && !controller.signal.aborted) {
        const index = cursor++;
        const sourceEvent = missing[index];
        try {
          const response = await fetch("/api/migration/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            signal: controller.signal,
            body: JSON.stringify({ countryCode, sourceEvent }),
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
          setCapsules((current) => dedupeCapsules([
            ...current,
            payload as HistoricalMigrationCapsule,
          ]));
          window.dispatchEvent(new Event("rdsismos-learning-updated"));
        } catch (analysisError) {
          if (analysisError instanceof DOMException && analysisError.name === "AbortError") return;
          setAnalysisWarnings((current) => [
            ...current,
            `${sourceEvent.place}: ${analysisError instanceof Error ? analysisError.message : "análisis no disponible"}`,
          ].slice(-5));
        } finally {
          setAnalysisCompleted((value) => value + 1);
        }
      }
    }

    void Promise.all(Array.from({ length: Math.min(2, missing.length) }, () => worker()));
    return () => controller.abort();
  // Capsules are intentionally excluded: each candidate is protected by attemptedRef.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateKey, countryCode, target]);

  const outlook = useMemo(
    () => target ? buildCountryOutlook(capsules, target.code, new Date()) : null,
    [capsules, target],
  );
  const analyzing = analysisTotal > 0 && analysisCompleted < analysisTotal;
  const contributorByEvent = useMemo(
    () => new Map(outlook?.contributors.map((item) => [item.sourceEvent.id, item]) ?? []),
    [outlook],
  );

  async function reanalyze(event: SeismicEvent) {
    attemptedRef.current.delete(`${countryCode}:${event.id}`);
    setCapsules((current) => current.filter((capsule) => capsule.sourceEvent.id !== event.id));
    setCatalog((current) => current ? { ...current, generatedAt: new Date().toISOString() } : current);
  }

  return (
    <main className="historical-dashboard automatic-outlook-dashboard">
      <header className="historical-head outlook-head">
        <div>
          <div className="brand-line"><span className="pulse-dot" /> RDSISMOS</div>
          <h1>Proyección sísmica automática por país</h1>
          <p>Selecciona un país. La aplicación identifica los fenómenos precedentes relevantes, construye las cápsulas y presenta de inmediato la franja temporal, magnitud orientativa y recurrencia histórica.</p>
        </div>
        <label className="country-control historical-country-control">
          País de estudio
          <select
            value={countryCode}
            disabled={loadingCatalog}
            onChange={(event) => setCountryCode(event.target.value)}
          >
            {(catalog?.countries ?? (storedTarget ? [storedTarget] : [])).map((country) => (
              <option key={country.code} value={country.code}>{country.name}</option>
            ))}
          </select>
        </label>
      </header>

      <div className="quality-warning">
        Esta es una proyección probabilística basada en recurrencia histórica, no una predicción determinista. El modelo guarda la proyección antes del resultado y aprende al comparar posteriormente lo proyectado con lo ocurrido.
      </div>

      <section className="panel outlook-hero">
        {!target || (loadingCatalog && loadingStored) ? (
          <div className="outlook-loading-state">
            <span className="eyebrow">Preparando análisis</span>
            <h2>Cargando país, memoria y catálogo reciente…</h2>
          </div>
        ) : outlook ? (
          <>
            <div className="outlook-hero-header">
              <div>
                <span className="eyebrow">Proyección activa para {target.name}</span>
                <h2>{outlook.probabilityPct}% de recurrencia empírica combinada</h2>
                <p>{outlook.activeContributors} fenómenos precedentes continúan dentro de su periodo de vigilancia.</p>
              </div>
              <div className="outlook-confidence"><strong>{outlook.confidencePct}%</strong><span>confianza muestral</span></div>
            </div>
            <div className="outlook-main-grid">
              <div><span>Línea base</span><strong>{outlook.baselinePct}%</strong></div>
              <div><span>Diferencia</span><strong className={outlook.liftPct > 0 ? "positive-lift" : "negative-lift"}>{signed(outlook.liftPct)}</strong></div>
              <div><span>Magnitud orientativa</span><strong>M{outlook.magnitudeMin.toFixed(1)}–M{outlook.magnitudeMax.toFixed(1)}</strong></div>
              <div><span>Mayor concentración</span><strong>{formatDate(outlook.peakStart)}–{formatDate(outlook.peakEnd)}</strong></div>
              <div><span>Vigilancia extendida</span><strong>hasta {formatDate(outlook.surveillanceEnd)}</strong></div>
              <div><span>Fuentes activas</span><strong>{outlook.activeContributors}</strong></div>
            </div>
            <p className="outlook-interpretation">
              La cifra combina las asociaciones históricas activas; no suma probabilidades como si los fenómenos fueran independientes. La línea base muestra cuánto de la actividad ya era habitual en ventanas de control equivalentes.
            </p>
          </>
        ) : (
          <div className="outlook-loading-state">
            <span className="eyebrow">Proyección automática</span>
            <h2>{analyzing ? `Analizando eventos ${analysisCompleted}/${analysisTotal}…` : "Sin evidencia activa suficiente"}</h2>
            <p>{analyzing ? "Los primeros resultados aparecerán progresivamente sin que tengas que seleccionar cada evento." : "El catálogo reciente no produjo todavía una cápsula activa utilizable para este país."}</p>
          </div>
        )}
      </section>

      {error && <div className="warning-banner historical-error">{error}</div>}
      {analysisWarnings.length > 0 && (
        <details className="outlook-warnings">
          <summary>{analysisWarnings.length} avisos del análisis</summary>
          <ul>{analysisWarnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul>
        </details>
      )}

      {target && (
        <section className="map-card outlook-map-card">
          <div className="section-heading">
            <div><span className="eyebrow">Mapa de proyección</span><h2>Fenómenos precedentes y área bajo vigilancia</h2></div>
            <span>Rojo: precedente · violeta/verde: proyección</span>
          </div>
          <CountryOutlookMap target={target} outlook={outlook} candidates={candidateEvents} />
          <p className="outlook-map-note">Las líneas son asociaciones históricas visuales; no representan un recorrido físico del sismo.</p>
        </section>
      )}

      <section className="panel outlook-precedents">
        <div className="section-heading compact">
          <div><span className="eyebrow">Evidencia que alimenta la proyección</span><h2>Fenómenos precedentes activos</h2></div>
          <strong>{outlook?.contributors.length ?? 0}</strong>
        </div>
        {outlook?.contributors.length ? (
          <div className="outlook-contribution-grid">
            {outlook.contributors.map((contribution, index) => (
              <article className="outlook-contribution-card" key={contribution.capsuleId}>
                <div className="outlook-contribution-title">
                  <span>{index + 1}</span>
                  <div><strong>M{contribution.sourceEvent.magnitude.toFixed(1)} · {contribution.sourceEvent.place}</strong><small>{formatUtc(contribution.sourceEvent.time)} UTC · {contribution.sourceEvent.depthKm.toFixed(0)} km</small></div>
                </div>
                <div className="outlook-contribution-metrics">
                  <div><span>Asociación histórica</span><strong>{contribution.probabilityPct}%</strong></div>
                  <div><span>Línea base</span><strong>{contribution.baselinePct}%</strong></div>
                  <div><span>Diferencia</span><strong className={contribution.liftPct > 0 ? "positive-lift" : "negative-lift"}>{signed(contribution.liftPct)}</strong></div>
                  <div><span>Confianza</span><strong>{contribution.confidencePct}%</strong></div>
                </div>
                <div className="outlook-contribution-window">
                  <div><span>Franja de vigilancia</span><strong>{formatDate(contribution.surveillanceStart)}–{formatDate(contribution.surveillanceEnd)}</strong></div>
                  <div><span>Severidad orientativa</span><strong>M{contribution.magnitudeMin.toFixed(1)}–M{contribution.magnitudeMax.toFixed(1)}</strong></div>
                </div>
                <p>Basado en {contribution.analogsEvaluated} análogos independientes. {contribution.medianLeadDays !== null ? `La mediana histórica fue ${contribution.medianLeadDays} días.` : "No hubo mediana temporal suficiente."}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="table-skeleton">{analyzing ? "Construyendo evidencia automáticamente…" : "No hay fenómenos precedentes activos para mostrar."}</div>
        )}
      </section>

      <details className="panel outlook-explorer">
        <summary>
          <div><span className="eyebrow">Control opcional</span><strong>Explorar los eventos recientes seleccionados por el sistema</strong></div>
          <span>{candidateEvents.length} eventos</span>
        </summary>
        <div className="outlook-candidate-list">
          {rankedSources.map(({ event, score, distanceKm }) => {
            const contribution = contributorByEvent.get(event.id);
            return (
              <article key={event.id}>
                <div><strong>M{event.magnitude.toFixed(1)} · {event.place}</strong><small>{formatUtc(event.time)} UTC · a {Math.round(distanceKm).toLocaleString()} km del país</small></div>
                <span>{contribution ? `${contribution.probabilityPct}% hacia el país` : analyzing ? "Analizando…" : `prioridad ${Math.round(score * 100)}%`}</span>
                <button onClick={() => void reanalyze(event)}>Recalcular</button>
              </article>
            );
          })}
        </div>
      </details>

      <details className="model-details outlook-methodology">
        <summary>Cómo se construye esta proyección automática</summary>
        <ol>{outlook?.methodology.map((item) => <li key={item}>{item}</li>) ?? <li>Esperando una proyección activa.</li>}</ol>
        <ul>{outlook?.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
      </details>

      <footer>Datos: USGS ComCat y Raspberry Shake cuando está disponible. RDSISMOS no sustituye avisos oficiales de protección civil ni de organismos sismológicos.</footer>
    </main>
  );
}
