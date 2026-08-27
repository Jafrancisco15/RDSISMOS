"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { VolcanoActivityMetrics, VolcanoCatalogEntry, VolcanoProbabilityComparison } from "@/lib/volcanoActivity";
import { readJsonResponse } from "@/lib/safeFetchJson";
import { VolcanoActivityMap } from "./VolcanoActivityMap";

type CatalogPayload = {
  volcanoes?: VolcanoCatalogEntry[];
  warnings?: Array<{ source: string; message: string }>;
  sources?: string[];
  generatedAt?: string;
};

type AnalysisPayload = {
  volcano?: VolcanoCatalogEntry;
  generatedAt?: string;
  settings?: { seismicMinMagnitude: number; forecastMagnitude: number; radiusKm: number; horizonDays: number };
  activity?: VolcanoActivityMetrics;
  baseline?: { probability: number; expectedCount: number; backgroundExpectedCount: number; triggeredExpectedCount: number; backgroundRatePerDay: number; triggerCount: number };
  comparison?: VolcanoProbabilityComparison;
  events?: EarthquakeEvent[];
  methodology?: Record<string, string>;
  sources?: string[];
  catalogWarnings?: Array<{ source: string; message: string }>;
  error?: string;
};

const panel: React.CSSProperties = { border: "1px solid rgba(249,115,22,.18)", borderRadius: 16, background: "linear-gradient(145deg,#101117,#05070b)", padding: 14 };
const control: React.CSSProperties = { width: "100%", background: "#111827", color: "white", border: "1px solid #374151", borderRadius: 9, padding: 8, marginTop: 4 };
const button: React.CSSProperties = { background: "#9a3412", color: "white", border: "1px solid #f97316", borderRadius: 10, padding: "9px 12px", cursor: "pointer", fontWeight: 800 };

function pct(value: number) { return `${(value * 100).toFixed(value < 0.1 ? 2 : 1)}%`; }
function score(value: number) { return `${value.toFixed(0)}/100`; }

function ScoreCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div style={{ ...panel, minHeight: 105 }}><div style={{ color: "#94a3b8", fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</div><div style={{ color: "#fff7ed", fontSize: 27, fontWeight: 900, marginTop: 5 }}>{value}</div><div style={{ color: "#cbd5e1", fontSize: 11, marginTop: 4 }}>{detail}</div></div>;
}

export function VolcanoActivityDashboard() {
  const [volcanoes, setVolcanoes] = useState<VolcanoCatalogEntry[]>([]);
  const [catalogWarnings, setCatalogWarnings] = useState<Array<{ source: string; message: string }>>([]);
  const [catalogSources, setCatalogSources] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("all");
  const [activeOnly, setActiveOnly] = useState(false);
  const [seismicMinMagnitude, setSeismicMinMagnitude] = useState(1.5);
  const [forecastMagnitude, setForecastMagnitude] = useState(4.5);
  const [radiusKm, setRadiusKm] = useState(200);
  const [horizonDays, setHorizonDays] = useState(7);
  const [analysis, setAnalysis] = useState<AnalysisPayload | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadingCatalog(true);
    fetch("/api/volcano-activity", { cache: "no-store" }).then(async (response) => {
      const payload = await readJsonResponse<CatalogPayload>(response);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return payload;
    }).then((payload) => {
      if (!active) return;
      const rows = payload.volcanoes ?? [];
      setVolcanoes(rows);
      setCatalogWarnings(payload.warnings ?? []);
      setCatalogSources(payload.sources ?? []);
      const preferred = rows.find((volcano) => volcano.weeklyReportType || volcano.usgsAlertLevel)
        ?? rows.find((volcano) => /kilauea|etna|popocatepetl/i.test(volcano.name))
        ?? rows[0];
      if (preferred) setSelectedId(preferred.id);
    }).catch((err) => { if (active) setError(err instanceof Error ? err.message : "No fue posible cargar volcanes."); })
      .finally(() => { if (active) setLoadingCatalog(false); });
    return () => { active = false; };
  }, []);

  const countries = useMemo(() => [...new Set(volcanoes.map((volcano) => volcano.country).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [volcanoes]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return volcanoes.filter((volcano) => {
      if (country !== "all" && volcano.country !== country) return false;
      if (activeOnly && !volcano.weeklyReportType && !volcano.usgsAlertLevel && !volcano.usgsColorCode) return false;
      if (query && !`${volcano.name} ${volcano.country} ${volcano.region}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [activeOnly, country, search, volcanoes]);

  const selected = volcanoes.find((volcano) => volcano.id === selectedId) ?? null;

  const runAnalysis = useCallback(async () => {
    if (!selectedId) return;
    setLoadingAnalysis(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        id: selectedId,
        seismicMinMagnitude: String(seismicMinMagnitude),
        forecastMagnitude: String(forecastMagnitude),
        radiusKm: String(radiusKm),
        horizonDays: String(horizonDays),
      });
      const response = await fetch(`/api/volcano-activity/analyze?${params}`, { cache: "no-store" });
      const payload = await readJsonResponse<AnalysisPayload>(response);
      if (!response.ok || payload.error) throw new Error(payload.error ?? `HTTP ${response.status}`);
      setAnalysis(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falló el análisis volcánico.");
    } finally {
      setLoadingAnalysis(false);
    }
  }, [forecastMagnitude, horizonDays, radiusKm, seismicMinMagnitude, selectedId]);

  useEffect(() => {
    if (selectedId && !analysis && !loadingAnalysis) void runAnalysis();
  }, [analysis, loadingAnalysis, runAnalysis, selectedId]);

  const selectVolcano = (id: string) => {
    setSelectedId(id);
    setAnalysis(null);
  };

  const activity = analysis?.activity;
  const events = analysis?.events ?? [];
  const comparison = analysis?.comparison;
  const elevatedCount = volcanoes.filter((volcano) => volcano.weeklyReportType || volcano.usgsAlertLevel || volcano.usgsColorCode).length;

  return <section style={{ maxWidth: 1500, margin: "0 auto", padding: "18px 18px 48px" }}>
    <div style={{ ...panel, borderColor: "rgba(249,115,22,.32)", marginBottom: 14 }}>
      <div style={{ color: "#fb923c", fontWeight: 900, fontSize: 12, letterSpacing: ".08em" }}>VOLCANO ACTIVITY · SISMOLOGÍA + UNREST</div>
      <h1 style={{ margin: "7px 0 5px", color: "white", fontSize: "clamp(26px,4vw,46px)" }}>¿Cuándo la sismicidad alrededor de un volcán contiene información adicional?</h1>
      <p style={{ margin: 0, color: "#cbd5e1", maxWidth: 1050, lineHeight: 1.6 }}>El módulo compara un baseline sísmico ETAS/Hawkes con una capa experimental de actividad volcánica. La presencia de sismos, enjambres o migración hipocentral no implica por sí sola una erupción; la evidencia mejora cuando coincide con deformación, gases, térmica y observaciones del volcán.</p>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 14 }}>
      <ScoreCard label="Catálogo" value={loadingCatalog ? "…" : String(volcanoes.length)} detail="Holoceno GVP; fallback si WFS falla" />
      <ScoreCard label="Actividad señalada" value={String(elevatedCount)} detail="GVP Weekly y/o USGS HANS" />
      <ScoreCard label="Sismos mostrados" value={String(events.length)} detail={`ComCat M${seismicMinMagnitude.toFixed(1)}+ · últimos 30 días`} />
      <ScoreCard label="Fuentes vivas" value={String(catalogSources.length)} detail={catalogSources.join(" · ") || "fallback local"} />
    </div>

    <div style={{ ...panel, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginBottom: 14 }}>
      <label style={{ color: "#cbd5e1", fontSize: 11 }}>Buscar volcán<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Etna, Indonesia…" style={control} /></label>
      <label style={{ color: "#cbd5e1", fontSize: 11 }}>País<select value={country} onChange={(event) => setCountry(event.target.value)} style={control}><option value="all">Todos</option>{countries.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label style={{ color: "#cbd5e1", fontSize: 11 }}>Volcán<select value={selectedId} onChange={(event) => selectVolcano(event.target.value)} style={control}><option value="">Seleccionar…</option>{filtered.slice(0, 1500).map((volcano) => <option key={volcano.id} value={volcano.id}>{volcano.name} · {volcano.country}</option>)}</select></label>
      <label style={{ color: "#cbd5e1", fontSize: 11 }}>Sismicidad mínima<select value={seismicMinMagnitude} onChange={(event) => { setSeismicMinMagnitude(Number(event.target.value)); setAnalysis(null); }} style={control}><option value={0}>M0+</option><option value={1}>M1+</option><option value={1.5}>M1.5+</option><option value={2.5}>M2.5+</option><option value={3}>M3+</option></select></label>
      <label style={{ color: "#cbd5e1", fontSize: 11 }}>Forecast sísmico<select value={forecastMagnitude} onChange={(event) => { setForecastMagnitude(Number(event.target.value)); setAnalysis(null); }} style={control}><option value={4}>M4+</option><option value={4.5}>M4.5+</option><option value={5}>M5+</option><option value={5.5}>M5.5+</option></select></label>
      <label style={{ color: "#cbd5e1", fontSize: 11 }}>Radio ETAS<select value={radiusKm} onChange={(event) => { setRadiusKm(Number(event.target.value)); setAnalysis(null); }} style={control}><option value={100}>100 km</option><option value={200}>200 km</option><option value={300}>300 km</option></select></label>
      <label style={{ color: "#cbd5e1", fontSize: 11 }}>Horizonte<select value={horizonDays} onChange={(event) => { setHorizonDays(Number(event.target.value)); setAnalysis(null); }} style={control}><option value={3}>3 días</option><option value={7}>7 días</option><option value={14}>14 días</option></select></label>
      <div style={{ display: "flex", gap: 9, alignItems: "end", flexWrap: "wrap" }}><label style={{ color: "#cbd5e1", fontSize: 11, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={activeOnly} onChange={(event) => setActiveOnly(event.target.checked)} /> Solo actividad señalada</label><button onClick={() => void runAnalysis()} disabled={!selectedId || loadingAnalysis} style={button}>{loadingAnalysis ? "Analizando…" : "Recalcular"}</button></div>
    </div>

    {catalogWarnings.length > 0 && <div style={{ ...panel, marginBottom: 14, color: "#fbbf24", fontSize: 11 }}>{catalogWarnings.map((warning) => <div key={`${warning.source}-${warning.message}`}><strong>{warning.source}:</strong> {warning.message}</div>)}</div>}
    {error && <div style={{ ...panel, marginBottom: 14, color: "#fca5a5" }}>{error}</div>}

    <VolcanoActivityMap volcanoes={filtered.length ? filtered : volcanoes} selectedId={selectedId} events={events} onVolcanoSelect={selectVolcano} />

    {selected && <div style={{ ...panel, marginTop: 14 }}><div style={{ color: "#fb923c", fontWeight: 900 }}>{selected.name} · {selected.country}</div><div style={{ color: "#cbd5e1", fontSize: 12, marginTop: 5 }}>{selected.region} · {selected.latitude.toFixed(3)}, {selected.longitude.toFixed(3)}{selected.elevationM !== null ? ` · ${selected.elevationM.toFixed(0)} m` : ""}{selected.lastEruption ? ` · última erupción: ${selected.lastEruption}` : ""}</div>{selected.weeklyReportType && <div style={{ color: "#fdba74", marginTop: 6 }}>GVP Weekly: {selected.weeklyReportType}</div>}{(selected.usgsAlertLevel || selected.usgsColorCode) && <div style={{ color: "#fde047", marginTop: 4 }}>USGS HANS: {selected.usgsAlertLevel ?? ""} {selected.usgsColorCode ?? ""}</div>}</div>}

    {activity && comparison && analysis?.baseline && <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10, marginTop: 14 }}>
        <ScoreCard label="Unrest sísmico" value={score(activity.seismicUnrestScore)} detail="tasa · profundidad · migración · magnitud" />
        <ScoreCard label="Evidencia observatoria" value={score(activity.evidenceScore)} detail="GVP Weekly / USGS HANS cuando existen" />
        <ScoreCard label="Índice combinado" value={score(activity.combinedUnrestScore)} detail="experimental; no probabilidad de erupción" />
        <ScoreCard label="M máxima 30 d" value={activity.maxMagnitude30d === null ? "—" : `M${activity.maxMagnitude30d.toFixed(1)}`} detail={`${activity.eventCount7d} eventos 7 d · ${activity.eventCount24h} en 24 h`} />
        <ScoreCard label="Migración profundidad" value={activity.depthMigrationKmPerDay === null ? "—" : `${activity.depthMigrationKmPerDay.toFixed(2)} km/d`} detail="negativo = tendencia somerizante del ajuste lineal" />
        <ScoreCard label="Aceleración 7 d" value={`${activity.sevenDayRateRatio.toFixed(2)}×`} detail="tasa 7 d vs días 8–30, con suavizado" />
      </div>

      <div style={{ ...panel, marginTop: 14 }}>
        <div style={{ color: "#fb923c", fontWeight: 900, marginBottom: 8 }}>ETAS vs ETAS + Volcano</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
          <ScoreCard label="ETAS baseline" value={pct(comparison.baselineProbability)} detail={`M${forecastMagnitude.toFixed(1)}+ · ${radiusKm} km · ${horizonDays} días`} />
          <ScoreCard label="ETAS + Volcano" value={pct(comparison.volcanoConditionedProbability)} detail="comparación experimental, no forecast de erupción" />
          <ScoreCard label="Aporte capa volcánica" value={`${comparison.deltaProbabilityPoints >= 0 ? "+" : ""}${comparison.deltaProbabilityPoints.toFixed(2)} pp`} detail={`Δ log-odds ${comparison.logOddsAdjustment.toFixed(3)}`} />
          <ScoreCard label="ETAS λ esperado" value={analysis.baseline.expectedCount.toFixed(3)} detail={`fondo ${analysis.baseline.backgroundExpectedCount.toFixed(3)} · triggered ${analysis.baseline.triggeredExpectedCount.toFixed(3)}`} />
        </div>
        <p style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.5, marginBottom: 0 }}>Esta primera capa todavía comparte información sísmica con ETAS; por eso no debe interpretarse como evidencia independiente hasta añadir deformación, gases y térmica. Su utilidad real se decidirá prospectivamente por Brier/information gain frente a ETAS.</p>
      </div>

      <div style={{ ...panel, marginTop: 14, overflowX: "auto" }}>
        <div style={{ color: "#fb923c", fontWeight: 900, marginBottom: 8 }}>Sismicidad por distancia al volcán</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, color: "#e2e8f0" }}><thead><tr style={{ color: "#94a3b8", textAlign: "left" }}><th style={{ padding: 7 }}>Anillo</th><th>Eventos 30 d</th><th>M máxima</th><th>Profundidad mediana</th></tr></thead><tbody>{activity.bands.map((band) => <tr key={band.label} style={{ borderTop: "1px solid #1f2937" }}><td style={{ padding: 7 }}>{band.label}</td><td>{band.count}</td><td>{band.maxMagnitude === null ? "—" : `M${band.maxMagnitude.toFixed(1)}`}</td><td>{band.medianDepthKm === null ? "—" : `${band.medianDepthKm.toFixed(1)} km`}</td></tr>)}</tbody></table>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 10, marginTop: 14 }}>
        <div style={panel}><div style={{ color: "#86efac", fontWeight: 900 }}>Evidencia disponible</div>{activity.evidenceChannels.length ? activity.evidenceChannels.map((item) => <div key={item} style={{ color: "#cbd5e1", fontSize: 12, marginTop: 6 }}>✓ {item}</div>) : <div style={{ color: "#94a3b8", marginTop: 7 }}>Sin canal observatorio adicional en esta consulta.</div>}</div>
        <div style={panel}><div style={{ color: "#fbbf24", fontWeight: 900 }}>Datos que faltan para inferencia fuerte</div>{activity.missingChannels.map((item) => <div key={item} style={{ color: "#cbd5e1", fontSize: 12, marginTop: 6 }}>• {item}</div>)}</div>
      </div>

      <div style={{ ...panel, marginTop: 14 }}>
        <div style={{ color: "#fb923c", fontWeight: 900 }}>Resultados del megaestudio convertidos en reglas de RDSISMOS</div>
        <p style={{ color: "#cbd5e1", lineHeight: 1.6, fontSize: 12 }}>La sismicidad cercana es una señal de vigilancia bien establecida, especialmente cuando cambia de tasa, profundidad o tipo. Un gran terremoto remoto puede perturbar un sistema volcánico susceptible, pero una coincidencia temporal no demuestra que haya causado una erupción. Por eso este tab separa distancia, tiempo y estado del volcán y conserva ETAS como baseline.</p>
        <p style={{ color: "#cbd5e1", lineHeight: 1.6, fontSize: 12, marginBottom: 0 }}>La siguiente fase científica es añadir GNSS/InSAR, SO₂ y anomalías térmicas y después congelar ventanas prospectivas para medir Brier Skill Score e information gain de <strong>ETAS+Volcano</strong> contra <strong>ETAS</strong>.</p>
      </div>

      {analysis.methodology && <details style={{ ...panel, marginTop: 14 }}><summary style={{ color: "#fdba74", cursor: "pointer", fontWeight: 800 }}>Metodología y límites</summary>{Object.entries(analysis.methodology).map(([key, value]) => <p key={key} style={{ color: "#cbd5e1", fontSize: 11, lineHeight: 1.5 }}><strong>{key}:</strong> {value}</p>)}</details>}
    </>}
  </section>;
}
