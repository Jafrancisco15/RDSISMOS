"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  defaultDipForMechanism,
  defaultRakeForMechanism,
  type TectonicMechanism,
  type TectonicSimulationInput,
  type TectonicSimulationResponse,
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

export function TectonicSimulator() {
  const [draft, setDraft] = useState<DraftInput>(INITIAL);
  const [simulation, setSimulation] = useState<TectonicSimulationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      let payload: (TectonicSimulationResponse & { error?: string }) | null = null;
      try {
        payload = raw ? JSON.parse(raw) as TectonicSimulationResponse & { error?: string } : null;
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

  useEffect(() => {
    void run(toInput(INITIAL));
  }, [run]);

  const strongest = useMemo(
    () => simulation?.interactions.slice(0, 8) ?? [],
    [simulation],
  );

  function update<K extends keyof DraftInput>(key: K, value: DraftInput[K]) {
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
    setDraft(next);
    void run(toInput(next));
  }

  return (
    <main className={styles.dashboard}>
      <header className={styles.header}>
        <div>
          <div className={styles.brand}><span /> RDSISMOS · LABORATORIO FÍSICO</div>
          <h1>Simulador de interacción tectónica 3D</h1>
          <p>
            Explora cómo un sismo hipotético redistribuye, en un modelo elástico simplificado,
            la tendencia de esfuerzo sobre fallas activas y límites de placas cercanos.
          </p>
        </div>
        <div className={styles.modelBadge}>
          <span>Modelo</span>
          <strong>Coulomb-inspired v1</strong>
          <small>No es alerta ni predicción determinista</small>
        </div>
      </header>

      <section className={styles.notice}>
        <strong>Qué significa la simulación:</strong> rojo/rosa indica una geometría receptora relativamente favorecida,
        azul una sombra relativa de esfuerzo y gris un cambio pequeño o ambiguo. Un aumento de esfuerzo no significa que una falla vaya a romper;
        la cercanía real al fallo depende de tensiones previas, presión de poros, geometría 3D y propiedades que no conocemos globalmente.
      </section>

      <section className={styles.controls} aria-label="Parámetros del sismo simulado">
        <div className={styles.controlHeading}>
          <div>
            <span>Evento fuente</span>
            <h2>Define el sismo hipotético</h2>
          </div>
          <button type="button" onClick={simulate} disabled={loading}>
            {loading ? "Calculando…" : "Simular reacción"}
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
        <p className={styles.mapHint}>También puedes tocar cualquier punto del globo para mover el epicentro y recalcular automáticamente.</p>
      </section>

      {error && <div className={styles.error}>{error}</div>}

      {simulation && (
        <>
          <section className={styles.metrics}>
            <article>
              <span>Momento sísmico</span>
              <strong>{simulation.source.seismicMomentNm.toExponential(2)} N·m</strong>
              <small>Mw {simulation.input.magnitude.toFixed(1)}</small>
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
              <span>Estructuras favorecidas</span>
              <strong>{simulation.counts.promoted}</strong>
              <small>{simulation.counts.inhibited} en sombra · {simulation.counts.neutral} pequeñas</small>
            </article>
          </section>

          <section className={styles.visualSection}>
            <div className={styles.visualHeader}>
              <div>
                <span>Respuesta espacial</span>
                <h2>Transferencia estática sobre placas y fallas</h2>
              </div>
              <div className={styles.legend}>
                <span><i className={styles.sourceDot} /> Fuente</span>
                <span><i className={styles.promotedDot} /> Favorecida</span>
                <span><i className={styles.inhibitedDot} /> Sombra</span>
                <span><i className={styles.neutralDot} /> Pequeña</span>
              </div>
            </div>
            <div className={styles.visualGrid}>
              <div className={styles.globeWrap}>
                <TectonicSimulatorGlobe simulation={simulation} onPickLocation={pickLocation} />
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
