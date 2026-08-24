"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { GlobeProjection, SeismicGlobeResponse } from "@/lib/globeTypes";
import {
  formatProbability,
  formatSignedPercentagePoints,
  ParameterLabel,
  PROJECTION_PARAMETER_HELP,
  projectionInfoStyles,
} from "./ProjectionInfo";
import type { SeismicGlobePoint } from "./SeismicGlobeRenderer";
import controls from "./ProjectionArchiveControls.module.css";

const SeismicGlobeRenderer = dynamic(
  () => import("./SeismicGlobeRenderer").then((module) => module.SeismicGlobeRenderer),
  { ssr: false, loading: () => <div className="globe-loading">Inicializando motor WebGL y globo 3D…</div> },
);

const PROJECTION_PAGE_SIZE = 20;
const DAY_MS = 86_400_000;
type PeriodPreset = "7" | "15" | "30" | "custom";

function formatDate(value: string, withTime = false) {
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const } : {}),
    timeZone: "UTC",
  }).format(new Date(value));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoKey(days: number, endKey = todayKey()) {
  const end = new Date(`${endKey}T23:59:59.999Z`);
  return new Date(end.getTime() - days * DAY_MS).toISOString().slice(0, 10);
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

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("es");
}

export function SeismicGlobe3D() {
  const today = todayKey();
  const [data, setData] = useState<SeismicGlobeResponse | null>(null);
  const [countryCode, setCountryCode] = useState("DO");
  const [dateDraft, setDateDraft] = useState(today);
  const [comparisonDraft, setComparisonDraft] = useState(today);
  const [viewDate, setViewDate] = useState(today);
  const [comparisonDate, setComparisonDate] = useState(today);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("15");
  const [customStartDraft, setCustomStartDraft] = useState(daysAgoKey(15, today));
  const [customStart, setCustomStart] = useState(daysAgoKey(15, today));
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [showObserved, setShowObserved] = useState(true);
  const [showProjected, setShowProjected] = useState(true);
  const [showComparison, setShowComparison] = useState(false);
  const [showFaults, setShowFaults] = useState(true);
  const [showPlateBoundaries, setShowPlateBoundaries] = useState(true);
  const [showCountryBorders, setShowCountryBorders] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [selected, setSelected] = useState<SeismicGlobePoint | null>(null);
  const [focusTarget, setFocusTarget] = useState<{ key: string; latitude: number; longitude: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectionPage, setProjectionPage] = useState(1);
  const [comparisonPage, setComparisonPage] = useState(1);
  const [projectionSearch, setProjectionSearch] = useState("");
  const [projectionCountry, setProjectionCountry] = useState("");
  const [projectionModel, setProjectionModel] = useState<"" | "historical-country" | "regional-etas">("");
  const [projectionMinProbability, setProjectionMinProbability] = useState("");
  const [projectionMinMagnitude, setProjectionMinMagnitude] = useState("");

  const periodDays = periodPreset === "custom"
    ? Math.max(1, Math.min(60, Math.ceil((new Date(`${viewDate}T23:59:59.999Z`).getTime() - new Date(`${customStart}T00:00:00.000Z`).getTime()) / DAY_MS)))
    : Number(periodPreset);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;

    async function load(showLoader: boolean) {
      if (showLoader) setLoading(true);
      try {
        const params = new URLSearchParams({ country: countryCode, date: viewDate, _: String(Date.now()) });
        if (periodPreset === "custom") params.set("start", `${customStart}T00:00:00.000Z`);
        else params.set("days", periodPreset);
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
          setProjectionPage(1);
          setComparisonPage(1);
          setSelected(null);
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
  }, [comparisonDate, compareEnabled, countryCode, customStart, periodPreset, today, viewDate]);

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

  const projectionCountries = useMemo(() => {
    const items = [...(data?.projections ?? []), ...(data?.comparisonProjections ?? [])];
    return [...new Map(items.map((item) => [item.countryCode, item.countryName])).entries()]
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
  }, [data]);

  function matchesProjection(projection: GlobeProjection) {
    const needle = normalized(projectionSearch);
    const minimumProbability = projectionMinProbability === "" ? null : Number(projectionMinProbability);
    const minimumMagnitude = projectionMinMagnitude === "" ? null : Number(projectionMinMagnitude);
    if (needle) {
      const haystack = normalized([
        projection.countryName,
        projection.countryCode,
        projection.sourceEvent.place,
        projection.sourceEvent.id,
        projection.id,
      ].join(" "));
      if (!haystack.includes(needle)) return false;
    }
    if (projectionCountry && projection.countryCode !== projectionCountry) return false;
    if (projectionModel && projection.projectionKind !== projectionModel) return false;
    if (minimumProbability !== null && Number.isFinite(minimumProbability) && projection.probabilityPct < minimumProbability) return false;
    if (minimumMagnitude !== null && Number.isFinite(minimumMagnitude) && projection.magnitudeMax < minimumMagnitude) return false;
    return true;
  }

  const filteredProjections = useMemo(
    () => (data?.projections ?? []).filter(matchesProjection),
    [data, projectionCountry, projectionMinMagnitude, projectionMinProbability, projectionModel, projectionSearch],
  );
  const filteredComparisonProjections = useMemo(
    () => (data?.comparisonProjections ?? []).filter(matchesProjection),
    [data, projectionCountry, projectionMinMagnitude, projectionMinProbability, projectionModel, projectionSearch],
  );
  const projectionTotalPages = Math.max(1, Math.ceil(filteredProjections.length / PROJECTION_PAGE_SIZE));
  const comparisonTotalPages = Math.max(1, Math.ceil(filteredComparisonProjections.length / PROJECTION_PAGE_SIZE));
  const visibleProjections = filteredProjections.slice((projectionPage - 1) * PROJECTION_PAGE_SIZE, projectionPage * PROJECTION_PAGE_SIZE);
  const visibleComparisonProjections = filteredComparisonProjections.slice((comparisonPage - 1) * PROJECTION_PAGE_SIZE, comparisonPage * PROJECTION_PAGE_SIZE);

  useEffect(() => {
    if (projectionPage > projectionTotalPages) setProjectionPage(projectionTotalPages);
  }, [projectionPage, projectionTotalPages]);
  useEffect(() => {
    if (comparisonPage > comparisonTotalPages) setComparisonPage(comparisonTotalPages);
  }, [comparisonPage, comparisonTotalPages]);

  function applyDates() {
    setViewDate(dateDraft || today);
    setComparisonDate(comparisonDraft || today);
    if (periodPreset === "custom") setCustomStart(customStartDraft || daysAgoKey(15, dateDraft || today));
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

  function resetProjectionFilters() {
    setProjectionSearch("");
    setProjectionCountry("");
    setProjectionModel("");
    setProjectionMinProbability("");
    setProjectionMinMagnitude("");
    setProjectionPage(1);
    setComparisonPage(1);
  }

  const projectionsCounter = data
    ? data.projectionsTruncated
      ? `${data.projectionsLoaded.toLocaleString()} de ${data.projectionsTotal.toLocaleString()}`
      : data.projectionsTotal.toLocaleString()
    : "—";

  return (
    <main className="globe-dashboard">
      <header className="globe-head">
        <div>
          <div className="brand-line"><span className="pulse-dot" /> RDSISMOS</div>
          <h1>Mapa sísmico 3D interactivo</h1>
          <p>Explora sismos M4.2+, proyecciones activas, fallas, placas tectónicas y períodos históricos de hasta 60 días.</p>
        </div>
        <div className="globe-update-chip">
          <span>Actualización</span>
          <strong>{data ? formatDate(data.generatedAt, true) : "Cargando…"}</strong>
        </div>
      </header>

      <section className="globe-stage globe-stage-first">
        <div className="globe-stage-head">
          <div>
            <span className="eyebrow">Visualización global</span>
            <h2>Tierra sísmica y tectónica</h2>
          </div>
          <div className="globe-legend" aria-label="Leyenda">
            <span><i className="observed" /> Observado M4.2+</span>
            <span><i className="projected" /> Proyección</span>
            <span><i className="comparison" /> Comparación</span>
            <span><i className="fault" /> Falla activa</span>
            <span><i className="plate" /> Placa tectónica</span>
            <span><i className="country" /> País</span>
          </div>
        </div>

        <section className="panel globe-controls globe-layer-controls" aria-label="Capas del mapa 3D">
          <label className="globe-switch"><input type="checkbox" checked={showObserved} onChange={(event) => setShowObserved(event.target.checked)} /><span className="globe-switch-track" aria-hidden="true" /><div><strong>Sismos observados</strong><small>{data?.observedWindowDays ?? periodDays} días · M4.2+</small></div></label>
          <label className="globe-switch"><input type="checkbox" checked={showProjected} onChange={(event) => setShowProjected(event.target.checked)} /><span className="globe-switch-track projected" aria-hidden="true" /><div><strong>Proyecciones</strong><small>Mismo período · analogía histórica + ETAS</small></div></label>
          <label className="globe-switch" aria-disabled={!compareEnabled}><input type="checkbox" disabled={!compareEnabled} checked={showComparison} onChange={(event) => setShowComparison(event.target.checked)} /><span className="globe-switch-track comparison" aria-hidden="true" /><div><strong>Fecha comparada</strong><small>{compareEnabled ? comparisonDate : "Actívala debajo del mapa"}</small></div></label>
          <label className="globe-switch"><input type="checkbox" checked={showFaults} onChange={(event) => setShowFaults(event.target.checked)} /><span className="globe-switch-track fault" aria-hidden="true" /><div><strong>Fallas activas</strong><small>Líneas rosadas puntuadas · GEM</small></div></label>
          <label className="globe-switch"><input type="checkbox" checked={showPlateBoundaries} onChange={(event) => setShowPlateBoundaries(event.target.checked)} /><span className="globe-switch-track plate" aria-hidden="true" /><div><strong>Placas tectónicas</strong><small>Límites azules puntuados · PB2002</small></div></label>
          <label className="globe-switch"><input type="checkbox" checked={showCountryBorders} onChange={(event) => setShowCountryBorders(event.target.checked)} /><span className="globe-switch-track country" aria-hidden="true" /><div><strong>Bordes de países</strong><small>Fronteras internacionales · Natural Earth</small></div></label>
          <label className="globe-switch compact"><input type="checkbox" checked={autoRotate} onChange={(event) => setAutoRotate(event.target.checked)} /><span className="globe-switch-track rotation" aria-hidden="true" /><div><strong>Rotación automática</strong><small>Desactivada inicialmente</small></div></label>
        </section>

        <div className="globe-visual-layout">
          <div className="globe-visual-main">
            {loading && !data ? (
              <div className="globe-loading">Consultando actividad, proyecciones y capas tectónicas…</div>
            ) : data ? (
              <SeismicGlobeRenderer
                observedEvents={data.observedEvents}
                projections={data.projections}
                comparisonProjections={data.comparisonProjections}
                showObserved={showObserved}
                showProjected={showProjected}
                showComparison={showComparison}
                showFaults={showFaults}
                showPlateBoundaries={showPlateBoundaries}
                showCountryBorders={showCountryBorders}
                autoRotate={autoRotate}
                focusTarget={focusTarget}
                selectedPoint={selected}
                onSelect={setSelected}
              />
            ) : null}
          </div>

          <aside className="globe-projection-list" aria-label="Listado de proyecciones">
            <div className="globe-list-head"><span className="eyebrow">Proyecciones del período</span><strong>{filteredProjections.length}/{data?.projectionsLoaded ?? 0}</strong></div>
            <p>{projectionsCounter} proyecciones disponibles en el período. Las líneas de procedencia aparecen únicamente al seleccionar una proyección.</p>

            <div className={`${controls.filterBar} ${controls.compact}`} aria-label="Filtros de proyecciones activas">
              <label className={controls.field}><span>Buscar</span><input type="search" value={projectionSearch} onChange={(event) => { setProjectionPage(1); setComparisonPage(1); setProjectionSearch(event.target.value); }} placeholder="País, precedente, ID" /></label>
              <label className={controls.field}><span>País</span><select value={projectionCountry} onChange={(event) => { setProjectionPage(1); setComparisonPage(1); setProjectionCountry(event.target.value); }}><option value="">Todos</option>{projectionCountries.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
              <label className={controls.field}><span>Modelo</span><select value={projectionModel} onChange={(event) => { setProjectionPage(1); setComparisonPage(1); setProjectionModel(event.target.value as "" | "historical-country" | "regional-etas"); }}><option value="">Todos</option><option value="historical-country">Histórica</option><option value="regional-etas">ETAS regional</option></select></label>
              <label className={controls.field}><span>Prob. mín. %</span><input type="number" min="0" max="100" step="0.1" value={projectionMinProbability} onChange={(event) => { setProjectionPage(1); setComparisonPage(1); setProjectionMinProbability(event.target.value); }} placeholder="0" /></label>
              <label className={controls.field}><span>M máx. proyectada ≥</span><input type="number" min="0" max="10" step="0.1" value={projectionMinMagnitude} onChange={(event) => { setProjectionPage(1); setComparisonPage(1); setProjectionMinMagnitude(event.target.value); }} placeholder="0" /></label>
              <button type="button" className={controls.clearButton} onClick={resetProjectionFilters}>Limpiar</button>
            </div>

            <div className={controls.filterMeta}><span>{filteredProjections.length} coinciden</span><strong>{PROJECTION_PAGE_SIZE} por página</strong></div>
            <div className="globe-list-scroll">
              {visibleProjections.map((projection) => {
                const delta = projectionDeltas.get(projection.id);
                return (
                  <button type="button" key={projection.id} onClick={() => focusProjection(projection)}>
                    <span className={projection.projectionKind === "regional-etas" ? "regional" : "historical"} />
                    <div>
                      <strong>{projection.countryName} · {formatProbability(projection.probabilityPct)}</strong>
                      <small>M{projection.magnitudeMin.toFixed(1)}–M{projection.magnitudeMax.toFixed(1)} · hasta {formatDate(projection.surveillanceEnd)}</small>
                      <em>{projection.projectionKind === "regional-etas" ? "ETAS regional" : `Histórica ${formatSignedPercentagePoints(projection.liftPct)} vs base`}{delta === null || delta === undefined ? "" : ` · cambio ${formatSignedPercentagePoints(delta)}`}</em>
                    </div>
                  </button>
                );
              })}
              {!filteredProjections.length && <div className="globe-list-empty">No hay proyecciones que coincidan con los filtros para este período.</div>}
            </div>
            <nav className={controls.pagination} aria-label="Paginación de proyecciones activas">
              <button type="button" disabled={projectionPage <= 1} onClick={() => setProjectionPage((value) => Math.max(1, value - 1))}>Anterior</button>
              <span>Página <strong>{projectionPage}</strong> de <strong>{projectionTotalPages}</strong></span>
              <button type="button" disabled={projectionPage >= projectionTotalPages} onClick={() => setProjectionPage((value) => value + 1)}>Siguiente</button>
            </nav>

            {compareEnabled && data?.comparisonProjections.length ? (
              <details className="globe-comparison-list">
                <summary>{data.comparisonDate}: {filteredComparisonProjections.length}/{data.comparisonProjections.length} proyecciones</summary>
                {visibleComparisonProjections.map((projection) => (
                  <button type="button" key={`comparison-${projection.id}`} onClick={() => focusProjection(projection, true)}>
                    <span className="comparison" />
                    <div><strong>{projection.countryName} · {formatProbability(projection.probabilityPct)}</strong><small>M{projection.magnitudeMin.toFixed(1)}–M{projection.magnitudeMax.toFixed(1)}</small></div>
                  </button>
                ))}
                <nav className={controls.pagination} aria-label="Paginación de fecha comparada">
                  <button type="button" disabled={comparisonPage <= 1} onClick={() => setComparisonPage((value) => Math.max(1, value - 1))}>Anterior</button>
                  <span>Página <strong>{comparisonPage}</strong> de <strong>{comparisonTotalPages}</strong></span>
                  <button type="button" disabled={comparisonPage >= comparisonTotalPages} onClick={() => setComparisonPage((value) => value + 1)}>Siguiente</button>
                </nav>
              </details>
            ) : null}
          </aside>
        </div>

        <p className="globe-help">Arrastra para girar · usa la rueda o gesto de pinza para acercar · toca una columna o una proyección del listado. El arco de procedencia se muestra solo para la proyección seleccionada.</p>
      </section>

      <section className="panel globe-time-controls globe-time-controls-after-map" aria-label="Fecha, período y país de análisis">
        <label><span>País de estudio</span><select value={countryCode} onChange={(event) => setCountryCode(event.target.value)}>{(data?.countries ?? []).map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}{!data && <option value="DO">República Dominicana</option>}</select></label>
        <label><span>Fin del período</span><input type="date" value={dateDraft} max={today} onChange={(event) => setDateDraft(event.target.value)} /></label>
        <label><span>Período</span><select value={periodPreset} onChange={(event) => { const value = event.target.value as PeriodPreset; setPeriodPreset(value); if (value !== "custom") setCustomStartDraft(daysAgoKey(Number(value), dateDraft || today)); }}><option value="7">Últimos 7 días</option><option value="15">Últimos 15 días</option><option value="30">Últimos 30 días</option><option value="custom">Personalizado · máx. 60 días</option></select></label>
        {periodPreset === "custom" && <label><span>Inicio personalizado</span><input type="date" value={customStartDraft} max={dateDraft || today} min={daysAgoKey(60, dateDraft || today)} onChange={(event) => setCustomStartDraft(event.target.value)} /></label>}
        <label><span>Comparar con</span><input type="date" value={comparisonDraft} max={today} disabled={!compareEnabled} onChange={(event) => setComparisonDraft(event.target.value)} /></label>
        <label className="globe-compare-check"><input type="checkbox" checked={compareEnabled} onChange={(event) => setCompareEnabled(event.target.checked)} /><span>Activar comparación histórica</span></label>
        <button type="button" onClick={applyDates}>Aplicar</button>
      </section>

      <section className="globe-summary-grid">
        <article className="metric-card"><span>Eventos observados</span><strong className="viz-stat-value">{data?.observedEvents.length.toLocaleString() ?? "—"}</strong><small>{data ? `${formatDate(data.periodStart)}–${formatDate(data.periodEnd)} · M${data.observedMinimumMagnitude}+` : "Multifuente"}</small></article>
        <article className="metric-card"><span>Mayor magnitud observada</span><strong className="viz-stat-value">{strongestObserved ? `M${strongestObserved.magnitude.toFixed(1)}` : "—"}</strong><small>{strongestObserved?.place ?? "Sin datos"}</small></article>
        <article className="metric-card"><span>Proyecciones del período</span><strong className="viz-stat-value">{projectionsCounter}</strong><small>{data?.databaseConnected ? "Supabase + cálculo regional" : "Cálculo regional sin memoria"}</small></article>
        <article className="metric-card"><span>Mayor recurrencia proyectada</span><strong className="viz-stat-value">{strongestProjection ? formatProbability(strongestProjection.probabilityPct) : "—"}</strong><small>{strongestProjection?.countryName ?? "Sin proyección activa"}</small></article>
      </section>

      {error && <div className="warning-banner globe-error">{error}</div>}
      {(data?.warnings.length ?? 0) > 0 && <details className="globe-warnings"><summary>{data?.warnings.length} avisos de datos</summary><ul>{data?.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}
      {(data?.providerStatus.length ?? 0) > 0 && <details className="globe-provider-status"><summary>Fuentes sísmicas consultadas: {data?.provider}</summary><ul>{data?.providerStatus.map((status) => <li key={status}>{status}</li>)}</ul></details>}

      <section className="panel globe-detail" aria-live="polite">
        {!selected ? (
          <div className="globe-detail-empty"><span className="eyebrow">Detalle interactivo</span><h2>Selecciona un punto del globo</h2><p>Los cilindros bajos son eventos registrados; los elevados representan proyecciones. La línea de procedencia solo aparece al seleccionar una proyección.</p></div>
        ) : selected.kind === "observed" ? (
          <>
            <div className="globe-detail-title observed"><span>Evento observado</span><h2>M{selected.event.magnitude.toFixed(1)} · {selected.event.place}</h2></div>
            <div className="globe-detail-grid"><div><span>Fecha UTC</span><strong>{formatDate(selected.event.timeUtc, true)}</strong></div><div><span>Profundidad</span><strong>{selected.event.depthKm.toFixed(1)} km</strong></div><div><span>Tipo de magnitud</span><strong>{selected.event.magnitudeType}</strong></div><div><span>Fuente</span><strong>{selected.event.sourceCatalog}</strong></div></div>
          </>
        ) : (
          <>
            <div className={`globe-detail-title projected${selected.comparison ? " comparison" : ""}`}>
              <span>{selected.comparison ? "Proyección comparada" : "Evento proyectado"}</span>
              <h2>{selected.projection.countryName} · {formatProbability(selected.projection.probabilityPct)}</h2>
            </div>
            <p className={projectionInfoStyles.narrative}>
              {selected.projection.projectionKind === "regional-etas"
                ? `Esta señal regional se generó a partir del sismo M${selected.projection.sourceEvent.magnitude.toFixed(1)} de ${selected.projection.sourceEvent.place} mediante el modelo ETAS espacio-tiempo.`
                : `Esta proyección hacia ${selected.projection.countryName} se generó a partir del sismo M${selected.projection.sourceEvent.magnitude.toFixed(1)} de ${selected.projection.sourceEvent.place}. El modelo comparó ese precedente con análogos históricos y con ventanas de control antes de evaluar el resultado.`}
            </p>
            <div className="globe-detail-grid projected">
              <div><span>Modelo</span><strong>{selected.projection.projectionKind === "regional-etas" ? "ETAS regional" : "Analogía histórica"}</strong></div>
              <div><ParameterLabel label="Probabilidad empírica" help={PROJECTION_PARAMETER_HELP.probability} /><strong>{formatProbability(selected.projection.probabilityPct)}</strong></div>
              <div><ParameterLabel label="Línea base" help={PROJECTION_PARAMETER_HELP.baseline} /><strong>{selected.projection.projectionKind === "regional-etas" ? "No aplica" : formatProbability(selected.projection.baselinePct)}</strong></div>
              <div><ParameterLabel label="Exceso vs. base" help={PROJECTION_PARAMETER_HELP.lift} /><strong>{selected.projection.projectionKind === "regional-etas" ? "No aplica" : formatSignedPercentagePoints(selected.projection.liftPct)}</strong></div>
              <div><ParameterLabel label="Ventana de tiempo" help={PROJECTION_PARAMETER_HELP.window} /><strong>{formatDate(selected.projection.surveillanceStart)}–{formatDate(selected.projection.surveillanceEnd)}</strong></div>
              <div><ParameterLabel label="Magnitud" help={PROJECTION_PARAMETER_HELP.magnitude} /><strong>M{selected.projection.magnitudeMin.toFixed(1)}–M{selected.projection.magnitudeMax.toFixed(1)}</strong></div>
              <div><span>Radio</span><strong>{selected.projection.radiusKm.toLocaleString()} km</strong></div>
              <div><span>Precedente</span><strong>M{selected.projection.sourceEvent.magnitude.toFixed(1)} · {selected.projection.sourceEvent.place}</strong></div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
