"use client";

import type { EarthquakeStats } from "@/lib/earthquakes/types";

export function EarthquakeCharts({ stats }: { stats: EarthquakeStats | null }) {
  if (!stats) return <div className="chart-empty">Aplica los filtros para generar estadísticas.</div>;
  return (
    <div className="earthquake-chart-grid">
      <BarChart title="Eventos por año" data={stats.byYear.slice(-20).map((item) => ({ label: item.key, value: item.count }))} />
      <BarChart title="Magnitud máxima por año" data={stats.byYear.slice(-20).map((item) => ({ label: item.key, value: item.maxMagnitude }))} />
      <BarChart title="Distribución por magnitud" data={stats.magnitudeBuckets.map((item) => ({ label: item.key, value: item.count }))} />
      <BarChart title="Distribución por profundidad" data={stats.depthBuckets.map((item) => ({ label: item.key, value: item.count }))} />
      <BarChart title="Regiones con más eventos" data={stats.byRegion.slice(0, 10).map((item) => ({ label: item.key, value: item.count }))} horizontal />
      <ScatterChart title="Magnitud frente a profundidad" points={stats.scatter} />
    </div>
  );
}

function BarChart({ title, data, horizontal = false }: { title: string; data: Array<{ label: string; value: number }>; horizontal?: boolean }) {
  const max = Math.max(1, ...data.map((item) => item.value));
  return (
    <article className="chart-card">
      <h3>{title}</h3>
      <div className={horizontal ? "mini-bars horizontal" : "mini-bars"}>
        {data.length ? data.map((item) => (
          <div className="mini-bar-item" key={item.label} title={`${item.label}: ${item.value.toFixed(1)}`}>
            <span>{item.label}</span>
            <div><i style={{ [horizontal ? "width" : "height"]: `${Math.max(3, (item.value / max) * 100)}%` }} /></div>
            <strong>{Number.isInteger(item.value) ? item.value : item.value.toFixed(1)}</strong>
          </div>
        )) : <p>Sin datos.</p>}
      </div>
    </article>
  );
}

function ScatterChart({ title, points }: { title: string; points: EarthquakeStats["scatter"] }) {
  const sample = points.slice(0, 500);
  const maxDepth = Math.max(1, ...sample.map((point) => point.depthKm));
  return (
    <article className="chart-card">
      <h3>{title}</h3>
      <div className="scatter-chart" role="img" aria-label={title}>
        {sample.map((point, index) => (
          <i key={`${point.timeUtc}-${index}`} title={`M${point.magnitude.toFixed(1)}, ${point.depthKm.toFixed(1)} km`} style={{ left: `${Math.max(0, Math.min(100, (point.magnitude / 10) * 100))}%`, top: `${Math.max(0, Math.min(100, (point.depthKm / maxDepth) * 100))}%` }} />
        ))}
      </div>
      <small>Eje horizontal: magnitud. Eje vertical: profundidad relativa.</small>
    </article>
  );
}
