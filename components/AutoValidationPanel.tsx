"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MethodValidationMetrics, ValidationMethodId } from "@/lib/autoValidation";
import styles from "./AutoValidationPanel.module.css";

interface ValidationCaseRow {
  id: string;
  countryCode: string;
  countryName: string;
  sourcePlace: string;
  sourceMagnitude: number;
  sourceTime: string;
  issuedAt: string;
  evaluatedAt: string;
  occurred: boolean;
  map3dProbabilityPct: number;
  map3dBaselinePct: number;
  etasProbabilityPct: number;
  etasEmitted: boolean;
  etasSourceAgeDays: number;
  scopeProbabilityPct: number;
  scopeBaselinePct: number;
  scopeEvidenceQualityPct: number;
}

interface AutoValidationResponse {
  generatedAt: string;
  available: boolean;
  databaseConfigured: boolean;
  databaseConnected: boolean;
  prospectiveEvaluatedCases?: number;
  pairedCasesRequested?: number;
  pairedCasesUsed?: number;
  climatologyPct?: number;
  methods: MethodValidationMetrics[];
  ranking: ValidationMethodId[];
  cases: ValidationCaseRow[];
  warnings?: string[];
  warning?: string;
  methodology?: string[];
}

const METHOD_COLORS: Record<ValidationMethodId, string> = {
  map3d: "map3d",
  etas: "etas",
  scope: "scope",
};

function pct(value: number | null | undefined, digits = 2) {
  return value === null || value === undefined ? "—" : `${value.toFixed(digits)}%`;
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;
}

function date(value: string) {
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function methodProbability(row: ValidationCaseRow, id: ValidationMethodId) {
  if (id === "map3d") return row.map3dProbabilityPct;
  if (id === "etas") return row.etasProbabilityPct;
  return row.scopeProbabilityPct;
}

async function readJson<T>(response: Response): Promise<T> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(raw || `HTTP ${response.status}`);
  }
}

