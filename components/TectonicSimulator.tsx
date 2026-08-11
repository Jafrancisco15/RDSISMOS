"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EarthScopeTravelTime } from "@/lib/earthscopeIntegration";
import type { EarthquakeEvent, EarthquakePage } from "@/lib/earthquakes/types";
import type { TectonicSimulationWithAnalogs } from "@/lib/tectonicAnalogs";
import type { GlobalDistanceBand } from "@/lib/tectonicGlobal";
import {
  defaultDipForMechanism,
  defaultRakeForMechanism,
  type TectonicMechanism,
  type TectonicSimulationInput,
} from "@/lib/tectonicSimulator";
import styles from "./TectonicSimulator.module.css";

const TectonicSimulatorGlobe = dynamic(
  () => import("./TectonicSimulatorGlobe").then((module) => module.TectonicSimulatorGlobe),
  { ssr: false, loading: () => <div className={styles.loading}>Inicializando simulador WebGL…</div> },
);

interface DraftInput {
  latitude: string;
  longitude: string;
  magnitude: string;
  depthKm: string;
  mechanism: TectonicMechanism;
  strikeDeg: string;
  dipDeg: string;
  rakeDeg: string;
}

type RecentDays = 7 | 30 | 90 | 365;

const INITIAL: DraftInput = {
  latitude: "18.50",
  longitude: "-69.50",
  magnitude: "6.5",
  depthKm: "15",
  mechanism: "strike-slip",
  strikeDeg: "90",
  dipDeg: "90",
  rakeDeg: "0",
};

function numeric(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInput(draft: DraftInput): TectonicSimulationInput {
  return {
    latitude: numeric(draft.latitude, 18.5),
    longitude: numeric(draft.longitude, -69.5),
    magnitude: numeric(draft.magnitude, 6.5),
    depthKm: numeric(draft.depthKm, 15),
    mechanism: draft.mechanism,
    strikeDeg: numeric(draft.strikeDeg, 90),
    dipDeg: numeric(draft.dipDeg, defaultDipForMechanism(draft.mechanism)),
    rakeDeg: numeric(draft.rakeDeg, defaultRakeForMechanism(draft.mechanism)),
  };
}

function stateLabel(state: "promoted" | "inhibited" | "neutral") {
  if (state === "promoted") return "Favorecida";
  if (state === "inhibited") return "Sombra relativa";
  return "Cambio pequeño";
}

function qualityLabel(quality: "high" | "medium" | "low") {
  if (quality === "high") return "Alta";
  if (quality === "medium") return "Media";
  return "Baja";
}

function mechanismLabel(mechanism: TectonicMechanism) {
  if (mechanism === "reverse") return "Inversa / cabalgamiento";
  if (mechanism === "normal") return "Normal / extensión";
  return "Rumbo / strike-slip";
}

function distanceBandLabel(band: GlobalDistanceBand) {
  if (band === "teleseismic") return "Teleseísmica";
  if (band === "regional") return "Regional";
  return "Cercana";
}

function globalBandColor(band: GlobalDistanceBand) {
  if (band === "teleseismic") return "#c084fc";
  if (band === "regional") return "#2dd4bf";
  return "#a3e635";
}

function formatEventDate(value: string, withTime = false) {
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const } : {}),
    timeZone: "UTC",
  }).format(new Date(value));
}

