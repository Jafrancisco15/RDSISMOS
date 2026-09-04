"use client";

import { useEffect, useMemo, useState } from "react";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { EarthScopeThreeComponentWaveforms } from "@/lib/earthscopeThreeComponent";
import type { TectonicStatePhase2Coverage } from "@/lib/tectonicStatePhase2";
import type { TectonicStatePhase3Result } from "@/lib/tectonicStatePhase3";
import { readJsonResponse } from "@/lib/safeFetchJson";
import { TectonicStatePhase3 } from "./TectonicStatePhase3";

type Phase2Response = {
  phase: 2;
  generatedAt: string;
  available: boolean;
  stationCandidates?: number;
  waveforms: EarthScopeThreeComponentWaveforms | null;
  rayCoverage: TectonicStatePhase2Coverage | null;
  phase3?: TectonicStatePhase3Result | null;
  warnings?: string[];
  methodology?: {
    observedWavefield?: string;
    rayGeometry?: string;
    voxelGrid?: string;
    inversionStatus?: string;
  };
  error?: string;
};

const card: React.CSSProperties = {
  padding: 12,
  borderRadius: 14,
  border: "1px solid rgba(34,211,238,.18)",
  background: "rgba(3,12,24,.78)",
};
const control: React.CSSProperties = {
  background: "#071525",
  color: "white",
  border: "1px solid #334155",
  borderRadius: 8,
  padding: "7px 9px",
  fontSize: 10,
};

function eventKey(event: EarthquakeEvent) {
  return event.externalId || event.id;
}

function eventLabel(event: EarthquakeEvent) {
  const date = new Date(event.timeUtc).toISOString().slice(0, 10);
  return `M${event.magnitude.toFixed(1)} · ${date} · ${event.place}`;
}

