"use client";

import { useEffect, useMemo, useState } from "react";

type PredictorKey = "poleSpeedKmYr" | "poleAccelerationKmYr2" | "jerkIntensity";
type EndpointKey = "countM7" | "logMoment";
type LagPoint = { lagYears: number; correlation: number; n: number };
type Analysis = {
  predictor: PredictorKey; endpoint: EndpointKey; bestLagYears: number; developmentCorrelation: number; lagCorrectedP: number;
  baselineOosLogLikelihood: number; geomagOosLogLikelihood: number; deltaOosLogLikelihood: number; informationGainBitsPerYear: number;
  nDevelopment: number; nTest: number; lagProfile: LagPoint[];
  interpretation: "sin-evidencia-robusta" | "senal-in-sample" | "ganancia-oos-exploratoria" | "asociacion-retrospectiva-replicada";
};
type Annual = {
  year: number; countM7: number; sumMomentNm: number; maxMagnitude: number | null; poleLat: number | null; poleLon: number | null;
  poleSpeedKmYr: number | null; poleAccelerationKmYr2: number | null; jerkIntensity: number;
};
type Prospective = {
  year: number; predictor: PredictorKey; lagYears: number; exposure: number; observedCount: number;
  baselineExpectedToDate: number; geomagExpectedToDate: number | null; predictorAvailable: boolean;
};
type ApiResult = {
  generatedAtUtc: string; experimentVersion: string; retrospectiveFreezeThrough: number; currentProspectiveYear: number;
  summary: { annualRows: number; historicalM7Events: number; polePoints: number; latestPoleYear: number | null; currentYearM7Observed: number; currentYearExposure: number; latestEventUtc: string | null };
  hypotheses: Record<string, string>;
  sources: Record<string, { name?: string; coverage?: string; url?: string; note?: string; status?: string; filter?: string; momentNote?: string }>;
  annual: Annual[]; analyses: Analysis[]; prospective: Prospective[]; warnings: string[];
};

const predictorLabel: Record<PredictorKey, string> = {
  poleSpeedKmYr: "Velocidad del polo",
  poleAccelerationKmYr2: "Aceleración del polo",
  jerkIntensity: "Geomagnetic jerks",
};
const endpointLabel: Record<EndpointKey, string> = { countM7: "Conteo M≥7", logMoment: "log₁₀ ΣM₀ proxy" };
const interpretationLabel: Record<Analysis["interpretation"], string> = {
  "sin-evidencia-robusta": "Sin evidencia robusta",
  "senal-in-sample": "Señal in-sample; no replica OOS",
  "ganancia-oos-exploratoria": "Ganancia OOS exploratoria",
  "asociacion-retrospectiva-replicada": "Asociación retrospectiva con soporte OOS",
};

function fmt(value: number, digits = 3) { return Number.isFinite(value) ? value.toFixed(digits) : "—"; }
function zScores(values: Array<number | null>) {
  const finite = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const mean = finite.reduce((a, b) => a + b, 0) / Math.max(1, finite.length);
  const variance = finite.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, finite.length - 1);
  const sd = Math.sqrt(variance) || 1;
  return values.map(v => typeof v === "number" && Number.isFinite(v) ? (v - mean) / sd : null);
}

function TimeSeriesChart({ annual }: { annual: Annual[] }) {
  const rows = annual.filter(r => r.year <= 2025 && r.year >= 1904);
  const speed = zScores(rows.map(r => r.poleSpeedKmYr));
  const quakes = zScores(rows.map(r => r.countM7));
  const width = 920, height = 260, pad = 42;
  const x = (i: number) => pad + i * (width - 2 * pad) / Math.max(1, rows.length - 1);
  const y = (v: number) => height / 2 - Math.max(-3.5, Math.min(3.5, v)) * 28;
  const path = (series: Array<number | null>) => series.reduce((d, v, i) => v === null ? d : `${d}${d ? " L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`, "");
  return <div style={{ overflowX: "auto" }}>
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", minWidth: 680, background: "#071522", borderRadius: 12 }} role="img" aria-label="Series estandarizadas de velocidad del polo y terremotos M7 o mayores">
      <line x1={pad} x2={width - pad} y1={height / 2} y2={height / 2} stroke="#536474" strokeWidth="1" />
      <path d={path(speed)} fill="none" stroke="#70b7ff" strokeWidth="2.4" />
      <path d={path(quakes)} fill="none" stroke="#ff9d70" strokeWidth="2.1" opacity="0.9" />
      <text x={pad} y={24} fill="#70b7ff" fontSize="13">velocidad del polo (z)</text>
      <text x={pad + 170} y={24} fill="#ff9d70" fontSize="13">conteo M≥7 (z)</text>
      {[1904, 1930, 1960, 1990, 2025].map(year => {
        const i = rows.findIndex(r => r.year >= year); if (i < 0) return null;
        return <g key={year}><line x1={x(i)} x2={x(i)} y1={height - 30} y2={height - 24} stroke="#8394a3"/><text x={x(i)} y={height - 8} fill="#9cafbd" fontSize="11" textAnchor="middle">{year}</text></g>;
      })}
    </svg>
  </div>;
}

