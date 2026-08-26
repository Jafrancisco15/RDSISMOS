"use client";

import { useEffect, useMemo, useState } from "react";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { ExtractionSite } from "@/lib/extractions";
import {
  dynamicTriggerCompatibility,
  estimateWaveArrivals,
  localTriggerContext,
  sourceWavePotential,
  triggerLabel,
} from "@/lib/frackingWaveAnalysis";

type Waveform = {
  available: boolean;
  sampleCount?: number;
  peakAbs?: number;
  baselineRms?: number | null;
  peakToBaseline?: number | null;
  units?: string | null;
  startUtc?: string;
  endUtc?: string;
};

type EarthScopeResponse = {
  arrivals: ReturnType<typeof estimateWaveArrivals>;
  earthscope: {
    historicalStationCount: number;
    currentStationCount: number;
    nearestHistoricalStation: {
      network: string;
      station: string;
      location: string;
      channel: string;
      latitude: number;
      longitude: number;
      distanceKm: number;
      siteName?: string | null;
      sampleRate?: number | null;
    } | null;
    waveform: Waveform;
  };
  warnings?: string[];
  methodology?: { eventCatalog?: string; stationAndWaveform?: string; waveModel?: string };
  error?: string;
};

type Candidate = {
  event: EarthquakeEvent;
  distanceKm: number;
  potential: number;
  arrivals: ReturnType<typeof estimateWaveArrivals>;
  local: ReturnType<typeof localTriggerContext>;
};

type Result = Candidate & {
  earthscope: EarthScopeResponse | null;
  error?: string;
  score: number;
};

const panel: React.CSSProperties = {
  border: "1px solid rgba(224,86,253,.32)",
  borderRadius: 16,
  background: "linear-gradient(145deg,rgba(24,7,33,.96),rgba(5,13,28,.98))",
  padding: 14,
  color: "#eaf6ff",
};

const mini: React.CSSProperties = {
  border: "1px solid rgba(148,163,184,.18)",
  borderRadius: 12,
  background: "rgba(15,23,42,.62)",
  padding: 10,
};

function fmtTime(value: string) {
  return new Date(value).toLocaleString("es-DO", { dateStyle: "short", timeStyle: "medium" });
}

