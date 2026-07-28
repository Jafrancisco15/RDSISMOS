"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  EventsApiResponse,
  MigrationProjection,
  SeismicEvent,
} from "@/lib/types";

const WorldMap = dynamic(
  () => import("./WorldMap").then((module) => module.WorldMap),
  { ssr: false, loading: () => <div className="map-loading">Cargando mapa mundial…</div> },
);

const levelCopy = {
  green: { title: "Sin señal destacada", tone: "Estable" },
  yellow: { title: "Vigilancia estadística", tone: "Atención" },
  orange: { title: "Actividad elevada", tone: "Elevada" },
  red: { title: "Posible actividad sísmica", tone: "Experimental" },
};

const projectionStatusCopy = {
  active: { label: "Proyección activa", detail: "En seguimiento" },
  fulfilled: { label: "Proyección cumplida", detail: "Coincidencia encontrada" },
  expired: { label: "Proyección vencida", detail: "Sin coincidencia en el plazo" },
};

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

function EventRow({ event }: { event: SeismicEvent }) {
  return (
    <article className="event-row">
      <div className={`magnitude ${event.magnitude >= 6 ? "magnitude-strong" : ""}`}>
        M{event.magnitude.toFixed(1)}
      </div>
      <div>
        <strong>{event.place}</strong>
        <span>{formatUtc(event.time)} UTC · {event.depthKm.toFixed(0)} km</span>
      </div>
    </article>
  );
}

function ProjectionCapsule({ projection }: { projection: MigrationProjection }) {
  const status = projectionStatusCopy[projection.status];

  return (
    <article className={`projection-capsule projection-${projection.status}`}>
      <div className="capsule-header">
        <div>
          <span className="eyebrow">Cápsula predictiva experimental</span>
          <h2>{projection.sourceRegionName}</h2>
          <p className="capsule-origin">
            Evento origen: <strong>M{projection.sourceEvent.magnitude.toFixed(1)}</strong> · {projection.sourceEvent.place}
          </p>
        </div>
        <div className="projection-status">
          <strong>{status.label}</strong>
          <span>{status.detail}</span>
        </div>
      </div>

      <div className="capsule-stats">
        <div><span>Rango estimado</span><strong>M{projection.magnitudeMin.toFixed(1)}–{projection.magnitudeMax.toFixed(1)}</strong></div>
        <div><span>Plazo máximo</span><strong>{projection.maxDays} días</strong></div>
        <div><span>Inicio</span><strong>{formatDate(projection.startTime)}</strong></div>
        <div><span>Vencimiento</span><strong>{formatDate(projection.expiresAt)}</strong></div>
        <div><span>Consistencia heurística</span><strong>{projection.consistencyScore}/100</strong></div>
      </div>

      <div className="migration-points">
        <h3>Puntos de migración sugeridos</h3>
        <ol>
          {projection.targets.map((target) => (
            <li key={target.id} className={projection.matchedTargetId === target.id ? "matched-target" : ""}>
              {target.name}
              {projection.matchedTargetId === target.id && <strong> · coincidencia observada</strong>}
            </li>
          ))}
        </ol>
      </div>

      {projection.matchedEvent && (
        <div className="projection-result">
          <strong>Proyección cumplida</strong>
          <span>
            M{projection.matchedEvent.magnitude.toFixed(1)} en {projection.matchedEvent.place}, {formatUtc(projection.matchedEvent.time)} UTC.
          </span>
        </div>
      )}

      <p className="capsule-disclaimer">
        Esta cápsula aplica reglas configuradas a eventos del catálogo. Es una hipótesis cuantificable y auditable, no una alerta oficial ni una predicción sísmica validada.
      </p>
    </article>
  );
}

