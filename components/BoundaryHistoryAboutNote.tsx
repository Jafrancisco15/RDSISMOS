export function BoundaryHistoryAboutNote() {
  return (
    <section style={{ maxWidth: 1180, margin: "0 auto 40px", padding: "0 18px" }}>
      <div style={{ border: "1px solid rgba(56,189,248,.22)", borderRadius: 20, background: "rgba(15,23,42,.82)", padding: 20 }}>
        <span style={{ color: "#38bdf8", fontSize: 12, fontWeight: 800, letterSpacing: ".12em" }}>GPLATES · HISTORIA DEL BORDE</span>
        <h2 style={{ margin: "8px 0 12px" }}>Cómo cambia la geometría de una placa a escala geológica</h2>
        <p style={{ color: "#b6c2d1", lineHeight: 1.6 }}>
          Esta sección reconstruye una misma identidad de placa con el modelo ZAHIROVIC2022 a 0, 5, 10, 20 y 50 millones de años. Compara el mayor contorno reconstruido mediante perímetro geodésico, orientación axial dominante, un índice de curvatura normalizado y desplazamiento medio de la geometría respecto al presente.
        </p>
        <p style={{ color: "#94a3b8", lineHeight: 1.55, marginBottom: 0 }}>
          <strong>Base teórica:</strong> reconstrucción cinemática de placas y análisis geométrico de contornos. <strong>Fuente:</strong> GPlates Web Service / EarthByte, modelo ZAHIROVIC2022, relacionado con los datasets y workflows descritos por Zahirovic et al. (2022). La velocidad mostrada es desplazamiento medio reconstruido, no una medición GNSS ni convergencia relativa entre dos placas. La curvatura es un índice exploratorio sensible a la resolución de la geometría y no constituye una predicción sísmica.
        </p>
      </div>
    </section>
  );
}