function fmtDuration(seconds: number) {
  if (seconds < 120) return `${seconds.toFixed(0)} s`;
  if (seconds < 7200) return `${(seconds / 60).toFixed(1)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

function candidateList(site: ExtractionSite, events: EarthquakeEvent[]): Candidate[] {
  return events
    .map((event) => {
      const arrivals = estimateWaveArrivals(event, site);
      return {
        event,
        distanceKm: arrivals.distanceKm,
        potential: sourceWavePotential(event.magnitude, arrivals.distanceKm),
        arrivals,
        local: localTriggerContext(events, site, arrivals.surfaceArrivalUtc, 100),
      };
    })
    .filter((item) => item.distanceKm >= 150 && item.event.magnitude >= 5.5)
    .sort((a, b) => (b.potential * (1 + b.event.magnitude / 10)) - (a.potential * (1 + a.event.magnitude / 10)))
    .slice(0, 3);
}

export function FrackingEarthScopeAnalysis({ site, events }: { site: ExtractionSite; events: EarthquakeEvent[] }) {
  const candidates = useMemo(() => candidateList(site, events), [events, site]);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    if (!candidates.length) {
      setResults([]);
      return () => controller.abort();
    }
    setLoading(true);
    Promise.all(candidates.map(async (candidate): Promise<Result> => {
      const params = new URLSearchParams({
        siteLat: String(site.latitude),
        siteLon: String(site.longitude),
        sourceLat: String(candidate.event.latitude),
        sourceLon: String(candidate.event.longitude),
        sourceDepthKm: String(candidate.event.depthKm),
        sourceTime: candidate.event.timeUtc,
        magnitude: String(candidate.event.magnitude),
      });
      try {
        const response = await fetch(`/api/extractions/earthscope-wave?${params}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as EarthScopeResponse;
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        const wave = payload.earthscope.waveform;
        const score = dynamicTriggerCompatibility({
          magnitude: candidate.event.magnitude,
          distanceKm: candidate.distanceKm,
          before24h: candidate.local.before24h,
          after24h: candidate.local.after24h,
          firstAfterMinutes: candidate.local.firstAfterMinutes,
          peakToBaseline: wave.peakToBaseline,
          waveformAvailable: wave.available,
          historicalStationCount: payload.earthscope.historicalStationCount,
        });
        return { ...candidate, earthscope: payload, score };
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        const score = dynamicTriggerCompatibility({
          magnitude: candidate.event.magnitude,
          distanceKm: candidate.distanceKm,
          before24h: candidate.local.before24h,
          after24h: candidate.local.after24h,
          firstAfterMinutes: candidate.local.firstAfterMinutes,
        });
        return { ...candidate, earthscope: null, score, error: error instanceof Error ? error.message : "EarthScope no disponible" };
      }
    })).then((loaded) => setResults(loaded.sort((a, b) => b.score - a.score)))
      .catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) setResults([]); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [candidates, site.latitude, site.longitude]);

  const strongest = results[0] ?? null;

  return <section style={panel}>
    <div style={{ color: "#e879f9", fontSize: 10, fontWeight: 900, letterSpacing: ".1em" }}>EARTHSCOPE · ONDAS → FRACKING · PASADO VS PRESENTE</div>
    <h3 style={{ margin: "5px 0 3px", color: "white" }}>Compatibilidad de disparo dinámico</h3>
    <p style={{ color: "#c4b5fd", fontSize: 11, lineHeight: 1.5, marginTop: 0 }}>
      Estima si ondas de sismos distantes llegaron a <b>{site.name}</b> y si la sismicidad local cambió después. EarthScope aporta estaciones y, cuando existe, la forma de onda registrada cerca del punto. No demuestra causalidad ni que el fracking haya originado un evento.
    </p>

    {loading && <div style={{ ...mini, color: "#f5d0fe" }}>Consultando estaciones y formas de onda EarthScope para {candidates.length} sismos fuente…</div>}
    {!loading && !candidates.length && <div style={{ ...mini, color: "#94a3b8" }}>En el span actual no hay sismos fuente M5.5+ a más de 150 km con los que ejecutar esta prueba. Amplía el período o baja el filtro sísmico.</div>}

    {strongest && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 8, marginBottom: 10 }}>
      <div style={mini}><div style={{ color: "#f0abfc", fontSize: 10, fontWeight: 900 }}>SEÑAL MÁS COMPATIBLE</div><strong style={{ fontSize: 25 }}>{strongest.score}/100</strong><div style={{ color: "#e9d5ff", fontSize: 11 }}>{triggerLabel(strongest.score)}</div></div>
      <div style={mini}><div style={{ color: "#f0abfc", fontSize: 10, fontWeight: 900 }}>FUENTE</div><strong>M{strongest.event.magnitude.toFixed(1)}</strong><div style={{ color: "#cbd5e1", fontSize: 11 }}>{strongest.event.place} · {strongest.distanceKm.toFixed(0)} km</div></div>
      <div style={mini}><div style={{ color: "#f0abfc", fontSize: 10, fontWeight: 900 }}>SISMICIDAD LOCAL ±24 H</div><strong>{strongest.local.before24h} → {strongest.local.after24h}</strong><div style={{ color: "#cbd5e1", fontSize: 11 }}>{strongest.local.firstAfterMinutes == null ? "sin evento posterior ≤24 h" : `primer evento +${strongest.local.firstAfterMinutes.toFixed(0)} min`}</div></div>
      <div style={mini}><div style={{ color: "#f0abfc", fontSize: 10, fontWeight: 900 }}>EARTHSCOPE</div><strong>{strongest.earthscope?.earthscope.historicalStationCount ?? 0} → {strongest.earthscope?.earthscope.currentStationCount ?? 0}</strong><div style={{ color: "#cbd5e1", fontSize: 11 }}>estaciones cercanas: durante llegada → ahora</div></div>
    </div>}

    <div style={{ display: "grid", gap: 8 }}>
      {results.map((result) => {
        const earthscope = result.earthscope?.earthscope;
        const waveform = earthscope?.waveform;
        return <details key={result.event.id} style={mini} open={result === strongest}>
          <summary style={{ cursor: "pointer", fontWeight: 800, color: "white" }}>
            {result.score}/100 · M{result.event.magnitude.toFixed(1)} · {result.distanceKm.toFixed(0)} km · {result.event.place}
          </summary>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(165px,1fr))", gap: 8, marginTop: 9, fontSize: 11 }}>
            <div><b style={{ color: "#7dd3fc" }}>Llegadas teóricas</b><div>P: {fmtTime(result.arrivals.pArrivalUtc)} ({fmtDuration(result.arrivals.pTravelSeconds)})</div><div>S: {fmtTime(result.arrivals.sArrivalUtc)} ({fmtDuration(result.arrivals.sTravelSeconds)})</div><div>Superficial: {fmtTime(result.arrivals.surfaceArrivalUtc)} ({fmtDuration(result.arrivals.surfaceTravelSeconds)})</div></div>
            <div><b style={{ color: "#7dd3fc" }}>Antes / después</b><div>24 h antes: {result.local.before24h}</div><div>24 h después: {result.local.after24h}</div><div>Primer posterior: {result.local.firstAfterMinutes == null ? "—" : `${result.local.firstAfterMinutes.toFixed(1)} min`}</div></div>
            <div><b style={{ color: "#7dd3fc" }}>EarthScope histórico → actual</b><div>Estaciones: {earthscope?.historicalStationCount ?? 0} → {earthscope?.currentStationCount ?? 0}</div><div>{earthscope?.nearestHistoricalStation ? `${earthscope.nearestHistoricalStation.network}.${earthscope.nearestHistoricalStation.station}.${earthscope.nearestHistoricalStation.channel} · ${earthscope.nearestHistoricalStation.distanceKm.toFixed(0)} km` : "Sin estación histórica cercana"}</div></div>
            <div><b style={{ color: "#7dd3fc" }}>Forma de onda</b>{waveform?.available ? <><div>Registro instrumental disponible</div><div>Pico/baseline: {waveform.peakToBaseline?.toFixed(1) ?? "—"}×</div><div>{waveform.sampleCount?.toLocaleString("es-DO")} muestras {waveform.units ? `· ${waveform.units}` : ""}</div></> : <div>Sin forma de onda recuperable para esa llegada.</div>}</div>
          </div>
          {result.error && <div style={{ color: "#fbbf24", marginTop: 7, fontSize: 10 }}>{result.error}</div>}
        </details>;
      })}
    </div>

    <div style={{ marginTop: 10, color: "#64748b", fontSize: 10, lineHeight: 1.45 }}>
      Modelo exploratorio: eventos USGS/NEIC; estaciones y waveform EarthScope FDSN. Llegadas P/S/superficiales usan velocidades constantes aproximadas (8.0/4.6/3.5 km/s), no TauP. Un aumento posterior puede coincidir por azar, secuencias tectónicas o cambios operacionales; se requiere presión/volumen de fractura e inyección y análisis estadístico independiente para atribuir inducción.
    </div>
  </section>;
}
