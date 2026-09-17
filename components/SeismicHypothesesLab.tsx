"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  DynamicTriggeringResult,
  HypothesisVerdict,
  IntraplateRelaxationResult,
  SeismicHypothesesResponse,
} from "@/lib/seismicHypotheses";
import styles from "./SeismicHypothesesLab.module.css";

const verdictCopy: Record<HypothesisVerdict, { title: string; short: string }> = {
  supported: { title: "Se sostiene en esta ejecución", short: "Evidencia estadística" },
  "not-supported": { title: "No se sostiene", short: "Sin evidencia suficiente" },
  inconclusive: { title: "Resultado inconcluso", short: "Cobertura insuficiente" },
};

function formatNumber(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("es-DO", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function formatInteger(value: number) {
  return value.toLocaleString("es-DO", { maximumFractionDigits: 0 });
}

function formatP(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value < 0.001) return "< 0.001";
  return value.toFixed(3);
}

function formatScientific(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toExponential(2).replace("e+", " × 10^").replace("e-", " × 10^−") + (value >= 1 ? "" : "");
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className={styles.metric}>
    <span>{label}</span>
    <strong>{value}</strong>
    {note && <small>{note}</small>}
  </div>;
}

function Verdict({ verdict }: { verdict: HypothesisVerdict }) {
  const copy = verdictCopy[verdict];
  return <div className={styles.verdict} data-verdict={verdict}>
    <span>{copy.short}</span>
    <strong>{copy.title}</strong>
  </div>;
}

function DynamicRateChart({ result }: { result: DynamicTriggeringResult }) {
  const width = 860;
  const height = 300;
  const left = 52;
  const right = 24;
  const top = 28;
  const bottom = 48;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const maximum = Math.max(1, ...result.relativeRate.map((row) => row.ratePerTriggerDay));
  const x = (day: number) => left + ((day + result.configuration.windowDays) / (result.configuration.windowDays * 2)) * chartWidth;
  const y = (rate: number) => top + chartHeight - (rate / maximum) * chartHeight;
  const path = result.relativeRate.map((row, index) =>
    `${index === 0 ? "M" : "L"}${x(row.midpointDay).toFixed(1)},${y(row.ratePerTriggerDay).toFixed(1)}`).join(" ");
  return <div className={styles.chartWrap}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Tasa de sismicidad remota por día relativo al paso estimado de la onda superficial">
      <rect x={x(0)} y={top} width={x(result.configuration.windowDays) - x(0)} height={chartHeight} className={styles.postWindow} />
      {[0, 0.25, 0.5, 0.75, 1].map((fraction) => <line key={fraction} x1={left} x2={width - right} y1={top + chartHeight * fraction} y2={top + chartHeight * fraction} className={styles.gridLine} />)}
      <line x1={x(0)} x2={x(0)} y1={top - 6} y2={top + chartHeight} className={styles.arrivalLine} />
      <path d={path} className={styles.rateLine} />
      {result.relativeRate.map((row) => <circle key={row.midpointDay} cx={x(row.midpointDay)} cy={y(row.ratePerTriggerDay)} r="4" className={styles.ratePoint} />)}
      {[-result.configuration.windowDays, -3, 0, 3, result.configuration.windowDays].map((day) => <text key={day} x={x(day)} y={height - 18} textAnchor="middle" className={styles.axisLabel}>{day === 0 ? "llegada" : `${day > 0 ? "+" : ""}${day} d`}</text>)}
      <text x={left} y={17} className={styles.axisTitle}>eventos M≥2 por evento disparador y día</text>
      <text x={x(0) + 7} y={top + 16} className={styles.arrivalLabel}>ventana post-onda</text>
    </svg>
  </div>;
}

function MaxwellChart({ result }: { result: IntraplateRelaxationResult }) {
  const width = 860;
  const height = 310;
  const left = 52;
  const right = 24;
  const top = 28;
  const bottom = 64;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const maximum = Math.max(1, ...result.lagDistribution.flatMap((row) => [row.observedPer10kPairs, row.expectedPer10kPairs]));
  const groupWidth = chartWidth / Math.max(1, result.lagDistribution.length);
  const barWidth = Math.min(30, groupWidth * 0.3);
  const y = (value: number) => top + chartHeight - (value / maximum) * chartHeight;
  return <div className={styles.chartWrap}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Pares observados por retraso temporal comparados con el catálogo Monte Carlo">
      {[0, 0.25, 0.5, 0.75, 1].map((fraction) => <line key={fraction} x1={left} x2={width - right} y1={top + chartHeight * fraction} y2={top + chartHeight * fraction} className={styles.gridLine} />)}
      {result.lagDistribution.map((row, index) => {
        const center = left + groupWidth * (index + 0.5);
        const observedY = y(row.observedPer10kPairs);
        const expectedY = y(row.expectedPer10kPairs);
        return <g key={row.label}>
          <rect x={center - barWidth - 2} y={observedY} width={barWidth} height={top + chartHeight - observedY} className={styles.observedBar} />
          <rect x={center + 2} y={expectedY} width={barWidth} height={top + chartHeight - expectedY} className={styles.expectedBar} />
          <text x={center} y={height - 29} textAnchor="middle" className={styles.axisLabel}>{row.label}</text>
        </g>;
      })}
      <text x={left} y={17} className={styles.axisTitle}>pares por 10,000 pares espaciales muestreados</text>
      <g transform={`translate(${width - 235},12)`}>
        <rect width="10" height="10" className={styles.observedBar} /><text x="15" y="9" className={styles.legendText}>observado</text>
        <rect x="90" width="10" height="10" className={styles.expectedBar} /><text x="105" y="9" className={styles.legendText}>nulo Monte Carlo</text>
      </g>
    </svg>
  </div>;
}

function HypothesisA({ result }: { result: DynamicTriggeringResult }) {
  return <section className={styles.hypothesis}>
    <header className={styles.hypothesisHead}>
      <div>
        <span className={styles.kicker}>HIPÓTESIS A · HORAS A DÍAS</span>
        <h2>Disparo dinámico remoto</h2>
        <p>¿Aumenta la sismicidad M≥2 a más de 1,000 km después de que pasa la onda superficial de un M≥7.5?</p>
      </div>
      <Verdict verdict={result.verdict} />
    </header>

    <div className={styles.conclusion}><strong>Conclusión explícita.</strong> {result.conclusion}</div>
    <div className={styles.metrics}>
      <Metric label="p · test Z unilateral" value={formatP(result.observed.pValue)} note={`Z = ${formatNumber(result.observed.z)}`} />
      <Metric label="p · fechas aleatorias" value={formatP(result.bootstrap.empiricalPValue)} note={`${formatInteger(result.bootstrap.iterations)} bootstrap`} />
      <Metric label="Tamaño de efecto" value={`${formatNumber(result.observed.rateRatio)}×`} note={`${result.observed.effectPercent >= 0 ? "+" : ""}${formatNumber(result.observed.effectPercent, 1)}%`} />
      <Metric label="IC 95% por evento" value={`${formatNumber(result.bootstrap.observedClusterCi95[0])}–${formatNumber(result.bootstrap.observedClusterCi95[1])}×`} />
      <Metric label="Falsos positivos" value={`${formatNumber(result.bootstrap.falsePositiveRate * 100, 1)}%`} note="en fechas aleatorias" />
      <Metric label="Sensibilidad M≥4.5" value={`${formatNumber(result.sensitivity.rateRatio)}×`} note={`p = ${formatP(result.sensitivity.pValue)}`} />
    </div>

    <DynamicRateChart result={result} />

    <div className={styles.explainerGrid}>
      <article>
        <h3>Qué compara</h3>
        <p>Cada evento remoto se alinea con su propia llegada estimada: distancia ÷ {result.configuration.surfaceWaveVelocityKmS} km/s. Se comparan {result.configuration.windowDays} días antes y después.</p>
      </article>
      <article>
        <h3>Qué significaría una señal</h3>
        <p>El cociente debe superar 1, su intervalo excluir 1 y el resultado debe ser más extremo que fechas sin gran sismo. Una sola p pequeña no basta.</p>
      </article>
      <article>
        <h3>Cobertura analizada</h3>
        <p>{result.analyzedTriggerCount} de {result.candidateTriggerCount} candidatos independientes, distribuidos entre 1990 y hoy; {result.randomDateCount} fechas aleatorias emparejadas.</p>
      </article>
    </div>

    <details className={styles.details} open>
      <summary>Resultados por región receptora</summary>
      <p>Las p regionales se corrigen por tasa de falsos descubrimientos. Una región solo se marca si q&lt;0.05, el IC95% está sobre 1 y el control global de fechas aleatorias mantiene ≤10% de falsos positivos.</p>
      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th>Región</th><th>Ventanas</th><th>Antes</th><th>Después</th><th>Razón</th><th>p</th><th>q FDR</th><th>Lectura</th></tr></thead>
          <tbody>
            {result.regions.slice(0, 16).map((region) => <tr key={region.id}>
              <td>{region.label}</td><td>{region.triggerExposure}</td><td>{region.controlCount}</td><td>{region.postCount}</td>
              <td>{formatNumber(region.rateRatio)}×</td><td>{formatP(region.pValue)}</td><td>{formatP(region.qValue)}</td>
              <td><span className={region.significant ? styles.signal : styles.noSignal}>{region.significant ? "señal FDR" : "no significativa"}</span></td>
            </tr>)}
          </tbody>
        </table>
      </div>
      {!result.regions.length && <p>No hubo celdas con exposición y conteos suficientes para el análisis regional.</p>}
    </details>

    <details className={styles.details}>
      <summary>Eventos M≥7.5 incluidos</summary>
      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th>Fecha</th><th>Evento</th><th>M</th><th>Antes</th><th>Después</th><th>Razón</th></tr></thead>
          <tbody>{result.triggerRows.map((row) => <tr key={row.id}>
            <td>{new Date(row.timeUtc).toLocaleDateString("es-DO")}</td><td>{row.place}</td><td>{formatNumber(row.magnitude, 1)}</td>
            <td>{row.remoteControlCount}</td><td>{row.remotePostCount}</td><td>{formatNumber(row.rateRatio)}×</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>
  </section>;
}

function HypothesisB({ result }: { result: IntraplateRelaxationResult }) {
  const pValue = result.maxwell.pValue;
  return <section className={styles.hypothesis}>
    <header className={styles.hypothesisHead}>
      <div>
        <span className={styles.kicker}>HIPÓTESIS B · MESES A AÑOS</span>
        <h2>Redistribución de esfuerzo intraplaca</h2>
        <p>¿Los M≥6.5 distantes dentro de una misma placa presentan retrasos compatibles con relajación viscoelástica y distintos del fondo?</p>
      </div>
      <Verdict verdict={result.verdict} />
    </header>

    <div className={styles.conclusion}><strong>Conclusión explícita.</strong> {result.conclusion}</div>
    <div className={styles.metrics}>
      <Metric label="p · Monte Carlo" value={formatP(pValue)} note={`${formatInteger(result.configuration.monteCarloIterations)} catálogos nulos`} />
      <Metric label="Tamaño de efecto" value={result.maxwell.rateRatio === null ? "—" : `${formatNumber(result.maxwell.rateRatio)}×`} note={result.maxwell.effectPercent === null ? undefined : `${result.maxwell.effectPercent >= 0 ? "+" : ""}${formatNumber(result.maxwell.effectPercent, 1)}%`} />
      <Metric label="IC 95%" value={result.maxwell.ci95 ? `${formatNumber(result.maxwell.ci95[0])}–${formatNumber(result.maxwell.ci95[1])}×` : "—"} />
      <Metric label="Tiempo Maxwell" value={result.maxwell.bestRelaxationYears === null ? "—" : `${formatNumber(result.maxwell.bestRelaxationYears, 2)} años`} />
      <Metric label="Viscosidad implícita" value={formatScientific(result.maxwell.impliedViscosityPaS)} note="Pa·s; μ = 30 GPa" />
      <Metric label="Cota Coulomb mediana" value={result.staticStress.medianUpperBoundKPa === null ? "—" : `${formatNumber(result.staticStress.medianUpperBoundKPa, 4)} kPa`} note={`umbral ${result.staticStress.thresholdKPa} kPa`} />
    </div>

    <MaxwellChart result={result} />

    <div className={styles.explainerGrid}>
      <article>
        <h3>Catálogo intraplaca</h3>
        <p>{formatInteger(result.assignedEventCount)} de {formatInteger(result.catalogEventCount)} eventos fueron asignados a {result.plateCount} placas PB2002 y {result.spatialCellCount} celdas espaciales.</p>
      </article>
      <article>
        <h3>Control de esfuerzo estático</h3>
        <p>{formatNumber(result.staticStress.fractionBelowThreshold * 100, 1)}% de las orientaciones escalares posibles quedan bajo {result.staticStress.thresholdKPa} kPa. Es una cota, no ΔCFS firmado.</p>
      </article>
      <article>
        <h3>Nulo conservador</h3>
        <p>Se desplaza circularmente la cronología de cada celda de 5°; así conserva sus enjambres y ritmo local, pero rompe la sincronía con regiones lejanas.</p>
      </article>
    </div>

    <div className={styles.stressNote}>
      <strong>Importante sobre Coulomb.</strong> {result.staticStress.method}. Para un ΔCFS físico hacen falta tensor de momento, geometría de la ruptura, mecanismo y falla receptora.
    </div>

    <details className={styles.details}>
      <summary>Placas representadas en la prueba</summary>
      <div className={styles.plateList}>{result.plateSummary.map((plate) => <span key={plate.plateId}><strong>{plate.plateName}</strong>{formatInteger(plate.eventCount)} eventos</span>)}</div>
      <p>Se examinaron {formatInteger(result.spatialPairsConsidered)} combinaciones espaciales elegibles y se muestrearon {formatInteger(result.sampledPairCount)} pares para {formatInteger(result.contributingPairCount)} retrasos dentro de 1 mes–10 años.</p>
    </details>
  </section>;
}

export function SeismicHypothesesLab() {
  const [data, setData] = useState<SeismicHypothesesResponse | null>(null);
  const [triggerLimit, setTriggerLimit] = useState(200);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError("");
    try {
      const randomDateLimit = triggerLimit >= 100 ? triggerLimit : Math.min(16, triggerLimit);
      const run = force ? `&run=${Date.now()}` : "";
      const response = await fetch(`/api/seismic-hypotheses?triggerLimit=${triggerLimit}&randomDateLimit=${randomDateLimit}&bootstrap=1000&monteCarlo=1000${run}`);
      const body = await response.json() as SeismicHypothesesResponse & { error?: string; detail?: string };
      if (!response.ok) throw new Error(body.detail ?? body.error ?? `HTTP ${response.status}`);
      setData(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [triggerLimit]);

  useEffect(() => { void load(false); }, [load]);

  const generated = data ? new Date(data.generatedAtUtc).toLocaleString("es-DO") : "—";

  return <main className={styles.lab}>
    <header className={styles.hero}>
      <div>
        <span className={styles.kicker}>CATÁLOGO HISTÓRICO · EXPERIMENTO FALSABLE</span>
        <h1>Laboratorio de hipótesis sísmicas</h1>
        <p>Dos mecanismos, dos escalas temporales y dos pruebas independientes. El sistema actualiza ComCat, vuelve a ejecutar los controles y declara de forma explícita si cada hipótesis se sostiene o no.</p>
      </div>
      <div className={styles.controls}>
        <label>Eventos M≥7.5 en hipótesis A
          <select value={triggerLimit} onChange={(event) => setTriggerLimit(Number(event.target.value))} disabled={loading}>
            <option value={12}>12 · rápido</option>
            <option value={24}>24 · estándar</option>
            <option value={36}>36 · ampliado</option>
            <option value={200}>Todos los independientes</option>
          </select>
        </label>
        <button type="button" onClick={() => void load(true)} disabled={loading}>{loading ? "Analizando catálogo…" : "Volver a calcular"}</button>
        <small>Última ejecución: {generated}</small>
      </div>
    </header>

    <div className={styles.guardrail}><strong>No es un sistema de predicción.</strong> Busca asociaciones históricas predefinidas y las somete a controles nulos. Una señal estadística no prueba causalidad ni permite anticipar lugar o fecha de un terremoto.</div>
    {loading && !data && <div className={styles.loading}><span />Descargando ventanas ComCat, asignando placas y ejecutando 1,000 catálogos nulos…</div>}
    {error && !data && <div className={styles.error}><strong>No se pudo completar el análisis.</strong><br />{error}<button type="button" onClick={() => void load(true)}>Reintentar</button></div>}
    {error && data && <div className={styles.error}>La actualización falló; se conservan los resultados anteriores. {error}</div>}

    {data && <>
      {data.warnings.length > 0 && <div className={styles.warning}>{data.warnings.join(" · ")}</div>}
      <div className={styles.catalogStrip}>
        <span><small>Catálogo</small><strong>{data.catalog.source}</strong></span>
        <span><small>Periodo</small><strong>{new Date(data.catalog.startTime).getUTCFullYear()}–{new Date(data.catalog.endTime).getUTCFullYear()}</strong></span>
        <span><small>M≥7.5 candidatos</small><strong>{formatInteger(data.catalog.triggerCandidates)}</strong></span>
        <span><small>M≥6.5</small><strong>{formatInteger(data.catalog.m65Events)}</strong></span>
        <span><small>Placas</small><strong>{data.catalog.plateModel}</strong></span>
      </div>

      <HypothesisA result={data.hypothesisA} />
      <HypothesisB result={data.hypothesisB} />

      <section className={styles.bottomGrid}>
        <article>
          <h2>Limitaciones que pueden sesgar el resultado</h2>
          <h3>Hipótesis A</h3>
          <ul>{data.hypothesisA.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
          <h3>Hipótesis B</h3>
          <ul>{data.hypothesisB.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
        </article>
        <article>
          <h2>Datos y trazabilidad</h2>
          {data.sources.map((source) => <div className={styles.source} key={source.url}>
            <a href={source.url} target="_blank" rel="noreferrer">{source.name}</a>
            <p>{source.use}</p>
          </div>)}
          <p className={styles.version}>Versión del experimento: <code>{data.experimentVersion}</code>. Todos los umbrales, ventanas y nulos se devuelven junto al resultado para que la ejecución sea auditable.</p>
        </article>
      </section>
    </>}
  </main>;
}
