"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { GlobeMapLayersResponse } from "@/lib/globeLayers";
import type { MantleTomographyResponse } from "@/lib/mantleTomography";
import type { SeismicMechanismResponse } from "@/lib/seismicMechanisms";
import { lunarPosition } from "@/lib/lunar";
import { readJsonResponse } from "@/lib/safeFetchJson";
import {
  TECTONIC_STATE_DEPTH_BANDS,
  reconstructTectonicState4D,
  tectonicStateWindow,
  type TectonicStateDepthBand,
} from "@/lib/tectonicState4d";
import { TectonicStatePhase2 } from "./TectonicStatePhase2";

const StateMap = dynamic(
  () => import("./TectonicState4DMap").then((module) => module.TectonicState4DMap),
  { ssr: false, loading: () => <div style={{ height: 560, display: "grid", placeItems: "center", borderRadius: 14, background: "#06111d", color: "#bae6fd" }}>Reconstruyendo estado tectónico…</div> },
);

type EventsPayload = { events?: EarthquakeEvent[]; total?: number; error?: string };
type GeomagneticContext = {
  anomalies?: Array<{ stationCode?: string; anomalyZ?: number; latitude?: number; longitude?: number }>;
  groundPoints?: unknown[];
  swarmPoints?: unknown[];
  sourceStatus?: Record<string, boolean>;
  error?: string;
};

type CorePayload = {
  events: EarthquakeEvent[];
  mechanisms: SeismicMechanismResponse;
  tomography: MantleTomographyResponse;
  layers: GlobeMapLayersResponse;
};

const panel: React.CSSProperties = { margin: "16px", padding: 14, borderRadius: 18, border: "1px solid rgba(56,189,248,.18)", background: "linear-gradient(145deg,#061322,#020914)" };
const card: React.CSSProperties = { padding: 11, borderRadius: 12, background: "rgba(15,23,42,.68)", border: "1px solid rgba(148,163,184,.13)" };
const control: React.CSSProperties = { background: "#071525", color: "white", border: "1px solid #334155", borderRadius: 8, padding: "6px 8px", fontSize: 10 };

