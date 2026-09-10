"use client";

import type {
  CoreSeismicRelativeBin,
  CoreSeismicRelativeEventRow,
  CoreSeismicRelativeStudy,
} from "@/lib/coreSeismicRelative";

function fmt(value: number | null, digits = 2) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function relativeLabel(value: number) {
  if (value === 0) return "0 · sismo";
  return value > 0 ? "+" + value : String(value);
}

function RelativeProfileChart({ bins }: { bins: CoreSeismicRelativeBin[] }) {
  const width = 1080;
  const height = 470;
  const left = 62;
  const right = 70;
  const plotWidth = width - left - right;
  const saTop = 52;
  const saBottom = 205;
  const jerkTop = 286;
  const jerkBottom = 439;
  const x = (index: number) => left + (index / Math.max(1, bins.length - 1)) * plotWidth;
  const saValues = bins
    .flatMap(bin => [bin.saEventMedianZ, bin.saControlMedianZ])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const jerkValues = bins
    .flatMap(bin => [bin.jerkEventMedian, bin.jerkControlMedian])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const saMax = Math.max(1, ...saValues.map(value => Math.abs(value)));
  const jerkMax = Math.max(1, ...jerkValues);
  const ySa = (value: number) => (saTop + saBottom) / 2 - (value / saMax) * ((saBottom - saTop) / 2);
  const yJerk = (value: number) => jerkBottom - (value / jerkMax) * (jerkBottom - jerkTop);
  const pathFor = (values: Array<number | null>, y: (value: number) => number) => {
    let path = "";
    values.forEach((value, index) => {
      if (typeof value !== "number" || !Number.isFinite(value)) return;
      path += (path ? " L" : " M") + x(index).toFixed(1) + "," + y(value).toFixed(1);
    });
    return path;
  };
  const eventSaPath = pathFor(bins.map(bin => bin.saEventMedianZ), ySa);
  const controlSaPath = pathFor(bins.map(bin => bin.saControlMedianZ), ySa);
  const eventJerkPath = pathFor(bins.map(bin => bin.jerkEventMedian), yJerk);
  const controlJerkPath = pathFor(bins.map(bin => bin.jerkControlMedian), yJerk);
  const zeroIndex = bins.findIndex(bin => bin.relativeYear === 0);
  const zeroX = zeroIndex >= 0 ? x(zeroIndex) : left + plotWidth / 2;

  return <div style={{ overflowX: "auto" }}>
    <svg viewBox={"0 0 " + width + " " + height} style={{ width: "100%", minWidth: 760, background: "#071522", borderRadius: 12 }} role="img" aria-label="Perfiles relativos de aceleración secular y magnetic jerks antes y después de los terremotos M7+">
      <rect x={left} y={saTop} width={Math.max(0, zeroX - left)} height={saBottom - saTop} fill="#10293a" opacity=".5" />
      <rect x={zeroX} y={saTop} width={Math.max(0, width - right - zeroX)} height={saBottom - saTop} fill="#2d2418" opacity=".42" />
      <rect x={left} y={jerkTop} width={Math.max(0, zeroX - left)} height={jerkBottom - jerkTop} fill="#10293a" opacity=".5" />
      <rect x={zeroX} y={jerkTop} width={Math.max(0, width - right - zeroX)} height={jerkBottom - jerkTop} fill="#2d2418" opacity=".42" />
      {[saTop, (saTop + saBottom) / 2, saBottom, jerkTop, jerkBottom].map((yValue, index) => <line key={index} x1={left} x2={width - right} y1={yValue} y2={yValue} stroke="#203747" strokeWidth="1" />)}
      <line x1={zeroX} x2={zeroX} y1={saTop - 10} y2={jerkBottom + 4} stroke="#f4c76b" strokeWidth="1.5" strokeDasharray="5 4" />
      {eventSaPath && <path d={eventSaPath} fill="none" stroke="#c5a0ff" strokeWidth="3" />}
      {controlSaPath && <path d={controlSaPath} fill="none" stroke="#7f95a4" strokeWidth="2.5" strokeDasharray="7 5" />}
      {eventJerkPath && <path d={eventJerkPath} fill="none" stroke="#6ce0dc" strokeWidth="3" />}
      {controlJerkPath && <path d={controlJerkPath} fill="none" stroke="#7f95a4" strokeWidth="2.5" strokeDasharray="7 5" />}
      {bins.map((bin, index) => <g key={bin.relativeYear}>
        {typeof bin.saEventMedianZ === "number" && Number.isFinite(bin.saEventMedianZ) && <circle cx={x(index)} cy={ySa(bin.saEventMedianZ)} r="4" fill="#c5a0ff" />}
        {typeof bin.saControlMedianZ === "number" && Number.isFinite(bin.saControlMedianZ) && <circle cx={x(index)} cy={ySa(bin.saControlMedianZ)} r="3" fill="#7f95a4" />}
        {typeof bin.jerkEventMedian === "number" && <circle cx={x(index)} cy={yJerk(bin.jerkEventMedian)} r="4" fill="#6ce0dc" />}
        {typeof bin.jerkControlMedian === "number" && <circle cx={x(index)} cy={yJerk(bin.jerkControlMedian)} r="3" fill="#7f95a4" />}
        <text x={x(index)} y={height - 12} fill="#9cafbd" fontSize="11" textAnchor="middle">{relativeLabel(bin.relativeYear)}</text>
      </g>)}
      <text x={left} y={25} fill="#c5a0ff" fontSize="13">Aceleración secular · z relativo al tramo previo</text>
      <text x={left + 330} y={25} fill="#c5a0ff" fontSize="11">evento</text>
      <text x={left + 385} y={25} fill="#7f95a4" fontSize="11">control · línea discontinua</text>
      <text x={left} y={saTop - 9} fill="#9cafbd" fontSize="11">+{saMax.toFixed(1)} z</text>
      <text x={left} y={(saTop + saBottom) / 2 - 4} fill="#9cafbd" fontSize="11">0</text>
      <text x={left} y={saBottom + 14} fill="#9cafbd" fontSize="11">−{saMax.toFixed(1)} z</text>
      <text x={left} y={jerkTop - 12} fill="#6ce0dc" fontSize="13">Intensidad de magnetic jerk catalogada</text>
      <text x={width - right + 8} y={jerkTop + 5} fill="#9cafbd" fontSize="11">{jerkMax.toFixed(1)}</text>
      <text x={width - right + 8} y={jerkBottom} fill="#9cafbd" fontSize="11">0</text>
      <text x={zeroX + 7} y={saTop + 15} fill="#f4c76b" fontSize="11">τ = 0</text>
      <text x={left + 6} y={saTop + 17} fill="#9cafbd" fontSize="11">antes</text>
      <text x={width - right - 42} y={saTop + 17} fill="#9cafbd" fontSize="11">después</text>
    </svg>
  </div>;
}

