"use client";

import dynamic from "next/dynamic";
import type { CoreGlobeData } from "./CoreSeismicGlobe";
const CoreSeismicGlobe = dynamic(() => import("./CoreSeismicGlobe"), { ssr: false, loading: () => <p>Cargando globo…</p> });

import { useEffect, useMemo, useState } from "react";
import { CoreSeismicRelativeStudyPanel } from "./CoreSeismicRelativeStudyPanel";
import type { CoreSeismicRelativeStudy } from "@/lib/coreSeismicRelative";

type Predictor = "secularAccelerationNtYr2" | "jerkIntensity";
type Interpretation = "sin-evidencia-robusta" | "senal-in-sample" | "ganancia-oos-exploratoria" | "asociacion-retrospectiva-replicada";

type Analysis = {
  predictor: Predictor;
  throughYear: number;
  bestLagYears: number;
  developmentCorrelation: number;
  lagCorrectedP: number;
  deltaOosLogLikelihood: number;
  informationGainBitsPerYear: number;
  nDevelopment: number;
  nTest: number;
  splitYear: number;
  interpretation: Interpretation;
  lagProfile: Array<{ lagYears: number; correlation: number; n: number }>;
};

type Annual = {
  year: number;
  countM7: number;
  secularAccelerationNtYr2: number | null;
  saStationCount: number;
  jerkIntensity: number;
  isJerkYear: boolean;
};

type ApiResult = {
  generatedAtUtc: string;
  experimentVersion: string;
  historicalStartYear: number;
  currentYear: number;
  summary: {
    historicalM7Events: number;
    currentYearM7Observed: number;
    currentYearExposure: number;
    latestEventUtc: string | null;
    firstSaYear: number | null;
    latestSaYear: number | null;
    latestSaStationCount: number;
    bgsStationsUsed: number;
    jerkCount: number;
  };
  annual: Annual[];
  relativeStudy: CoreSeismicRelativeStudy;
  analyses: Analysis[];
  jerkEpochs: Array<{ year: number; weight: number; source: string }>;
  stations: Array<{ code: string; name: string; firstYear: number | null; lastYear: number | null }>;
  warnings: string[];
  globe?: CoreGlobeData;
  diagnostics?: { failures: string[]; saYearsAvailable: number; minimumYears: number };
};

const verdict: Record<Interpretation, { title: string; note: string }> = {
  "sin-evidencia-robusta": {
    title: "Sin evidencia robusta",
    note: "La relación no supera conjuntamente los controles históricos y fuera de muestra.",
  },
  "senal-in-sample": {
    title: "Señal solo retrospectiva",
    note: "Aparece en la parte histórica usada para explorar, pero no se sostiene fuera de muestra.",
  },
  "ganancia-oos-exploratoria": {
    title: "Ganancia OOS exploratoria",
    note: "Mejora fuera de muestra, pero no supera la corrección estadística de la búsqueda temporal.",
  },
  "asociacion-retrospectiva-replicada": {
    title: "Asociación histórica con soporte OOS",
    note: "La señal supera la corrección de lag y además mejora la evaluación fuera de muestra. No implica causalidad.",
  },
};