function LagChart({ profile }: { profile: LagPoint[] }) {
  const width = 920, height = 250, pad = 44;
  const x = (lag: number) => pad + (lag + 20) / 40 * (width - 2 * pad);
  const y = (r: number) => height / 2 - Math.max(-1, Math.min(1, r)) * 86;
  const d = profile.map((p, i) => `${i ? "L" : "M"}${x(p.lagYears).toFixed(1)},${y(p.correlation).toFixed(1)}`).join(" ");
  return <div style={{ overflowX: "auto" }}>
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", minWidth: 680, background: "#071522", borderRadius: 12 }} role="img" aria-label="Correlación preblanqueada aproximada por lag temporal">
      <line x1={pad} x2={width - pad} y1={height / 2} y2={height / 2} stroke="#536474"/>
      <line x1={x(0)} x2={x(0)} y1={28} y2={height - 32} stroke="#536474" strokeDasharray="4 5"/>
      <path d={d} fill="none" stroke="#cba8ff" strokeWidth="2.5"/>
      {[-20,-10,0,10,20].map(lag => <text key={lag} x={x(lag)} y={height - 10} fill="#9cafbd" fontSize="11" textAnchor="middle">{lag > 0 ? `+${lag}` : lag}</text>)}
      <text x={pad} y={22} fill="#cba8ff" fontSize="13">r residual por lag · + = geomagnetismo primero</text>
    </svg>
  </div>;
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div style={{ background: "#0a1b2a", border: "1px solid #20384a", borderRadius: 12, padding: 14, minWidth: 150 }}>
    <div style={{ color: "#94a9b8", fontSize: 12 }}>{label}</div><div style={{ color: "#f2f7fa", fontSize: 22, fontWeight: 700, marginTop: 4 }}>{value}</div>{note && <div style={{ color: "#8195a4", fontSize: 11, marginTop: 5 }}>{note}</div>}
  </div>;
}

