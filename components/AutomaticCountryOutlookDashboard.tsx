"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildCountryOutlook,
  DEFAULT_AUTOMATIC_SOURCE_MAGNITUDE,
  rankOutlookSourceEvents,
  type CountryOutlook,
} from "@/lib/countryOutlook";
import { dedupeMigrationCapsules } from "@/lib/learning/projectionNormalization";
import type {
  CountryTarget,
  EventsApiResponse,
  HistoricalMigrationCapsule,
  SeismicEvent,
} from "@/lib/types";
import {
  formatProbability,
  formatSignedPercentagePoints,
  ParameterLabel,
  PROJECTION_PARAMETER_HELP,
} from "./ProjectionInfo";

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

const MAGNITUDE_OPTIONS = [4.5, 5, 5.5, 6, 6.5] as const;

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

export function AutomaticCountryOutlookDashboard() {
  const [countryCode, setCountryCode] = useState("DO");
  const [minimumSourceMagnitude, setMinimumSourceMagnitude] = useState(
    DEFAULT_AUTOMATIC_SOURCE_MAGNITUDE,
  );
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
        setCapsules(dedupeMigrationCapsules(payload.capsules ?? []));
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
  }, [countryCode, minimumSourceMagnitude]);

  const target = catalog?.target ?? storedTarget;
  const rankedSources = useMemo(() => {
    if (!catalog || !target) return [];
    return rankOutlookSourceEvents(
      catalog.events,
      target,
      new Date(catalog.generatedAt),
      3,
      minimumSourceMagnitude,
    );
  }, [catalog, target, minimumSourceMagnitude]);
  const candidateEvents = useMemo(() => rankedSources.map((item) => item.event), [rankedSources]);
  const candidateKey = `${minimumSourceMagnitude}:${candidateEvents.map((event) => event.id).join("|")}`;

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
          setCapsules((current) => dedupeMigrationCapsules([
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

  const eligibleCapsules = useMemo(
    () => capsules.filter((capsule) => capsule.sourceEvent.magnitude >= minimumSourceMagnitude),
    [capsules, minimumSourceMagnitude],
  );
  const outlook = useMemo(
    () => target ? buildCountryOutlook(eligibleCapsules, target.code, new Date()) : null,
    [eligibleCapsules, target],
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
          <p>Selecciona un país y el umbral mínimo. La aplicación identifica los fenómenos precedentes relevantes, construye el análisis histórico y presenta la franja temporal, magnitud orientativa y recurrencia observada.</p>
        </div>
        <div className="outlook-head-controls">
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
          <label className="country-control historical-country-control">
            Magnitud mínima del precedente
            <select
              value={minimumSourceMagnitude}
              disabled={loadingCatalog}
              onChange={(event) => setMinimumSourceMagnitude(Number(event.target.value))}
            >
              {MAGNITUDE_OPTIONS.map((magnitude) => (
                <option key={magnitude} value={magnitude}>M{magnitude.toFixed(1)} o superior</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="quality-warning">
        Esta es una proyección probabilística basada en recurrencia histórica, no una predicción determinista. Las probabilidades se muestran con dos decimales para conservar señales pequeñas; una proyección solo se emite si existe al menos una coincidencia histórica posterior para el destino.
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
                <span className="eyebrow">Proyección activa para {target.name} · precedentes M{minimumSourceMagnitude.toFixed(1)}+</span>
                <h2>{formatProbability(outlook.probabilityPct)} de recurrencia empírica combinada</h2>
                <p>{outlook.activeContributors} fenómenos precedentes continúan dentro de su periodo de vigilancia.</p>
              </div>
              <div className="outlook-confidence">
                <strong>{outlook.confidencePct.toFixed(0)}%</strong>
                <span><ParameterLabel label="calidad de evidencia" help={PROJECTION_PARAMETER_HELP.confidence} /></span>
              </div>
            </div>
            <div className="outlook-main-grid">
              <div><ParameterLabel label="Probabilidad" help={PROJECTION_PARAMETER_HELP.probability} /><strong>{formatProbability(outlook.probabilityPct)}</strong></div>
              <div><ParameterLabel label="Línea base" help={PROJECTION_PARAMETER_HELP.baseline} /><strong>{formatProbability(outlook.baselinePct)}</strong></div>
              <div><ParameterLabel label="Exceso vs. base" help={PROJECTION_PARAMETER_HELP.lift} /><strong className={outlook.liftPct > 0 ? "positive-lift" : "negative-lift"}>{formatSignedPercentagePoints(outlook.liftPct)}</strong></div>
              <div><ParameterLabel label="Magnitud orientativa" help={PROJECTION_PARAMETER_HELP.magnitude} /><strong>M{outlook.magnitudeMin.toFixed(1)}–M{outlook.magnitudeMax.toFixed(1)}</strong></div>
              <div><span>Mayor concentración</span><strong>{formatDate(outlook.peakStart)}–{formatDate(outlook.peakEnd)}</strong></div>
              <div><ParameterLabel label="Vigilancia extendida" help={PROJECTION_PARAMETER_HELP.window} /><strong>hasta {formatDate(outlook.surveillanceEnd)}</strong></div>
            </div>
            <p className="outlook-interpretation">
              La cifra combina las asociaciones históricas activas; no suma probabilidades como si los fenómenos fueran independientes. La línea base muestra cuánto de la actividad ya era habitual en ventanas de control equivalentes.
            </p>
          </>
        ) : (
          <div className="outlook-loading-state">
            <span className="eyebrow">Proyección automática M{minimumSourceMagnitude.toFixed(1)}+</span>
            <h2>{analyzing ? `Analizando eventos ${analysisCompleted}/${analysisTotal}…` : "Sin evidencia activa suficiente"}</h2>
            <p>{analyzing ? "Los primeros resultados aparecerán progresivamente sin que tengas que seleccionar cada evento." : "El catálogo reciente no produjo todavía evidencia activa utilizable para este país y umbral."}</p>
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
          <p className="outlook-map-note">Toca el área o un precedente para abrir la explicación. Las líneas son asociaciones históricas visuales; no representan un recorrido físico del sismo.</p>
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
                  <div><ParameterLabel label="Probabilidad" help={PROJECTION_PARAMETER_HELP.probability} /><strong>{formatProbability(contribution.probabilityPct)}</strong></div>
                  <div><ParameterLabel label="Línea base" help={PROJECTION_PARAMETER_HELP.baseline} /><strong>{formatProbability(contribution.baselinePct)}</strong></div>
                  <div><ParameterLabel label="Exceso" help={PROJECTION_PARAMETER_HELP.lift} /><strong className={contribution.liftPct > 0 ? "positive-lift" : "negative-lift"}>{formatSignedPercentagePoints(contribution.liftPct)}</strong></div>
                  <div><ParameterLabel label="Calidad evidencia" help={PROJECTION_PARAMETER_HELP.confidence} /><strong>{contribution.confidencePct.toFixed(0)}%</strong></div>
                </div>
                <div className="outlook-contribution-window">
                  <div><ParameterLabel label="Franja de vigilancia" help={PROJECTION_PARAMETER_HELP.window} /><strong>{formatDate(contribution.surveillanceStart)}–{formatDate(contribution.surveillanceEnd)}</strong></div>
                  <div><ParameterLabel label="Severidad orientativa" help={PROJECTION_PARAMETER_HELP.magnitude} /><strong>M{contribution.magnitudeMin.toFixed(1)}–M{contribution.magnitudeMax.toFixed(1)}</strong></div>
                </div>
                <p>Basado en {contribution.analogsEvaluated} análogos independientes; {contribution.analogHits} mostraron una coincidencia posterior y {contribution.controlHits} la mostraron en la ventana de control. {contribution.medianLeadDays !== null ? `La mediana histórica fue ${contribution.medianLeadDays} días.` : "No hubo mediana temporal suficiente."}</p>
                <details className="model-details">
                  <summary>Explicar esta proyección</summary>
                  <p>
                    Esta señal hacia {target?.name} nació del terremoto M{contribution.sourceEvent.magnitude.toFixed(1)} de {contribution.sourceEvent.place}. En los análogos históricos comparables, la recurrencia ponderada posterior fue {formatProbability(contribution.probabilityPct)}, frente a una línea base de {formatProbability(contribution.baselinePct)}; la diferencia fue {formatSignedPercentagePoints(contribution.liftPct)}.
                  </p>
                  <p>
                    La calidad de evidencia de {contribution.confidencePct.toFixed(0)}% describe cuánta evidencia y semejanza sustentan el escenario; no significa que exista esa probabilidad de que ocurra un sismo. Para cumplir la proyección, un evento debe entrar en la zona del país, la ventana temporal y el rango M{contribution.magnitudeMin.toFixed(1)}–M{contribution.magnitudeMax.toFixed(1)}.
                  </p>
                </details>
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
          <span>{candidateEvents.length} eventos M{minimumSourceMagnitude.toFixed(1)}+</span>
        </summary>
        <div className="outlook-candidate-list">
          {rankedSources.map(({ event, score, distanceKm }) => {
            const contribution = contributorByEvent.get(event.id);
            return (
              <article key={event.id}>
                <div><strong>M{event.magnitude.toFixed(1)} · {event.place}</strong><small>{formatUtc(event.time)} UTC · a {Math.round(distanceKm).toLocaleString()} km del país</small></div>
                <span>{contribution ? `${formatProbability(contribution.probabilityPct)} hacia el país` : analyzing ? "Analizando…" : `prioridad ${Math.round(score * 100)}%`}</span>
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

      <footer>Datos: USGS ComCat, EMSC y Raspberry Shake cuando están disponibles. RDSISMOS no sustituye avisos oficiales de protección civil ni de organismos sismológicos.</footer>
    </main>
  );
}
