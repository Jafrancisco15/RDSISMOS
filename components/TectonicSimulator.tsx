"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EarthquakeEvent, EarthquakePage } from "@/lib/earthquakes/types";
import type { TectonicSimulationWithAnalogs } from "@/lib/tectonicAnalogs";
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

  const run = useCallback(async (input: TectonicSimulationInput) => {
    setLoading(true);
    try {
      const response = await fetch("/api/simulator/tectonic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
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
    void run(toInput(next));
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

  const strongest = useMemo(
    () => simulation?.interactions.slice(0, 8) ?? [],
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
    void run(toInput(draft));
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
          <h1>Simulador de migración e interacción tectónica 3D</h1>
          <p>
            Selecciona un terremoto real reciente y explora cómo su cambio de esfuerzo podría propagarse
            sobre fallas activas y límites de placas. El modo manual queda disponible para escenarios hipotéticos.
          </p>
        </div>
        <div className={styles.modelBadge}>
          <span>Flujo principal</span>
          <strong>Evento real → migración</strong>
          <small>Análogos históricos reales M5.9+</small>
        </div>
      </header>

      <section className={styles.notice}>
        <strong>Interpretación:</strong> el evento elegido es real; la migración posterior es una simulación física simplificada.
        Rojo/rosa indica una geometría receptora relativamente favorecida, azul una sombra relativa y gris un cambio pequeño.
        No significa que una falla vaya a romper ni constituye una alerta sísmica.
      </section>

      <section className={styles.recentSection} aria-label="Sismos reales recientes para simular">
        <div className={styles.recentHeader}>
          <div>
            <span>Sismos reales recientes · M5.9+</span>
            <h2>Escoge el evento fuente</h2>
            <p>Al seleccionar uno se cargan automáticamente epicentro, magnitud y profundidad y se ejecuta la simulación.</p>
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
            <small>Epicentro usado por el simulador</small>
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
              {loading ? "Calculando…" : "Simular migración"}
            </button>
          </div>
          <div className={styles.formGrid}>
            <label>
              <span>Latitud</span>
              <input type="number" min="-90" max="90" step="0.01" value={draft.latitude} onChange={(event) => update("latitude", event.target.value)} />
            </label>
            <label>
              <span>Longitud</span>
              <input type="number" min="-180" max="180" step="0.01" value={draft.longitude} onChange={(event) => update("longitude", event.target.value)} />
            </label>
            <label>
              <span>Magnitud Mw</span>
              <input type="number" min="4" max="9.5" step="0.1" value={draft.magnitude} onChange={(event) => update("magnitude", event.target.value)} />
            </label>
            <label>
              <span>Profundidad km</span>
              <input type="number" min="0" max="700" step="1" value={draft.depthKm} onChange={(event) => update("depthKm", event.target.value)} />
            </label>
            <label>
              <span>Mecanismo</span>
              <select value={draft.mechanism} onChange={(event) => changeMechanism(event.target.value as TectonicMechanism)}>
                <option value="strike-slip">Rumbo / strike-slip</option>
                <option value="reverse">Inversa / cabalgamiento</option>
                <option value="normal">Normal / extensión</option>
              </select>
            </label>
            <label>
              <span>Strike °</span>
              <input type="number" min="0" max="359" step="1" value={draft.strikeDeg} onChange={(event) => update("strikeDeg", event.target.value)} />
            </label>
            <label>
              <span>Dip °</span>
              <input type="number" min="1" max="90" step="1" value={draft.dipDeg} onChange={(event) => update("dipDeg", event.target.value)} />
            </label>
            <label>
              <span>Rake °</span>
              <input type="number" min="-180" max="180" step="1" value={draft.rakeDeg} onChange={(event) => update("rakeDeg", event.target.value)} />
            </label>
          </div>
          <p className={styles.mapHint}>
            El catálogo reciente aporta epicentro, Mw y profundidad. Strike, dip y rake siguen siendo supuestos editables cuando no existe mecanismo focal disponible.
            También puedes tocar el globo para mover el epicentro y convertir el escenario en manual.
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
              <span>Ruptura mediana</span>
              <strong>{simulation.source.ruptureLengthKm.toFixed(0)} × {simulation.source.ruptureWidthKm.toFixed(0)} km</strong>
              <small>{simulation.source.ruptureAreaKm2.toLocaleString()} km²</small>
            </article>
            <article>
              <span>Radio analizado</span>
              <strong>{simulation.source.interactionRadiusKm.toLocaleString()} km</strong>
              <small>Decaimiento estático ~M₀/r³</small>
            </article>
            <article>
              <span>Análogos históricos</span>
              <strong>{simulation.historicalAnalogs?.length ?? 0}</strong>
              <small>Eventos reales M5.9+ · {simulation.historicalCatalog?.provider ?? "USGS"}</small>
            </article>
          </section>

          <section className={styles.visualSection}>
            <div className={styles.visualHeader}>
              <div>
                <span>Respuesta espacial</span>
                <h2>Migración simulada sobre placas y fallas</h2>
              </div>
              <div className={styles.legend}>
                <span><i className={styles.sourceDot} /> Fuente</span>
                <span><i className={styles.promotedDot} /> Favorecida</span>
                <span><i className={styles.inhibitedDot} /> Sombra</span>
                <span><i className={styles.neutralDot} /> Pequeña</span>
                <span><i className={styles.analogDot} /> Histórico M5.9+</span>
              </div>
            </div>
            <div className={styles.visualGrid}>
              <div className={styles.globeWrap}>
                <TectonicSimulatorGlobe simulation={simulation} onPickLocation={pickLocation} sourceEvent={selectedRecent} />
              </div>
              <aside className={styles.sideList}>
                <div className={styles.sideHead}>
                  <div><span>Mayor respuesta</span><strong>{simulation.interactions.length}</strong></div>
                  <small>{simulation.counts.faults} fallas · {simulation.counts.plateBoundaries} límites</small>
                </div>
                {strongest.map((interaction) => (
                  <article key={interaction.id} className={styles.interactionItem} data-state={interaction.stressState}>
                    <div className={styles.itemTop}>
                      <strong>{interaction.name}</strong>
                      <span>{interaction.stressProxyKpa > 0 ? "+" : ""}{interaction.stressProxyKpa.toFixed(1)} kPa</span>
                    </div>
                    <p>{interaction.kind === "active-fault" ? "Falla activa" : "Límite de placa"} · {interaction.distanceKm.toFixed(0)} km</p>
                    <small>{stateLabel(interaction.stressState)} · evidencia {qualityLabel(interaction.evidenceQuality).toLowerCase()}</small>
                  </article>
                ))}
                {!strongest.length && <div className={styles.empty}>No se localizaron estructuras dentro del radio modelado.</div>}
              </aside>
            </div>
          </section>

          <section className={styles.tableSection}>
            <div className={styles.tableHeader}>
              <div>
                <span>Auditoría del escenario</span>
                <h2>Reacción estimada por estructura</h2>
              </div>
              <p>ΔCFS proxy es una aproximación de primer orden; conserva signo y escala relativa, no precisión de ingeniería.</p>
            </div>
            <div className={styles.tableScroll}>
              <table>
                <thead>
                  <tr>
                    <th>Estructura</th>
                    <th>Tipo</th>
                    <th>Distancia</th>
                    <th>Strike receptor</th>
                    <th>Dip / rake</th>
                    <th>ΔCFS proxy</th>
                    <th>Respuesta</th>
                    <th>Calidad</th>
                    <th>Contexto</th>
                  </tr>
                </thead>
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
                <div>
                  <span>Casos comparables reales</span>
                  <h2>Análogos históricos M5.9+</h2>
                </div>
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
              <span>Supuestos del escenario</span>
              <h2>{mechanismLabel(simulation.input.mechanism)} · strike {simulation.input.strikeDeg.toFixed(0)}°</h2>
              <ul>
                {simulation.methodology.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </article>
            <article>
              <span>Limitaciones científicas</span>
              <h2>Qué todavía no debe interpretarse como predicción</h2>
              <ul>
                {simulation.warnings.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </article>
          </section>

          <section className={styles.references}>
            <span>Fundamento científico y geológico</span>
            <div>
              {simulation.sources.map((source) => (
                <article key={source.label}>
                  <strong>{source.label}</strong>
                  <p>{source.citation}</p>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
