"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import type { TectonicStatePhase4Result } from "@/lib/tectonicStatePhase4";
import type { TectonicStatePhase4Seed } from "@/lib/tectonicStatePhase4Bridge";
import { readJsonResponse } from "@/lib/safeFetchJson";

const Phase4Map = dynamic(
  () => import("./TectonicStatePhase4Map").then((module) => module.TectonicStatePhase4Map),
  { ssr: false, loading: () => <div style={{ height: 430, display: "grid", placeItems: "center", borderRadius: 13, background: "#06111d", color: "#67e8f9" }}>Reconstruyendo deformación GNSS…</div> },
);

const card: React.CSSProperties = {
  padding: 11,
  borderRadius: 12,
  border: "1px solid rgba(34,211,238,.16)",
  background: "rgba(3,14,28,.76)",
  minWidth: 0,
};

function mm(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)} mm`;
}

function signedMm(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)} mm`;
}

function readinessStyle(label: TectonicStatePhase4Result["readiness"]["label"]) {
  if (label === "ready") return { color: "#6ee7b7", border: "rgba(52,211,153,.38)", bg: "rgba(6,78,59,.18)" };
  if (label === "provisional") return { color: "#fde68a", border: "rgba(251,191,36,.35)", bg: "rgba(120,53,15,.16)" };
  return { color: "#fda4af", border: "rgba(251,113,133,.34)", bg: "rgba(127,29,29,.15)" };
}

type Phase4ApiResponse = {
  phase: 4;
  phase4?: TectonicStatePhase4Result;
  error?: string;
};

