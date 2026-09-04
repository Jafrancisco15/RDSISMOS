"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { Phase3Wave, TectonicStatePhase3Result } from "@/lib/tectonicStatePhase3";

const Phase3Map = dynamic(
  () => import("./TectonicStatePhase3Map").then((module) => module.TectonicStatePhase3Map),
  { ssr: false, loading: () => <div style={{ height: 430, display: "grid", placeItems: "center", borderRadius: 13, background: "#06111d", color: "#c4b5fd" }}>Renderizando actualización tomográfica…</div> },
);

const card: React.CSSProperties = {
  padding: 11,
  borderRadius: 12,
  border: "1px solid rgba(167,139,250,.16)",
  background: "rgba(8,11,28,.72)",
};

function sec(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)} s`;
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)} s`;
}

export function TectonicStatePhase3({
  result,
  event,
}: {
  result: TectonicStatePhase3Result;
  event: EarthquakeEvent;
}) {
  const [wave, setWave] = useState<Phase3Wave>("P");
  const strongest = useMemo(() => result.voxels
    .filter((voxel) => (wave === "P" ? voxel.deltaVpPct : voxel.deltaVsPct) !== null)
    .sort((a, b) => b.supportScore - a.supportScore)
    .slice(0, 8), [result.voxels, wave]);
  const picks = useMemo(() => result.picks
    .filter((pick) => pick.phase === wave)
    .sort((a, b) => Number(b.usedInInversion) - Number(a.usedInInversion) || b.quality01 - a.quality01)
    .slice(0, 10), [result.picks, wave]);

  return <section style={{ marginTop: 12, padding: 12, borderRadius: 15, border: "1px solid rgba(167,139,250,.25)", background: "linear-gradient(145deg,rgba(49,46,129,.18),rgba(2,8,23,.88))" }}>
    <div style={{ color: "#c4b5fd", fontSize: 9, fontWeight: 900, letterSpacing: ".09em" }}>FASE 3 · RESIDUAL OBSERVADO − SINTÉTICO</div>
    <h3 style={{ color: "white", margin: "5px 0", fontSize: 18 }}>Backprojection de tiempos P/S → δVp / δVs</h3>
    <p style={{ color: "#94a3b8", fontSize: 9.3, lineHeight: 1.55, margin: 0 }}>
      Detecta automáticamente llegadas en las trazas reales de Fase 2, las compara con tiempos IASP91 y distribuye el residual sobre los voxeles atravesados. Se elimina el sesgo mediano común por fase antes de invertir para reducir contaminación por error de tiempo de origen. Esto es una <b style={{ color: "#ddd6fe" }}>tomografía de tiempos de llegada de primera pasada</b>, no full-waveform inversion.
    </p>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(125px,1fr))", gap: 7, marginTop: 10 }}>
      <article style={card}><div style={{ color: "#93c5fd", fontSize: 8, fontWeight: 900 }}>PICKS P / S</div><strong style={{ color: "white", fontSize: 18 }}>{result.pPickCount} / {result.sPickCount}</strong></article>
      <article style={card}><div style={{ color: "#a7f3d0", fontSize: 8, fontWeight: 900 }}>USADOS EN INVERSIÓN</div><strong style={{ color: "white", fontSize: 18 }}>{result.usedPickCount}</strong></article>
      <article style={card}><div style={{ color: "#fde68a", fontSize: 8, fontWeight: 900 }}>RMS RESIDUAL</div><strong style={{ color: "white", fontSize: 15 }}>{sec(result.rmsResidualBeforeSec)} → {sec(result.rmsResidualAfterSec)}</strong></article>
      <article style={card}><div style={{ color: "#f9a8d4", fontSize: 8, fontWeight: 900 }}>REDUCCIÓN DE VARIANZA</div><strong style={{ color: "white", fontSize: 18 }}>{result.varianceReductionPct === null ? "—" : `${result.varianceReductionPct.toFixed(0)}%`}</strong></article>
      <article style={card}><div style={{ color: "#c4b5fd", fontSize: 8, fontWeight: 900 }}>SOPORTE INVERSIÓN</div><strong style={{ color: "white", fontSize: 18 }}>{result.inversionSupportScore}/100</strong></article>
      <article style={card}><div style={{ color: "#94a3b8", fontSize: 8, fontWeight: 900 }}>SESGO COMÚN P / S</div><strong style={{ color: "white", fontSize: 14 }}>{sec(result.pOriginBiasSec)} / {sec(result.sOriginBiasSec)}</strong></article>
    </div>

    {!result.available && <div style={{ marginTop: 9, padding: 9, borderRadius: 10, border: "1px solid rgba(251,191,36,.25)", background: "rgba(120,53,15,.12)", color: "#fde68a", fontSize: 9, lineHeight: 1.5 }}>
      Fase 3 no tiene todavía geometría/picks suficientes para producir una actualización estable con este evento. Puedes probar otro terremoto con mejor cobertura de estaciones.
    </div>}

    {result.available && <>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 10 }}>
        {(["P", "S"] as const).map((item) => <button key={item} type="button" onClick={() => setWave(item)} style={{ border: `1px solid ${wave === item ? "#8b5cf6" : "#334155"}`, background: wave === item ? "rgba(91,33,182,.25)" : "#071525", color: "white", borderRadius: 999, padding: "6px 10px", fontSize: 9, fontWeight: 800, cursor: "pointer" }}>
          {item === "P" ? "δVp · ondas P" : "δVs · ondas S"}
        </button>)}
      </div>

      <div style={{ marginTop: 9 }}>
        <Phase3Map voxels={result.voxels} event={event} wave={wave} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,285px),1fr))", gap: 8, marginTop: 9 }}>
        <article style={card}>
          <div style={{ color: "#ddd6fe", fontSize: 8.5, fontWeight: 900 }}>PICKS {wave} · OBSERVADO VS IASP91</div>
          <div style={{ display: "grid", gap: 5, marginTop: 6 }}>
            {picks.length ? picks.map((pick) => <div key={pick.id} style={{ padding: 6, borderRadius: 8, background: "rgba(2,6,23,.55)", color: "#cbd5e1", fontSize: 8.3, lineHeight: 1.45 }}>
              <b style={{ color: pick.usedInInversion ? "#a7f3d0" : "#fbbf24" }}>{pick.network}.{pick.station} · {pick.pathPhase}</b><br />
              pred {pick.predictedSec.toFixed(1)} s · obs {pick.observedSec.toFixed(1)} s · residual centrado {signed(pick.centeredResidualSec)}<br />
              canal {pick.channel} · SNR proxy {pick.snrProxy.toFixed(1)} · calidad {(pick.quality01 * 100).toFixed(0)}% {pick.usedInInversion ? "· usado" : "· descartado"}
            </div>) : <span style={{ color: "#64748b", fontSize: 8.5 }}>Sin picks {wave} disponibles.</span>}
          </div>
        </article>

        <article style={card}>
          <div style={{ color: "#fca5a5", fontSize: 8.5, fontWeight: 900 }}>VOXELES CON MAYOR SOPORTE · δV{wave.toLowerCase()}</div>
          <div style={{ display: "grid", gap: 5, marginTop: 6 }}>
            {strongest.length ? strongest.map((voxel) => {
              const value = wave === "P" ? voxel.deltaVpPct : voxel.deltaVsPct;
              return <div key={voxel.id} style={{ color: "#cbd5e1", fontSize: 8.4, lineHeight: 1.45 }}>
                <b style={{ color: (value ?? 0) >= 0 ? "#fca5a5" : "#93c5fd" }}>{voxel.latitude.toFixed(1)}°, {voxel.longitude.toFixed(1)}° · {voxel.depthKm.toFixed(0)} km</b> — {value === null ? "N/D" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`} · soporte {voxel.supportScore}/100 · {voxel.stationCount} est.
              </div>;
            }) : <span style={{ color: "#64748b", fontSize: 8.5 }}>Sin voxeles resueltos para {wave}.</span>}
          </div>
        </article>
      </div>
    </>}

    <div style={{ marginTop: 9, padding: 8, borderRadius: 9, background: "rgba(2,6,23,.6)", color: "#94a3b8", fontSize: 8.5, lineHeight: 1.55 }}>
      <b style={{ color: "#e2e8f0" }}>Interpretación:</b> δV positivo = las llegadas corregidas son compatibles con material que propaga esa fase algo más rápido que IASP91; δV negativo = algo más lento. La amplitud del color se atenúa cuando hay poco soporte. Estas perturbaciones pueden reflejar estructura, temperatura, composición, fluidos, anisotropía o errores de geometría/pick; <b>no son una medida directa de tensión.</b>
    </div>

    {result.warnings.length > 0 && <details style={{ marginTop: 8, ...card, color: "#94a3b8", fontSize: 8.3 }}>
      <summary style={{ cursor: "pointer", color: "#cbd5e1", fontWeight: 800 }}>Advertencias Fase 3 ({result.warnings.length})</summary>
      <div style={{ marginTop: 5, lineHeight: 1.5 }}>{result.warnings.map((warning, index) => <div key={`${warning}-${index}`}>• {warning}</div>)}</div>
    </details>}
  </section>;
}
