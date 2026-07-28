"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { haversineKm } from "@/lib/regions";
import type {
  EventsApiResponse,
  MapLayerVisibility,
  MigrationProjection,
  SeismicEvent,
} from "@/lib/types";

const WorldMap = dynamic(
  () => import("./WorldMap").then((module) => module.WorldMap),
  {
    ssr: false,
    loading: () => <div className="map-loading">Cargando mapa sísmico…</div>,
  },
);

const levelCopy = {
  green: { tone: "Bajo" },
  yellow: { tone: "Observación" },
  orange: { tone: "Moderado" },
  red: { tone: "Elevado" },
};

const projectionStatusCopy = {
  active: { label: "Cápsula activa", detail: "Dentro del plazo" },
  fulfilled: { label: "Coincidencia observada", detail: "Evento posterior asociado" },
  expired: { label: "Cápsula vencida", detail: "Sin coincidencia en el plazo" },
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

function EventRow({ event, label }: { event: SeismicEvent; label?: string }) {
  return (
    <article className="event-row">
      <div className={`magnitude ${event.magnitude >= 5 ? "magnitude-strong" : ""}`}>
        M{event.magnitude.toFixed(1)}
      </div>
      <div>
        <strong>{event.place}</strong>
        <span>
          {formatUtc(event.time)} UTC · {event.depthKm.toFixed(0)} km · {event.source}
        </span>
        {label && <small className="event-relation-label">{label}</small>}
      </div>
    </article>
  );
}

function relatedEventsForProjection(
  events: SeismicEvent[],
  projection: MigrationProjection | null,
) {
  if (!projection) return [];
  const start = new Date(projection.startTime).getTime();
  const end = new Date(projection.expiresAt).getTime();

  return events
    .filter((event) => {
      const eventTime = new Date(event.time).getTime();
      if (
        event.id === projection.parentEventId ||
        eventTime <= start ||
        eventTime > end ||
        event.magnitude < projection.magnitudeMin ||
        event.magnitude > projection.magnitudeMax
      ) {
        return false;
      }

      const distanceToProjection = haversineKm(
        event.latitude,
        event.longitude,
        projection.projectedZone.latitude,
        projection.projectedZone.longitude,
      );
      const distanceToTarget = haversineKm(
        event.latitude,
        event.longitude,
        projection.targetCountry.latitude,
        projection.targetCountry.longitude,
      );

      return (
        distanceToProjection <= projection.projectedZone.radiusKm + 220 &&
        distanceToTarget <= projection.targetCountry.radiusKm + 350
      );
    })
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
    .slice(0, 100);
}

function ProjectionCapsule({
  projection,
  relatedEvents,
  showRelatedEvents,
  onToggleRelatedEvents,
}: {
  projection: MigrationProjection;
  relatedEvents: SeismicEvent[];
  showRelatedEvents: boolean;
  onToggleRelatedEvents: () => void;
}) {
  const status = projectionStatusCopy[projection.status];

  return (
    <article className={`projection-capsule projection-${projection.status}`}>
      <div className="capsule-header">
        <div>
          <span className="eyebrow">Cápsula ETAS vinculada a un evento anterior</span>
          <h2>{projection.targetCountry.name}</h2>
          <p className="capsule-origin">
            Evento padre: <strong>M{projection.sourceEvent.magnitude.toFixed(1)}</strong> ·{" "}
            {projection.sourceEvent.place} · {formatUtc(projection.sourceEvent.time)} UTC
          </p>
        </div>
        <div className="projection-status">
          <strong>{status.label}</strong>
          <span>{status.detail}</span>
        </div>
      </div>

      <div className="capsule-stats">
        <div><span>Probabilidad condicional</span><strong>{projection.probabilityPct}%</strong></div>
        <div>
          <span>Magnitud contemplada</span>
          <strong>M{projection.magnitudeMin.toFixed(1)}–{projection.magnitudeMax.toFixed(1)}</strong>
        </div>
        <div><span>Plazo</span><strong>{projection.maxDays} días</strong></div>
        <div><span>Vencimiento</span><strong>{formatDate(projection.expiresAt)}</strong></div>
        <div><span>Conteo esperado ETAS</span><strong>{projection.expectedCount.toFixed(3)}</strong></div>
      </div>

      <div className="migration-points">
        <h3>Zona proyectada</h3>
        <p>
          {projection.projectedZone.name}. Radio aproximado: {Math.round(projection.projectedZone.radiusKm)} km.
        </p>
        <p>
          Asociación auditable: cápsula <code>{projection.id}</code> → evento padre{" "}
          <code>{projection.parentEventId}</code>.
        </p>
      </div>

      {projection.matchedEvent && (
        <div className="projection-result">
          <strong>Evento posterior que cumplió los criterios</strong>
          <span>
            M{projection.matchedEvent.magnitude.toFixed(1)} en {projection.matchedEvent.place},{" "}
            {formatUtc(projection.matchedEvent.time)} UTC.
          </span>
        </div>
      )}

      <div className="capsule-actions">
        <button
          type="button"
          className={showRelatedEvents ? "active" : ""}
          onClick={onToggleRelatedEvents}
          aria-expanded={showRelatedEvents}
        >
          {showRelatedEvents ? "Ocultar eventos relacionados" : "Ver eventos relacionados pronosticados"}
          <span>{relatedEvents.length}</span>
        </button>
      </div>

      {showRelatedEvents && (
        <section className="related-events-panel" aria-live="polite">
          <div className="related-events-intro">
            <div>
              <span className="eyebrow">Trazabilidad de la cápsula</span>
              <h3>Eventos relacionados con este pronóstico</h3>
            </div>
            <strong>{relatedEvents.length} observados</strong>
          </div>
          <EventRow event={projection.sourceEvent} label="Evento padre que originó la cápsula" />
          {relatedEvents.length ? (
            relatedEvents.map((event) => (
              <EventRow
                key={`related-${event.source}-${event.id}`}
                event={event}
                label={
                  projection.matchedEvent?.id === event.id
                    ? "Cumplió todos los criterios de la cápsula"
                    : "Dentro de la ventana, magnitud y zona proyectada"
                }
              />
            ))
          ) : (
            <p className="empty-related">
              Aún no se observan eventos que coincidan con la ventana temporal, el rango de magnitud y la zona de esta cápsula.
            </p>
          )}
        </section>
      )}

      <details className="model-details">
        <summary>Modelo y razones del cálculo</summary>
        <p>
          <strong>{projection.model.modelName}</strong>. Mc={projection.model.magnitudeCompleteness.toFixed(1)}, p={projection.model.omoriP.toFixed(1)}, q={projection.model.spatialQ.toFixed(1)}, b={projection.model.gutenbergRichterB.toFixed(1)}.
        </p>
        <ol>
          {projection.rationale.map((item) => <li key={item}>{item}</li>)}
        </ol>
        <p>{projection.model.calibration}</p>
      </details>

      <p className="capsule-disclaimer">
        Es un pronóstico probabilístico de agrupamiento regional, no una predicción exacta ni una alerta oficial.
      </p>
    </article>
  );
}

export function SeismicDashboard() {
  const [data, setData] = useState<EventsApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [countryCode, setCountryCode] = useState("DO");
  const [secondsToRefresh, setSecondsToRefresh] = useState(60);
  const [minimumMagnitude, setMinimumMagnitude] = useState(2);
  const [globalMinimumMagnitude, setGlobalMinimumMagnitude] = useState(4.5);
  const [globalWindowHours, setGlobalWindowHours] = useState(72);
  const [selectedProjectionId, setSelectedProjectionId] = useState<string | null>(null);
  const [showRelatedEvents, setShowRelatedEvents] = useState(false);
  const [layers, setLayers] = useState<MapLayerVisibility>({
    occurred: true,
    faults: false,
    projected: true,
    preceding: true,
  });

  const loadData = useCallback(async (selectedCountry: string) => {
    try {
      const response = await fetch(
        `/api/events?country=${encodeURIComponent(selectedCountry)}&_=${Date.now()}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`Error HTTP ${response.status}`);
      const payload = (await response.json()) as EventsApiResponse;
      setData(payload);
      setCountryCode(payload.target.code);
      setSelectedProjectionId((current) => {
        if (current && payload.projections.some((projection) => projection.id === current)) {
          return current;
        }
        return (
          payload.projections.find((projection) => projection.status === "active")?.id ??
          payload.projections[0]?.id ??
          null
        );
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
    void loadData(countryCode);
    const refresh = window.setInterval(() => void loadData(countryCode), 60_000);
    return () => window.clearInterval(refresh);
  }, [countryCode, loadData]);

  useEffect(() => {
    const countdown = window.setInterval(
      () => setSecondsToRefresh((value) => (value <= 1 ? 60 : value - 1)),
      1_000,
    );
    return () => window.clearInterval(countdown);
  }, []);

  useEffect(() => {
    setShowRelatedEvents(false);
  }, [selectedProjectionId, countryCode]);

  const relevantEvents = useMemo(() => {
    if (!data) return [];
    return [...data.events]
      .filter((event) => event.isTargetRegion && event.magnitude >= minimumMagnitude)
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 80);
  }, [data, minimumMagnitude]);

  const globalEvents = useMemo(() => {
    if (!data) return [];
    const referenceTime = new Date(data.generatedAt).getTime();
    const earliest = referenceTime - globalWindowHours * 3_600_000;
    return [...data.events]
      .filter(
        (event) =>
          event.magnitude >= globalMinimumMagnitude &&
          new Date(event.time).getTime() >= earliest,
      )
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 80);
  }, [data, globalMinimumMagnitude, globalWindowHours]);

  const selectedProjection = useMemo(() => {
    if (!data) return null;
    return (
      data.projections.find((projection) => projection.id === selectedProjectionId) ??
      data.projections[0] ??
      null
    );
  }, [data, selectedProjectionId]);

  const relatedEvents = useMemo(
    () => relatedEventsForProjection(data?.events ?? [], selectedProjection),
    [data, selectedProjection],
  );

  if (loading && !data) {
    return <main className="center-state">Conectando con los catálogos sísmicos…</main>;
  }

  if (!data) {
    return (
      <main className="center-state error-state">
        <h1>RDSISMOS</h1>
        <p>{error ?? "No hay datos disponibles."}</p>
        <button onClick={() => void loadData(countryCode)}>Reintentar</button>
      </main>
    );
  }

  const status = levelCopy[data.analysis.level];
  const toggleLayer = (key: keyof MapLayerVisibility) =>
    setLayers((current) => ({ ...current, [key]: !current[key] }));
  const raspberryAvailable = data.providerStatus.some(
    (item) => /^Raspberry Shake .*: [1-9]\d* eventos/.test(item),
  );
  const usgsAvailable = data.providerStatus.some(
    (item) => /^USGS .*: [1-9]\d* eventos/.test(item),
  );

  return (
    <main className={`dashboard level-${data.analysis.level}`}>
      <header className="topbar">
        <div>
          <div className="brand-line"><span className="pulse-dot" /> RDSISMOS</div>
          <h1>Pronóstico sísmico probabilístico por país</h1>
          <p>Ventana histórica de {data.windowDays} días · actualización cada minuto</p>
        </div>
        <div className="live-meta">
          <label className="country-control">
            País de intención del análisis
            <select
              value={countryCode}
              onChange={(event) => {
                setLoading(true);
                setSelectedProjectionId(null);
                setCountryCode(event.target.value);
              }}
            >
              {data.countries.map((country) => (
                <option key={country.code} value={country.code}>{country.name}</option>
              ))}
            </select>
          </label>
          <span>Fuente operativa: {usgsAvailable ? "USGS" : data.provider}</span>
          <strong>Próxima actualización: {secondsToRefresh}s</strong>
          <button onClick={() => void loadData(countryCode)}>Actualizar ahora</button>
        </div>
      </header>

      <section className="provider-health" aria-label="Estado de proveedores">
        <div className={usgsAvailable ? "provider-online" : "provider-offline"}>
          <span>USGS</span><strong>{usgsAvailable ? "Operativo" : "No disponible"}</strong>
        </div>
        <div className={raspberryAvailable ? "provider-online" : "provider-offline"}>
          <span>Raspberry Shake</span>
          <strong>{raspberryAvailable ? "Operativo" : "Fuera de servicio; usando USGS"}</strong>
        </div>
      </section>

      {data.warning && !usgsAvailable && <div className="warning-banner">{data.warning}</div>}
      {!raspberryAvailable && usgsAvailable && (
        <div className="info-banner">
          Raspberry Shake no está entregando eventos utilizables. RDSISMOS continúa actualizándose con USGS ComCat y su feed de tiempo real.
        </div>
      )}
      {error && <div className="warning-banner">Última actualización fallida: {error}</div>}

      <section className="hero-grid">
        <article className="risk-card">
          <div className="risk-head">
            <div>
              <span className="eyebrow">Pronóstico operacional para {data.target.name}</span>
              <h2>{data.analysis.label}</h2>
            </div>
            <div className="score-ring"><strong>{data.analysis.score}</strong><span>/100</span></div>
          </div>
          <div className="status-pill">{status.tone}</div>
          <p className="risk-summary">{data.analysis.summary}</p>
          <div className="metrics-grid">
            <div><span>Actividad reciente</span><strong>{data.analysis.targetActivityRatio.toFixed(2)}×</strong></div>
            <div><span>Tasa 7 días</span><strong>{data.analysis.recentRatePerDay.toFixed(2)}/día</strong></div>
            <div><span>Cápsulas activas</span><strong>{data.analysis.activeCapsules}</strong></div>
            <div><span>Máxima probabilidad</span><strong>{data.analysis.maxCapsuleProbabilityPct}%</strong></div>
          </div>
        </article>

        <article className="science-card">
          <span className="eyebrow">Base científica</span>
          <h2>ETAS + Omori–Utsu + Gutenberg–Richter</h2>
          <p>
            El modelo trata cada sismo relevante como un evento padre capaz de elevar temporalmente la tasa de eventos cercanos. No crea rutas mundiales arbitrarias.
          </p>
          <ul>{data.analysis.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
        </article>
      </section>

      <section className="projection-section">
        {selectedProjection ? (
          <ProjectionCapsule
            projection={selectedProjection}
            relatedEvents={relatedEvents}
            showRelatedEvents={showRelatedEvents}
            onToggleRelatedEvents={() => {
              setShowRelatedEvents((current) => !current);
              setLayers((current) => ({ ...current, projected: true, preceding: true }));
            }}
          />
        ) : (
          <article className="projection-capsule empty-capsule">
            <span className="eyebrow">Cápsulas ETAS</span>
            <h2>No hay una cápsula activa para {data.target.name}</h2>
            <p>No se identificó un evento padre regional que supere los umbrales actuales.</p>
          </article>
        )}

        <aside className="projection-selector">
          <span className="eyebrow">Cápsulas recientes</span>
          <h2>Evento padre asociado</h2>
          <div className="projection-tabs">
            {data.projections.length ? data.projections.map((projection) => (
              <button
                key={projection.id}
                className={projection.id === selectedProjection?.id ? "active" : ""}
                onClick={() => setSelectedProjectionId(projection.id)}
              >
                <span>M{projection.sourceEvent.magnitude.toFixed(1)} · {projection.sourceEvent.place}</span>
                <strong>{projection.probabilityPct}% · {projectionStatusCopy[projection.status].label}</strong>
              </button>
            )) : <p>No existen cápsulas en la ventana actual.</p>}
          </div>
        </aside>
      </section>

      <section className="map-card">
        <div className="section-heading map-heading">
          <div>
            <span className="eyebrow">Mapa por capas</span>
            <h2>Eventos, fallas, proyecciones y eventos precedentes</h2>
          </div>
          <div className="layer-controls" role="group" aria-label="Capas del mapa">
            {([
              ["occurred", "Eventos ocurridos"],
              ["faults", "Fallas activas"],
              ["projected", "Eventos proyectados"],
              ["preceding", "Eventos precedentes"],
            ] as Array<[keyof MapLayerVisibility, string]>).map(([key, label]) => (
              <button
                key={key}
                className={layers[key] ? "active" : ""}
                onClick={() => toggleLayer(key)}
                aria-pressed={layers[key]}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="legend">
          <span><i className="legend-target-event" /> Evento del país/entorno</span>
          <span><i className="legend-parent" /> Evento precedente</span>
          <span><i className="legend-projection" /> Zona ETAS proyectada</span>
          <span><i className="legend-fault" /> Falla activa GEM</span>
        </div>
        <WorldMap
          key={data.target.code}
          events={data.events}
          target={data.target}
          level={data.analysis.level}
          projections={data.projections}
          selectedProjection={selectedProjection}
          layers={layers}
        />
      </section>

      <section className="panel global-events-panel">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">Panorama mundial</span>
            <h2>Eventos globales recientes</h2>
            <p>Catálogo combinado; USGS permanece como fuente operativa cuando Raspberry Shake no responde.</p>
          </div>
          <div className="panel-filters">
            <label>
              Periodo
              <select value={globalWindowHours} onChange={(event) => setGlobalWindowHours(Number(event.target.value))}>
                <option value={24}>Últimas 24 horas</option>
                <option value={72}>Últimas 72 horas</option>
                <option value={168}>Últimos 7 días</option>
              </select>
            </label>
            <label>
              Magnitud mínima
              <select value={globalMinimumMagnitude} onChange={(event) => setGlobalMinimumMagnitude(Number(event.target.value))}>
                <option value={4.5}>M4.5</option>
                <option value={5}>M5.0</option>
                <option value={5.5}>M5.5</option>
                <option value={6}>M6.0</option>
              </select>
            </label>
          </div>
        </div>
        <div className="global-event-grid">
          {globalEvents.length ? globalEvents.map((event) => (
            <EventRow
              key={`global-${event.source}-${event.id}`}
              event={event}
              label={event.isTargetRegion ? `También pertenece al entorno de ${data.target.name}` : undefined}
            />
          )) : <p>No hay eventos globales para los filtros seleccionados.</p>}
        </div>
      </section>

      <section className="content-grid">
        <article className="panel events-panel">
          <div className="section-heading compact">
            <div>
              <span className="eyebrow">Actividad relevante actualizada</span>
              <h2>Eventos de {data.target.name} y su entorno</h2>
            </div>
            <label>
              Magnitud mínima
              <select value={minimumMagnitude} onChange={(event) => setMinimumMagnitude(Number(event.target.value))}>
                <option value={2}>M2.0</option>
                <option value={2.5}>M2.5</option>
                <option value={3}>M3.0</option>
                <option value={4}>M4.0</option>
                <option value={5}>M5.0</option>
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
          <span className="eyebrow">Trazabilidad</span>
          <h2>Datos y cálculo</h2>
          <ol>{data.analysis.evidence.map((item) => <li key={item}>{item}</li>)}</ol>
          <details>
            <summary>Estado de los proveedores</summary>
            <ul>{data.providerStatus.map((item) => <li key={item}>{item}</li>)}</ul>
          </details>
          <p className="updated-at">Calculado: {formatUtc(data.generatedAt)} UTC</p>
        </article>
      </section>

      <footer>
        Eventos: USGS ComCat/GeoJSON en tiempo real y Raspberry Shake cuando está disponible. Fallas: GEM Global Active Faults Database, CC BY-SA 4.0. El sistema es experimental y no sustituye las comunicaciones de las autoridades sismológicas.
      </footer>
    </main>
  );
}
