"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Scope = "global" | "subduction" | "strike_slip" | "rift_normal" | "collision" | "mixed";

type CalibrationBin = {
  lowerBound: number;
  upperBound: number;
  sampleCount: number;
  averageProbability: number;
  observedRate: number;
  absoluteGap: number;
};

type CalibrationMetrics = {
  sampleCount: number;
  positiveRate: number;
  averageProbability: number;
  calibrationGap?: number;
  brierScore: number;
  logLoss: number;
  accuracyAt50: number;
  majorityClassAccuracy?: number;
  climatologyProbability?: number;
  climatologyBrierScore?: number;
  brierSkillVsClimatology?: number | null;
  rocAuc?: number | null;
  prAuc?: number | null;
  expectedCalibrationError?: number;
  calibrationBins?: CalibrationBin[];
};

type RegimeResult = {
  scope: Scope;
  sampleCount: number;
  trainSampleCount: number;
  embargoedSampleCount?: number;
  testSampleCount: number;
  positiveCount: number;
  negativeCount: number;
  fittedIndependently: boolean;
  fallbackScope: Scope | null;
  rawMetrics: CalibrationMetrics | null;
  calibratedMetrics: CalibrationMetrics | null;
  brierSkillVsRaw: number | null;
};

type LabResult = {
  id: string;
  modelVersionId: string;
  calculatedAt: string;
  persisted: boolean;
  warning?: string;
  configuration: {
    startTime: string;
    endTime: string;
    lookbackDays: number;
    minimumMagnitude: number;
    maxEvents: number;
  };
  eventsAvailable: number;
  eventsLoaded: number;
  samplesBuilt: number;
  sampling: {
    applied: boolean;
    method: string;
    available: number;
    requested: number;
    selected: number;
    regimeCountsAvailable: Partial<Record<Exclude<Scope, "global">, number>>;
    regimeCountsSelected: Partial<Record<Exclude<Scope, "global">, number>>;
  };
  calibration: {
    method: string;
    referenceLabelMethod: string;
    trainFraction: number;
    embargoDays?: number;
    minimumIndependentSamples: number;
    regimes: RegimeResult[];
  };
  interpretation: string[];
};

type ApiResponse = {
  databaseConfigured: boolean;
  databaseConnected: boolean;
  result: LabResult | null;
  warning?: string;
};