function fmt(value: number, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function lagText(lag: number) {
  if (lag === 0) return "mismo año";
  if (lag > 0) return `señal magnética ${lag} año${lag === 1 ? "" : "s"} antes`;
  const years = Math.abs(lag);
  return `sismos M7+ ${years} año${years === 1 ? "" : "s"} antes`;
}

function HistoricalChart({ rows, jerkEpochs, currentYear }: { rows: Annual[]; jerkEpochs: ApiResult["jerkEpochs"]; currentYear: number }) {
  const data = rows.filter(row => row.year >= 1904 && row.year <= currentYear);
  const width = 1080, height = 330, left = 48, right = 62, top = 34, bottom = 34;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const countMax = Math.max(1, ...data.map(row => row.countM7));
  const saValues = data.map(row => row.secularAccelerationNtYr2).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const saMax = Math.max(1, ...saValues);
  const x = (year: number) => left + ((year - 1904) / Math.max(1, currentYear - 1904)) * plotWidth;
  const yCount = (value: number) => top + plotHeight - (value / countMax) * plotHeight;
  const ySa = (value: number) => top + plotHeight - (value / saMax) * plotHeight;
  let previousSaYear: number | null = null;
  const saPath = data.reduce((path, row) => {
    if (typeof row.secularAccelerationNtYr2 !== "number" || !Number.isFinite(row.secularAccelerationNtYr2)) return path;
    const command = previousSaYear === row.year - 1 ? " L" : " M";
    previousSaYear = row.year;
    return `${path}${command}${x(row.year).toFixed(1)},${ySa(row.secularAccelerationNtYr2).toFixed(1)}`;
  }, "");
  const barWidth = Math.max(1.5, plotWidth / data.length * 0.72);

  return <div style={{ overflowX: "auto" }}>
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", minWidth: 760, background: "#071522", borderRadius: 12 }} role="img" aria-label="Aceleración secular, jerks magnéticos y terremotos de magnitud 7 o mayor desde 1904">
      {[0, 0.25, 0.5, 0.75, 1].map(frac => <line key={frac} x1={left} x2={width - right} y1={top + plotHeight * frac} y2={top + plotHeight * frac} stroke="#203747" strokeWidth="1" />)}
      {data.map(row => {
        const h = (row.countM7 / countMax) * plotHeight;
        return <rect key={row.year} x={x(row.year) - barWidth / 2} y={top + plotHeight - h} width={barWidth} height={h} fill="#ff9466" opacity={row.year === currentYear ? 0.55 : 0.78} />;
      })}
      {jerkEpochs.filter(jerk => jerk.year >= 1904 && jerk.year <= currentYear).map(jerk => <line key={jerk.year} x1={x(jerk.year)} x2={x(jerk.year)} y1={top} y2={top + plotHeight} stroke="#6ce0dc" strokeWidth="1.3" strokeDasharray="5 5" opacity={0.72} />)}
      {saPath && <path d={saPath} fill="none" stroke="#c5a0ff" strokeWidth="2.5" />}
      <text x={left} y={20} fill="#ff9466" fontSize="12">barras: sismos M≥7 por año</text>
      <text x={left + 190} y={20} fill="#c5a0ff" fontSize="12">línea: aceleración secular (nT/a²)</text>
      <text x={left + 430} y={20} fill="#6ce0dc" fontSize="12">líneas verticales: magnetic jerks</text>
      <text x={10} y={top + 5} fill="#9cafbd" fontSize="11">{countMax}</text>
      <text x={12} y={top + plotHeight} fill="#9cafbd" fontSize="11">0</text>
      <text x={width - right + 8} y={top + 5} fill="#bda3e8" fontSize="11">{saMax.toFixed(0)}</text>
      <text x={width - right + 8} y={top + plotHeight} fill="#bda3e8" fontSize="11">0</text>
      {[1904, 1930, 1960, 1990, 2020, currentYear].filter((year, index, list) => list.indexOf(year) === index && year <= currentYear).map(year => <text key={year} x={x(year)} y={height - 10} fill="#9cafbd" fontSize="11" textAnchor="middle">{year}</text>)}
    </svg>
  </div>;
}

function ResultCard({ analysis, title, description, unavailable }: { analysis: Analysis | null; title: string; description: string; unavailable?: string }) {
  if (!analysis) return <div style={{ flex: "1 1 420px", background: "#081724", border: "1px solid #20384a", borderRadius: 14, padding: 18 }}>
    <h3 style={{ margin: 0 }}>{title}</h3>
    <p style={{ color: "#9eb4c2", lineHeight: 1.5 }}>{description}</p>
    <strong style={{ color: "#f4c76b" }}>{unavailable ?? "Datos insuficientes para una prueba histórica estable."}</strong>
  </div>;
  const info = verdict[analysis.interpretation];
  return <div style={{ flex: "1 1 420px", background: "#081724", border: "1px solid #20384a", borderRadius: 14, padding: 18 }}>
    <h3 style={{ margin: 0 }}>{title}</h3>
    <p style={{ color: "#9eb4c2", lineHeight: 1.5 }}>{description}</p>
    <div style={{ background: "#0c2131", borderRadius: 11, padding: 14, marginTop: 12 }}>
      <div style={{ fontSize: 12, color: "#91a8b7" }}>RESULTADO</div>
      <div style={{ fontSize: 21, fontWeight: 800, marginTop: 4 }}>{info.title}</div>
      <div style={{ color: "#9fb3bf", fontSize: 12, lineHeight: 1.45, marginTop: 5 }}>{info.note}</div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 9, marginTop: 12 }}>
      <div style={{ background: "#0a1b2a", borderRadius: 10, padding: 11 }}><div style={{ color: "#8fa5b4", fontSize: 11 }}>Relación temporal</div><strong>{lagText(analysis.bestLagYears)}</strong></div>
      <div style={{ background: "#0a1b2a", borderRadius: 10, padding: 11 }}><div style={{ color: "#8fa5b4", fontSize: 11 }}>Correlación histórica</div><strong>{fmt(analysis.developmentCorrelation)}</strong></div>
      <div style={{ background: "#0a1b2a", borderRadius: 10, padding: 11 }}><div style={{ color: "#8fa5b4", fontSize: 11 }}>p corregido</div><strong>{fmt(analysis.lagCorrectedP)}</strong></div>
      <div style={{ background: "#0a1b2a", borderRadius: 10, padding: 11 }}><div style={{ color: "#8fa5b4", fontSize: 11 }}>Ganancia fuera de muestra</div><strong>{fmt(analysis.informationGainBitsPerYear)} bits/año</strong></div>
    </div>
    <p style={{ color: "#7f95a4", fontSize: 11, lineHeight: 1.45, marginBottom: 0 }}>Analizado hasta {analysis.throughYear}. Un lag positivo significa que la señal magnética ocurrió antes; uno negativo significa que los M7+ ocurrieron antes. La asociación no se interpreta como causalidad ni predicción.</p>
  </div>;
}

