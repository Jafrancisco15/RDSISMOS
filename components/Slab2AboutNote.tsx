export function Slab2AboutNote() {
  return (
    <section style={{ maxWidth: 1180, margin: "0 auto 40px", padding: "0 18px" }}>
      <div style={{ border: "1px solid rgba(56,189,248,.22)", borderRadius: 20, background: "rgba(15,23,42,.82)", padding: 20 }}>
        <span style={{ color: "#38bdf8", fontSize: 12, fontWeight: 800, letterSpacing: ".12em" }}>ACTUALIZACIÓN TECTÓNICA 3D · SLAB2</span>
        <h2 style={{ margin: "8px 0 12px" }}>Sismos de interfaz, intraslab y placa superior</h2>
        <p style={{ color: "#b6c2d1", lineHeight: 1.6 }}>
          El mapa de placas de GPlates representa la geometría tectónica vista desde la superficie. Un terremoto profundo puede proyectarse debajo del polígono de una placa continental y, sin embargo, ocurrir físicamente dentro de una placa oceánica que ya se encuentra subducida. Por eso RDSISMOS mantiene separadas ambas lecturas.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
          <article style={{ padding: 13, borderRadius: 13, background: "rgba(2,6,23,.42)" }}>
            <strong>GPlates · asignación superficial</strong>
            <p style={{ color: "#9fb0c4", lineHeight: 1.5, marginBottom: 0 }}>Sirve para estadísticas y geometría de placas en planta. No determina por sí sola qué placa contiene un hipocentro profundo.</p>
          </article>
          <article style={{ padding: 13, borderRadius: 13, background: "rgba(2,6,23,.42)" }}>
            <strong>Inspector Slab2 · contexto 3D</strong>
            <p style={{ color: "#9fb0c4", lineHeight: 1.5, marginBottom: 0 }}>Compara profundidad del sismo con la superficie Slab2 y clasifica de forma exploratoria INTERFAZ, INTRASLAB, PLACA SUPERIOR, FUERA DE LOSA o INCIERTO.</p>
          </article>
          <article style={{ padding: 13, borderRadius: 13, background: "rgba(2,6,23,.42)" }}>
            <strong>Scope Projection v3</strong>
            <p style={{ color: "#9fb0c4", lineHeight: 1.5, marginBottom: 0 }}>Cuando Slab2 tiene cobertura, la similitud conserva 80% del criterio histórico y añade 20% de compatibilidad tectónica, reduciendo el peso de análogos de un régimen diferente.</p>
          </article>
        </div>
        <p style={{ color: "#94a3b8", lineHeight: 1.55, marginBottom: 0, marginTop: 14 }}>
          <strong>Base teórica y fuente:</strong> USGS Slab2, Hayes et al. (2018), DOI 10.5066/F7PV6JNV. Slab2 es un modelo tridimensional de geometría de zonas de subducción. La clasificación de RDSISMOS es una inferencia geométrica y no una identificación definitiva de la falla que rompió.
        </p>
      </div>
    </section>
  );
}