export function CoreSeismicCouplingLab() {
  const [data, setData] = useState<ApiResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [predictor, setPredictor] = useState<PredictorKey>("jerkIntensity");
  const [endpoint, setEndpoint] = useState<EndpointKey>("countM7");
  const load = async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/core-seismic-coupling", { cache: "no-store" });
      const body = await response.json() as ApiResult & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setData(body);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const selected = useMemo(() => data?.analyses.find(a => a.predictor === predictor && a.endpoint === endpoint) ?? null, [data, endpoint, predictor]);
  const prospective = useMemo(() => data?.prospective.find(p => p.predictor === predictor) ?? null, [data, predictor]);

  if (loading && !data) return <div className="map-loading" style={{ margin: 28 }}>Cargando NOAA + USGS y ejecutando experimento histórico…</div>;
  if (error && !data) return <div className="quality-warning" style={{ margin: 28 }}><strong>No se pudo ejecutar el laboratorio.</strong><br/>{error}</div>;
  if (!data) return null;

  return <section style={{ maxWidth: 1500, margin: "0 auto", padding: "24px 22px 80px", color: "#dce8ef" }}>
    <div style={{ background: "linear-gradient(135deg,#0b2132,#111b2b)", border: "1px solid #27465a", borderRadius: 16, padding: 22 }}>
      <div style={{ color: "#8cc7ff", letterSpacing: ".08em", fontSize: 12, fontWeight: 800 }}>EXPERIMENTO · DATOS REALES · {data.experimentVersion}</div>
      <h2 style={{ margin: "8px 0 8px", fontSize: 28 }}>Acoplamiento núcleo–sismicidad</h2>
      <p style={{ margin: 0, maxWidth: 1000, lineHeight: 1.55, color: "#b8c8d2" }}>Prueba si la cinemática del polo magnético y los geomagnetic jerks añaden información estadística sobre la sismicidad global M≥7. El resultado compara un baseline sísmico con baseline + predictor geomagnético. No interpreta asociación como fuerza tectónica, causalidad ni predicción operativa.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16 }}>
        <button onClick={() => void load()} disabled={loading} style={{ padding: "9px 14px", borderRadius: 9, border: "1px solid #3d6075", background: "#123047", color: "#e8f3f8", cursor: "pointer" }}>{loading ? "Actualizando…" : "Actualizar datos reales"}</button>
        <span style={{ padding: "9px 12px", borderRadius: 9, background: "#102536", color: "#9eb4c2", fontSize: 12 }}>Retrospectiva congelada: 1904–{data.retrospectiveFreezeThrough}</span>
        <span style={{ padding: "9px 12px", borderRadius: 9, background: "#102536", color: "#9eb4c2", fontSize: 12 }}>Prospectiva: {data.currentProspectiveYear} → futuro</span>
      </div>
    </div>

    {data.warnings.length > 0 && <div className="quality-warning" style={{ marginTop: 14 }}>{data.warnings.join(" · ")}</div>}

    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 18 }}>
      <Metric label="Años retrospectivos" value={String(data.summary.annualRows)} note="1904–2025"/>
      <Metric label="Eventos M≥7" value={data.summary.historicalM7Events.toLocaleString()} note="USGS/ComCat"/>
      <Metric label="Puntos polo NOAA" value={String(data.summary.polePoints)} note={`hasta ${data.summary.latestPoleYear ?? "—"}`}/>
      <Metric label={`M≥7 en ${data.currentProspectiveYear}`} value={String(data.summary.currentYearM7Observed)} note={`${(data.summary.currentYearExposure * 100).toFixed(1)}% del año transcurrido`}/>
    </div>

    <div style={{ marginTop: 22, background: "#081724", border: "1px solid #20384a", borderRadius: 15, padding: 18 }}>
      <h3 style={{ marginTop: 0 }}>Historia observada</h3>
      <TimeSeriesChart annual={data.annual}/>
      <p style={{ fontSize: 12, color: "#8fa5b4", lineHeight: 1.5 }}>Las dos curvas están estandarizadas solo para visualización. Una coincidencia visual no se usa como evidencia; la inferencia se realiza sobre series detrendidas y con validación temporal separada.</p>
    </div>

    <div style={{ marginTop: 22, background: "#081724", border: "1px solid #20384a", borderRadius: 15, padding: 18 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: 12 }}>
        <label style={{ fontSize: 12, color: "#9eb4c2" }}>Predictor<br/><select value={predictor} onChange={e => setPredictor(e.target.value as PredictorKey)} style={{ marginTop: 5, padding: 8, borderRadius: 8, background: "#102536", color: "#e5eef4", border: "1px solid #315066" }}><option value="jerkIntensity">Geomagnetic jerks</option><option value="poleSpeedKmYr">Velocidad del polo</option><option value="poleAccelerationKmYr2">Aceleración del polo</option></select></label>
        <label style={{ fontSize: 12, color: "#9eb4c2" }}>Endpoint<br/><select value={endpoint} onChange={e => setEndpoint(e.target.value as EndpointKey)} style={{ marginTop: 5, padding: 8, borderRadius: 8, background: "#102536", color: "#e5eef4", border: "1px solid #315066" }}><option value="countM7">Conteo M≥7</option><option value="logMoment">log₁₀ ΣM₀ proxy</option></select></label>
      </div>
      {selected ? <>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "16px 0" }}>
          <Metric label="Mejor lag" value={`${selected.bestLagYears > 0 ? "+" : ""}${selected.bestLagYears} años`} note="seleccionado en desarrollo, no en test"/>
          <Metric label="r desarrollo" value={fmt(selected.developmentCorrelation)} note="detrendido"/>
          <Metric label="p corregido" value={fmt(selected.lagCorrectedP)} note="surrogates circulares; búsqueda ±20 a"/>
          <Metric label="ΔLL OOS" value={fmt(selected.deltaOosLogLikelihood, 2)} note="geomag − baseline, 1990–2025"/>
          <Metric label="IG OOS" value={fmt(selected.informationGainBitsPerYear, 3)} note="bits/año"/>
        </div>
        <LagChart profile={selected.lagProfile}/>
        <div style={{ marginTop: 12, padding: 13, borderRadius: 10, background: "#102536" }}><strong>{interpretationLabel[selected.interpretation]}</strong><div style={{ color: "#9eb3c0", fontSize: 12, marginTop: 4 }}>{predictorLabel[selected.predictor]} → {endpointLabel[selected.endpoint]}. Un lag positivo significa que el predictor geomagnético ocurre antes que la respuesta sísmica; uno negativo es una prueba de dirección inversa.</div></div>
      </> : <div style={{ marginTop: 16, color: "#a5b7c3" }}>No hay suficientes datos para esta combinación.</div>}
    </div>

    <div style={{ marginTop: 22, background: "#081724", border: "1px solid #20384a", borderRadius: 15, padding: 18 }}>
      <h3 style={{ marginTop: 0 }}>Registro prospectivo {data.currentProspectiveYear}</h3>
      {prospective ? <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <Metric label="Observados hasta hoy" value={String(prospective.observedCount)} note="M≥7 USGS"/>
        <Metric label="Baseline esperado a fecha" value={fmt(prospective.baselineExpectedToDate, 2)} note="ajustado por exposición del año"/>
        <Metric label="Geomag esperado a fecha" value={prospective.geomagExpectedToDate === null ? "pendiente" : fmt(prospective.geomagExpectedToDate, 2)} note={prospective.predictorAvailable ? `${predictorLabel[predictor]}, lag ${prospective.lagYears}` : "el predictor requerido aún no está publicado"}/>
      </div> : <p style={{ color: "#9eb4c2" }}>Sin score prospectivo para este predictor.</p>}
      <p style={{ color: "#8fa5b4", fontSize: 12, lineHeight: 1.55 }}>Este panel acumula observaciones futuras sin reescribir el bloque retrospectivo 1904–2025. El año actual es parcial y se corrige por la fracción de año transcurrida. No convierte el modelo en una alarma de terremotos.</p>
    </div>

    <div style={{ marginTop: 22, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(270px,1fr))", gap: 12 }}>
      <div style={{ background: "#081724", border: "1px solid #20384a", borderRadius: 15, padding: 18 }}><h3 style={{ marginTop: 0 }}>Hipótesis</h3>{Object.entries(data.hypotheses).map(([key, value]) => <p key={key} style={{ fontSize: 13, lineHeight: 1.45 }}><strong>{key}</strong> · {value}</p>)}</div>
      <div style={{ background: "#081724", border: "1px solid #20384a", borderRadius: 15, padding: 18 }}><h3 style={{ marginTop: 0 }}>Fuentes activas</h3>{Object.values(data.sources).map((source, i) => <p key={i} style={{ fontSize: 13, lineHeight: 1.45 }}><strong>{source.name ?? source.status}</strong>{source.coverage ? ` · ${source.coverage}` : ""}<br/><span style={{ color: "#8fa5b4" }}>{source.note ?? source.momentNote ?? source.filter}</span>{source.url && <><br/><a href={source.url} target="_blank" rel="noreferrer" style={{ color: "#7bc0ff" }}>fuente oficial</a></>}</p>)}</div>
    </div>

    <div style={{ marginTop: 18, padding: 16, borderRadius: 12, border: "1px solid #51472d", background: "#211d11", color: "#d8cda7", fontSize: 12, lineHeight: 1.55 }}><strong>Estado científico v0.1.</strong> H<sub>pole</sub> y H<sub>jerk</sub> corren con datos reales. H<sub>SA</sub> permanece desactivada deliberadamente hasta ingerir series mensuales BGS/INTERMAGNET o CHAOS-8; no se calcula aceleración secular tomando segundas derivadas de IGRF a cinco años. ΣM₀ está marcado como proxy derivado de magnitud hasta añadir la réplica de momento directo GCMT/ISC.</div>
  </section>;
}
