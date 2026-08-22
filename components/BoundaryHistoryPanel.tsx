"use client";

import { useEffect, useMemo, useState } from "react";
import type { BoundaryHistoryResponse, BoundaryHistorySnapshot, BoundaryPoint } from "@/lib/boundaryHistory";
import styles from "./BoundaryHistoryPanel.module.css";

function fmt(value: number | null, digits = 1, suffix = "") {
  return value === null || !Number.isFinite(value) ? "—" : `${value.toFixed(digits)}${suffix}`;
}

function signed(value: number | null, digits = 1, suffix = "%") {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}${suffix}`;
}

function unwrap(points: BoundaryPoint[]) {
  if (!points.length) return [] as BoundaryPoint[];
  const result: BoundaryPoint[] = [[points[0][0], points[0][1]]];
  for (let i = 1; i < points.length; i += 1) {
    let lon = points[i][0];
    const prev = result[i - 1][0];
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    result.push([lon, points[i][1]]);
  }
  return result;
}

function outlinePath(points: BoundaryPoint[]) {
  const clean = unwrap(points);
  if (clean.length < 3) return "";
  const xs = clean.map((point) => point[0]);
  const ys = clean.map((point) => point[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = Math.max(1e-6, maxX - minX), spanY = Math.max(1e-6, maxY - minY);
  const pad = 12, width = 320, height = 220;
  return clean.map(([lon, lat], index) => {
    const x = pad + (lon - minX) / spanX * (width - 2 * pad);
    const y = height - pad - (lat - minY) / spanY * (height - 2 * pad);
    return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ") + " Z";
}

function snapshotLabel(snapshot: BoundaryHistorySnapshot) {
  return snapshot.timeMa === 0 ? "Presente" : `${snapshot.timeMa} Ma`;
}

export function BoundaryHistoryPanel() {
  const [data, setData] = useState<BoundaryHistoryResponse | null>(null);
  const [plateId, setPlateId] = useState<string>("");
  const [age, setAge] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const query = plateId ? `?plateId=${encodeURIComponent(plateId)}` : "";
        const response = await fetch(`/api/boundary-history${query}`, { cache: "force-cache", signal: controller.signal });
        const payload = await response.json() as BoundaryHistoryResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        if (!disposed) {
          setData(payload);
          if (!plateId && payload.plateId) setPlateId(payload.plateId);
          if (!payload.snapshots.some((snapshot) => snapshot.timeMa === age && snapshot.available)) {
            setAge(payload.snapshots.find((snapshot) => snapshot.available)?.timeMa ?? 0);
          }
        }
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        if (!disposed) setError(loadError instanceof Error ? loadError.message : "No fue posible cargar la historia del borde.");
      } finally {
        if (!disposed) setLoading(false);
      }
    }
    void load();
    return () => { disposed = true; controller.abort(); };
  }, [plateId]);

  const active = useMemo(
    () => data?.snapshots.find((snapshot) => snapshot.timeMa === age) ?? null,
    [age, data],
  );
  const path = active ? outlinePath(active.outline) : "";

  return (
    <section className={styles.panel}>
      <div className={styles.card}>
        <header className={styles.head}>
          <div>
            <span className={styles.eyebrow}>GPlates · historia geométrica</span>
            <h2>Historia del borde de la placa</h2>
            <p>
              Reconstruye la geometría de una misma placa en varias edades y compara cómo cambian su perímetro, orientación dominante,
              curvatura y desplazamiento cinemático. Está inspirado en el uso de reconstrucciones tectónicas temporales de Zahirovic et al. (2022).
            </p>
          </div>
          <div className={styles.model}>
            <span>Modelo</span><strong>{data?.model ?? "ZAHIROVIC2022"}</strong>
            <span>0 · 5 · 10 · 20 · 50 Ma</span>
          </div>
        </header>

        <div className={styles.controls}>
          <label>
            <span>Placa reconstruida</span>
            <select value={plateId} onChange={(event) => { setPlateId(event.target.value); setAge(0); }} disabled={loading}>
              {(data?.availablePlates ?? []).map((plate) => (
                <option key={plate.plateId} value={plate.plateId}>{plate.plateName} · ID {plate.plateId}</option>
              ))}
            </select>
          </label>
        </div>

        <div className={`${styles.status} ${error ? styles.error : ""}`}>
          {loading ? "Reconstruyendo geometrías de GPlates…" : error ? error : data?.plateName ? `Analizando ${data.plateName}.` : "Sin placa disponible."}
        </div>

        {data && data.snapshots.length > 0 && (
          <div className={styles.grid}>
            <div className={styles.preview}>
              <div className={styles.ageTabs}>
                {data.snapshots.map((snapshot) => (
                  <button
                    key={snapshot.timeMa}
                    type="button"
                    className={age === snapshot.timeMa ? styles.active : ""}
                    disabled={!snapshot.available}
                    onClick={() => setAge(snapshot.timeMa)}
                  >
                    {snapshotLabel(snapshot)}
                  </button>
                ))}
              </div>
              <svg className={styles.svg} viewBox="0 0 320 220" role="img" aria-label={`Silueta reconstruida ${snapshotLabel(active ?? data.snapshots[0])}`}>
                {path ? <path d={path} className={styles.outline} /> : null}
              </svg>
              <div className={styles.previewMeta}>
                <div><span>Perímetro</span><strong>{fmt(active?.perimeterKm ?? null, 0, " km")}</strong></div>
                <div><span>Orientación</span><strong>{fmt(active?.dominantOrientationDeg ?? null, 0, "°")}</strong></div>
                <div><span>Curvatura</span><strong>{fmt(active?.curvatureDegPer1000Km ?? null, 1, "°/1000 km")}</strong></div>
                <div><span>Movimiento medio</span><strong>{fmt(active?.meanMotionMmYr ?? null, 1, " mm/año")}</strong></div>
              </div>
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr><th>Edad</th><th>Perímetro</th><th>Δ perímetro</th><th>Orientación</th><th>Δ orientación</th><th>Curvatura</th><th>Δ curvatura</th><th>Desplazamiento</th><th>Movimiento medio</th></tr>
                </thead>
                <tbody>
                  {data.snapshots.map((snapshot) => (
                    <tr key={snapshot.timeMa}>
                      <td>{snapshotLabel(snapshot)}</td>
                      {snapshot.available ? <>
                        <td>{fmt(snapshot.perimeterKm, 0, " km")}</td>
                        <td>{signed(snapshot.perimeterChangePct)}</td>
                        <td>{fmt(snapshot.dominantOrientationDeg, 0, "°")}</td>
                        <td>{fmt(snapshot.orientationChangeDeg, 1, "°")}</td>
                        <td>{fmt(snapshot.curvatureDegPer1000Km, 1)}</td>
                        <td>{signed(snapshot.curvatureChangePct)}</td>
                        <td>{fmt(snapshot.displacementFromPresentKm, 0, " km")}</td>
                        <td>{fmt(snapshot.meanMotionMmYr, 1, " mm/año")}</td>
                      </> : <td colSpan={8} className={styles.na}>No disponible con la misma identidad de placa</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {data && (
          <div className={styles.notes}>
            <details>
              <summary>Cómo se calculan estas métricas</summary>
              <ul>{data.methodology.map((item) => <li key={item}>{item}</li>)}</ul>
            </details>
            {data.warnings.map((warning) => <div key={warning} className={styles.warning}>{warning}</div>)}
            <p className={styles.caution}>
              Esta capa describe historia cinemática y forma reconstruida a escala de millones de años. El índice de curvatura es exploratorio y depende de la resolución del borde. No es una variable de predicción sísmica de corto plazo ni equivale a esfuerzo acumulado. La velocidad mostrada describe desplazamiento medio de la geometría de la placa, no convergencia relativa entre dos placas.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