export function TectonicStatePhase4({ event, seed }: { event: EarthquakeEvent; seed: TectonicStatePhase4Seed }) {
  const [result, setResult] = useState<TectonicStatePhase4Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strongestStations = useMemo(() => result ? [...result.gnss.stations]
    .sort((a, b) => b.qualityScore - a.qualityScore || b.vectorMm - a.vectorMm)
    .slice(0, 8) : [], [result]);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/tectonic-state-4d/phase4", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, seed }),
        cache: "no-store",
      });
      const body = await readJsonResponse<Phase4ApiResponse>(response);
      if (!response.ok || !body.phase4) throw new Error(body.error ?? `Fase 4 HTTP ${response.status}`);
      setResult(body.phase4);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "No fue posible ejecutar Fase 4.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const ready = result ? readinessStyle(result.readiness.label) : null;

  return <section style={{ marginTop: 12, padding: 12, borderRadius: 15, border: "1px solid rgba(34,211,238,.26)", background: "linear-gradient(145deg,rgba(8,47,73,.22),rgba(2,8,23,.9))", minWidth: 0 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 8, flexWrap: "wrap" }}>
      <div style={{ minWidth: 0, flex: "1 1 440px" }}>
        <div style={{ color: "#67e8f9", fontSize: 9, fontWeight: 900, letterSpacing: ".09em" }}>FASE 4 v0.1 · DEFORMACIÓN GEODÉSICA OBSERVADA</div>
        <h3 style={{ color: "white", margin: "5px 0", fontSize: 18 }}>GNSS E/N/U → campo Ux/Uy/Uz + contexto InSAR</h3>
        <p style={{ color: "#94a3b8", fontSize: 9.3, lineHeight: 1.55, margin: 0 }}>
          Recupera series diarias NGL/IGS20 cercanas al evento, ajusta la tendencia pre-evento y estima el desplazamiento residual E/N/U. Después interpola un campo superficial <b style={{ color: "#cffafe" }}>Ux/Uy/Uz</b>. COMET LiCSAR se consulta de forma independiente para saber si existen interferogramas coseísmicos/post-sísmicos.
        </p>
      </div>
      {result && ready && <span style={{ border: `1px solid ${ready.border}`, background: ready.bg, color: ready.color, borderRadius: 999, padding: "6px 9px", fontSize: 8.5, fontWeight: 900 }}>
        {result.readiness.readyForPhase5 ? "LISTA PARA PREPARAR FASE 5" : result.readiness.label === "provisional" ? "FASE 4 PROVISIONAL" : "SOPORTE INSUFICIENTE"}
      </span>}
    </div>

    <div style={{ marginTop: 9, padding: 9, borderRadius: 10, background: "rgba(2,6,23,.58)", border: `1px solid ${seed.gatePassed ? "rgba(52,211,153,.22)" : "rgba(251,191,36,.24)"}`, color: "#cbd5e1", fontSize: 8.7, lineHeight: 1.5 }}>
      <b style={{ color: seed.gatePassed ? "#6ee7b7" : "#fde68a" }}>Contrato Fase 3 → 4:</b> gate {seed.gatePassed ? "superado" : "no superado"} · score {seed.gateScore}/100 · {seed.acceptedConstraintCount} constraints estructurales. {seed.gatePassed ? "Se usarán únicamente como contexto/resolución." : "GNSS puede ejecutarse, pero δVp/δVs tendrá peso cero."}
    </div>

    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 9, alignItems: "center" }}>
      <button type="button" onClick={() => void run()} disabled={loading} style={{ background: "#083344", color: "#ecfeff", border: "1px solid #0891b2", borderRadius: 9, padding: "8px 11px", fontSize: 9.5, fontWeight: 800, cursor: loading ? "default" : "pointer", opacity: loading ? .72 : 1 }}>
        {loading ? "Consultando GNSS / InSAR…" : result ? "Recalcular Fase 4" : "Ejecutar Fase 4 · GNSS + InSAR"}
      </button>
      <span style={{ color: "#64748b", fontSize: 8.3 }}>Evento: M{event.magnitude.toFixed(1)} · {new Date(event.timeUtc).toISOString().slice(0, 10)}</span>
    </div>

    {error && <div style={{ marginTop: 9, padding: 9, borderRadius: 10, border: "1px solid rgba(248,113,113,.3)", background: "rgba(127,29,29,.16)", color: "#fecaca", fontSize: 9 }}>{error}</div>}

    {result && <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(125px,1fr))", gap: 7, marginTop: 10 }}>
        <article style={card}><div style={{ color: "#67e8f9", fontSize: 8, fontWeight: 900 }}>ESTACIONES GNSS</div><strong style={{ color: "white", fontSize: 18 }}>{result.stationCount}</strong><div style={{ color: "#64748b", fontSize: 8 }}>{result.gnss.product ?? "sin producto"} · IGS20</div></article>
        <article style={card}><div style={{ color: "#a7f3d0", fontSize: 8, fontWeight: 900 }}>MEDIANA |U|</div><strong style={{ color: "white", fontSize: 18 }}>{mm(result.medianVectorMm)}</strong></article>
        <article style={card}><div style={{ color: "#fda4af", fontSize: 8, fontWeight: 900 }}>MÁXIMO |U|</div><strong style={{ color: "white", fontSize: 18 }}>{mm(result.maxVectorMm)}</strong></article>
        <article style={card}><div style={{ color: "#fde68a", fontSize: 8, fontWeight: 900 }}>INCERTIDUMBRE MEDIANA</div><strong style={{ color: "white", fontSize: 18 }}>{mm(result.medianUncertaintyMm)}</strong></article>
        <article style={card}><div style={{ color: "#c4b5fd", fontSize: 8, fontWeight: 900 }}>GEOMETRÍA AZIMUTAL</div><strong style={{ color: "white", fontSize: 16 }}>{result.azimuthCoverageDeg.toFixed(0)}°</strong><div style={{ color: "#64748b", fontSize: 8 }}>gap {result.azimuthGapDeg.toFixed(0)}°</div></article>
        <article style={card}><div style={{ color: "#22d3ee", fontSize: 8, fontWeight: 900 }}>CAMPO SOPORTADO</div><strong style={{ color: "white", fontSize: 18 }}>{result.strongCellCount}</strong><div style={{ color: "#64748b", fontSize: 8 }}>celdas score ≥42</div></article>
        <article style={card}><div style={{ color: "#fb7185", fontSize: 8, fontWeight: 900 }}>INSAR CATALOGADO</div><strong style={{ color: "white", fontSize: 18 }}>{result.insar.coseismicCount}</strong><div style={{ color: "#64748b", fontSize: 8 }}>coseísmicos LiCSAR</div></article>
        <article style={card}><div style={{ color: ready?.color ?? "#94a3b8", fontSize: 8, fontWeight: 900 }}>READY FASE 5</div><strong style={{ color: "white", fontSize: 18 }}>{result.readiness.score}/100</strong><div style={{ color: "#64748b", fontSize: 8 }}>{result.readiness.label}</div></article>
      </div>

      {result.available && <div style={{ marginTop: 9 }}><Phase4Map result={result} event={event} /></div>}

      {!result.available && <div style={{ marginTop: 9, padding: 9, borderRadius: 10, border: "1px solid rgba(251,191,36,.25)", background: "rgba(120,53,15,.12)", color: "#fde68a", fontSize: 9, lineHeight: 1.5 }}>
        NGL no devolvió series GNSS utilizables con suficiente cobertura pre/post para este evento. Fase 4 no inventa desplazamientos; prueba otro evento o una ventana histórica con mejor red geodésica.
      </div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,285px),1fr))", gap: 8, marginTop: 9 }}>
        <article style={card}>
          <div style={{ color: "#67e8f9", fontSize: 8.5, fontWeight: 900 }}>GNSS · DESPLAZAMIENTO RESIDUAL</div>
          <div style={{ display: "grid", gap: 5, marginTop: 6 }}>
            {strongestStations.length ? strongestStations.map((station) => <div key={station.code} style={{ padding: 6, borderRadius: 8, background: "rgba(2,6,23,.55)", color: "#cbd5e1", fontSize: 8.3, lineHeight: 1.48 }}>
              <b style={{ color: "#cffafe" }}>{station.code} · {station.distanceKm.toFixed(0)} km · calidad {station.qualityScore}/100</b><br />
              E {signedMm(station.eastMm)} ± {station.uncertaintyEastMm.toFixed(1)} · N {signedMm(station.northMm)} ± {station.uncertaintyNorthMm.toFixed(1)}<br />
              U {signedMm(station.upMm)} ± {station.uncertaintyUpMm.toFixed(1)} · |U| {station.vectorMm.toFixed(1)} mm<br />
              pre/post {station.preSampleCount}/{station.postSampleCount} · {station.sourceProduct}
            </div>) : <span style={{ color: "#64748b", fontSize: 8.5 }}>Sin estaciones GNSS aceptadas.</span>}
          </div>
        </article>

        <article style={card}>
          <div style={{ color: "#f9a8d4", fontSize: 8.5, fontWeight: 900 }}>COMET LiCSAR · CONTEXTO INSAR</div>
          <div style={{ display: "grid", gap: 5, marginTop: 6 }}>
            {result.insar.products.length ? result.insar.products.slice(0, 10).map((product) => <div key={`${product.frameId}-${product.pair}-${product.observation}`} style={{ color: "#cbd5e1", fontSize: 8.3, lineHeight: 1.48 }}>
              <b style={{ color: product.observation === "Coseismic" ? "#fda4af" : "#ddd6fe" }}>{product.frameId} · {product.direction} · {product.observation}</b><br />
              {product.pair} · track {product.track} · LOS raster: pendiente de validación
            </div>) : <span style={{ color: "#64748b", fontSize: 8.5 }}>Sin productos LiCSAR reconocidos para este evento.</span>}
          </div>
          <div style={{ marginTop: 7, color: "#64748b", fontSize: 8.2, lineHeight: 1.5 }}>
            En v0.1 la presencia de InSAR <b style={{ color: "#cbd5e1" }}>no cambia Ux/Uy/Uz</b>. Leer un `geo.unw.tif` en radianes sin validar longitud de onda, coherencia y vector de mirada produciría una falsa deformación LOS.
          </div>
        </article>
      </div>

      <div style={{ marginTop: 9, padding: 10, borderRadius: 12, border: `1px solid ${ready?.border ?? "rgba(148,163,184,.2)"}`, background: ready?.bg ?? "rgba(2,6,23,.58)" }}>
        <div style={{ color: ready?.color ?? "#cbd5e1", fontSize: 9, fontWeight: 900 }}>GATE FASE 4 → FASE 5</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,190px),1fr))", gap: 6, marginTop: 7 }}>
          {result.readiness.checks.map((check) => <div key={check.id} title={check.note} style={{ padding: 7, borderRadius: 9, background: "rgba(2,6,23,.55)", border: `1px solid ${check.pass ? "rgba(52,211,153,.22)" : check.required ? "rgba(251,113,133,.18)" : "rgba(148,163,184,.16)"}` }}>
            <div style={{ color: check.pass ? "#6ee7b7" : check.required ? "#fda4af" : "#94a3b8", fontSize: 8, fontWeight: 900 }}>{check.pass ? "✓" : check.required ? "×" : "○"} {check.label.toUpperCase()}</div>
            <div style={{ color: "#e2e8f0", fontSize: 9, marginTop: 2 }}>{check.value}</div>
          </div>)}
        </div>
        <div style={{ color: "#94a3b8", fontSize: 8.2, lineHeight: 1.5, marginTop: 7 }}>{result.readiness.meaning}</div>
      </div>

      <div style={{ marginTop: 9, padding: 8, borderRadius: 9, background: "rgba(2,6,23,.6)", color: "#94a3b8", fontSize: 8.4, lineHeight: 1.55 }}>
        <b style={{ color: "#e2e8f0" }}>Límite físico:</b> este campo describe desplazamiento geodésico observado y su interpolación. No es tensión, ΔCFS ni probabilidad sísmica. El siguiente paso científico será convertir deformación + geometría de falla + propiedades elásticas en cambios de esfuerzo, con validación independiente.
      </div>

      {result.warnings.length > 0 && <details style={{ marginTop: 8, ...card, color: "#94a3b8", fontSize: 8.3 }}>
        <summary style={{ cursor: "pointer", color: "#cbd5e1", fontWeight: 800 }}>Advertencias Fase 4 ({result.warnings.length})</summary>
        <div style={{ marginTop: 5, lineHeight: 1.5 }}>{result.warnings.map((warning, index) => <div key={`${warning}-${index}`}>• {warning}</div>)}</div>
      </details>}
    </>}
  </section>;
}
