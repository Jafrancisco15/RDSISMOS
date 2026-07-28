"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EventsApiResponse, SeismicEvent } from "@/lib/types";

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

function formatUtc(value: string) {
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    timeStyle: "short",
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

export function SeismicDashboard() {
  const [data, setData] = useState<EventsApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [secondsToRefresh, setSecondsToRefresh] = useState(60);
  const [minimumMagnitude, setMinimumMagnitude] = useState(4.5);

  const loadData = useCallback(async () => {
    try {
      const response = await fetch("/api/events", { cache: "no-store" });
      if (!response.ok) throw new Error(`Error HTTP ${response.status}`);
      const payload = (await response.json()) as EventsApiResponse;
      setData(payload);
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
              <span className="eyebrow">Índice exploratorio</span>
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
          <h2>Esto no es una predicción</h2>
          <p>
            El color representa coincidencias estadísticas entre actividad reciente, magnitud,
            proximidad y tendencia espacial. No confirma que un sismo distante vaya a provocar
            otro en República Dominicana.
          </p>
          <ul>
            {data.analysis.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
          </ul>
        </article>
      </section>

      <section className="map-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Mapa mundial</span>
            <h2>Eventos en zonas históricas y entorno dominicano</h2>
          </div>
          <div className="legend">
            <span><i className="legend-source" /> Zona histórica</span>
            <span><i className="legend-rd" /> Entorno RD</span>
            <span><i className="legend-global" /> M6+ global</span>
          </div>
        </div>
        <WorldMap
          events={data.events}
          watchedRegions={data.watchedRegions}
          level={data.analysis.level}
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
            <span className="eyebrow">Base histórica</span>
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
