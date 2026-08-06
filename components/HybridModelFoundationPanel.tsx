export function HybridModelFoundationPanel() {
  return (
    <section className="panel hybrid-foundation-panel" aria-labelledby="hybrid-foundation-title">
      <div className="hybrid-foundation-head">
        <div>
          <span className="eyebrow">Arquitectura científica en transición</span>
          <h2 id="hybrid-foundation-title">Base híbrida v1</h2>
          <p>
            El país continúa como filtro visual, pero el catálogo comienza a trabajar con
            magnitud homogénea, corredores tectónicos y separación causal experimental.
          </p>
        </div>
        <span className="hybrid-foundation-badge">No altera aún la probabilidad final</span>
      </div>

      <div className="hybrid-foundation-grid">
        <article>
          <strong>Magnitud Mw transparente</strong>
          <p>Mw reportada se conserva. mb y Ms solo se convierten dentro de rangos publicados; ML, Md y escalas no calibradas permanecen sin conversión.</p>
        </article>
        <article>
          <strong>Receptor tectónico</strong>
          <p>Cada evento se asocia a un corredor tectónico global aproximado. Es un paso intermedio antes de usar segmentos de falla 3D.</p>
        </article>
        <article>
          <strong>Fondo frente a secuencia</strong>
          <p>Un indicador causal usa únicamente eventos anteriores y combina tiempo, distancia, profundidad y magnitud. Su porcentaje es todavía un score no calibrado.</p>
        </article>
        <article>
          <strong>Trazabilidad</strong>
          <p>Los campos nuevos aparecen en JSON, GeoJSON y CSV para poder calibrarlos por régimen tectónico mediante backtesting.</p>
        </article>
      </div>

      <details className="hybrid-foundation-next">
        <summary>Siguientes capas físicas</summary>
        <p>
          Calibración por régimen, catálogo de fallas receptoras, mecanismos focales,
          transferencia de Coulomb para eventos grandes y combinación validada con ETAS.
          Hasta completar esas fases, el resultado operacional sigue describiéndose como
          compatibilidad estadística, no causalidad física demostrada.
        </p>
      </details>
    </section>
  );
}