export function CoreSeismicCouplingLab() {
  const [data, setData] = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/core-seismic-coupling", { cache: "no-store" });
      const body = await response.json() as ApiResult & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setData(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const saAnalysis = useMemo(() => data?.analyses.find(item => item.predictor === "secularAccelerationNtYr2") ?? null, [data]);
  const jerkAnalysis = useMemo(() => data?.analyses.find(item => item.predictor === "jerkIntensity") ?? null, [data]);

  if (loading && !data) return <div className="map-loading" style={{ margin: 28 }}>Cargando BGS + USGS y comparando aceleración secular / jerks con sismos M7+…</div>;
  if (error && !data) return <div className="quality-warning" style={{ margin: 28 }}><strong>No se pudo ejecutar la comparación.</strong><br />{error}</div>;
  if (!data) return null;

  return <section style={{ maxWidth: 1500, margin: "0 auto", padding: "24px 22px 80px", color: "#dce8ef" }}>
    <div style={{ background: "linear-gradient(135deg,#0b2132,#111b2b)", border: "1px solid #27465a", borderRadius: 16, padding: 22 }}>
      <div style={{ color: "#8cc7ff", letterSpacing: ".08em", fontSize: 12, fontWeight: 800 }}>DATOS REALES · {data.experimentVersion}</div>
      <h2 style={{ margin: "8px 0" }}>Aceleración secular + magnetic jerks vs sismos M7+</h2>
      <p style={{ margin: 0, maxWidth: 1030, lineHeight: 1.55, color: "#b8c8d2" }}>Explora en el globo la trayectoria histórica del polo norte magnético y los sismos M7+, con las épocas de magnetic jerks. El experimento principal alinea cada terremoto en τ = 0 y compara los cinco años anteriores y posteriores; el análisis anual queda como referencia secundaria.</p>
      <button onClick={() => void load()} disabled={loading} style={{ marginTop: 15, padding: "9px 14px", borderRadius: 9, border: "1px solid #3d6075", background: "#123047", color: "#e8f3f8", cursor: "pointer" }}>{loading ? "Actualizando…" : "Actualizar datos"}</button>
    </div>

    {error && <p role="alert">No se pudo actualizar: {error}. Se conservan los datos anteriores.</p>}
    {data.diagnostics && data.diagnostics.failures.length > 0 && <details><summary>Diagnóstico por observatorio</summary>{data.diagnostics.failures.map((f, i) => <p key={i}>{f}</p>)}</details>}
    {data.warnings.length > 0 && <div className="quality-warning" style={{ marginTop: 14 }}>{data.warnings.join(" · ")}</div>}

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10, marginTop: 16 }}>
      <div style={{ background: "#0a1b2a", borderRadius: 12, padding: 14 }}><div style={{ color: "#91a8b7", fontSize: 11 }}>M7+ históricos desde 1904</div><strong style={{ fontSize: 23 }}>{data.summary.historicalM7Events.toLocaleString()}</strong></div>
      <div style={{ background: "#0a1b2a", borderRadius: 12, padding: 14 }}><div style={{ color: "#91a8b7", fontSize: 11 }}>Aceleración secular disponible</div><strong style={{ fontSize: 23 }}>{data.summary.firstSaYear ?? "—"}–{data.summary.latestSaYear ?? "—"}</strong></div>
      <div style={{ background: "#0a1b2a", borderRadius: 12, padding: 14 }}><div style={{ color: "#91a8b7", fontSize: 11 }}>Observatorios BGS usados</div><strong style={{ fontSize: 23 }}>{data.summary.bgsStationsUsed}</strong></div>
      <div style={{ background: "#0a1b2a", borderRadius: 12, padding: 14 }}><div style={{ color: "#91a8b7", fontSize: 11 }}>Jerks del catálogo</div><strong style={{ fontSize: 23 }}>{data.summary.jerkCount}</strong></div>
      <div style={{ background: "#0a1b2a", borderRadius: 12, padding: 14 }}><div style={{ color: "#91a8b7", fontSize: 11 }}>M7+ en {data.currentYear}</div><strong style={{ fontSize: 23 }}>{data.summary.currentYearM7Observed}</strong><div style={{ color: "#7f95a4", fontSize: 11 }}>{(data.summary.currentYearExposure * 100).toFixed(1)}% del año transcurrido</div></div>
    </div>

    <CoreSeismicRelativeStudyPanel study={data.relativeStudy} />

    <div style={{ marginTop: 20, background: "#081724", border: "1px solid #20384a", borderRadius: 15, padding: 18 }}>
      <h3 style={{ marginTop: 0 }}>Referencia secundaria · historia anual 1904 → presente</h3>
      <HistoricalChart rows={data.annual} jerkEpochs={data.jerkEpochs} currentYear={data.currentYear} />
      <p style={{ fontSize: 12, color: "#8fa5b4", lineHeight: 1.5, marginBottom: 0 }}>Las barras son el número real de terremotos M7+ por año. La línea morada es |d²B/dt²| en nT/año² calculada desde medias mensuales de observatorios. Las líneas turquesa marcan jerks publicados. Esta vista anual no sustituye el alineamiento relativo por evento. El año actual se muestra en seguimiento, pero no se usa como año completo en la prueba histórica.</p>
    </div>

    {data.globe && <CoreSeismicGlobe data={data.globe} currentYear={data.currentYear} jerks={data.jerkEpochs} />}

    <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 18 }}>
      <ResultCard unavailable={data.summary.bgsStationsUsed === 0 ? "No se recuperaron series BGS utilizables para esta referencia anual; el experimento relativo conserva el diagnóstico por evento." : `${data.diagnostics?.saYearsAvailable ?? 0} años geomagnéticos utilizables; el análisis anual se conserva como control secundario.`} analysis={saAnalysis} title="Aceleración secular ↔ M7+ · secundario" description="Prueba si cambios rápidos de la variación secular del campo contienen información temporal adicional sobre la tasa anual de sismos M7+." />
      <ResultCard analysis={jerkAnalysis} title="Magnetic jerks ↔ M7+ · secundario" description="Referencia anual: prueba si las épocas de jerks publicados presentan una relación temporal reproducible con los años de mayor o menor ocurrencia de M7+." />
    </div>

    <div style={{ marginTop: 18, background: "#081724", border: "1px solid #20384a", borderRadius: 14, padding: 17 }}>
      <h3 style={{ marginTop: 0 }}>Datos que se actualizan</h3>
      <p style={{ color: "#9eb4c2", lineHeight: 1.55, marginBottom: 8 }}>Sismicidad: USGS/ComCat M≥7 desde 1904 hasta hoy. Aceleración secular: medias mensuales del World Data Centre for Geomagnetism de BGS, agregadas entre observatorios con cobertura utilizable. Jerks: catálogo bibliográfico versionado; no se asume que sean perfectamente simultáneos en todo el planeta.</p>
      <div style={{ color: "#7f95a4", fontSize: 11, lineHeight: 1.5 }}>Observatorios usados: {data.stations.length ? data.stations.map(station => `${station.code} ${station.firstYear ?? "?"}–${station.lastYear ?? "?"}`).join(" · ") : "ninguno disponible en esta ejecución"}. Último M7+ recibido: {data.summary.latestEventUtc ? new Date(data.summary.latestEventUtc).toLocaleString() : "—"}.</div>
    </div>
  </section>;
}
