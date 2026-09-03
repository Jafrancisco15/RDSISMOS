import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { MagneticLocalityMetrics } from "@/lib/geomagnetism";
import type { GeomagCoverage } from "@/lib/geomagNetwork";
import { assessFreundCompatibility, type FreundCriterionState } from "@/lib/freundExperimental";

const panel: React.CSSProperties = {
  border: "1px solid rgba(192,132,252,.24)",
  borderRadius: 16,
  background: "linear-gradient(145deg,#100b1f,#07101c 58%,#04111d)",
  padding: 14,
  minWidth: 0,
  maxWidth: "100%",
  overflow: "hidden",
};

function stateColor(state: FreundCriterionState) {
  if (state === "supportive") return "#34d399";
  if (state === "mixed") return "#fbbf24";
  if (state === "weak") return "#fb7185";
  return "#94a3b8";
}

function classificationColor(classification: ReturnType<typeof assessFreundCompatibility>["classification"]) {
  if (classification === "high") return "#34d399";
  if (classification === "partial") return "#fbbf24";
  if (classification === "solar-contaminated") return "#fb7185";
  if (classification === "weak") return "#f59e0b";
  return "#94a3b8";
}

export function FreundExperimentalPanel({
  metrics,
  event,
  coverage = null,
}: {
  metrics: MagneticLocalityMetrics | null;
  event: EarthquakeEvent | null;
  coverage?: GeomagCoverage | null;
}) {
  const assessment = metrics ? assessFreundCompatibility(metrics) : null;

  return <section style={panel}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "start", minWidth: 0 }}>
      <div style={{ minWidth: 0, flex: "1 1 360px" }}>
        <div style={{ color: "#c084fc", fontSize: 10, fontWeight: 900, letterSpacing: ".08em", overflowWrap: "anywhere" }}>FRIEDEMANN T. FREUND · POSITIVE-HOLE HYPOTHESIS</div>
        <h2 style={{ color: "white", margin: "5px 0 3px", fontSize: "clamp(17px,4vw,20px)", overflowWrap: "anywhere" }}>Prueba Freund · compatibilidad magnética experimental</h2>
        <p style={{ color: "#cbd5e1", fontSize: 11, lineHeight: 1.55, margin: 0, maxWidth: 940, overflowWrap: "anywhere" }}>
          Fase 1 del contraste en RDSISMOS. Evalúa si una anomalía magnética parece local, robusta, persistente y ocurre con baja contaminación geomagnética planetaria. No mide directamente p-holes, corriente telúrica, radón, TEC ni infrarrojo.
        </p>
      </div>
      <span style={{ color: "#fda4af", border: "1px solid rgba(251,113,133,.35)", background: "rgba(127,29,29,.18)", borderRadius: 999, padding: "6px 9px", fontSize: 9, fontWeight: 900, maxWidth: "100%", overflowWrap: "anywhere" }}>
        HIPÓTESIS NO VALIDADA PARA PREDICCIÓN
      </span>
    </div>

    <div style={{ marginTop: 12, padding: 10, borderRadius: 12, background: "rgba(15,23,42,.72)", color: "#ddd6fe", fontSize: 11, lineHeight: 1.55, overflowWrap: "anywhere" }}>
      <b>Cadena propuesta:</b> estrés tectónico → activación de defectos peroxi → “positive holes” → transporte de carga → corriente/campo EM → posible anomalía local detectable.
    </div>

    {!assessment ? <div style={{ marginTop: 12, color: "#94a3b8", fontSize: 11 }}>
      Ejecuta <b style={{ color: "#e2e8f0" }}>Analizar señal local</b> para calcular el índice experimental Freund con la red federada USGS + INTERMAGNET y sus controles.
    </div> : <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,220px),1fr))", gap: 12, marginTop: 12, alignItems: "stretch", minWidth: 0 }}>
        <article style={{ borderRadius: 13, padding: 12, background: "rgba(30,27,75,.42)", border: "1px solid rgba(129,140,248,.2)", minWidth: 0 }}>
          <div style={{ color: "#a5b4fc", fontSize: 9, fontWeight: 900, overflowWrap: "anywhere" }}>FREUND MAGNETIC COMPATIBILITY</div>
          <strong style={{ display: "block", color: "white", fontSize: "clamp(28px,8vw,34px)", marginTop: 3 }}>{assessment.score}/100</strong>
          <div style={{ color: classificationColor(assessment.classification), fontSize: 11, fontWeight: 900, overflowWrap: "anywhere" }}>{assessment.label}</div>
          <div style={{ color: "#64748b", fontSize: 9, marginTop: 6 }}>Índice de compatibilidad física, no probabilidad sísmica.</div>
          {coverage && <div style={{ marginTop: 9, paddingTop: 8, borderTop: "1px solid rgba(148,163,184,.15)", color: coverage.score >= 58 ? "#86efac" : "#fde68a", fontSize: 9, lineHeight: 1.4 }}>
            Cobertura observacional: <b>{coverage.score}/100 · {coverage.label}</b><br />{coverage.referenceCount} controles · {coverage.azimuthCoverageDeg}° de cobertura azimutal
          </div>}
        </article>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,145px),1fr))", gap: 8, minWidth: 0 }}>
          {assessment.criteria.map((criterion) => <article key={criterion.id} title={criterion.note} style={{ borderRadius: 11, padding: 9, background: "rgba(2,8,18,.68)", border: "1px solid rgba(148,163,184,.12)", minWidth: 0, overflowWrap: "anywhere" }}>
            <div style={{ color: stateColor(criterion.state), fontSize: 9, fontWeight: 900 }}>{criterion.label.toUpperCase()}</div>
            <strong style={{ color: "white", fontSize: 16 }}>{criterion.value}</strong>
            <div style={{ color: "#64748b", fontSize: 9, lineHeight: 1.4, marginTop: 4 }}>{criterion.note}</div>
          </article>)}
        </div>
      </div>

      {coverage && coverage.score < 35 && <div style={{ marginTop: 10, padding: 9, borderRadius: 10, background: "rgba(120,53,15,.18)", border: "1px solid rgba(245,158,11,.25)", color: "#fde68a", fontSize: 9.5, lineHeight: 1.5 }}>
        Cobertura insuficiente: un Freund score alto con esta geometría de estaciones debe tratarse como evidencia débil hasta disponer de más controles alrededor del observatorio.
      </div>}

      {event && <div style={{ marginTop: 10, color: "#cbd5e1", fontSize: 10, lineHeight: 1.5, overflowWrap: "anywhere" }}>
        <b style={{ color: "#fda4af" }}>Referencia temporal:</b> M{event.magnitude.toFixed(1)} · {event.place} · {new Date(event.timeUtc).toLocaleString("es-DO")}. El terremoto seleccionado <b>no entra en el cálculo del índice</b>; se conserva separado para evitar convertir una asociación retrospectiva en evidencia predictiva.
      </div>}

      <div style={{ marginTop: 10, color: "#94a3b8", fontSize: 9, lineHeight: 1.55, overflowWrap: "anywhere" }}>
        <b style={{ color: "#cbd5e1" }}>Qué faltaría para una prueba Freund más completa:</b> medición eléctrica de terreno/ULF, GNSS-TEC o ionosfera, radón y/o infrarrojo térmico, además de validación prospectiva con falsos positivos, falsos negativos y ventanas declaradas antes del sismo.
      </div>
    </>}
  </section>;
}
