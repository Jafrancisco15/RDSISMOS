"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { GlobeProjection, SeismicGlobeResponse } from "@/lib/globeTypes";
import type { SeismicGlobePoint } from "./SeismicGlobeRenderer";

const SeismicGlobeRenderer = dynamic(
  () => import("./SeismicGlobeRenderer").then((module) => module.SeismicGlobeRenderer),
  { ssr: false, loading: () => <div className="globe-loading">Inicializando motor WebGL y globo 3D…</div> },
);

function formatDate(value: string, withTime = false) {
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const } : {}),
    timeZone: "UTC",
  }).format(new Date(value));
}

function signed(value: number) {
  return `${value > 0 ? "+" : ""}${value}%`;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function projectionPoint(projection: GlobeProjection, comparison: boolean): SeismicGlobePoint {
  return {
    kind: "projected",
    id: `${comparison ? "comparison" : "projected"}:${projection.id}`,
    lat: projection.latitude,
    lng: projection.longitude,
    altitude: 0,
    radius: 0,
    color: comparison ? "#22c55e" : "#a855f7",
    comparison,
    projection,
  };
}

export function SeismicGlobe3D() {
  const today = todayKey();
  const [data, setData] = useState<SeismicGlobeResponse | null>(null);
  const [countryCode, setCountryCode] = useState("DO");
  const [dateDraft, setDateDraft] = useState(today);
  const [comparisonDraft, setComparisonDraft] = useState(today);
  const [viewDate, setViewDate] = useState(today);
  const [comparisonDate, setComparisonDate] = useState(today);
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [showObserved, setShowObserved] = useState(true);
  const [showProjected, setShowProjected] = useState(true);
  const [showComparison, setShowComparison] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [selected, setSelected] = useState<SeismicGlobePoint | null>(null);
  const [focusTarget, setFocusTarget] = useState<{ key: string; latitude: number; longitude: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;

    async function load(showLoader: boolean) {
      if (showLoader) setLoading(true);
      try {
        const params = new URLSearchParams({ country: countryCode, date: viewDate, _: String(Date.now()) });
        if (compareEnabled) params.set("compare", comparisonDate);
        const response = await fetch(`/api/globe?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json() as SeismicGlobeResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        if (!disposed) {
          setData(payload);
          setError(null);
          setShowComparison(compareEnabled && payload.comparisonProjections.length > 0);
        }
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        if (!disposed) setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el mapa 3D.");
      } finally {
        if (!disposed && showLoader) setLoading(false);
      }
    }

    void load(true);
    const isLiveView = viewDate === today;
    const interval = isLiveView ? window.setInterval(() => void load(false), 10 * 60_000) : null;
    return () => {
      disposed = true;
      controller.abort();
      if (interval) window.clearInterval(interval);
    };
  }, [comparisonDate, compareEnabled, countryCode, today, viewDate]);

  const strongestObserved = useMemo(
    () => [...(data?.observedEvents ?? [])].sort((a, b) => b.magnitude - a.magnitude)[0] ?? null,
    [data],
  );
  const strongestProjection = useMemo(
    () => [...(data?.projections ?? [])].sort((a, b) => b.probabilityPct - a.probabilityPct)[0] ?? null,
    [data],
  );
  const projectionDeltas = useMemo(() => {
    const comparison = new Map((data?.comparisonProjections ?? []).map((item) => [item.countryCode, item]));
    return new Map((data?.projections ?? []).map((item) => [
      item.id,
      comparison.has(item.countryCode)
        ? item.probabilityPct - (comparison.get(item.countryCode)?.probabilityPct ?? 0)
        : null,
    ]));
  }, [data]);

  function applyDates() {
    setViewDate(dateDraft || today);
    setComparisonDate(comparisonDraft || today);
    setSelected(null);
  }

  function focusProjection(projection: GlobeProjection, comparison = false) {
    setSelected(projectionPoint(projection, comparison));
    setFocusTarget({
      key: `${comparison ? "comparison" : "primary"}:${projection.id}:${Date.now()}`,
      latitude: projection.latitude,
      longitude: projection.longitude,
    });
  }

  return (
    <main className="globe-dashboard">
      <header className="globe-head">
        <div>
          <div className="brand-line"><span className="pulse-dot" /> RDSISMOS</div>
          <h1>Mapa sísmico 3D interactivo</h1>
          <p>Explora sismos M4.2+ de los últimos 90 días, proyecciones activas y el estado histórico que tenía el modelo en cualquier fecha disponible.</p>
        </div>
        <div className="globe-update-chip">
          <span>Actualización</span>
          <strong>{data ? formatDate(data.generatedAt, true) : "Cargando…"}</strong>
        </div>
      </header>

      <section className="panel globe-time-controls" aria-label="Fecha y país de análisis">
        <label>
          <span>País de estudio</span>
          <select value={countryCode} onChange={(event) => setCountryCode(event.target.value)}>
            {(data?.countries ?? []).map((country) => (
              <option key={country.code} value={country.code}>{country.name}</option>
            ))}
            {!data && <option value="DO">República Dominicana</option>}
          </select>
        </label>
        <label>
          <span>Estado del modelo en</span>
          <input type="date" value={dateDraft} max={today} onChange={(event) => setDateDraft(event.target.value)} />
        </label>
        <label>
          <span>Comparar con</span>
          <input type="date" value={comparisonDraft} max={today} disabled={!compareEnabled} onChange={(event) => setComparisonDraft(event.target.value)} />
        </label>
        <label className="globe-compare-check">
          <input type="checkbox" checked={compareEnabled} onChange={(event) => setCompareEnabled(event.target.checked)} />
          <span>Activar comparación histórica</span>
        </label>
        <button type="button" onClick={applyDates}>Aplicar</button>
      </section>

      <section className="panel globe-controls" aria-label="Controles del mapa 3D">
        <label className="globe-switch">
          <input type="checkbox" checked={showObserved} onChange={(event) => setShowObserved(event.target.checked)} />
          <span className="globe-switch-track" aria-hidden="true" />
          <div><strong>Sismos observados</strong><small>90 días hasta la fecha seleccionada · M4.2+</small></div>
        </label>
        <label className="globe-switch">
          <input type="checkbox" checked={showProjected} onChange={(event) => setShowProjected(event.target.checked)} />
          <span className="globe-switch-track projected" aria-hidden="true" />
          <div><strong>Proyecciones de la fecha</strong><small>Analogía histórica y ETAS regional</small></div>
        </label>
        <label className="globe-switch" aria-disabled={!compareEnabled}>
          <input type="checkbox" disabled={!compareEnabled} checked={showComparison} onChange={(event) => setShowComparison(event.target.checked)} />
          <span className="globe-switch-track comparison" aria-hidden="true" />
          <div><strong>Fecha comparada</strong><small>{compareEnabled ? comparisonDate : "Activa primero la comparación"}</small></div>
        </label>
        <label className="globe-switch compact">
          <input type="checkbox" checked={autoRotate} onChange={(event) => setAutoRotate(event.target.checked)} />
          <span className="globe-switch-track rotation" aria-hidden="true" />
          <div><strong>Rotación automática</strong><small>Desactivada inicialmente</small></div>
        </label>
      </section>

      <section className="globe-summary-grid">
        <article className="metric-card">
          <span>Eventos observados</span>
          <strong className="viz-stat-value">{data?.observedEvents.length.toLocaleString() ?? "—"}</strong>
          <small>{data?.provider ?? "Multifuente"} · M{data?.observedMinimumMagnitude ?? 4.2}+</small>
        </article>
        <article className="metric-card">
          <span>Mayor magnitud observada</span>
          <strong className="viz-stat-value">{strongestObserved ? `M${strongestObserved.magnitude.toFixed(1)}` : "—"}</strong>
          <small>{strongestObserved?.place ?? "Sin datos"}</small>
        </article>
        <article className="metric-card">
          <span>Proyecciones de {data?.viewDate ?? viewDate}</span>
          <strong className="viz-stat-value">{data?.projections.length.toLocaleString() ?? "—"}</strong>
          <small>{data?.databaseConnected ? "Supabase + cálculo regional" : "Cálculo regional sin memoria"}</small>
        </article>
        <article className="metric-card">
          <span>Mayor recurrencia proyectada</span>
          <strong className="viz-stat-value">{strongestProjection ? `${strongestProjection.probabilityPct}%` : "—"}</strong>
          <small>{strongestProjection?.countryName ?? "Sin proyección activa"}</small>
        </article>
      </section>

      {error && <div className="warning-banner globe-error">{error}</div>}
      {(data?.warnings.length ?? 0) > 0 && (
        <details className="globe-warnings">
          <summary>{data?.warnings.length} avisos de datos</summary>
          <ul>{data?.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </details>
      )}
      {(data?.providerStatus.length ?? 0) > 0 && (
        <details className="globe-provider-status">
          <summary>Fuentes consultadas: {data?.provider}</summary>
          <ul>{data?.providerStatus.map((status) => <li key={status}>{status}</li>)}</ul>
        </details>
      )}

      <section className="globe-stage">
        <div className="globe-stage-head">
          <div>
            <span className="eyebrow">Visualización global</span>
            <h2>Tierra sísmica en movimiento</h2>
          </div>
          <div className="globe-legend" aria-label="Leyenda">
            <span><i className="observed" /> Observado M4.2+</span>
            <span><i className="projected" /> Proyección seleccionada</span>
            <span><i className="comparison" /> Fecha comparada</span>
            <span><i className="arc" /> Asociación histórica</span>
          </div>
        </div>

        <div className="globe-visual-layout">
          <div className="globe-visual-main">
            {loading && !data ? (
              <div className="globe-loading">Consultando 90 días de actividad y reconstruyendo las proyecciones…</div>
            ) : data ? (
              <SeismicGlobeRenderer
                observedEvents={data.observedEvents}
                projections={data.projections}
                comparisonProjections={data.comparisonProjections}
                showObserved={showObserved}
                showProjected={showProjected}
                showComparison={showComparison}
                autoRotate={autoRotate}
                focusTarget={focusTarget}
                onSelect={setSelected}
              />
            ) : null}
          </div>

          <aside className="globe-projection-list" aria-label="Listado de proyecciones">
            <div className="globe-list-head">
              <span className="eyebrow">Proyecciones activas</span>
              <strong>{data?.projections.length ?? 0}</strong>
            </div>
            <p>Toca una proyección para mover el globo directamente a su zona.</p>
            <div className="globe-list-scroll">
              {(data?.projections ?? []).map((projection) => {
                const delta = projectionDeltas.get(projection.id);
                return (
                  <button type="button" key={projection.id} onClick={() => focusProjection(projection)}>
                    <span className={projection.projectionKind === "regional-etas" ? "regional" : "historical"} />
                    <div>
                      <strong>{projection.countryName} · {projection.probabilityPct}%</strong>
                      <small>M{projection.magnitudeMin.toFixed(1)}–M{projection.magnitudeMax.toFixed(1)} · hasta {formatDate(projection.surveillanceEnd)}</small>
                      <em>{projection.projectionKind === "regional-etas" ? "ETAS regional" : `Histórica ${signed(projection.liftPct)} vs base`}{delta === null || delta === undefined ? "" : ` · cambio ${signed(delta)}`}</em>
                    </div>
                  </button>
                );
              })}
              {!data?.projections.length && <div className="globe-list-empty">No hay proyecciones activas para esta fecha.</div>}
            </div>
            {compareEnabled && data?.comparisonProjections.length ? (
              <details className="globe-comparison-list">
                <summary>{data.comparisonDate}: {data.comparisonProjections.length} proyecciones</summary>
                {data.comparisonProjections.map((projection) => (
                  <button type="button" key={`comparison-${projection.id}`} onClick={() => focusProjection(projection, true)}>
                    <span className="comparison" />
                    <div><strong>{projection.countryName} · {projection.probabilityPct}%</strong><small>M{projection.magnitudeMin.toFixed(1)}–M{projection.magnitudeMax.toFixed(1)}</small></div>
                  </button>
                ))}
              </details>
            ) : null}
          </aside>
        </div>

        <p className="globe-help">Arrastra para girar · usa la rueda o gesto de pinza para acercar · toca una columna o una proyección del listado.</p>
      </section>

      <section className="panel globe-detail" aria-live="polite">
        {!selected ? (
          <div className="globe-detail-empty">
            <span className="eyebrow">Detalle interactivo</span>
            <h2>Selecciona un punto del globo</h2>
            <p>Los cilindros bajos son eventos registrados; los elevados representan proyecciones con escala M4.2 o superior.</p>
          </div>
        ) : selected.kind === "observed" ? (
          <>
            <div className="globe-detail-title observed">
              <span>Evento observado</span>
              <h2>M{selected.event.magnitude.toFixed(1)} · {selected.event.place}</h2>
            </div>
            <div className="globe-detail-grid">
              <div><span>Fecha UTC</span><strong>{formatDate(selected.event.timeUtc, true)}</strong></div>
              <div><span>Profundidad</span><strong>{selected.event.depthKm.toFixed(1)} km</strong></div>
              <div><span>Tipo de magnitud</span><strong>{selected.event.magnitudeType}</strong></div>
              <div><span>Fuente</span><strong>{selected.event.sourceCatalog}</strong></div>
            </div>
          </>
        ) : (
          <>
            <div className={`globe-detail-title projected${selected.comparison ? " comparison" : ""}`}>
              <span>{selected.comparison ? "Proyección comparada" : "Evento proyectado"}</span>
              <h2>{selected.projection.countryName} · {selected.projection.probabilityPct}%</h2>
            </div>
            <div className="globe-detail-grid projected">
              <div><span>Modelo</span><strong>{selected.projection.projectionKind === "regional-etas" ? "ETAS regional" : "Analogía histórica"}</strong></div>
              <div><span>Probabilidad empírica</span><strong>{selected.projection.probabilityPct}%</strong></div>
              <div><span>Línea base</span><strong>{selected.projection.projectionKind === "regional-etas" ? "No aplica" : `${selected.projection.baselinePct}%`}</strong></div>
              <div><span>Diferencia</span><strong>{selected.projection.projectionKind === "regional-etas" ? "No aplica" : signed(selected.projection.liftPct)}</strong></div>
              <div><span>Ventana de tiempo</span><strong>{formatDate(selected.projection.surveillanceStart)}–{formatDate(selected.projection.surveillanceEnd)}</strong></div>
              <div><span>Escala orientativa</span><strong>M{selected.projection.magnitudeMin.toFixed(1)}–M{selected.projection.magnitudeMax.toFixed(1)}</strong></div>
              <div><span>Evento precedente</span><strong>M{selected.projection.sourceEvent.magnitude.toFixed(1)} · {selected.projection.sourceEvent.place}</strong></div>
              <div><span>Evidencia</span><strong>{selected.projection.projectionKind === "regional-etas" ? "Tasa regional espacio-tiempo" : `${selected.projection.analogHits} análogos · control ${selected.projection.controlHits}`}</strong></div>
            </div>
          </>
        )}
      </section>

      <footer>Las proyecciones son estimaciones probabilísticas y reconstrucciones históricas del modelo. No son predicciones deterministas ni sustituyen alertas oficiales.</footer>
    </main>
  );
}
