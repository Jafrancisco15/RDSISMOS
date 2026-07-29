"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { SeismicGlobePoint } from "./SeismicGlobeRenderer";
import type { SeismicGlobeResponse } from "@/lib/globeTypes";

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

export function SeismicGlobe3D() {
  const [data, setData] = useState<SeismicGlobeResponse | null>(null);
  const [showObserved, setShowObserved] = useState(true);
  const [showProjected, setShowProjected] = useState(true);
  const [autoRotate, setAutoRotate] = useState(true);
  const [selected, setSelected] = useState<SeismicGlobePoint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;

    async function load(showLoader: boolean) {
      if (showLoader) setLoading(true);
      try {
        const response = await fetch(`/api/globe?_=${Date.now()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json() as SeismicGlobeResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        if (!disposed) {
          setData(payload);
          setError(null);
        }
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        if (!disposed) setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el mapa 3D.");
      } finally {
        if (!disposed && showLoader) setLoading(false);
      }
    }

    void load(true);
    const interval = window.setInterval(() => void load(false), 10 * 60_000);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);

  const strongestObserved = useMemo(
    () => [...(data?.observedEvents ?? [])].sort((a, b) => b.magnitude - a.magnitude)[0] ?? null,
    [data],
  );
  const strongestProjection = useMemo(
    () => [...(data?.projections ?? [])].sort((a, b) => b.probabilityPct - a.probabilityPct)[0] ?? null,
    [data],
  );

  return (
    <main className="globe-dashboard">
      <header className="globe-head">
        <div>
          <div className="brand-line"><span className="pulse-dot" /> RDSISMOS</div>
          <h1>Mapa sísmico 3D interactivo</h1>
          <p>Gira, acerca y explora el planeta. Las capas observadas y proyectadas pueden activarse o desactivarse de forma independiente.</p>
        </div>
        <div className="globe-update-chip">
          <span>Actualización</span>
          <strong>{data ? formatDate(data.generatedAt, true) : "Cargando…"}</strong>
        </div>
      </header>

      <section className="panel globe-controls" aria-label="Controles del mapa 3D">
        <label className="globe-switch">
          <input type="checkbox" checked={showObserved} onChange={(event) => setShowObserved(event.target.checked)} />
          <span className="globe-switch-track" aria-hidden="true" />
          <div><strong>Sismos observados</strong><small>Últimos 90 días · M5.5 o superior</small></div>
        </label>
        <label className="globe-switch">
          <input type="checkbox" checked={showProjected} onChange={(event) => setShowProjected(event.target.checked)} />
          <span className="globe-switch-track projected" aria-hidden="true" />
          <div><strong>Eventos proyectados</strong><small>Probabilidad, magnitud y ventana activa</small></div>
        </label>
        <label className="globe-switch compact">
          <input type="checkbox" checked={autoRotate} onChange={(event) => setAutoRotate(event.target.checked)} />
          <span className="globe-switch-track rotation" aria-hidden="true" />
          <div><strong>Rotación automática</strong><small>Se detiene al desactivarla</small></div>
        </label>
      </section>

      <section className="globe-summary-grid">
        <article className="metric-card">
          <span>Eventos observados</span>
          <strong className="viz-stat-value">{data?.observedEvents.length.toLocaleString() ?? "—"}</strong>
          <small>USGS · M{data?.observedMinimumMagnitude ?? 5.5}+ · {data?.observedWindowDays ?? 90} días</small>
        </article>
        <article className="metric-card">
          <span>Mayor magnitud observada</span>
          <strong className="viz-stat-value">{strongestObserved ? `M${strongestObserved.magnitude.toFixed(1)}` : "—"}</strong>
          <small>{strongestObserved?.place ?? "Sin datos"}</small>
        </article>
        <article className="metric-card">
          <span>Proyecciones activas</span>
          <strong className="viz-stat-value">{data?.projections.length.toLocaleString() ?? "—"}</strong>
          <small>{data?.databaseConnected ? "Memoria Supabase conectada" : "Sin memoria disponible"}</small>
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

      <section className="globe-stage">
        <div className="globe-stage-head">
          <div>
            <span className="eyebrow">Visualización global</span>
            <h2>Tierra sísmica en movimiento</h2>
          </div>
          <div className="globe-legend" aria-label="Leyenda">
            <span><i className="observed" /> Observado: altura según magnitud</span>
            <span><i className="projected" /> Proyectado: altura según probabilidad</span>
            <span><i className="arc" /> Asociación histórica</span>
          </div>
        </div>

        {loading && !data ? (
          <div className="globe-loading">Consultando los últimos 90 días y las proyecciones activas…</div>
        ) : data ? (
          <SeismicGlobeRenderer
            observedEvents={data.observedEvents}
            projections={data.projections}
            showObserved={showObserved}
            showProjected={showProjected}
            autoRotate={autoRotate}
            onSelect={setSelected}
          />
        ) : null}

        <p className="globe-help">Arrastra para girar · usa la rueda o gesto de pinza para acercar · toca una columna para ver el detalle.</p>
      </section>

      <section className="panel globe-detail" aria-live="polite">
        {!selected ? (
          <div className="globe-detail-empty">
            <span className="eyebrow">Detalle interactivo</span>
            <h2>Selecciona un punto del globo</h2>
            <p>Los cilindros bajos corresponden a eventos observados; los elevados representan proyecciones activas.</p>
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
              <div><span>Estado</span><strong>{selected.event.status}</strong></div>
            </div>
          </>
        ) : (
          <>
            <div className="globe-detail-title projected">
              <span>Evento proyectado</span>
              <h2>{selected.projection.countryName} · {selected.projection.probabilityPct}%</h2>
            </div>
            <div className="globe-detail-grid projected">
              <div><span>Probabilidad empírica</span><strong>{selected.projection.probabilityPct}%</strong></div>
              <div><span>Línea base</span><strong>{selected.projection.baselinePct}%</strong></div>
              <div><span>Diferencia</span><strong>{signed(selected.projection.liftPct)}</strong></div>
              <div><span>Confianza</span><strong>{selected.projection.confidencePct}%</strong></div>
              <div><span>Ventana de tiempo</span><strong>{formatDate(selected.projection.surveillanceStart)}–{formatDate(selected.projection.surveillanceEnd)}</strong></div>
              <div><span>Escala orientativa</span><strong>M{selected.projection.magnitudeMin.toFixed(1)}–M{selected.projection.magnitudeMax.toFixed(1)}</strong></div>
              <div><span>Evento precedente</span><strong>M{selected.projection.sourceEvent.magnitude.toFixed(1)} · {selected.projection.sourceEvent.place}</strong></div>
              <div><span>Evidencia</span><strong>{selected.projection.analogHits} análogos · control {selected.projection.controlHits}</strong></div>
            </div>
          </>
        )}
      </section>

      <footer>Las proyecciones representan recurrencia histórica y ventanas probabilísticas. No son predicciones deterministas ni sustituyen alertas oficiales.</footer>
    </main>
  );
}