export function AutoValidationPanel() {
  const [sampleLimit, setSampleLimit] = useState(10);
  const [data, setData] = useState<AutoValidationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (limit = sampleLimit) => {
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 58_000);
    try {
      const response = await fetch(`/api/auto-validation?limit=${limit}&_=${Date.now()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = await readJson<AutoValidationResponse>(response);
      if (!response.ok) throw new Error(payload.warning || `HTTP ${response.status}`);
      setData(payload);
    } catch (loadError) {
      setData(null);
      setError(
        loadError instanceof DOMException && loadError.name === "AbortError"
          ? "Auto-Validación tardó demasiado. La reconstrucción ETAS/EarthScope puede estar respondiendo lentamente; intenta de nuevo."
          : loadError instanceof Error
            ? loadError.message
            : "No fue posible cargar Auto-Validación.",
      );
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }, [sampleLimit]);

  useEffect(() => {
    void load(sampleLimit);
  }, [load, sampleLimit]);

  const methodById = useMemo(
    () => new Map(data?.methods.map((method) => [method.id, method]) ?? []),
    [data],
  );
  const ranking = data?.ranking ?? [];

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className={styles.brand}><span /> RDSISMOS · MODEL AUDIT</div>
          <h1>Auto-Validación</h1>
          <p>
            Comparación automática de Mapa 3D, ETAS Projection y Scope Projection con los mismos casos cerrados.
            El objetivo es medir skill, no contar solamente aciertos llamativos.
          </p>
        </div>
        <div className={styles.controls}>
          <label>
            Casos recientes
            <select
              value={sampleLimit}
              onChange={(event) => setSampleLimit(Number(event.target.value))}
              disabled={loading}
            >
              <option value={6}>6 casos</option>
              <option value={10}>10 casos</option>
              <option value={14}>14 casos</option>
            </select>
          </label>
          <button type="button" onClick={() => void load(sampleLimit)} disabled={loading}>
            {loading ? "Recalculando…" : "Actualizar auditoría"}
          </button>
        </div>
      </header>

      <section className={styles.notice}>
        <strong>Lectura científica:</strong> Mapa 3D se evalúa con probabilidades que quedaron persistidas antes del resultado.
        ETAS y Scope se muestran por ahora como <b>replay retrospectivo sin fuga del resultado en el cálculo de probabilidad</b>.
        La comparación es diagnóstica y no sustituye todavía una evaluación prospectiva CSEP independiente de los tres modelos.
      </section>

      {error && <div className={styles.error}>{error}</div>}
      {loading && !data && <div className={styles.loading}>Reconstruyendo probabilidades, evidencia EarthScope y métricas…</div>}

      {data && !data.available && (
        <div className={styles.warning}>
          <strong>Auto-Validación no disponible.</strong>
          <span>{data.warning || "No hay una muestra persistida suficiente para calcular métricas."}</span>
        </div>
      )}

      {data?.available && (
        <>
          <section className={styles.summaryGrid}>
            <article>
              <span>Ledger prospectivo disponible</span>
              <strong>{data.prospectiveEvaluatedCases ?? 0}</strong>
              <small>pares Mapa 3D/país ya evaluados</small>
            </article>
            <article>
              <span>Muestra pareada usada</span>
              <strong>{data.pairedCasesUsed ?? 0}/{data.pairedCasesRequested ?? 0}</strong>
              <small>mismos casos para los tres métodos</small>
            </article>
            <article>
              <span>Climatología de referencia</span>
              <strong>{pct(data.climatologyPct)}</strong>
              <small>tasa base suavizada de esta muestra</small>
            </article>
            <article>
              <span>Mejor Brier actual</span>
              <strong>{ranking[0] ? methodById.get(ranking[0])?.label ?? ranking[0] : "—"}</strong>
              <small>ranking diagnóstico; menor Brier es mejor</small>
            </article>
          </section>

          <section className={styles.comparisonSection}>
            <div className={styles.sectionHeading}>
              <div>
                <span>Comparación directa</span>
                <h2>Las cinco pruebas por método</h2>
              </div>
              <p>Todos los porcentajes probabilísticos se puntúan como probabilidades, no como etiquetas de “acierto/fallo”.</p>
            </div>

            <div className={styles.methodGrid}>
              {data.methods.map((method, index) => (
                <article key={method.id} className={`${styles.methodCard} ${styles[METHOD_COLORS[method.id]]}`}>
                  <div className={styles.methodHead}>
                    <div>
                      <span>#{ranking.indexOf(method.id) + 1 || index + 1} por Brier</span>
                      <h3>{method.label}</h3>
                    </div>
                    <b className={method.mode === "prospective" ? styles.prospective : styles.replay}>
                      {method.mode === "prospective" ? "PROSPECTIVO" : "REPLAY"}
                    </b>
                  </div>

                  <div className={styles.testBlock}>
                    <span>1 · Calibración</span>
                    <strong>ECE {method.expectedCalibrationErrorPp.toFixed(2)} pp</strong>
                    <small>Prob. media {pct(method.averageProbabilityPct)} · observado {pct(method.observedRatePct)} · gap global {method.calibrationGapPp.toFixed(2)} pp</small>
                    <div className={styles.calibrationBars}>
                      {method.calibration.map((bin) => (
                        <div key={bin.label} title={`${bin.label}: predicho ${pct(bin.averageProbabilityPct)}, observado ${pct(bin.observedRatePct)}`}>
                          <span>{bin.label}</span>
                          <i style={{ width: `${Math.min(100, bin.averageProbabilityPct)}%` }} />
                          <em style={{ width: `${Math.min(100, bin.observedRatePct)}%` }} />
                          <small>{bin.count}</small>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className={styles.metricPair}>
                    <div className={styles.testBlock}>
                      <span>2 · Proper scores</span>
                      <strong>Brier {method.brierScore.toFixed(4)}</strong>
                      <small>Log Loss {method.logLoss.toFixed(4)} · Brier Skill {signed(method.brierSkillScore)}</small>
                    </div>
                    <div className={styles.testBlock}>
                      <span>3 · Information Gain</span>
                      <strong>{signed(method.informationGainBits)} bits/caso</strong>
                      <small>{method.informationGainBits > 0 ? "Mejora sobre climatología" : "No supera la climatología en esta muestra"}</small>
                    </div>
                  </div>

                  <div className={styles.testBlock}>
                    <span>4 · Falsos positivos y omisiones</span>
                    <strong>{method.falsePositives} FP · {method.omissions} omisiones</strong>
                    <small>
                      Umbral común {pct(method.signalThresholdPct)} · precisión {pct(method.precisionPct, 1)} · recall {pct(method.recallPct, 1)} · cobertura {pct(method.coveragePct, 1)}
                    </small>
                  </div>

                  <div className={styles.testBlock}>
                    <span>5 · Comparación</span>
                    <strong>Rango #{ranking.indexOf(method.id) + 1}</strong>
                    <small>
                      {method.sampleCount} casos · {method.positiveCount} positivos. El ranking usa Brier como criterio principal y Information Gain como desempate.
                    </small>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.caseSection}>
            <div className={styles.sectionHeading}>
              <div><span>Trazabilidad</span><h2>Casos incluidos en esta auditoría</h2></div>
              <p>Permite comprobar qué probabilidad recibió exactamente cada caso en cada método.</p>
            </div>
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Resultado</th><th>País</th><th>Precedente</th><th>Mapa 3D</th><th>ETAS</th><th>Scope</th><th>Emitida</th><th>Evaluada</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cases.map((row) => (
                    <tr key={row.id}>
                      <td><b className={row.occurred ? styles.hit : styles.miss}>{row.occurred ? "OCURRIÓ" : "NO OCURRIÓ"}</b></td>
                      <td><strong>{row.countryName}</strong><small>{row.countryCode}</small></td>
                      <td><strong>M{row.sourceMagnitude.toFixed(1)}</strong><small>{row.sourcePlace}</small></td>
                      <td><strong>{pct(methodProbability(row, "map3d"))}</strong><small>base {pct(row.map3dBaselinePct)}</small></td>
                      <td><strong>{pct(methodProbability(row, "etas"))}</strong><small>{row.etasEmitted ? `edad ${row.etasSourceAgeDays.toFixed(1)} d` : "sin señal regional"}</small></td>
                      <td><strong>{pct(methodProbability(row, "scope"))}</strong><small>evidencia {row.scopeEvidenceQualityPct}%</small></td>
                      <td>{date(row.issuedAt)} UTC</td>
                      <td>{date(row.evaluatedAt)} UTC</td>
                    </tr>
                  ))}
                  {!data.cases.length && <tr><td colSpan={8}>Todavía no hay casos comparables.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          {(data.warnings?.length ?? 0) > 0 && (
            <details className={styles.warnings}>
              <summary>{data.warnings?.length} advertencia(s) de reconstrucción</summary>
              <ul>{data.warnings?.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </details>
          )}

          <section className={styles.methodology}>
            <div><span>Metodología de Auto-Validación</span><h2>Qué significan estas cifras</h2></div>
            <ol>{data.methodology?.map((item) => <li key={item}>{item}</li>)}</ol>
          </section>
        </>
      )}
    </main>
  );
}
