export function Sequence3DAboutNote() {
  return (
    <section style={{ maxWidth: 1180, margin: "0 auto 40px", padding: "0 18px" }}>
      <div style={{ border: "1px solid rgba(244,63,94,.22)", borderRadius: 20, background: "rgba(15,23,42,.82)", padding: 20 }}>
        <span style={{ color: "#fb7185", fontSize: 12, fontWeight: 800, letterSpacing: ".12em" }}>MÓDULO · SECUENCIA 3D</span>
        <h2 style={{ margin: "8px 0 12px" }}>Cómo leer un enjambre como un volumen y no solo como puntos en un mapa</h2>
        <p style={{ color: "#b6c2d1", lineHeight: 1.6 }}>
          Secuencia 3D centra una ventana local alrededor de un terremoto real y representa cada evento por longitud, latitud, profundidad y tiempo. Su objetivo es explorar geometría hipocentral, migración temporal y relación con estructuras tectónicas sin asumir que una alineación visual identifica automáticamente una falla causal.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
          <article style={{ padding: 13, borderRadius: 13, background: "rgba(2,6,23,.42)" }}>
            <strong>Volumen + reproducción temporal</strong>
            <p style={{ color: "#9fb0c4", lineHeight: 1.5, marginBottom: 0 }}>Permite rotar la perspectiva, exagerar la profundidad y reproducir cronológicamente la secuencia para observar expansión, concentración o migración aparente.</p>
          </article>
          <article style={{ padding: 13, borderRadius: 13, background: "rgba(2,6,23,.42)" }}>
            <strong>Corte A–A′</strong>
            <p style={{ color: "#9fb0c4", lineHeight: 1.5, marginBottom: 0 }}>Proyecta los hipocentros cercanos a un perfil configurable para estudiar planos inclinados, cambios de profundidad y su relación aproximada con Slab2.</p>
          </article>
          <article style={{ padding: 13, borderRadius: 13, background: "rgba(2,6,23,.42)" }}>
            <strong>Capas tectónicas</strong>
            <p style={{ color: "#9fb0c4", lineHeight: 1.5, marginBottom: 0 }}>Puede superponer fallas GEM, superficie local Slab2, ejes P/T de mecanismos USGS y el balance Coulomb de fallas receptoras usando solo fuentes ya ocurridas en el instante reproducido.</p>
          </article>
        </div>
        <p style={{ color: "#94a3b8", lineHeight: 1.55, marginBottom: 0, marginTop: 14 }}>
          <strong>Base teórica:</strong> localización hipocentral, secciones geológicas, mecanismos focales/tensores de momento, geometría Slab2 y transferencia estática Coulomb. <strong>Fuentes:</strong> catálogo normalizado RDSISMOS (USGS/NEIC, EMSC y Raspberry Shake cuando corresponda), GEM Global Active Faults, USGS Slab2 y productos de tensor de momento USGS. La completitud para sismos pequeños varía por región y red; el módulo es analítico, no una predicción determinista.
        </p>
      </div>
    </section>
  );
}