function startDateFor(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function closestTravelTime(distanceKm: number, samples: EarthScopeTravelTime[]) {
  return samples.reduce<EarthScopeTravelTime | null>((best, sample) => {
    if (!best) return sample;
    return Math.abs(sample.distanceKm - distanceKm) < Math.abs(best.distanceKm - distanceKm)
      ? sample
      : best;
  }, null);
}

function minutes(value: number | null) {
  return value === null ? "—" : `${value.toFixed(value < 10 ? 1 : 0)} min`;
}

export function TectonicSimulator() {
  const [draft, setDraft] = useState<DraftInput>(INITIAL);
  const [simulation, setSimulation] = useState<TectonicSimulationWithAnalogs | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentEvents, setRecentEvents] = useState<EarthquakeEvent[]>([]);
  const [recentDays, setRecentDays] = useState<RecentDays>(90);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [selectedRecent, setSelectedRecent] = useState<EarthquakeEvent | null>(null);

  const run = useCallback(async (input: TectonicSimulationInput, sourceEvent?: EarthquakeEvent | null) => {
    setLoading(true);
    try {
      const body = {
        ...input,
        sourceEvent: sourceEvent ? {
          id: sourceEvent.externalId || sourceEvent.id,
          timeUtc: sourceEvent.timeUtc,
          place: sourceEvent.place,
          sourceCatalog: sourceEvent.sourceCatalog,
          sourceUrl: sourceEvent.sourceUrl,
        } : undefined,
      };
      const response = await fetch("/api/simulator/tectonic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      const raw = await response.text();
      let payload: (TectonicSimulationWithAnalogs & { error?: string }) | null = null;
      try {
        payload = raw ? JSON.parse(raw) as TectonicSimulationWithAnalogs & { error?: string } : null;
      } catch {
        throw new Error(raw || `HTTP ${response.status}`);
      }
      if (!response.ok || !payload) throw new Error(payload?.error ?? `HTTP ${response.status}`);
      setSimulation(payload);
      setError(null);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "No fue posible ejecutar la simulación.");
    } finally {
      setLoading(false);
    }
  }, []);

  const selectRecentEvent = useCallback((event: EarthquakeEvent) => {
    const next: DraftInput = {
      ...INITIAL,
      latitude: event.latitude.toFixed(4),
      longitude: event.longitude.toFixed(4),
      magnitude: event.magnitude.toFixed(1),
      depthKm: event.depthKm.toFixed(1),
    };
    setSelectedRecent(event);
    setDraft(next);
    void run(toInput(next), event);
  }, [run]);

  const loadRecent = useCallback(async (days: RecentDays, autoSelect = false) => {
    setRecentLoading(true);
    setRecentError(null);
    try {
      const params = new URLSearchParams({
        starttime: startDateFor(days),
        endtime: new Date().toISOString().slice(0, 10),
        minmagnitude: "5.9",
        eventtype: "earthquake",
        orderby: "time",
        limit: "100",
      });
      const response = await fetch(`/api/earthquakes?${params}`, { cache: "no-store" });
      const raw = await response.text();
      let payload: (EarthquakePage & { error?: string }) | null = null;
      try {
        payload = raw ? JSON.parse(raw) as EarthquakePage & { error?: string } : null;
      } catch {
        throw new Error(raw || `HTTP ${response.status}`);
      }
      if (!response.ok || !payload) throw new Error(payload?.error ?? `HTTP ${response.status}`);
      setRecentEvents(payload.events);
      if (autoSelect && payload.events.length > 0) selectRecentEvent(payload.events[0]);
      if (autoSelect && payload.events.length === 0) void run(toInput(INITIAL));
    } catch (loadError) {
      setRecentError(loadError instanceof Error ? loadError.message : "No fue posible cargar los sismos recientes.");
      if (autoSelect) void run(toInput(INITIAL));
    } finally {
      setRecentLoading(false);
    }
  }, [run, selectRecentEvent]);

  useEffect(() => {
    void loadRecent(90, true);
  }, [loadRecent]);

  const strongestStatic = useMemo(
    () => simulation?.interactions.slice(0, 6) ?? [],
    [simulation],
  );
  const strongestGlobal = useMemo(
    () => simulation?.globalTectonics.interactions
      .filter((interaction) => interaction.distanceBand !== "near")
      .slice(0, 8) ?? [],
    [simulation],
  );
  const highestEnergy = useMemo(
    () => simulation?.globalTectonics.interactions.reduce((best, item) => (
      !best || item.energyArrivalIndex > best.energyArrivalIndex ? item : best
    ), simulation.globalTectonics.interactions[0] ?? null) ?? null,
    [simulation],
  );
  const highestSusceptibility = useMemo(
    () => simulation?.globalTectonics.interactions.reduce((best, item) => (
      !best || item.susceptibilityIndex > best.susceptibilityIndex ? item : best
    ), simulation.globalTectonics.interactions[0] ?? null) ?? null,
    [simulation],
  );
  const highestPotential = useMemo(
    () => simulation?.globalTectonics.interactions[0] ?? null,
    [simulation],
  );

  function update<K extends keyof DraftInput>(key: K, value: DraftInput[K]) {
    if (["latitude", "longitude", "magnitude", "depthKm"].includes(key)) setSelectedRecent(null);
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function changeMechanism(next: TectonicMechanism) {
    setDraft((current) => ({
      ...current,
      mechanism: next,
      dipDeg: String(defaultDipForMechanism(next)),
      rakeDeg: String(defaultRakeForMechanism(next)),
    }));
  }

  function simulate() {
    void run(toInput(draft), selectedRecent);
  }

  function pickLocation(latitude: number, longitude: number) {
    const next = {
      ...draft,
      latitude: latitude.toFixed(3),
      longitude: longitude.toFixed(3),
    };
    setSelectedRecent(null);
    setDraft(next);
    void run(toInput(next));
  }

  function changeRecentRange(days: RecentDays) {
    setRecentDays(days);
    void loadRecent(days, false);
  }

  return (
    <main className={styles.dashboard}>
      <header className={styles.header}>
        <div>
          <div className={styles.brand}><span /> RDSISMOS · LABORATORIO FÍSICO</div>
          <h1>Simulador global de ondas, placas y fallas</h1>
          <p>
            Selecciona un terremoto real reciente y separa cuatro fenómenos: transferencia estática de Coulomb cerca de la ruptura,
            energía de las ondas que llega a cada estructura, susceptibilidad tectónica del receptor y respuesta potencial al combinar ambas.
          </p>
        </div>
        <div className={styles.modelBadge}>
          <span>Modelo multicapas</span>
          <strong>Coulomb + ondas + susceptibilidad</strong>
          <small>EarthScope NSF SAGE · USGS · GEM · PB2002</small>
        </div>
      </header>

      <section className={styles.notice}>
        <strong>Separación física:</strong> que una onda llegue a una falla no significa que la falla responda. La capa de energía estima la perturbación que alcanza el receptor;
        la susceptibilidad es un proxy independiente de entorno tectónico, orientación y metadata; la respuesta potencial combina ambos. Ninguno de esos índices es probabilidad de ruptura.
      </section>

      <section className={styles.recentSection} aria-label="Sismos reales recientes para simular">
        <div className={styles.recentHeader}>
          <div>
            <span>Sismos reales recientes · M5.9+</span>
            <h2>Escoge el evento fuente</h2>
            <p>Epicentro, magnitud y profundidad se cargan automáticamente. Para eventos reales también intentamos incorporar metadatos y tiempos de viaje de EarthScope.</p>
          </div>
          <div className={styles.rangeButtons} aria-label="Rango de eventos recientes">
            {([7, 30, 90, 365] as RecentDays[]).map((days) => (
              <button
                type="button"
                key={days}
                className={recentDays === days ? styles.activeRange : ""}
                onClick={() => changeRecentRange(days)}
                disabled={recentLoading}
              >
                {days === 365 ? "1 año" : `${days} días`}
              </button>
            ))}
            <button type="button" onClick={() => void loadRecent(recentDays, false)} disabled={recentLoading}>
              {recentLoading ? "Cargando…" : "Actualizar"}
            </button>
          </div>
        </div>

        {recentError && <div className={styles.inlineWarning}>{recentError}</div>}
        <div className={styles.recentList}>
          {recentEvents.map((event) => (
            <button
              type="button"
              key={event.id}
              className={selectedRecent?.id === event.id ? styles.selectedRecent : ""}
              onClick={() => selectRecentEvent(event)}
            >
              <strong>M{event.magnitude.toFixed(1)}</strong>
              <span>{event.place}</span>
              <small>{formatEventDate(event.timeUtc, true)} UTC · {event.depthKm.toFixed(0)} km</small>
            </button>
          ))}
          {!recentLoading && recentEvents.length === 0 && (
            <div className={styles.empty}>No se encontraron eventos M5.9+ en este rango. Amplía el periodo o usa el modo manual.</div>
          )}
        </div>
      </section>

      {selectedRecent && (
        <section className={styles.selectedSource}>
          <div>
            <span>Fuente real seleccionada</span>
            <h2>M{selectedRecent.magnitude.toFixed(1)} · {selectedRecent.place}</h2>
            <p>{formatEventDate(selectedRecent.timeUtc, true)} UTC · profundidad {selectedRecent.depthKm.toFixed(1)} km · {selectedRecent.sourceCatalog}</p>
          </div>
          <div>
            <strong>{selectedRecent.latitude.toFixed(3)}°, {selectedRecent.longitude.toFixed(3)}°</strong>
            <small>Hipocentro/epicentro de referencia para ondas y tectónica</small>
          </div>
        </section>
      )}

      <details className={styles.manualDetails} open={!selectedRecent}>
        <summary>Parámetros del evento y modo manual</summary>
        <section className={styles.controls} aria-label="Parámetros del sismo simulado">
          <div className={styles.controlHeading}>
            <div>
              <span>{selectedRecent ? "Geometría focal / supuestos" : "Escenario manual"}</span>
              <h2>{selectedRecent ? "Ajusta el mecanismo si lo conoces" : "Define un sismo hipotético"}</h2>
            </div>
            <button type="button" onClick={simulate} disabled={loading}>
              {loading ? "Calculando…" : "Simular interacción"}
            </button>
          </div>
          <div className={styles.formGrid}>
            <label><span>Latitud</span><input type="number" min="-90" max="90" step="0.01" value={draft.latitude} onChange={(event) => update("latitude", event.target.value)} /></label>
            <label><span>Longitud</span><input type="number" min="-180" max="180" step="0.01" value={draft.longitude} onChange={(event) => update("longitude", event.target.value)} /></label>
            <label><span>Magnitud Mw</span><input type="number" min="4" max="9.5" step="0.1" value={draft.magnitude} onChange={(event) => update("magnitude", event.target.value)} /></label>
            <label><span>Profundidad km</span><input type="number" min="0" max="700" step="1" value={draft.depthKm} onChange={(event) => update("depthKm", event.target.value)} /></label>
            <label>
              <span>Mecanismo</span>
              <select value={draft.mechanism} onChange={(event) => changeMechanism(event.target.value as TectonicMechanism)}>
                <option value="strike-slip">Rumbo / strike-slip</option>
                <option value="reverse">Inversa / cabalgamiento</option>
                <option value="normal">Normal / extensión</option>
              </select>
            </label>
            <label><span>Strike °</span><input type="number" min="0" max="359" step="1" value={draft.strikeDeg} onChange={(event) => update("strikeDeg", event.target.value)} /></label>
            <label><span>Dip °</span><input type="number" min="1" max="90" step="1" value={draft.dipDeg} onChange={(event) => update("dipDeg", event.target.value)} /></label>
            <label><span>Rake °</span><input type="number" min="-180" max="180" step="1" value={draft.rakeDeg} onChange={(event) => update("rakeDeg", event.target.value)} /></label>
          </div>
          <p className={styles.mapHint}>
            El catálogo reciente aporta epicentro, Mw y profundidad. Strike, dip y rake siguen siendo supuestos editables cuando no existe mecanismo focal disponible.
            Tocar el globo mueve el epicentro y convierte el escenario en manual.
          </p>
        </section>
      </details>

      {error && <div className={styles.error}>{error}</div>}

      {simulation && (
        <>
          <section className={styles.metrics}>
            <article>
              <span>Evento fuente</span>
              <strong>{selectedRecent ? `Real · M${simulation.input.magnitude.toFixed(1)}` : `Manual · M${simulation.input.magnitude.toFixed(1)}`}</strong>
              <small>{selectedRecent ? selectedRecent.place : "Escenario definido por el usuario"}</small>
            </article>
            <article>
              <span>Alcance Coulomb local</span>
              <strong>{simulation.source.interactionRadiusKm.toLocaleString()} km</strong>
              <small>Transferencia estática ~M₀/r³ · no es alcance de las ondas</small>
            </article>
            <article>
              <span>EarthScope directo</span>
              <strong>{simulation.earthScope.available ? `${simulation.earthScope.stations.length} estaciones` : "No disponible"}</strong>
              <small>Tiempos P/S {simulation.earthScope.travelTimeModel} · metadata FDSN</small>
            </article>
            <article>
              <span>Análogos históricos</span>
              <strong>{simulation.historicalAnalogs?.length ?? 0}</strong>
              <small>Eventos reales M5.9+ · {simulation.historicalCatalog?.provider ?? "USGS"}</small>
            </article>
          </section>

          <section className={styles.metrics} aria-label="Tres capas de respuesta dinámica">
            <article>
              <span>1 · Energía de llegada</span>
              <strong>{highestEnergy ? `${highestEnergy.energyArrivalIndex}/100` : "—"}</strong>
              <small>{highestEnergy ? `${highestEnergy.name} · perturbación relativa de onda` : "Sin receptor resuelto"}</small>
            </article>
            <article>
              <span>2 · Susceptibilidad tectónica</span>
              <strong>{highestSusceptibility ? `${highestSusceptibility.susceptibilityIndex}/100` : "—"}</strong>
              <small>{highestSusceptibility ? `${highestSusceptibility.name} · proxy del receptor` : "Sin receptor resuelto"}</small>
            </article>
            <article>
              <span>3 · Respuesta potencial</span>
              <strong>{highestPotential ? `${highestPotential.potentialResponseIndex}/100` : "—"}</strong>
              <small>{highestPotential ? `${highestPotential.name} · energía × susceptibilidad` : "Sin receptor resuelto"}</small>
            </article>
            <article>
              <span>Potencial elevado</span>
              <strong>{simulation.globalTectonics.counts.elevatedPotential}</strong>
              <small>Estructuras ≥35/100; no significa 35% de probabilidad</small>
            </article>
          </section>

          <section className={styles.visualSection}>
            <div className={styles.visualHeader}>
              <div>
                <span>Propagación + receptor + respuesta</span>
                <h2>La onda llega; la estructura decide cuánto podría responder</h2>
              </div>
              <div className={styles.legend}>
                <span><i className={styles.sourceDot} /> Fuente</span>
                <span><i className={styles.wavePDot} /> P</span>
                <span><i className={styles.waveSDot} /> S</span>
                <span><i className={styles.waveSurfaceDot} /> Superficie</span>
                <span><i className={styles.stationDot} /> EarthScope</span>
                <span><i className={styles.promotedDot} /> Coulomb +</span>
                <span><i className={styles.inhibitedDot} /> Coulomb −</span>
              </div>
            </div>
            <div className={styles.visualGrid}>
              <div className={styles.globeWrap}>
                <TectonicSimulatorGlobe simulation={simulation} onPickLocation={pickLocation} sourceEvent={selectedRecent} />
              </div>
              <aside className={styles.sideList}>
                <div className={styles.sideHead}>
                  <div><span>Estructuras remotas</span><strong>{strongestGlobal.length}</strong></div>
                  <small>Ordenadas por respuesta potencial, no por conectividad de placas.</small>
                </div>
                {strongestGlobal.map((interaction) => {
                  const travel = closestTravelTime(interaction.distanceKm, simulation.earthScope.travelTimes);
                  return (
                    <article
                      key={interaction.id}
                      className={styles.interactionItem}
                      style={{ borderLeftColor: globalBandColor(interaction.distanceBand) }}
                    >
                      <div className={styles.itemTop}>
                        <strong>{interaction.name}</strong>
                        <span>{interaction.potentialResponseIndex}/100</span>
                      </div>
                      <p>{distanceBandLabel(interaction.distanceBand)} · {interaction.distanceKm.toFixed(0)} km</p>
                      <small>
                        P {minutes(travel?.pMinutes ?? null)} · S {minutes(travel?.sMinutes ?? null)} · superficie ~{minutes(travel?.surfaceMinutes ?? interaction.arrivalMinutes)}
                      </small>
                      <small>
                        Energía {interaction.energyArrivalIndex}/100 · susceptibilidad {interaction.susceptibilityIndex}/100 · potencial {interaction.potentialResponseIndex}/100
                      </small>
                      <small>
                        Entorno {interaction.susceptibilityComponents.environmentPrior}/100 · geometría {interaction.susceptibilityComponents.geometryCoupling}/100 · soporte metadata {interaction.susceptibilityComponents.metadataSupport}/100
                      </small>
                      <small>
                        {interaction.connectivityHops === null ? "Contexto de placa no resuelto" : `${interaction.connectivityHops} saltos tectónicos (solo contexto)`}
                      </small>
                    </article>
                  );
                })}
                <div className={styles.sideHead} style={{ position: "static", marginTop: 8 }}>
                  <div><span>Coulomb local</span><strong>{simulation.interactions.length}</strong></div>
                  <small>{simulation.counts.faults} fallas · {simulation.counts.plateBoundaries} límites</small>
                </div>
                {strongestStatic.map((interaction) => (
                  <article key={interaction.id} className={styles.interactionItem} data-state={interaction.stressState}>
                    <div className={styles.itemTop}>
                      <strong>{interaction.name}</strong>
                      <span>{interaction.stressProxyKpa > 0 ? "+" : ""}{interaction.stressProxyKpa.toFixed(1)} kPa</span>
                    </div>
                    <p>{interaction.kind === "active-fault" ? "Falla activa" : "Límite de placa"} · {interaction.distanceKm.toFixed(0)} km</p>
                    <small>{stateLabel(interaction.stressState)} · evidencia {qualityLabel(interaction.evidenceQuality).toLowerCase()}</small>
                  </article>
                ))}
              </aside>
            </div>
          </section>

          <section className={`${styles.tableSection} ${styles.earthScopeSection}`}>
            <div className={styles.tableHeader}>
              <div>
                <span>EarthScope NSF SAGE</span>
                <h2>Observación instrumental y tiempos de viaje</h2>
              </div>
              <p>Las estaciones vienen del servicio FDSN de EarthScope. Los tiempos P/S se calculan directamente con su servicio traveltime usando el modelo iasp91.</p>
            </div>

            <div className={styles.earthScopeSummary}>
              <article>
                <span>Estaciones mostradas</span>
                <strong>{simulation.earthScope.stations.length}</strong>
                <small>Muestra espacial de metadata activa alrededor del evento.</small>
              </article>
              <article>
                <span>Modelo de tiempos</span>
                <strong>{simulation.earthScope.travelTimeModel}</strong>
                <small>P y S EarthScope/TauP · superficie como referencia 3.6 km/s.</small>
              </article>
              <article>
                <span>Producto EarthScope</span>
                <strong>{simulation.earthScope.products.gmvUrl ? "GMV disponible" : simulation.earthScope.products.eventPageUrl ? "Página del evento" : "Sin producto localizado"}</strong>
                <small>Los productos dependen de que EarthScope haya publicado el evento.</small>
              </article>
            </div>

            {(simulation.earthScope.products.eventPageUrl || simulation.earthScope.products.gmvUrl || simulation.earthScope.products.dataAccessUrl) && (
              <div className={styles.earthScopeLinks}>
                {simulation.earthScope.products.eventPageUrl && <a href={simulation.earthScope.products.eventPageUrl} target="_blank" rel="noreferrer">Evento en EarthScope</a>}
                {simulation.earthScope.products.gmvUrl && <a href={simulation.earthScope.products.gmvUrl} target="_blank" rel="noreferrer">Ground Motion Visualization</a>}
                {simulation.earthScope.products.dataAccessUrl && <a href={simulation.earthScope.products.dataAccessUrl} target="_blank" rel="noreferrer">Datos GNSS/sísmicos EarthScope</a>}
              </div>
            )}

            <div className={styles.tableScroll}>
              <table>
                <thead><tr><th>Distancia</th><th>Fase P</th><th>Fase S</th><th>Onda superficial</th><th>Fuente</th></tr></thead>
                <tbody>
                  {simulation.earthScope.travelTimes.slice(0, 24).map((sample) => (
                    <tr key={`earthscope-time:${sample.distanceKm}`}>
                      <td>{sample.distanceKm.toLocaleString()} km · {sample.distanceDeg.toFixed(1)}°</td>
                      <td>{minutes(sample.pMinutes)}</td>
                      <td>{minutes(sample.sMinutes)}</td>
                      <td>~{minutes(sample.surfaceMinutes)}</td>
                      <td>EarthScope traveltime / iasp91</td>
                    </tr>
                  ))}
                  {!simulation.earthScope.travelTimes.length && <tr><td colSpan={5}>EarthScope no devolvió tiempos de viaje para este escenario.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className={styles.mapHint}>Los puntos de estación en el globo son ubicaciones reales de metadata EarthScope. En modo OBSERVADO el globo puede descargar formas de onda reales cuando están disponibles.</p>
            {simulation.earthScope.warnings.length > 0 && <div className={styles.inlineWarning}>{simulation.earthScope.warnings.join(" · ")}</div>}
          </section>

          <section className={styles.tableSection}>
            <div className={styles.tableHeader}>
              <div>
                <span>Interacción mundial</span>
                <h2>Energía de onda → susceptibilidad → respuesta potencial</h2>
              </div>
              <p>La energía se propaga por la Tierra independientemente de los bordes de placa. La susceptibilidad pertenece al receptor y no representa su esfuerzo acumulado real.</p>
            </div>
            <div className={styles.tableScroll}>
              <table>
                <thead>
                  <tr>
                    <th>Estructura</th><th>Escala</th><th>Distancia</th><th>P EarthScope</th><th>S EarthScope</th><th>Superficie</th><th>Energía llegada</th><th>Susceptibilidad</th><th>Respuesta potencial</th><th>Base susceptibilidad</th><th>Contexto de placas</th><th>Tipo receptor</th>
                  </tr>
                </thead>
                <tbody>
                  {simulation.globalTectonics.interactions.map((interaction) => {
                    const travel = closestTravelTime(interaction.distanceKm, simulation.earthScope.travelTimes);
                    return (
                      <tr key={`global-row:${interaction.id}`}>
                        <td><strong>{interaction.name}</strong></td>
                        <td style={{ color: globalBandColor(interaction.distanceBand) }}>{distanceBandLabel(interaction.distanceBand)}</td>
                        <td>{interaction.distanceKm.toFixed(0)} km</td>
                        <td>{minutes(travel?.pMinutes ?? null)}</td>
                        <td>{minutes(travel?.sMinutes ?? null)}</td>
                        <td>~{minutes(travel?.surfaceMinutes ?? interaction.arrivalMinutes)}</td>
                        <td>{interaction.energyArrivalIndex}/100</td>
                        <td>{interaction.susceptibilityIndex}/100</td>
                        <td><strong>{interaction.potentialResponseIndex}/100</strong></td>
                        <td>entorno {interaction.susceptibilityComponents.environmentPrior} · geometría {interaction.susceptibilityComponents.geometryCoupling} · metadata {interaction.susceptibilityComponents.metadataSupport}</td>
                        <td>{interaction.connectivityHops === null ? "—" : `${interaction.connectivityHops} saltos (solo contexto)`}</td>
                        <td>{interaction.plateA && interaction.plateB
                          ? `${interaction.plateA} ↔ ${interaction.plateB}${interaction.boundaryType ? ` · ${interaction.boundaryType}` : ""}`
                          : interaction.kind === "active-fault"
                            ? `${interaction.slipType || "Falla activa GEM"}${interaction.activityConfidence !== null && interaction.activityConfidence !== undefined ? " · metadata actividad" : ""}`
                            : "PB2002"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className={styles.mapHint}>Respuesta potencial = energía de llegada × susceptibilidad tectónica proxy. Un 40/100 no significa 40% de probabilidad de terremoto; solo compara estructuras dentro de este escenario.</p>
          </section>

          <section className={styles.tableSection}>
            <div className={styles.tableHeader}>
              <div><span>Campo cercano</span><h2>Transferencia estática de Coulomb</h2></div>
              <p>ΔCFS proxy conserva signo y escala relativa solo cerca/regionalmente; no se extrapola como cambio estático hasta el otro lado del planeta.</p>
            </div>
            <div className={styles.tableScroll}>
              <table>
                <thead><tr><th>Estructura</th><th>Tipo</th><th>Distancia</th><th>Strike receptor</th><th>Dip / rake</th><th>ΔCFS proxy</th><th>Respuesta</th><th>Calidad</th><th>Contexto</th></tr></thead>
                <tbody>
                  {simulation.interactions.map((interaction) => (
                    <tr key={`row:${interaction.id}`}>
                      <td><strong>{interaction.name}</strong></td>
                      <td>{interaction.kind === "active-fault" ? interaction.metadata.slipType || "Falla activa" : interaction.metadata.boundaryType || "Límite de placa"}</td>
                      <td>{interaction.distanceKm.toFixed(0)} km</td>
                      <td>{interaction.strikeDeg.toFixed(0)}°</td>
                      <td>{interaction.receiverDipDeg.toFixed(0)}° / {interaction.receiverRakeDeg.toFixed(0)}°</td>
                      <td className={styles.stressValue} data-state={interaction.stressState}>{interaction.stressProxyKpa > 0 ? "+" : ""}{interaction.stressProxyKpa.toFixed(1)} kPa</td>
                      <td>{stateLabel(interaction.stressState)}</td>
                      <td>{qualityLabel(interaction.evidenceQuality)}</td>
                      <td>{interaction.metadata.plateA && interaction.metadata.plateB
                        ? `${interaction.metadata.plateA} ↔ ${interaction.metadata.plateB}`
                        : interaction.metadata.reference || interaction.interpretation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {(simulation.historicalAnalogs?.length ?? 0) > 0 && (
            <section className={styles.tableSection}>
              <div className={styles.tableHeader}>
                <div><span>Casos comparables reales</span><h2>Análogos históricos M5.9+</h2></div>
                <p>Se ordenan por similitud de magnitud, profundidad y cercanía al entorno tectónico del evento fuente.</p>
              </div>
              <div className={styles.analogGrid}>
                {simulation.historicalAnalogs.slice(0, 12).map((analog) => (
                  <article key={analog.id}>
                    <div><strong>M{analog.magnitude.toFixed(1)}</strong><span>{analog.similarityScore}% similar</span></div>
                    <h3>{analog.place}</h3>
                    <p>{formatEventDate(analog.timeUtc)} · {analog.depthKm.toFixed(0)} km · {analog.distanceKm.toFixed(0)} km del evento fuente</p>
                    <small>{analog.similarityReasons.join(" · ")}</small>
                  </article>
                ))}
              </div>
            </section>
          )}

          <section className={styles.scienceGrid}>
            <article>
              <span>Modelo multiescala</span>
              <h2>{mechanismLabel(simulation.input.mechanism)} · ondas + receptor + respuesta</h2>
              <ul>
                <li>{simulation.globalTectonics.model.description}</li>
                <li>La energía de llegada usa magnitud, distancia, profundidad y radiación como proxy relativo. Para eventos reales, las formas de onda EarthScope son la observación instrumental y no se sustituyen por este índice.</li>
                <li>La susceptibilidad usa un prior amplio de ambiente tectónico, acoplamiento geométrico y soporte de metadata GEM/PB2002. No conoce el estado crítico real de la falla.</li>
                <li>La respuesta potencial multiplica energía × susceptibilidad, por lo que una onda fuerte sobre un receptor poco susceptible o una onda débil sobre uno susceptible siguen produciendo un valor moderado/bajo.</li>
                <li>Las llegadas P y S se consultan al servicio EarthScope traveltime con un modelo terrestre 1-D iasp91; la animación del globo está acelerada y no corre a escala temporal real.</li>
                <li>Las ondas superficiales usan {simulation.globalTectonics.model.surfaceWaveSpeedKmS.toFixed(1)} km/s solo como referencia visual; no reconstruyen una forma de onda.</li>
                <li>PB2002 se conserva como grafo para explicar qué placas bordean cada estructura. Ese número de saltos no aumenta ni disminuye la energía ni la respuesta potencial.</li>
                {simulation.methodology.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </article>
            <article>
              <span>Limitaciones científicas</span>
              <h2>Propagación no significa disparo</h2>
              <ul>
                {simulation.globalTectonics.warnings.map((item) => <li key={`global-${item}`}>{item}</li>)}
                {simulation.warnings.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </article>
          </section>

          <section className={styles.references}>
            <span>Fundamento científico y geológico</span>
            <div>
              {simulation.sources.map((source) => (
                <article key={source.label}><strong>{source.label}</strong><p>{source.citation}</p></article>
              ))}
              <article><strong>EarthScope NSF SAGE</strong><p>FDSN Station para metadata instrumental y IRISWS traveltime para tiempos de viaje P/S en modelos 1-D como iasp91.</p></article>
              <article><strong>EarthScope GMV</strong><p>Las Ground Motion Visualizations muestran movimiento registrado por estaciones mientras las ondas viajan por el interior y la superficie terrestre.</p></article>
              <article><strong>Hill & Prejean · USGS</strong><p>Dynamic triggering: esfuerzos transitorios de ondas sísmicas pueden disparar sismicidad remota bajo condiciones susceptibles; el entorno tectónico y los fluidos pueden influir.</p></article>
              <article><strong>Hill (2008) · USGS</strong><p>La orientación y el régimen tectónico afectan cómo un receptor responde al esfuerzo dinámico; no existe un umbral universal que permita conocer la ruptura.</p></article>
              <article><strong>Velasco et al. (2008)</strong><p>Global ubiquity of dynamic earthquake triggering: evidencia de disparo remoto por ondas de grandes terremotos.</p></article>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