const SCOPE_LABELS: Record<Scope, string> = {
  global: "Global",
  subduction: "Subducción",
  strike_slip: "Falla de rumbo",
  rift_normal: "Rift / normal",
  collision: "Colisión",
  mixed: "Mixto",
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function integer(value: number | undefined) {
  return finite(value) ? Math.round(value).toLocaleString("es-DO") : "—";
}

function decimal(value: number | null | undefined, digits = 3) {
  return finite(value) ? value.toFixed(digits) : "—";
}

function percent(value: number | null | undefined, digits = 1) {
  return finite(value) ? `${(value * 100).toFixed(digits)}%` : "—";
}

function signedPercent(value: number | null | undefined, digits = 1) {
  if (!finite(value)) return "—";
  const rendered = `${(value * 100).toFixed(digits)}%`;
  return value > 0 ? `+${rendered}` : rendered;
}

function dateTime(value: string | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function toneFor(regime: RegimeResult) {
  const metrics = regime.calibratedMetrics;
  if (!metrics || !finite(metrics.rocAuc) || !finite(metrics.prAuc)) {
    return { className: "neutral", label: "No evaluable" };
  }
  const skill = metrics.brierSkillVsClimatology;
  const prLift = metrics.positiveRate > 0 ? metrics.prAuc / metrics.positiveRate : 0;
  if (finite(skill) && skill > 0.05 && metrics.rocAuc >= 0.65 && prLift >= 1.15) {
    return { className: "positive", label: "Señal prometedora" };
  }
  if (finite(skill) && skill >= 0 && metrics.rocAuc >= 0.55) {
    return { className: "caution", label: "Evidencia débil" };
  }
  return { className: "negative", label: "Sin habilidad demostrada" };
}

function ReliabilityChart({ metrics }: { metrics: CalibrationMetrics | null }) {
  const bins = metrics?.calibrationBins?.filter((bin) => bin.sampleCount > 0) ?? [];
  if (!bins.length) {
    return (
      <div className="lab-empty-chart">
        La corrida almacenada no contiene intervalos de confiabilidad. Ejecuta nuevamente la calibración v2 para completar esta gráfica.
      </div>
    );
  }

  const width = 680;
  const height = 330;
  const left = 58;
  const right = 22;
  const top = 22;
  const bottom = 50;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (value: number) => left + Math.max(0, Math.min(1, value)) * plotWidth;
  const y = (value: number) => top + (1 - Math.max(0, Math.min(1, value))) * plotHeight;

  return (
    <div className="lab-reliability-wrap">
      <svg className="lab-reliability-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Probabilidad prevista frente a frecuencia observada">
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
          <g key={tick}>
            <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} className="lab-grid-line" />
            <line x1={x(tick)} x2={x(tick)} y1={top} y2={height - bottom} className="lab-grid-line" />
            <text x={left - 10} y={y(tick) + 4} textAnchor="end" className="lab-axis-label">{Math.round(tick * 100)}%</text>
            <text x={x(tick)} y={height - 24} textAnchor="middle" className="lab-axis-label">{Math.round(tick * 100)}%</text>
          </g>
        ))}
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} className="lab-perfect-line" />
        <polyline
          points={bins.map((bin) => `${x(bin.averageProbability)},${y(bin.observedRate)}`).join(" ")}
          className="lab-observed-line"
        />
        {bins.map((bin) => (
          <g key={`${bin.lowerBound}-${bin.upperBound}`}>
            <circle cx={x(bin.averageProbability)} cy={y(bin.observedRate)} r={Math.max(5, Math.min(11, 4 + Math.sqrt(bin.sampleCount) / 2))} className="lab-observed-point" />
            <title>{`${Math.round(bin.lowerBound * 100)}–${Math.round(bin.upperBound * 100)}%: ${bin.sampleCount} casos, previsto ${percent(bin.averageProbability)}, observado ${percent(bin.observedRate)}`}</title>
          </g>
        ))}
        <text x={left + plotWidth / 2} y={height - 3} textAnchor="middle" className="lab-axis-title">Probabilidad prevista</text>
        <text transform={`translate(15 ${top + plotHeight / 2}) rotate(-90)`} textAnchor="middle" className="lab-axis-title">Frecuencia observada</text>
      </svg>
      <div className="lab-chart-legend">
        <span><i className="perfect" /> Calibración perfecta</span>
        <span><i className="observed" /> Resultado observado</span>
      </div>
    </div>
  );
}