function EventTable({ rows }: { rows: CoreSeismicRelativeEventRow[] }) {
  const visible = [...rows]
    .sort((a, b) => b.magnitude - a.magnitude || (b.timeUtc ?? "").localeCompare(a.timeUtc ?? ""))
    .slice(0, 120);
  return <details style={{ marginTop: 15 }}>
    <summary style={{ cursor: "pointer", color: "#8cc7ff" }}>Eventos individuales ({rows.length.toLocaleString()} en la API; muestra visual de {visible.length})</summary>
    <div style={{ overflowX: "auto", marginTop: 10 }}>
      <table style={{ width: "100%", minWidth: 1060, borderCollapse: "collapse", fontSize: 11 }}>
        <thead><tr style={{ color: "#91a8b7", textAlign: "right" }}><th style={{ textAlign: "left", padding: 6 }}>Fecha</th><th style={{ padding: 6 }}>M</th><th style={{ padding: 6 }}>SA pre</th><th style={{ padding: 6 }}>SA evento</th><th style={{ padding: 6 }}>SA post</th><th style={{ padding: 6 }}>Δ post−pre</th><th style={{ padding: 6 }}>Jerk 2–5 años</th><th style={{ padding: 6 }}>Control</th></tr></thead>
        <tbody>{visible.map(row => <tr key={row.id} style={{ borderTop: "1px solid #203747", textAlign: "right" }}><td style={{ textAlign: "left", padding: 6 }}>{row.timeUtc?.slice(0, 10) ?? row.year}</td><td style={{ padding: 6 }}>M{row.magnitude.toFixed(1)}</td><td style={{ padding: 6 }}>{fmt(row.preSaMedianNtYr2, 1)}</td><td style={{ padding: 6 }}>{fmt(row.eventSaMedianNtYr2, 1)}</td><td style={{ padding: 6 }}>{fmt(row.postSaMedianNtYr2, 1)}</td><td style={{ padding: 6 }}>{fmt(row.postMinusPreSaNtYr2, 1)}</td><td style={{ padding: 6 }}>{row.hasJerkAfter2to5 ? "sí · " + fmt(row.firstJerkAfter2to5Years, 1) + " a" : "no"}</td><td style={{ padding: 6 }}>{row.controlTimeUtc?.slice(0, 10) ?? "—"}</td></tr>)}</tbody>
      </table>
    </div>
  </details>;
}

