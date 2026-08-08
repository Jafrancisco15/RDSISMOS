"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  ProjectionHistoryItem,
  ProjectionHistoryResponse,
} from "@/lib/learning/projectionHistory";

function formatDate(value: string, withTime = false) {
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const } : {}),
    timeZone: "UTC",
  }).format(new Date(value));
}

function daysBetween(first: string, second: string) {
  const delta = Date.parse(second) - Date.parse(first);
  if (!Number.isFinite(delta)) return null;
  return delta / 86_400_000;
}

function observed(item: ProjectionHistoryItem) {
  return item.outcome?.firstEvent ?? null;
}

async function readHistoryResponse(response: Response): Promise<ProjectionHistoryResponse> {
  const raw = await response.text();
  let payload: ProjectionHistoryResponse | null = null;
  try {
    payload = JSON.parse(raw) as ProjectionHistoryResponse;
  } catch {
    const compact = raw.replace(/\s+/g, " ").trim().slice(0, 240);
    throw new Error(compact || `El servidor devolvió HTTP ${response.status} sin JSON válido.`);
  }
  if (!response.ok) {
    throw new Error(payload.message ?? `HTTP ${response.status}`);
  }
  return payload;
}

export function RecentFulfilledProjections() {
  const [data, setData] = useState<ProjectionHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;

    async function load(showLoader: boolean) {
      if (showLoader) setLoading(true);
      try {
        const params = new URLSearchParams({
          status: "fulfilled",
          page: "1",
          pageSize: "15",
          _: String(Date.now()),
        });
        const response = await fetch(`/api/migration/projections?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await readHistoryResponse(response);
        if (!disposed) {
          setData(payload);
          setError(null);
        }
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        if (!disposed) {
          setError(loadError instanceof Error ? loadError.message : "No fue posible cargar los aciertos recientes.");
        }
      } finally {
        if (!disposed && showLoader) setLoading(false);
      }
    }

    void load(true);
    const interval = window.setInterval(() => void load(false), 5 * 60_000);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);

  const fulfilled = useMemo(
    () => (data?.items ?? []).filter((item) => item.status === "fulfilled" && item.outcome?.firstEvent),
    [data],
  );

  return (
    <section className="globe-fulfilled-section" aria-label="Proyecciones cumplidas verificadas">
      <header className="globe-fulfilled-head">
        <div>
          <span className="eyebrow">Validación observada</span>
          <h2>Proyecciones cumplidas</h2>
          <p>Comparación directa entre el evento precedente, lo que el modelo proyectó y el primer sismo que cumplió tiempo, ubicación y magnitud.</p>
        </div>
        <div className="globe-fulfilled-count">
          <span>Aciertos registrados</span>
          <strong>{data?.total.toLocaleString() ?? "—"}</strong>
        </div>
      </header>

      {error && <div className="warning-banner">Tabla de cumplidas: {error}</div>}

      <div className="globe-fulfilled-cards">
        {fulfilled.slice(0, 3).map((item) => {
          const event = observed(item)!;
          const afterPrecedent = daysBetween(item.sourceEvent.time, event.time);
          return (
            <article key={`card-${item.id}`} className="panel globe-fulfilled-card">
              <div className="globe-fulfilled-card-title">
                <span className="projection-status-badge fulfilled">Cumplida</span>
                <strong>{item.countryName}</strong>
              </div>
              <div className="globe-fulfilled-flow">
                <div>
                  <small>Precedente</small>
                  <strong>M{item.sourceEvent.magnitude.toFixed(1)}</strong>
                  <span>{item.sourceEvent.place}</span>
                  <em>{formatDate(item.sourceEvent.time, true)}</em>
                </div>
                <b>→</b>
                <div>
                  <small>Predicción</small>
                  <strong>{item.probabilityPct.toFixed(0)}% · M{item.magnitudeMin.toFixed(1)}–M{item.magnitudeMax.toFixed(1)}</strong>
                  <span>{item.zoneName}</span>
                  <em>hasta {formatDate(item.surveillanceEnd)}</em>
                </div>
                <b>→</b>
                <div>
                  <small>Ocurrió</small>
                  <strong>M{event.magnitude.toFixed(1)}</strong>
                  <span>{event.place}</span>
                  <em>{formatDate(event.time, true)}</em>
                </div>
              </div>
              <footer>
                {afterPrecedent === null ? "Tiempo no disponible" : `${afterPrecedent.toFixed(1)} días después del precedente`}
                {item.outcome?.daysToFirstEvent !== null && item.outcome?.daysToFirstEvent !== undefined
                  ? ` · ${item.outcome.daysToFirstEvent.toFixed(1)} días desde el inicio efectivo de la predicción`
                  : ""}
              </footer>
            </article>
          );
        })}
        {!loading && !fulfilled.length && !error && (
          <div className="panel globe-fulfilled-empty">Todavía no hay proyecciones cumplidas registradas.</div>
        )}
      </div>

      <section className="panel globe-fulfilled-table-panel">
        <div className="globe-fulfilled-table-head">
          <div><span className="eyebrow">Auditoría</span><h3>Predicción vs. resultado</h3></div>
          <span>{loading ? "Actualizando…" : `Últimas ${fulfilled.length} cumplidas`}</span>
        </div>
        <div className="projection-table-wrap">
          <table className="projection-history-table globe-fulfilled-table">
            <thead>
              <tr>
                <th>País / zona</th>
                <th>Evento precedente</th>
                <th>Predicción emitida</th>
                <th>Lo que sucedió</th>
                <th>Cuándo</th>
                <th>Verificación</th>
              </tr>
            </thead>
            <tbody>
              {fulfilled.map((item) => {
                const event = observed(item)!;
                const afterPrecedent = daysBetween(item.sourceEvent.time, event.time);
                return (
                  <tr key={`row-${item.id}`}>
                    <td>
                      <strong>{item.countryName}</strong>
                      <span>{item.zoneName}</span>
                      <small>{item.id}</small>
                    </td>
                    <td>
                      <strong>M{item.sourceEvent.magnitude.toFixed(1)} · {item.sourceEvent.place}</strong>
                      <span>{formatDate(item.sourceEvent.time, true)}</span>
                      <small>{item.sourceEvent.depthKm.toFixed(1)} km de profundidad</small>
                    </td>
                    <td>
                      <strong>{item.probabilityPct.toFixed(0)}% · M{item.magnitudeMin.toFixed(1)}–M{item.magnitudeMax.toFixed(1)}</strong>
                      <span>{formatDate(item.surveillanceStart)} → {formatDate(item.surveillanceEnd)}</span>
                      <small>Base {item.baselinePct.toFixed(0)}% · diferencia {item.liftPct > 0 ? "+" : ""}{item.liftPct.toFixed(0)} pp</small>
                    </td>
                    <td>
                      <strong>M{event.magnitude.toFixed(1)} · {event.place}</strong>
                      <span>{event.depthKm.toFixed(1)} km de profundidad</span>
                      <small>{item.outcome?.eventCount ?? 1} evento(s) compatibles en la ventana</small>
                    </td>
                    <td>
                      <strong>{formatDate(event.time, true)}</strong>
                      <span>{afterPrecedent === null ? "—" : `${afterPrecedent.toFixed(1)} días después del precedente`}</span>
                      <small>{item.outcome?.daysToFirstEvent !== null && item.outcome?.daysToFirstEvent !== undefined ? `${item.outcome.daysToFirstEvent.toFixed(1)} días desde el inicio efectivo` : ""}</small>
                    </td>
                    <td>
                      <span className="projection-status-badge fulfilled">Cumplida</span>
                      <span>Evaluada {item.outcome ? formatDate(item.outcome.evaluatedAt, true) : "—"}</span>
                    </td>
                  </tr>
                );
              })}
              {!loading && !fulfilled.length && !error && (
                <tr><td colSpan={6} className="projection-history-empty">No hay aciertos registrados para mostrar.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