export function SeismicDashboard() {
  const [data, setData] = useState<EventsApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [secondsToRefresh, setSecondsToRefresh] = useState(60);
  const [minimumMagnitude, setMinimumMagnitude] = useState(4.5);
  const [selectedProjectionId, setSelectedProjectionId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const response = await fetch("/api/events", { cache: "no-store" });
      if (!response.ok) throw new Error(`Error HTTP ${response.status}`);
      const payload = (await response.json()) as EventsApiResponse;
      setData(payload);
      setSelectedProjectionId((current) => {
        if (current && payload.projections.some((projection) => projection.id === current)) {
          return current;
        }
        return payload.projections.find((projection) => projection.status === "active")?.id
          ?? payload.projections[0]?.id
          ?? null;
      });
      setError(null);
      setSecondsToRefresh(payload.refreshSeconds);
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "No fue posible actualizar los eventos.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    const refresh = window.setInterval(() => void loadData(), 60_000);
    return () => window.clearInterval(refresh);
  }, [loadData]);

  useEffect(() => {
    const countdown = window.setInterval(
      () => setSecondsToRefresh((value) => (value <= 1 ? 60 : value - 1)),
      1_000,
    );
    return () => window.clearInterval(countdown);
  }, []);

  const relevantEvents = useMemo(() => {
    if (!data) return [];
    return data.events
      .filter(
        (event) =>
          event.magnitude >= minimumMagnitude &&
          (event.regionId || event.isDominicanRegion),
      )
      .slice(0, 40);
  }, [data, minimumMagnitude]);

  const selectedProjection = useMemo(() => {
    if (!data) return null;
    return data.projections.find((projection) => projection.id === selectedProjectionId)
      ?? data.projections[0]
      ?? null;
  }, [data, selectedProjectionId]);

  if (loading && !data) {
    return <main className="center-state">Conectando con el catálogo sísmico…</main>;
  }

  if (!data) {
    return (
      <main className="center-state error-state">
        <h1>RDSISMOS</h1>
        <p>{error ?? "No hay datos disponibles."}</p>
        <button onClick={() => void loadData()}>Reintentar</button>
      </main>
    );
  }

  const status = levelCopy[data.analysis.level];

  return (
    <main className={`dashboard level-${data.analysis.level}`}>
      <header className="topbar">
        <div>
          <div className="brand-line"><span className="pulse-dot" /> RDSISMOS</div>
          <h1>Observatorio experimental de migración sísmica</h1>
          <p>Ventana móvil de {data.windowDays} días · actualización cada minuto</p>
        </div>
        <div className="live-meta">
          <span>Fuente: {data.provider}</span>
          <strong>Próxima actualización: {secondsToRefresh}s</strong>
          <button onClick={() => void loadData()}>Actualizar ahora</button>
        </div>
      </header>

      {data.warning && <div className="warning-banner">{data.warning}</div>}
      {error && <div className="warning-banner">Última actualización fallida: {error}</div>}

      <section className="hero-grid">
        <article className="risk-card">
          <div className="risk-head">
            <div>
              <span className="eyebrow">Índice exploratorio general</span>
              <h2>{data.analysis.label}</h2>
            </div>
            <div className="score-ring"><strong>{data.analysis.score}</strong><span>/100</span></div>
          </div>
          <div className="status-pill">{status.tone}</div>
          <p className="risk-summary">{data.analysis.summary}</p>
          <div className="metrics-grid">
            <div><span>Zonas fuente</span><strong>{data.analysis.sourceActivityRatio.toFixed(2)}×</strong></div>
            <div><span>Entorno RD</span><strong>{data.analysis.caribbeanActivityRatio.toFixed(2)}×</strong></div>
            <div><span>Tendencia</span><strong>{data.analysis.distanceTrendKmPerDay.toFixed(0)} km/día</strong></div>
            <div><span>Cadena</span><strong>{data.analysis.approachChainLength} eventos</strong></div>
          </div>
        </article>

        <article className="science-card">
          <span className="eyebrow">Interpretación responsable</span>
          <h2>Proyección experimental, no alerta oficial</h2>
          <p>
            Las cápsulas convierten cada evento origen en destinos, magnitud y plazo verificables.
            El sistema conserva también las proyecciones vencidas para medir aciertos y fallos sin seleccionar solamente coincidencias favorables.
          </p>
          <ul>
            {data.analysis.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
          </ul>
        </article>
      </section>

      <section className="projection-section">
        {selectedProjection ? (
          <ProjectionCapsule projection={selectedProjection} />
        ) : (
          <article className="projection-capsule empty-capsule">
            <span className="eyebrow">Cápsula predictiva experimental</span>
            <h2>No hay una proyección activa</h2>
            <p>Se necesita un evento M4.7 o mayor en una zona fuente configurada durante los últimos 30 días.</p>
          </article>
        )}

        <aside className="projection-selector">
          <span className="eyebrow">Cápsulas recientes</span>
          <h2>Seleccionar proyección</h2>
          <div className="projection-tabs">
            {data.projections.length ? data.projections.map((projection) => (
              <button
                key={projection.id}
                className={projection.id === selectedProjection?.id ? "active" : ""}
                onClick={() => setSelectedProjectionId(projection.id)}
              >
                <span>M{projection.sourceEvent.magnitude.toFixed(1)} · {projection.sourceRegionName}</span>
                <strong>{projectionStatusCopy[projection.status].label}</strong>
              </button>
            )) : <p>No existen cápsulas en la ventana actual.</p>}
          </div>
        </aside>
      </section>

      <section className="map-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Mapa mundial</span>
            <h2>Ruta y destinos de la cápsula seleccionada</h2>
          </div>
          <div className="legend">
            <span><i className="legend-source" /> Zona histórica</span>
            <span><i className="legend-projection" /> Ruta proyectada</span>
            <span><i className="legend-rd" /> Entorno RD</span>
            <span><i className="legend-global" /> M6+ global</span>
          </div>
        </div>
        <WorldMap
          events={data.events}
          watchedRegions={data.watchedRegions}
          level={data.analysis.level}
          projection={selectedProjection}
        />
      </section>

      <section className="content-grid">
        <article className="panel events-panel">
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">Actividad relevante</span>
              <h2>Eventos recientes</h2>
            </div>
            <label>
              Magnitud mínima
              <select
                value={minimumMagnitude}
                onChange={(event) => setMinimumMagnitude(Number(event.target.value))}
              >
                <option value={2.5}>M2.5</option>
                <option value={4}>M4.0</option>
                <option value={4.5}>M4.5</option>
                <option value={5}>M5.0</option>
                <option value={6}>M6.0</option>
              </select>
            </label>
          </div>
          <div className="event-list">
            {relevantEvents.length ? relevantEvents.map((event) => (
              <EventRow key={`${event.source}-${event.id}`} event={event} />
            )) : <p>No hay eventos para el filtro seleccionado.</p>}
          </div>
        </article>

        <article className="panel evidence-panel">
          <span className="eyebrow">Por qué cambió el índice</span>
          <h2>Evidencia calculada</h2>
          <ol>
            {data.analysis.evidence.map((item) => <li key={item}>{item}</li>)}
          </ol>
          <p className="updated-at">Calculado: {formatUtc(data.generatedAt)} UTC</p>
        </article>
      </section>

      <section className="panel regions-panel">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">Base histórica y experimental</span>
            <h2>Zonas incluidas en el modelo</h2>
          </div>
          <span>{data.watchedRegions.length} áreas vigiladas</span>
        </div>
        <div className="region-grid">
          {data.watchedRegions.map((region) => (
            <article key={region.id}>
              <strong>{region.name}</strong>
              <p>{region.historicalNote}</p>
            </article>
          ))}
        </div>
      </section>

      <footer>
        Datos principales: Raspberry Shake QuakeLink. Respaldo opcional: USGS ComCat.
        RDSISMOS es una herramienta educativa y experimental; siga siempre al Centro Nacional
        de Sismología y a las autoridades de protección civil.
      </footer>
    </main>
  );
}
