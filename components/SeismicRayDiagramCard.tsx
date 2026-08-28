"use client";

import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { GlobeMapLayersResponse } from "@/lib/globeLayers";
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
    ["P", "onda compresional directa"],
    ["S", "onda de corte directa"],
    ["Pdiff / Sdiff", "difracción cerca del límite núcleo-manto"],
  ];
  return [
    ["P / S", "fases directas del manto"],
    ["PP / SS", "reflexión en la superficie y segundo salto"],
    ["PcP / ScS", "reflexión en el límite núcleo-manto"],
    ["PKP / SKS", "fases que atraviesan el núcleo externo"],
    ["PKIKP / SKIKS", "fases que atraviesan núcleo externo e interno"],
  ];
}

function modelLabel(model: RayDiagramModel) {
  if (model === "prem") return "PREM";
  if (model === "iasp91") return "IASP91";
  return "AK135";
}

export function SeismicRayDiagramCard({
  event,
  model,
  detail,
  layers,
}: {
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
        <div style={{ color: "#7dd3fc", fontSize: 9, fontWeight: 900, letterSpacing: ".1em" }}>SEISMIC RAY DIAGRAM · EARTHSCOPE TAUP</div>
        <h3 style={{ color: "white", margin: "5px 0 3px", fontSize: 20 }}>M{event.magnitude.toFixed(1)} · {event.place}</h3>
        <div style={{ color: "#94a3b8", fontSize: 10, lineHeight: 1.5 }}>
          {new Date(event.timeUtc).toISOString().replace("T", " ").slice(0, 19)} UTC · hipocentro {event.depthKm.toFixed(1)} km · {event.latitude.toFixed(3)}°, {event.longitude.toFixed(3)}° · {event.sourceCatalog}
        </div>
      </div>
      <div style={{ border: "1px solid #334155", borderRadius: 999, padding: "6px 10px", color: "#cbd5e1", fontSize: 9, fontWeight: 800 }}>
        {modelLabel(model)} · {detail === "full" ? "P/S + reflejadas + núcleo" : "P/S directas"}
      </div>
    </div>

    <div style={{ marginTop: 12 }}>
      {layers ? <SeismicSurfaceContext event={event} layers={layers} /> : <div style={{ minHeight: 180, display: "grid", placeItems: "center", borderRadius: 14, background: "#030914", color: "#64748b", fontSize: 10 }}>Cargando países, placas y fallas…</div>}
    </div>

    <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,260px),1fr))", gap: 12, alignItems: "start" }}>
      <div style={{ borderRadius: 14, overflow: "auto", background: "white", minHeight: 360, display: "grid", placeItems: "center" }}>
        <img src={rayImage} alt={`Trayectorias sísmicas TauP para M${event.magnitude.toFixed(1)} ${event.place}`} loading="lazy" style={{ width: "100%", minWidth: 300, height: "auto", display: "block" }} />
      </div>

      <aside style={{ display: "grid", gap: 8 }}>
        <section style={{ borderRadius: 12, padding: 10, background: "rgba(15,23,42,.72)", border: "1px solid rgba(148,163,184,.13)" }}>
          <div style={{ color: "#a5b4fc", fontSize: 9, fontWeight: 900 }}>LECTURA DEL CORTE</div>
          <p style={{ color: "#cbd5e1", fontSize: 9.5, lineHeight: 1.5, margin: "6px 0 0" }}>Las curvas provienen del cálculo de trayectorias de TauP para la profundidad real del sismo. Las distancias receptoras muestreadas llegan hasta 180° para mostrar el otro lado del planeta y la antípoda.</p>
        </section>

        {legend.map(([phase, description]) => <section key={phase} style={{ borderRadius: 10, padding: 9, background: "rgba(2,8,18,.7)", border: "1px solid rgba(148,163,184,.11)" }}>
          <strong style={{ color: phase.startsWith("S") ? "#fbbf24" : "#38bdf8", fontSize: 10 }}>{phase}</strong>
          <div style={{ color: "#94a3b8", fontSize: 9, lineHeight: 1.4, marginTop: 2 }}>{description}</div>
        </section>)}

        <section style={{ borderRadius: 12, padding: 10, background: "rgba(127,29,29,.12)", border: "1px solid rgba(251,113,133,.2)" }}>
          <div style={{ color: "#fda4af", fontSize: 9, fontWeight: 900 }}>ZONAS DE SOMBRA</div>
          <div style={{ color: "#cbd5e1", fontSize: 9, lineHeight: 1.45, marginTop: 5 }}>La ausencia de S directa más allá del núcleo externo y la discontinuidad de P directa alrededor de ~103°–142° son propiedades del modelo terrestre; las fases de núcleo vuelven a aparecer al otro lado.</div>
        </section>
      </aside>
    </div>

    <div style={{ marginTop: 10, color: "#64748b", fontSize: 9, lineHeight: 1.5 }}>
      <b style={{ color: "#94a3b8" }}>Importante:</b> el mapa superior muestra el contexto geográfico real del epicentro y de su antípoda. El corte inferior es un modelo 1-D esférico y por tanto no representa un azimut geográfico específico; no se asignan países concretos a cada rayo para evitar falsa precisión.
    </div>
  </article>;
}