function waveformPath(samples: Array<{ tSec: number; normalized: number }>) {
  if (samples.length < 2) return "";
  const width = 320;
  const height = 62;
  const minT = samples[0].tSec;
  const maxT = samples.at(-1)?.tSec ?? minT + 1;
  const span = Math.max(1, maxT - minT);
  return samples.map((sample, index) => {
    const x = ((sample.tSec - minT) / span) * width;
    const y = height / 2 - sample.normalized * height * 0.42;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function componentLabel(channel: string) {
  const suffix = channel.slice(-1).toUpperCase();
  if (suffix === "1") return "H1";
  if (suffix === "2") return "H2";
  return suffix;
}

export function TectonicStatePhase2({ events }: { events: EarthquakeEvent[] }) {
  const candidates = useMemo(() => {
    const sorted = [...events].sort((a, b) => b.magnitude - a.magnitude || Date.parse(b.timeUtc) - Date.parse(a.timeUtc));
    const significant = sorted.filter((event) => event.magnitude >= 5.5);
    return (significant.length ? significant : sorted).slice(0, 18);
  }, [events]);
  const [selectedId, setSelectedId] = useState("");
  const [result, setResult] = useState<Phase2Response | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!candidates.length) {
      setSelectedId("");
      return;
    }
    if (!candidates.some((event) => eventKey(event) === selectedId)) setSelectedId(eventKey(candidates[0]));
  }, [candidates, selectedId]);

  const selected = candidates.find((event) => eventKey(event) === selectedId) ?? candidates[0] ?? null;

  async function run() {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/tectonic-state-4d/phase2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: selected }),
        cache: "no-store",
      });
      const body = await readJsonResponse<Phase2Response>(response);
      if (!response.ok) throw new Error(body.error ?? `Fase 2/3 HTTP ${response.status}`);
      setResult(body);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "No fue posible cargar Fase 2/3.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const waveformStations = result?.waveforms?.stations ?? [];
  const completeStations = waveformStations.filter((station) => station.complete);
  const displayStations = (completeStations.length ? completeStations : waveformStations).slice(0, 3);
  const coverage = result?.rayCoverage;

  return <section style={{ marginTop: 14, padding: 13, borderRadius: 16, border: "1px solid rgba(45,212,191,.25)", background: "linear-gradient(145deg,rgba(4,47,46,.20),rgba(2,8,23,.82))" }}>
    <div style={{ color: "#5eead4", fontSize: 9, fontWeight: 900, letterSpacing: ".09em" }}>FASE 2 · WAVEFIELD OBSERVADO + RAY COVERAGE</div>
    <h2 style={{ margin: "5px 0", color: "white", fontSize: 19 }}>Z/N/E reales + sensibilidad por voxel</h2>
    <p style={{ margin: 0, color: "#94a3b8", fontSize: 9.5, lineHeight: 1.55 }}>
      Usa un terremoto real como fuente, busca estaciones abiertas en EarthScope, recupera tres componentes por <b style={{ color: "#d1fae5" }}>FDSN dataselect</b> cuando existen y traza familias P/S con iasp91 hacia esas mismas estaciones. Fase 2 mide cobertura observacional; el mismo cálculo alimenta Fase 3, que compara llegadas observadas contra IASP91.
    </p>

    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", marginTop: 10 }}>
      <label style={{ flex: "1 1 330px", color: "#94a3b8", fontSize: 8.5 }}>Evento fuente<br />
        <select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setResult(null); }} style={{ ...control, width: "100%" }} disabled={!candidates.length}>
          {candidates.map((event) => <option key={eventKey(event)} value={eventKey(event)}>{eventLabel(event)}</option>)}
        </select>
      </label>
      <button type="button" onClick={() => void run()} disabled={!selected || loading} style={{ ...control, borderColor: "#14b8a6", cursor: selected && !loading ? "pointer" : "default", opacity: selected ? 1 : .5 }}>
        {loading ? "Cargando wavefield…" : "Cargar Fase 2 + 3"}
      </button>
    </div>

    {!candidates.length && <div style={{ marginTop: 10, color: "#fcd34d", fontSize: 9 }}>No hay eventos utilizables en la ventana actual. Amplía la ventana o baja la magnitud mínima.</div>}
    {error && <div style={{ marginTop: 10, padding: 9, borderRadius: 10, border: "1px solid rgba(248,113,113,.3)", background: "rgba(127,29,29,.16)", color: "#fecaca", fontSize: 9.5 }}>{error}</div>}

    {result && <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(125px,1fr))", gap: 7, marginTop: 11 }}>
        <article style={card}><div style={{ color: "#67e8f9", fontSize: 8, fontWeight: 900 }}>ESTACIONES CANDIDATAS</div><strong style={{ color: "white", fontSize: 18 }}>{result.stationCandidates ?? 0}</strong></article>
        <article style={card}><div style={{ color: "#a7f3d0", fontSize: 8, fontWeight: 900 }}>ESTACIONES 3C</div><strong style={{ color: "white", fontSize: 18 }}>{result.waveforms?.completeStations ?? 0}</strong><div style={{ color: "#64748b", fontSize: 8 }}>de {result.waveforms?.requestedStations ?? 0} solicitadas</div></article>
        <article style={card}><div style={{ color: "#c4b5fd", fontSize: 8, fontWeight: 900 }}>TRAZAS REALES</div><strong style={{ color: "white", fontSize: 18 }}>{result.waveforms?.traceCount ?? 0}</strong><div style={{ color: "#64748b", fontSize: 8 }}>GeoCSV · sensibilidad instrumental aplicada</div></article>
        <article style={card}><div style={{ color: "#fda4af", fontSize: 8, fontWeight: 900 }}>RAYOS P/S</div><strong style={{ color: "white", fontSize: 18 }}>{coverage?.rayCount ?? 0}</strong><div style={{ color: "#64748b", fontSize: 8 }}>iasp91 · estaciones con waveform</div></article>
        <article style={card}><div style={{ color: "#fde68a", fontSize: 8, fontWeight: 900 }}>VOXELES CUBIERTOS</div><strong style={{ color: "white", fontSize: 18 }}>{coverage?.coveredVoxelCount ?? 0}</strong><div style={{ color: "#64748b", fontSize: 8 }}>4° × 4° × 50 km</div></article>
        <article style={card}><div style={{ color: "#5eead4", fontSize: 8, fontWeight: 900 }}>COBERTURA FASE 2</div><strong style={{ color: "white", fontSize: 18 }}>{coverage?.coverageScore ?? 0}/100</strong><div style={{ color: "#64748b", fontSize: 8 }}>soporte geométrico, no riesgo</div></article>
      </div>

      {displayStations.length > 0 && <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
        {displayStations.map((station) => <article key={`${station.network}.${station.station}.${station.location}.${station.band}`} style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <b style={{ color: "#e2e8f0", fontSize: 9.5 }}>{station.network}.{station.station} · {station.band} · {station.distanceKm.toFixed(0)} km</b>
            <span style={{ color: station.complete ? "#6ee7b7" : "#fbbf24", fontSize: 8 }}>{station.complete ? "3 componentes" : `${station.components.length} componentes`}</span>
          </div>
          <div style={{ display: "grid", gap: 5, marginTop: 6 }}>
            {station.components.slice(0, 3).map((trace) => <div key={trace.channel} style={{ display: "grid", gridTemplateColumns: "28px minmax(0,1fr)", gap: 5, alignItems: "center" }}>
              <span style={{ color: "#67e8f9", fontSize: 8, fontWeight: 900 }}>{componentLabel(trace.channel)}</span>
              <svg viewBox="0 0 320 62" preserveAspectRatio="none" style={{ width: "100%", height: 45, borderRadius: 7, background: "rgba(2,6,23,.7)" }} aria-label={`Waveform ${trace.channel}`}>
                <line x1="0" y1="31" x2="320" y2="31" stroke="rgba(148,163,184,.18)" strokeWidth="1" />
                <path d={waveformPath(trace.samples)} fill="none" stroke="currentColor" strokeWidth="1.1" style={{ color: "#5eead4" }} vectorEffect="non-scaling-stroke" />
              </svg>
            </div>)}
          </div>
        </article>)}
      </div>}

      {coverage && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,280px),1fr))", gap: 8, marginTop: 10 }}>
        <article style={card}>
          <div style={{ color: "#fde68a", fontSize: 8.5, fontWeight: 900 }}>VOXELES MÁS ATRAVESADOS</div>
          <div style={{ display: "grid", gap: 5, marginTop: 6 }}>
            {coverage.voxels.slice(0, 8).map((voxel) => <div key={voxel.id} style={{ color: "#cbd5e1", fontSize: 8.5, lineHeight: 1.4 }}>
              <b>{voxel.latitude.toFixed(1)}°, {voxel.longitude.toFixed(1)}° · {voxel.depthKm.toFixed(0)} km</b> — {voxel.rayCount} rayos, {voxel.stationCount} estaciones
            </div>)}
          </div>
        </article>
        <article style={card}>
          <div style={{ color: "#a7f3d0", fontSize: 8.5, fontWeight: 900 }}>CÓMO LEER FASE 2</div>
          <div style={{ color: "#cbd5e1", fontSize: 9, lineHeight: 1.55, marginTop: 6 }}>
            Las curvas Z/N/E son <b>registros reales</b>. Un voxel con más rayos y más estaciones tiene mejor geometría para ser interrogado. El Coverage Score mide esa capacidad de observación: <b>no es tensión, anomalía ni probabilidad sísmica.</b>
          </div>
        </article>
      </div>}

      {selected && result.phase3 && <TectonicStatePhase3 result={result.phase3} event={selected} />}

      {(result.warnings?.length ?? 0) > 0 && <details style={{ marginTop: 8, ...card, color: "#94a3b8", fontSize: 8.5 }}>
        <summary style={{ cursor: "pointer", color: "#cbd5e1", fontWeight: 800 }}>Advertencias de disponibilidad ({result.warnings?.length})</summary>
        <div style={{ marginTop: 5, lineHeight: 1.5 }}>{result.warnings?.slice(0, 16).map((warning, index) => <div key={`${warning}-${index}`}>• {warning}</div>)}</div>
      </details>}
    </>}
  </section>;
}
