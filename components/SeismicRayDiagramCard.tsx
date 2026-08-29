"use client";

import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { GlobeMapLayersResponse } from "@/lib/globeLayers";
import { SeismicEarthInteriorDiagram } from "./SeismicEarthInteriorDiagram";
import { SeismicImpactPanel } from "./SeismicImpactPanel";
import { SeismicSurfaceContext } from "./SeismicSurfaceContext";

export type RayDiagramModel = "ak135" | "prem" | "iasp91";
export type RayDiagramDetail = "basic" | "full";

const panel: React.CSSProperties = {
  border: "1px solid rgba(56,189,248,.16)",
  borderRadius: 16,
  background: "linear-gradient(145deg,#061322,#020914)",
  padding: 14,
};

function phaseLegend(detail: RayDiagramDetail) {
  if (detail === "basic") return [
    ["P", "onda compresional directa; gira dentro del manto"],
    ["S", "onda de corte directa; no atraviesa el núcleo externo líquido"],
  ];
  return [
    ["P / S", "fases directas que giran dentro del manto"],
    ["PcP / ScS", "reflexión física en el límite núcleo-manto"],
    ["PKP", "P atraviesa el núcleo externo y vuelve al manto"],
    ["SKS", "S se convierte a P en el núcleo externo y vuelve a S"],
    ["PKIKP", "P atraviesa núcleo externo e interno"],
  ];
}

function modelLabel(model: RayDiagramModel) {
  if (model === "prem") return "PREM";
  if (model === "iasp91") return "IASP91";
  return "AK135";
}

export function SeismicRayDiagramCard({ event, model, detail, layers }: {
  event: EarthquakeEvent;
  model: RayDiagramModel;
  detail: RayDiagramDetail;
  layers: GlobeMapLayersResponse | null;
}) {
  const params = new URLSearchParams({ depth: event.depthKm.toFixed(1), model, detail });
  const rayImage = `/api/geomagnetism/raypaths?${params}`;
  const legend = phaseLegend(detail);

  return <article style={panel}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12, flexWrap: "wrap" }}>
      <div>
        <div style={{ color: "#7dd3fc", fontSize: 9, fontWeight: 900, letterSpacing: ".1em" }}>SEISMIC RAY DIAGRAM · RDSISMOS LOCAL 1-D ENGINE</div>
        <h3 style={{ color: "white", margin: "5px 0 3px", fontSize: 20 }}>M{event.magnitude.toFixed(1)} · {event.place}</h3>
        <div style={{ color: "#94a3b8", fontSize: 10, lineHeight: 1.5 }}>
          {new Date(event.timeUtc).toISOString().replace("T", " ").slice(0, 19)} UTC · hipocentro {event.depthKm.toFixed(1)} km · {event.latitude.toFixed(3)}°, {event.longitude.toFixed(3)}° · {event.sourceCatalog}
        </div>
      </div>
      <div style={{ border: "1px solid #334155", borderRadius: 999, padding: "6px 10px", color: "#cbd5e1", fontSize: 9, fontWeight: 800 }}>
        {modelLabel(model)} · {detail === "full" ? "P/S + reflexiones + núcleo" : "P/S directas"}
      </div>
    </div>

    <div style={{ marginTop: 12 }}>
      {layers ? <SeismicSurfaceContext event={event} layers={layers} /> : <div style={{ minHeight: 180, display: "grid", placeItems: "center", borderRadius: 14, background: "#030914", color: "#64748b", fontSize: 10 }}>Cargando países, placas y fallas…</div>}
    </div>

    <div style={{ marginTop: 12 }}>
      <SeismicImpactPanel event={event} model={model} layers={layers} />
    </div>

    <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,320px),1fr))", gap: 12, alignItems: "start" }}>
      <SeismicEarthInteriorDiagram event={event} model={model} />
      <div style={{ borderRadius: 14, overflow: "auto", background: "white", minHeight: 360, display: "grid", placeItems: "center", border: "1px solid rgba(148,163,184,.16)" }}>
        <img src={rayImage} alt={`Trayectorias sísmicas locales ${modelLabel(model)} para M${event.magnitude.toFixed(1)} ${event.place}`} loading="lazy" style={{ width: "100%", minWidth: 300, height: "auto", display: "block" }} />
      </div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8, marginTop: 10 }}>
      <section style={{ borderRadius: 12, padding: 10, background: "rgba(15,23,42,.72)", border: "1px solid rgba(148,163,184,.13)" }}>
        <div style={{ color: "#a5b4fc", fontSize: 9, fontWeight: 900 }}>LECTURA DEL CORTE</div>
        <p style={{ color: "#cbd5e1", fontSize: 9.5, lineHeight: 1.5, margin: "6px 0 0" }}>Los cortes se calculan localmente con teoría de rayos en una Tierra esférica 1-D y el perfil {modelLabel(model)}. El globo superior separa propagación P/S de impacto humano estimado mediante una IPE de intensidad.</p>
      </section>
      {legend.map(([phase, description]) => <section key={phase} style={{ borderRadius: 10, padding: 9, background: "rgba(2,8,18,.7)", border: "1px solid rgba(148,163,184,.11)" }}>
        <strong style={{ color: phase.startsWith("S") ? "#fbbf24" : "#38bdf8", fontSize: 10 }}>{phase}</strong>
        <div style={{ color: "#94a3b8", fontSize: 9, lineHeight: 1.4, marginTop: 2 }}>{description}</div>
      </section>)}
    </div>

    <div style={{ marginTop: 10, color: "#64748b", fontSize: 9, lineHeight: 1.5 }}>
      <b style={{ color: "#94a3b8" }}>Importante:</b> el mapa superior muestra el contexto geográfico real del epicentro y de su antípoda. Los cortes usan modelos radiales 1-D y no representan heterogeneidad 3-D lateral. La estimación de impacto no sustituye ShakeMap ni una GMPE regional con Vs30 y geometría de ruptura.
    </div>
  </article>;
}