export function CoreSeismicRelativeStudyPanel({ study }: { study: CoreSeismicRelativeStudy }) {
  const replication = study.historicalReplication;
  const statusColor = study.status === "ready" ? "#7ee0a8" : study.status === "partial" ? "#f4c76b" : "#ff9c82";
  const percent = (value: number | null) => value === null ? "—" : (value * 100).toFixed(1) + "%";
  return <div style={{ marginTop: 20, background: "#081724", border: "1px solid #315266", borderRadius: 15, padding: 18 }}>
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
      <h3 style={{ margin: 0 }}>Experimento principal · épocas superpuestas por sismo</h3>
      <strong style={{ color: statusColor }}>{study.status === "ready" ? "COBERTURA LISTA" : study.status === "partial" ? "COBERTURA PARCIAL" : "COBERTURA INSUFICIENTE"}</strong>
    </div>
    <p style={{ color: "#b8c8d2", lineHeight: 1.55, maxWidth: 1100 }}>Cada terremoto M7+ tiene su propio tiempo cero (τ = 0). La aceleración secular se conserva a escala mensual, se resume en bins relativos de −5 a +5 años y se compara con épocas de control emparejadas por cobertura. Los terremotos que caen en el mismo año comparten un bloque para no convertir una secuencia o un único jerk en múltiples confirmaciones independientes.</p>
    <div role="status" style={{ background: "#0c2131", borderRadius: 10, padding: 12, color: statusColor, lineHeight: 1.45 }}>{study.statusMessage}</div>
    {study.warnings.length > 0 && <div className="quality-warning" style={{ marginTop: 10 }}>{study.warnings.join(" · ")}</div>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 9, marginTop: 14 }}>
      <div style={{ background: "#0a1b2a", borderRadius: 10, padding: 11 }}><div style={{ color: "#91a8b7", fontSize: 11 }}>M7+ con ±{study.windowYears} años</div><strong style={{ fontSize: 21 }}>{study.eligibleEvents.toLocaleString()}</strong></div>
      <div style={{ background: "#0a1b2a", borderRadius: 10, padding: 11 }}><div style={{ color: "#91a8b7", fontSize: 11 }}>Controles emparejados</div><strong style={{ fontSize: 21 }}>{study.eligibleControls.toLocaleString()}</strong></div>
      <div style={{ background: "#0a1b2a", borderRadius: 10, padding: 11 }}><div style={{ color: "#91a8b7", fontSize: 11 }}>Bloques de eventos</div><strong style={{ fontSize: 21 }}>{study.independentEventClusters.toLocaleString()}</strong></div>
      <div style={{ background: "#0a1b2a", borderRadius: 10, padding: 11 }}><div style={{ color: "#91a8b7", fontSize: 11 }}>Medias magnéticas mensuales</div><strong style={{ fontSize: 21 }}>{study.magneticObservations.toLocaleString()}</strong><div style={{ color: "#7f95a4", fontSize: 11 }}>{study.magneticFirstYear?.toFixed(1) ?? "—"}–{study.magneticLastYear?.toFixed(1) ?? "—"}</div></div>
      <div style={{ background: "#0a1b2a", borderRadius: 10, padding: 11 }}><div style={{ color: "#91a8b7", fontSize: 11 }}>Cambio post − pre · evento/control</div><strong style={{ fontSize: 19 }}>{fmt(study.prePost.postMinusPreDifferenceNtYr2, 1)}</strong><div style={{ color: "#7f95a4", fontSize: 11 }}>nT/año²</div></div>
    </div>
    <div style={{ marginTop: 16 }}><RelativeProfileChart bins={study.bins} /></div>
    <p style={{ color: "#8fa5b4", fontSize: 12, lineHeight: 1.5 }}>La curva morada muestra la mediana estandarizada por evento respecto de sus cinco años previos; la línea gris discontinua es el control. La curva turquesa muestra la intensidad continua del catálogo de jerks alrededor de cada época. Un cambio visual no demuestra causalidad.</p>
    <div style={{ overflowX: "auto", marginTop: 14 }}>
      <table style={{ width: "100%", minWidth: 850, borderCollapse: "collapse", fontSize: 12 }}>
        <caption style={{ textAlign: "left", padding: "0 0 8px", color: "#dce8ef", fontWeight: 700 }}>Perfil alineado por año relativo</caption>
        <thead><tr style={{ color: "#91a8b7", textAlign: "right" }}><th style={{ textAlign: "left", padding: 7 }}>τ</th><th style={{ padding: 7 }}>SA evento z</th><th style={{ padding: 7 }}>SA control z</th><th style={{ padding: 7 }}>Δ z</th><th style={{ padding: 7 }}>Jerk evento</th><th style={{ padding: 7 }}>Jerk control</th><th style={{ padding: 7 }}>perfiles E/C</th><th style={{ padding: 7 }}>bloques E/C</th></tr></thead>
        <tbody>{study.bins.map(bin => <tr key={bin.relativeYear} style={{ borderTop: "1px solid #203747", textAlign: "right" }}><th scope="row" style={{ textAlign: "left", padding: 7, color: bin.relativeYear === 0 ? "#f4c76b" : "#dce8ef" }}>{relativeLabel(bin.relativeYear)}</th><td style={{ padding: 7 }}>{fmt(bin.saEventMedianZ)}</td><td style={{ padding: 7 }}>{fmt(bin.saControlMedianZ)}</td><td style={{ padding: 7, color: "#c5a0ff" }}>{fmt(bin.saEffectZ)}</td><td style={{ padding: 7 }}>{fmt(bin.jerkEventMedian)}</td><td style={{ padding: 7 }}>{fmt(bin.jerkControlMedian)}</td><td style={{ padding: 7 }}>{bin.eventSampleCount}/{bin.controlSampleCount}</td><td style={{ padding: 7 }}>{bin.eventClusterCount}/{bin.controlClusterCount}</td></tr>)}</tbody>
      </table>
    </div>
    <div style={{ marginTop: 16, background: "#0a1b2a", borderRadius: 12, padding: 14 }}>
      <h4 style={{ margin: "0 0 8px" }}>Réplica histórica de la ventana 2–5 años</h4>
      <p style={{ color: "#b8c8d2", fontSize: 12, lineHeight: 1.5 }}>{replication.reference}. Se evaluaron {replication.eventsConsidered} pares; {replication.candidateM8Events} eventos M≥8 quedaron dentro de la cobertura y {replication.exactMsCandidates} tienen etiqueta Ms explícita.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 9 }}>
        <div><div style={{ color: "#91a8b7", fontSize: 11 }}>Escala usada</div><strong>{replication.scaleUsed}</strong></div>
        <div><div style={{ color: "#91a8b7", fontSize: 11 }}>Jerk en evento</div><strong>{percent(replication.eventHitFraction)}</strong></div>
        <div><div style={{ color: "#91a8b7", fontSize: 11 }}>Jerk en control</div><strong>{percent(replication.controlHitFraction)}</strong></div>
        <div><div style={{ color: "#91a8b7", fontSize: 11 }}>Diferencia</div><strong>{percent(replication.differenceFraction)}</strong></div>
        <div><div style={{ color: "#91a8b7", fontSize: 11 }}>p permutacional</div><strong>{fmt(replication.permutationP, 3)}</strong></div>
      </div>
      <p style={{ color: "#7f95a4", fontSize: 11, lineHeight: 1.45, marginBottom: 0 }}>{replication.scaleNote} La p es exploratoria y está basada en diferencias apareadas por bloque de año; no corrige todas las decisiones de catálogo.</p>
    </div>
    <EventTable rows={study.eventRows} />
    <p style={{ color: "#7f95a4", fontSize: 11, lineHeight: 1.45 }}>Diseño: observaciones magnéticas BGS en meses relativos; controles desplazados de forma determinista con la misma exigencia de cobertura; resumen robusto por bloque de año. El resultado es una asociación retrospectiva/exploratoria, no una alerta ni una predicción operacional.</p>
  </div>;
}
