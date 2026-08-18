"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  ProjectionHistoryItem,
  ProjectionHistoryResponse,
} from "@/lib/learning/projectionHistory";
import { ProjectionExplanationCard } from "./ProjectionExplanationCard";
import {
  formatProbability,
  formatSignedPercentagePoints,
  projectionInfoStyles,
} from "./ProjectionInfo";
import controls from "./ProjectionArchiveControls.module.css";

const PAGE_SIZE = 20;

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
  const [selectedItem, setSelectedItem] = useState<ProjectionHistoryItem | null>(null);
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("");
  const [minProbability, setMinProbability] = useState("");
  const [minProjectedMagnitude, setMinProjectedMagnitude] = useState("");
  const [minObservedMagnitude, setMinObservedMagnitude] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setSearch(searchDraft.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;

    async function load(showLoader: boolean) {
      if (showLoader) setLoading(true);
      try {
        const params = new URLSearchParams({
          status: "fulfilled",
          page: String(page),
          pageSize: String(PAGE_SIZE),
          search,
          country,
          minProbability,
          minProjectedMagnitude,
          minObservedMagnitude,
          sort: "generatedAt",
          direction: "desc",
          _: String(Date.now()),
        });
        const response = await fetch(`/api/migration/projections?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await readHistoryResponse(response);
        if (!disposed) {
          if (payload.totalPages > 0 && page > payload.totalPages) {
            setPage(payload.totalPages);
            return;
          }
          setData(payload);
          setSelectedItem((current) => current
            ? payload.items.find((item) => item.id === current.id) ?? current
            : null);
          setError(null);
        }
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        if (!disposed) {
          setError(loadError instanceof Error ? loadError.message : "No fue posible cargar las proyecciones cumplidas.");
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
  }, [country, minObservedMagnitude, minProbability, minProjectedMagnitude, page, search]);

  const fulfilled = useMemo(
    () => (data?.items ?? []).filter((item) => item.status === "fulfilled"),
    [data],
  );
  const featured = useMemo(
    () => fulfilled.filter((item) => Boolean(observed(item))).slice(0, 3),
    [fulfilled],
  );
  const firstRow = data?.total ? (data.page - 1) * data.pageSize + 1 : 0;
  const lastRow = data?.total ? Math.min(data.total, firstRow + fulfilled.length - 1) : 0;

  function resetFilters() {
    setPage(1);
    setSearchDraft("");
    setSearch("");
    setCountry("");
    setMinProbability("");
    setMinProjectedMagnitude("");
    setMinObservedMagnitude("");
    setSelectedItem(null);
  }

  return (
    <section className="globe-fulfilled-section" aria-label="Proyecciones cumplidas verificadas">
      <header className="globe-fulfilled-head">
        <div>
          <span className="eyebrow">Validación observada</span>
          <h2>Proyecciones cumplidas</h2>
          <p>Archivo paginado de aciertos auditados. Puedes buscar por país, zona, evento precedente o ID y filtrar las columnas principales. Cada página contiene un máximo de {PAGE_SIZE} registros.</p>
        </div>
        <div className="globe-fulfilled-count">
          <span>Aciertos filtrados</span>
          <strong>{data?.total.toLocaleString() ?? "—"}</strong>
        </div>
      </header>

      <div className={controls.tableFilters} aria-label="Filtros de proyecciones cumplidas">
        <label className={controls.field}>
          <span>Buscar · país / zona / precedente / ID</span>
          <input type="search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Ej. Indonesia, Colombia…" />
        </label>
        <label className={controls.field}>
          <span>País</span>
          <select value={country} onChange={(event) => { setPage(1); setCountry(event.target.value); }}>
            <option value="">Todos</option>
            {(data?.countries ?? []).map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
          </select>
        </label>
        <label className={controls.field}>
          <span>Prob. mínima %</span>
          <input type="number" min="0" max="100" step="0.1" value={minProbability} onChange={(event) => { setPage(1); setMinProbability(event.target.value); }} placeholder="0" />
        </label>
        <label className={controls.field}>
          <span>M proyectada mín.</span>
          <input type="number" min="0" max="10" step="0.1" value={minProjectedMagnitude} onChange={(event) => { setPage(1); setMinProjectedMagnitude(event.target.value); }} placeholder="0" />
        </label>
        <label className={controls.field}>
          <span>M observada mín.</span>
          <input type="number" min="0" max="10" step="0.1" value={minObservedMagnitude} onChange={(event) => { setPage(1); setMinObservedMagnitude(event.target.value); }} placeholder="0" />
        </label>
        <button type="button" className={controls.clearButton} onClick={resetFilters}>Limpiar filtros</button>
      </div>

      <div className={controls.filterMeta}>
        <span>{data?.total ? `Mostrando ${firstRow}–${lastRow} de ${data.total}` : "Sin resultados con estos filtros"}</span>
        <strong>{PAGE_SIZE} por página</strong>
      </div>

      {error && <div className="warning-banner">Tabla de cumplidas: {error}</div>}

      <div className="globe-fulfilled-cards">
        {featured.map((item) => {
          const event = observed(item)!;
          const afterPrecedent = daysBetween(item.sourceEvent.time, event.time);
          return (
            <article key={`card-${item.id}`} className="panel globe-fulfilled-card">
              <div className="globe-fulfilled-card-title">
                <span className="projection-status-badge fulfilled">Cumplida</span>
                <strong>{item.countryName}</strong>
              </div>
              {item.legacyEvaluated && <span className={controls.legacyBadge}>Registro legado auditado</span>}
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
                  <strong>{formatProbability(item.probabilityPct)} · M{item.magnitudeMin.toFixed(1)}–M{item.magnitudeMax.toFixed(1)}</strong>
                  <span>Base {formatProbability(item.baselinePct)} · {formatSignedPercentagePoints(item.liftPct)}</span>
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
              <button type="button" className={projectionInfoStyles.detailButton} onClick={() => setSelectedItem(item)}>
                Explicar por qué se cumplió
              </button>
            </article>
          );
        })}
        {!loading && !fulfilled.length && !error && (
          <div className="panel globe-fulfilled-empty">No hay proyecciones cumplidas que coincidan con los filtros.</div>
        )}
      </div>

      {selectedItem && <ProjectionExplanationCard item={selectedItem} onClose={() => setSelectedItem(null)} />}

      <section className="panel globe-fulfilled-table-panel">
        <div className="globe-fulfilled-table-head">
          <div><span className="eyebrow">Auditoría</span><h3>Predicción vs. resultado</h3></div>
          <span>{loading ? "Actualizando…" : `${firstRow}–${lastRow} de ${data?.total ?? 0}`}</span>
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
                const event = observed(item);
                const afterPrecedent = event ? daysBetween(item.sourceEvent.time, event.time) : null;
                return (
                  <tr key={`row-${item.id}`}>
                    <td>
                      <strong>{item.countryName}</strong>
                      <span>{item.zoneName}</span>
                      <small>{item.id}</small>
                      {item.legacyEvaluated && <span className={controls.legacyBadge}>Legado</span>}
                    </td>
                    <td>
                      <strong>M{item.sourceEvent.magnitude.toFixed(1)} · {item.sourceEvent.place}</strong>
                      <span>{formatDate(item.sourceEvent.time, true)}</span>
                      <small>{item.sourceEvent.depthKm.toFixed(1)} km de profundidad</small>
                    </td>
                    <td>
                      <strong>{formatProbability(item.probabilityPct)} · M{item.magnitudeMin.toFixed(1)}–M{item.magnitudeMax.toFixed(1)}</strong>
                      <span>{formatDate(item.surveillanceStart)} → {formatDate(item.surveillanceEnd)}</span>
                      <small>{item.legacyEvaluated ? "Metadata de evidencia histórica incompleta" : `Base ${formatProbability(item.baselinePct)} · diferencia ${formatSignedPercentagePoints(item.liftPct)} · evidencia ${item.confidencePct.toFixed(0)}%`}</small>
                    </td>
                    <td>
                      {event ? (
                        <>
                          <strong>M{event.magnitude.toFixed(1)} · {event.place}</strong>
                          <span>{event.depthKm.toFixed(1)} km de profundidad</span>
                          <small>{item.outcome?.eventCount ?? 1} evento(s) compatibles en la ventana</small>
                        </>
                      ) : (
                        <><strong>Resultado auditado: cumplida</strong><span>Detalle del primer evento no conservado en este registro legado.</span></>
                      )}
                    </td>
                    <td>
                      {event ? (
                        <>
                          <strong>{formatDate(event.time, true)}</strong>
                          <span>{afterPrecedent === null ? "—" : `${afterPrecedent.toFixed(1)} días después del precedente`}</span>
                          <small>{item.outcome?.daysToFirstEvent !== null && item.outcome?.daysToFirstEvent !== undefined ? `${item.outcome.daysToFirstEvent.toFixed(1)} días desde el inicio efectivo` : ""}</small>
                        </>
                      ) : <span>Fecha de evento no disponible</span>}
                    </td>
                    <td>
                      <span className="projection-status-badge fulfilled">Cumplida</span>
                      <span>Evaluada {item.outcome ? formatDate(item.outcome.evaluatedAt, true) : "—"}</span>
                      <button type="button" className={projectionInfoStyles.detailButton} onClick={() => setSelectedItem(item)}>Explicar</button>
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

        <nav className={controls.pagination} aria-label="Paginación de proyecciones cumplidas">
          <button type="button" disabled={loading || !data || data.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Anterior</button>
          <span>Página <strong>{data?.page ?? page}</strong> de <strong>{Math.max(1, data?.totalPages ?? 1)}</strong></span>
          <button type="button" disabled={loading || !data || data.page >= data.totalPages} onClick={() => setPage((value) => value + 1)}>Siguiente</button>
        </nav>
      </section>
    </section>
  );
}