function dateInput(date: Date) { return date.toISOString().slice(0, 10); }
function pct(value: number) { return `${Math.round(value)}%`; }
function supportColor(score: number) { return score >= 70 ? "#34d399" : score >= 42 ? "#fbbf24" : "#fb7185"; }
function signed(value: number, digits = 2) { return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`; }

function depthBand(id: string): TectonicStateDepthBand {
  return TECTONIC_STATE_DEPTH_BANDS.find((band) => band.id === id) ?? TECTONIC_STATE_DEPTH_BANDS[3];
}

function emptyTomography(depthKm: number, warning: string): MantleTomographyResponse {
  return {
    generatedAt: new Date().toISOString(),
    source: "EarthScope EMC",
    model: "SEISGLOB2",
    referenceModel: "PREM",
    depthKm,
    gridStepDeg: 8,
    cells: [],
    minDvsPct: 0,
    maxDvsPct: 0,
    meanDvsPct: 0,
    scaleAbsPct: 1,
    fastPct: 0,
    slowPct: 0,
    warnings: [warning],
  };
}

export function TectonicState4D() {
  const [days, setDays] = useState(60);
  const [minMagnitude, setMinMagnitude] = useState(4.5);
  const [depthBandId, setDepthBandId] = useState<TectonicStateDepthBand["id"]>("all");
  const [tomographyDepth, setTomographyDepth] = useState(100);
  const [core, setCore] = useState<CorePayload | null>(null);
  const [geomag, setGeomag] = useState<GeomagneticContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tomographyWarning, setTomographyWarning] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const window = useMemo(() => tectonicStateWindow(days), [days, refreshKey]);
  const selectedBand = depthBand(depthBandId);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setTomographyWarning(null);
    const eventParams = new URLSearchParams({ starttime: dateInput(window.start), endtime: dateInput(window.end), minmagnitude: String(minMagnitude) });
    const mechanismParams = new URLSearchParams({ days: String(days), minMagnitude: String(Math.max(5.5, minMagnitude)), limit: "48", orderBy: "time" });
    const tomographyParams = new URLSearchParams({ depth: String(tomographyDepth) });

    const tomographyPromise = fetch(`/api/mantle-tomography?${tomographyParams}`, { cache: "force-cache", signal: controller.signal })
      .then((response) => readJsonResponse<MantleTomographyResponse & { error?: string }>(response).then((body) => {
        if (!response.ok) throw new Error(body.error ?? `Tomografía HTTP ${response.status}`);
        return body;
      }))
      .catch((tomographyError) => {
        if (tomographyError instanceof DOMException && tomographyError.name === "AbortError") throw tomographyError;
        const warning = tomographyError instanceof Error ? tomographyError.message : "Tomografía temporalmente no disponible.";
        setTomographyWarning(warning);
        return emptyTomography(tomographyDepth, warning);
      });

    Promise.all([
      fetch(`/api/extractions/events?${eventParams}`, { cache: "no-store", signal: controller.signal }).then((response) => readJsonResponse<EventsPayload>(response).then((body) => { if (!response.ok) throw new Error(body.error ?? `Eventos HTTP ${response.status}`); return body.events ?? []; })),
      fetch(`/api/seismic-mechanisms?${mechanismParams}`, { cache: "no-store", signal: controller.signal }).then((response) => readJsonResponse<SeismicMechanismResponse & { error?: string }>(response).then((body) => { if (!response.ok) throw new Error(body.error ?? `Mecanismos HTTP ${response.status}`); return body; })),
      tomographyPromise,
      fetch("/api/globe/layers?include=boundaries,faults", { cache: "force-cache", signal: controller.signal }).then((response) => readJsonResponse<GlobeMapLayersResponse & { error?: string }>(response).then((body) => { if (!response.ok) throw new Error(body.error ?? `Geometría HTTP ${response.status}`); return body; })),
    ]).then(([events, mechanisms, tomography, layers]) => setCore({ events, mechanisms, tomography, layers }))
      .catch((loadError) => { if (!(loadError instanceof DOMException && loadError.name === "AbortError")) setError(loadError instanceof Error ? loadError.message : "No fue posible reconstruir Tectonic State 4D."); })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [days, minMagnitude, tomographyDepth, refreshKey, window.start, window.end]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/geomagnetism/world-observation?_=${Date.now()}-${refreshKey}`, { cache: "no-store", signal: controller.signal })
      .then((response) => readJsonResponse<GeomagneticContext>(response).then((body) => response.ok ? body : null))
      .then((body) => setGeomag(body))
      .catch(() => setGeomag(null));
    return () => controller.abort();
  }, [refreshKey]);

  const reconstruction = useMemo(() => {
    if (!core) return null;
    return reconstructTectonicState4D(core.events, core.mechanisms.mechanisms, core.tomography.cells, {
      startTime: window.start,
      endTime: window.end,
      depthBand: selectedBand,
      gridSizeDeg: 8,
    });
  }, [core, window.start, window.end, selectedBand]);

  const filteredEvents = useMemo(() => (core?.events ?? []).filter((event) => event.depthKm >= selectedBand.minKm && event.depthKm <= selectedBand.maxKm), [core, selectedBand]);
  const moon = useMemo(() => lunarPosition(new Date()), [refreshKey]);
  const summary = reconstruction?.summary;
  const geomagAnomalies = geomag?.anomalies?.length ?? 0;

  return <section style={panel}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "start" }}>
      <div style={{ minWidth: 0, flex: "1 1 540px" }}>
        <div style={{ color: "#67e8f9", fontSize: 10, fontWeight: 900, letterSpacing: ".1em" }}>EXPERIMENTO FÍSICO · X / Y / Z / TIEMPO</div>
        <h1 style={{ color: "white", margin: "5px 0 5px", fontSize: "clamp(23px,4vw,34px)" }}>Tectonic State 4D</h1>
        <p style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.6, margin: 0, maxWidth: 1000 }}>
          Reconstrucción experimental del <b style={{ color: "#e2e8f0" }}>estado observado y su cambio</b>, no “migración” ni pronóstico. Combina catálogo sísmico, momento liberado, mecanismos focales, tomografía SEISGLOB2 y geometría de placas/fallas. Geomagnetismo y marea lunar se muestran como observaciones externas independientes y todavía no alteran el índice mecánico.
        </p>
      </div>
      <button type="button" onClick={() => setRefreshKey((value) => value + 1)} style={{ ...control, borderColor: "#0ea5e9", cursor: "pointer" }}>{loading ? "Reconstruyendo…" : "Actualizar estado"}</button>
    </div>

    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, alignItems: "end" }}>
      <label style={{ color: "#94a3b8", fontSize: 9 }}>Ventana<br /><select value={days} onChange={(event) => setDays(Number(event.target.value))} style={control}><option value={30}>30 días</option><option value={60}>60 días</option><option value={90}>90 días</option><option value={120}>120 días</option></select></label>
      <label style={{ color: "#94a3b8", fontSize: 9 }}>Magnitud mínima<br /><select value={minMagnitude} onChange={(event) => setMinMagnitude(Number(event.target.value))} style={control}><option value={4}>M4.0+</option><option value={4.5}>M4.5+</option><option value={5}>M5.0+</option><option value={5.5}>M5.5+</option></select></label>
      <label style={{ color: "#94a3b8", fontSize: 9 }}>Volumen de profundidad<br /><select value={depthBandId} onChange={(event) => setDepthBandId(event.target.value as TectonicStateDepthBand["id"])} style={control}>{TECTONIC_STATE_DEPTH_BANDS.map((band) => <option key={band.id} value={band.id}>{band.label}</option>)}</select></label>
      <label style={{ color: "#94a3b8", fontSize: 9 }}>Corte tomográfico dVs<br /><select value={tomographyDepth} onChange={(event) => setTomographyDepth(Number(event.target.value))} style={control}><option value={100}>100 km</option><option value={400}>400 km</option><option value={650}>650 km</option><option value={1000}>1000 km</option></select></label>
    </div>

    <div style={{ marginTop: 10, padding: 9, borderRadius: 11, border: "1px solid rgba(251,191,36,.22)", background: "rgba(120,53,15,.12)", color: "#fde68a", fontSize: 9.5, lineHeight: 1.5 }}>
      <b>Estado v0.2:</b> el cambio t₀→t₁ sigue separado de cualquier pronóstico. Fase 2 añade waveforms reales y cobertura de rayos, pero todavía no convierte esa cobertura en Vp/Vs/Q ni en tensión acumulada.
    </div>

    {tomographyWarning && <div style={{ marginTop: 9, padding: 9, borderRadius: 10, color: "#fde68a", background: "rgba(120,53,15,.12)", border: "1px solid rgba(251,191,36,.24)", fontSize: 9 }}>
      <b>SEISGLOB2 en modo degradado:</b> {tomographyWarning} El resto de Tectonic State 4D permanece operativo y la tomografía se reincorpora automáticamente cuando la fuente responde.
    </div>}
    {error && <div style={{ marginTop: 10, padding: 11, borderRadius: 11, color: "#fecaca", background: "rgba(127,29,29,.18)", border: "1px solid rgba(248,113,113,.3)" }}>{error}</div>}

    {summary && <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 8, marginTop: 12 }}>
        <article style={card}><div style={{ color: "#67e8f9", fontSize: 8.5, fontWeight: 900 }}>SISMICIDAD OBSERVADA</div><strong style={{ color: "white", fontSize: 21 }}>{summary.eventCount}</strong><div style={{ color: "#64748b", fontSize: 8.5 }}>t₀ {summary.earlyEvents} → t₁ {summary.recentEvents}</div></article>
        <article style={card}><div style={{ color: "#c4b5fd", fontSize: 8.5, fontWeight: 900 }}>MECANISMOS FOCALES</div><strong style={{ color: "white", fontSize: 21 }}>{summary.mechanismCount}</strong><div style={{ color: "#64748b", fontSize: 8.5 }}>USGS moment tensor / P-T axes</div></article>
        <article style={card}><div style={{ color: "#fdba74", fontSize: 8.5, fontWeight: 900 }}>TOMOGRAFÍA</div><strong style={{ color: "white", fontSize: 21 }}>{summary.tomographyCells}</strong><div style={{ color: "#64748b", fontSize: 8.5 }}>{summary.tomographyCells ? `SEISGLOB2 dVs · ${core?.tomography.depthKm ?? tomographyDepth} km` : "temporalmente opcional"}</div></article>
        <article style={card}><div style={{ color: supportColor(summary.coverageScore), fontSize: 8.5, fontWeight: 900 }}>SOPORTE DE RECONSTRUCCIÓN</div><strong style={{ color: "white", fontSize: 21 }}>{summary.coverageScore}/100</strong><div style={{ color: "#64748b", fontSize: 8.5 }}>{summary.coverageLabel} · no probabilidad sísmica</div></article>
        <article style={card}><div style={{ color: "#f0abfc", fontSize: 8.5, fontWeight: 900 }}>GEOMAGNETISMO</div><strong style={{ color: "white", fontSize: 21 }}>{geomagAnomalies}</strong><div style={{ color: "#64748b", fontSize: 8.5 }}>anomalías temporales actuales; contexto independiente</div></article>
        <article style={card}><div style={{ color: "#fde68a", fontSize: 8.5, fontWeight: 900 }}>MAREA LUNAR · CONTEXTO</div><strong style={{ color: "white", fontSize: 15 }}>{moon.phaseName}</strong><div style={{ color: "#64748b", fontSize: 8.5 }}>{pct(moon.illuminatedFraction * 100)} iluminada · sublunar {moon.latitude.toFixed(1)}°, {moon.longitude.toFixed(1)}°</div></article>
      </div>

      <div style={{ marginTop: 12 }}>
        <StateMap cells={reconstruction!.cells} events={filteredEvents} boundaries={core?.layers.plateBoundaries ?? []} faults={core?.layers.activeFaults ?? []} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,290px),1fr))", gap: 10, marginTop: 12 }}>
        <article style={card}>
          <div style={{ color: "#67e8f9", fontSize: 9, fontWeight: 900 }}>CAMBIOS CON MAYOR SOPORTE</div>
          <div style={{ marginTop: 7, display: "grid", gap: 6 }}>
            {summary.strongestChanges.length ? summary.strongestChanges.map((cell) => <div key={cell.id} style={{ padding: 7, borderRadius: 8, background: "rgba(2,8,18,.58)", color: "#cbd5e1", fontSize: 9, lineHeight: 1.45 }}>
              <b style={{ color: cell.signedChange >= 0 ? "#fb7185" : "#60a5fa" }}>{cell.latitude.toFixed(1)}°, {cell.longitude.toFixed(1)}° · {signed(cell.signedChange * 100, 0)}%</b><br />
              t₀/t₁ {cell.earlyCount}/{cell.recentCount} · Mw máx {cell.maxMagnitude.toFixed(1)} · soporte {cell.supportScore}/100 · dVs {cell.tomographyDvsPct === null ? "N/D" : `${signed(cell.tomographyDvsPct)}%`}
            </div>) : <span style={{ color: "#64748b", fontSize: 9 }}>No hay celdas con soporte suficiente en esta selección.</span>}
          </div>
        </article>

        <article style={card}>
          <div style={{ color: "#a5b4fc", fontSize: 9, fontWeight: 900 }}>CAPAS FUSIONADAS AHORA</div>
          <div style={{ marginTop: 7, color: "#cbd5e1", fontSize: 9.5, lineHeight: 1.6 }}>
            <b>Catálogo sísmico:</b> posición, profundidad, tiempo, magnitud y momento aproximado.<br />
            <b>Mecanismos focales:</b> orientación de ruptura/ejes P-T para soporte mecánico.<br />
            <b>SEISGLOB2:</b> anomalías dVs como estructura independiente del manto cuando EMC está disponible.<br />
            <b>PB2002 + GEM:</b> límites de placa y fallas activas como geometría.<br />
            <b>Geomagnetismo:</b> contexto observacional separado; no modifica el estado mecánico.<br />
            <b>Luna:</b> perturbación externa conocida; contexto experimental, peso mecánico 0.
          </div>
        </article>

        <article style={card}>
          <div style={{ color: "#34d399", fontSize: 9, fontWeight: 900 }}>RUTA DE INVERSIÓN</div>
          <div style={{ marginTop: 7, color: "#cbd5e1", fontSize: 9.5, lineHeight: 1.6 }}>
            <b>Fase 2 · activa:</b> waveforms Z/N/E EarthScope/FDSN + cobertura de rayos por voxel.<br />
            <b>Fase 3:</b> residual observado−sintético + back-propagation para actualizar Vp/Vs/Q.<br />
            <b>Fase 4:</b> GNSS/InSAR para deformación y relajación post-sísmica.<br />
            <b>Fase 5:</b> ΔCFS por falla y evolución viscoelástica 4D, validada contra períodos de control.
          </div>
        </article>
      </div>

      <TectonicStatePhase2 events={core?.events ?? []} />

      <details style={{ marginTop: 11, ...card, color: "#cbd5e1", fontSize: 9.5 }}>
        <summary style={{ cursor: "pointer", fontWeight: 900, color: "#e2e8f0" }}>Método y límites de Tectonic State 4D v0.2</summary>
        <div style={{ marginTop: 8, lineHeight: 1.6 }}>
          La ventana se divide en dos mitades iguales. Cada celda de 8° compara conteo y momento sísmico liberado entre t₀ y t₁. El corte tomográfico aporta contexto estructural y ahora es fail-open: una caída de EMC no detiene el módulo. Fase 2 recupera waveforms observados y calcula cobertura geométrica P/S por voxel; todavía no invierte velocidades. El score de cobertura mide disponibilidad de datos independientes; <b>no estima probabilidad de terremoto</b>. Esta versión no reemplaza Scope, ETAS, Historial ni los módulos de migración existentes.
        </div>
      </details>
    </>}
  </section>;
}