export function SequenceCalibrationLabPanel() {
  const [payload, setPayload] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/migration/learning/sequence-calibration", { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as ApiResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? body.warning ?? "No fue posible cargar el laboratorio.");
      setPayload(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible cargar el laboratorio.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const result = payload?.result ?? null;
  const global = useMemo(
    () => result?.calibration.regimes.find((regime) => regime.scope === "global") ?? null,
    [result],
  );
  const calibrated = global?.calibratedMetrics ?? null;
  const raw = global?.rawMetrics ?? null;
  const isV2 = result?.calibration.method === "platt_logistic_by_tectonic_regime_v2";

  if (loading && !payload) {
    return <main className="sequence-lab"><div className="lab-state">Cargando laboratorio técnico…</div></main>;
  }

  if (error) {
    return (
      <main className="sequence-lab">
        <div className="lab-state lab-state-error">
          <strong>No fue posible abrir el laboratorio.</strong>
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>Reintentar</button>
        </div>
      </main>
    );
  }

  if (!result) {
    return (
      <main className="sequence-lab">
        <div className="lab-state">
          <strong>No hay una corrida de calibración almacenada.</strong>
          <span>{payload?.warning ?? "Ejecuta el laboratorio protegido para generar el primer resultado."}</span>
          <button type="button" onClick={() => void load()}>Actualizar</button>
        </div>
      </main>
    );
  }

  const globalTone = global ? toneFor(global) : { className: "neutral", label: "No evaluable" };
  const train = global?.trainSampleCount;
  const test = global?.testSampleCount;
  const embargoed = global?.embargoedSampleCount ?? 0;

  return (
    <main className="sequence-lab">
      <header className="lab-hero">
        <div>
          <div className="lab-kicker"><span /> Investigación aislada</div>
          <h1>Laboratorio técnico</h1>
          <p>
            Calibración del proxy fondo/secuencia por régimen tectónico. Estos resultados no modifican el Mapa 3D, Historial, probabilidades ni estados operacionales.
          </p>
        </div>
        <div className="lab-hero-meta">
          <div className="lab-status-row">
            <span className="lab-pill experimental">Experimental</span>
            <span className="lab-pill isolated">Impacto operacional: ninguno</span>
          </div>
          <span>Última corrida: <strong>{dateTime(result.calculatedAt)}</strong></span>
          <button type="button" onClick={() => void load()} disabled={loading}>{loading ? "Actualizando…" : "Actualizar datos"}</button>
        </div>
      </header>

      {!isV2 && (
        <div className="lab-notice">
          Esta corrida fue creada con la calibración v1. La comparación frente a climatología, ROC-AUC, PR-AUC, embargo temporal y confiabilidad aparecerán al ejecutar nuevamente la versión v2.
        </div>
      )}
      {(payload?.warning || result.warning) && <div className="lab-warning">{payload?.warning ?? result.warning}</div>}

      <section className="lab-summary-grid" aria-label="Resumen de la corrida">
        <article><span>Eventos disponibles</span><strong>{integer(result.eventsAvailable)}</strong><small>Catálogo previo al muestreo</small></article>
        <article><span>Eventos seleccionados</span><strong>{integer(result.eventsLoaded)}</strong><small>{result.sampling.applied ? "Muestra estratificada" : "Cohorte completa"}</small></article>
        <article><span>Entrenamiento</span><strong>{integer(train)}</strong><small>{percent(result.calibration.trainFraction, 0)} cronológico</small></article>
        <article><span>Prueba</span><strong>{integer(test)}</strong><small>{integer(embargoed)} excluidos por embargo</small></article>
        <article><span>Ventana histórica</span><strong>{integer(result.configuration.lookbackDays)} días</strong><small>{dateTime(result.configuration.startTime)} – {dateTime(result.configuration.endTime)}</small></article>
        <article><span>Magnitud mínima</span><strong>M{result.configuration.minimumMagnitude.toFixed(1)}</strong><small>{result.calibration.embargoDays ?? 0} días de embargo</small></article>
      </section>

      <section className="lab-panel lab-global-panel">
        <div className="lab-section-heading">
          <div>
            <span className="lab-eyebrow">Evaluación fuera de muestra</span>
            <h2>Resultado global</h2>
            <p>La calibración corrige el nivel de probabilidad; ROC-AUC y PR-AUC muestran si el score ordena los casos positivos por encima de los negativos.</p>
          </div>
          <span className={`lab-verdict ${globalTone.className}`}>{globalTone.label}</span>
        </div>

        <div className="lab-probability-comparison">
          <article>
            <span>Score crudo promedio</span>
            <strong>{percent(raw?.averageProbability)}</strong>
            <small>Antes de calibración</small>
          </article>
          <div className="lab-comparison-arrow" aria-hidden="true">→</div>
          <article className="calibrated">
            <span>Probabilidad calibrada</span>
            <strong>{percent(calibrated?.averageProbability)}</strong>
            <small>Aplicada al conjunto de prueba</small>
          </article>
          <div className="lab-comparison-arrow" aria-hidden="true">↔</div>
          <article className="observed">
            <span>Tasa observada</span>
            <strong>{percent(calibrated?.positiveRate)}</strong>
            <small>Proxy de referencia</small>
          </article>
        </div>

        <div className="lab-metric-grid">
          <article><span>Brier crudo</span><strong>{decimal(raw?.brierScore)}</strong><small>Menor es mejor</small></article>
          <article><span>Brier calibrado</span><strong>{decimal(calibrated?.brierScore)}</strong><small>Prueba temporal</small></article>
          <article><span>Skill vs. score crudo</span><strong>{signedPercent(global?.brierSkillVsRaw)}</strong><small>Corrección de escala</small></article>
          <article className="primary"><span>Skill vs. climatología</span><strong>{signedPercent(calibrated?.brierSkillVsClimatology)}</strong><small>Prueba de habilidad real</small></article>
          <article><span>ROC-AUC</span><strong>{decimal(calibrated?.rocAuc)}</strong><small>0.5 equivale al azar</small></article>
          <article><span>PR-AUC</span><strong>{decimal(calibrated?.prAuc)}</strong><small>Comparar con {percent(calibrated?.positiveRate)}</small></article>
          <article><span>Error de calibración</span><strong>{percent(calibrated?.expectedCalibrationError)}</strong><small>Brecha ponderada</small></article>
          <article><span>Exactitud / trivial</span><strong>{percent(calibrated?.accuracyAt50)} / {percent(calibrated?.majorityClassAccuracy)}</strong><small>Detecta desbalance</small></article>
        </div>
      </section>

      <section className="lab-panel">
        <div className="lab-section-heading compact">
          <div>
            <span className="lab-eyebrow">Comparación tectónica</span>
            <h2>Resultados por régimen</h2>
          </div>
          <span className="lab-method">{result.calibration.method}</span>
        </div>
        <div className="lab-table-wrap">
          <table className="lab-table">
            <thead>
              <tr>
                <th>Régimen</th>
                <th>Muestra / prueba</th>
                <th>Observado</th>
                <th>Calibrado</th>
                <th>Skill clima</th>
                <th>ROC-AUC</th>
                <th>PR-AUC</th>
                <th>ECE</th>
                <th>Modelo</th>
                <th>Lectura</th>
              </tr>
            </thead>
            <tbody>
              {result.calibration.regimes.map((regime) => {
                const metrics = regime.calibratedMetrics;
                const tone = toneFor(regime);
                return (
                  <tr key={regime.scope}>
                    <td><strong>{SCOPE_LABELS[regime.scope]}</strong></td>
                    <td>{integer(regime.sampleCount)} / {integer(regime.testSampleCount)}</td>
                    <td>{percent(metrics?.positiveRate)}</td>
                    <td>{percent(metrics?.averageProbability)}</td>
                    <td className={finite(metrics?.brierSkillVsClimatology) && metrics!.brierSkillVsClimatology! > 0 ? "metric-positive" : "metric-muted"}>{signedPercent(metrics?.brierSkillVsClimatology)}</td>
                    <td>{decimal(metrics?.rocAuc)}</td>
                    <td>{decimal(metrics?.prAuc)}</td>
                    <td>{percent(metrics?.expectedCalibrationError)}</td>
                    <td>{regime.fittedIndependently ? "Propio" : regime.fallbackScope ? `Fallback ${SCOPE_LABELS[regime.fallbackScope]}` : "—"}</td>
                    <td><span className={`lab-table-status ${tone.className}`}>{tone.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="lab-two-column">
        <article className="lab-panel">
          <div className="lab-section-heading compact">
            <div>
              <span className="lab-eyebrow">Confiabilidad global</span>
              <h2>Previsto vs. observado</h2>
              <p>Los puntos cercanos a la diagonal indican probabilidades bien calibradas. Su tamaño representa la cantidad de casos.</p>
            </div>
          </div>
          <ReliabilityChart metrics={calibrated} />
        </article>

        <article className="lab-panel lab-methodology">
          <div className="lab-section-heading compact">
            <div>
              <span className="lab-eyebrow">Trazabilidad</span>
              <h2>Condiciones de la prueba</h2>
            </div>
          </div>
          <dl>
            <div><dt>Versión del modelo</dt><dd>{result.modelVersionId}</dd></div>
            <div><dt>Etiqueta de referencia</dt><dd>{result.calibration.referenceLabelMethod}</dd></div>
            <div><dt>Método de muestra</dt><dd>{result.sampling.method}</dd></div>
            <div><dt>Persistido</dt><dd>{result.persisted ? "Sí" : "No"}</dd></div>
            <div><dt>ID de corrida</dt><dd><code>{result.id}</code></dd></div>
          </dl>
          <div className="lab-interpretation">
            {result.interpretation.map((item) => <p key={item}>{item}</p>)}
          </div>
        </article>
      </section>
    </main>
  );
}
