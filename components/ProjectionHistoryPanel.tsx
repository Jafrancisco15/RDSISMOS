"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  ProjectionHistoryItem,
  ProjectionHistoryResponse,
  ProjectionHistoryStatus,
} from "@/lib/learning/projectionHistory";
import { ProjectionExplanationCard } from "./ProjectionExplanationCard";
import {
  formatProbability,
  formatSignedPercentagePoints,
  ParameterLabel,
  PROJECTION_PARAMETER_HELP,
  projectionInfoStyles,
} from "./ProjectionInfo";

const STATUS_LABELS: Record<ProjectionHistoryStatus, string> = {
  active: "Activa",
  fulfilled: "Cumplida",
  fulfilled_outside_range: "Cumplida fuera de rango",
  not_fulfilled: "No cumplida",
  pending_evaluation: "Pendiente de evaluación",
};

function formatDate(value: string, withTime = false) {
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const } : {}),
    timeZone: "UTC",
  }).format(new Date(value));
}

function observedEvent(item: ProjectionHistoryItem) {
  if (item.status === "fulfilled" && item.outcome?.firstEvent) {
    return {
      magnitude: item.outcome.firstEvent.magnitude,
      place: item.outcome.firstEvent.place,
      time: item.outcome.firstEvent.time,
      days: item.outcome.daysToFirstEvent,
      note: "Dentro del rango",
    };
  }
  if (item.status === "fulfilled_outside_range" && item.outcome?.firstOutsideRangeEvent) {
    return {
      magnitude: item.outcome.firstOutsideRangeEvent.magnitude,
      place: item.outcome.firstOutsideRangeEvent.place,
      time: item.outcome.firstOutsideRangeEvent.timeUtc,
      days: null,
      note: "Fuera de la escala proyectada",
    };
  }
  return null;
}

async function readHistoryResponse(response: Response): Promise<ProjectionHistoryResponse> {
  const raw = await response.text();
  let payload: ProjectionHistoryResponse | null = null;
  try {
    payload = JSON.parse(raw) as ProjectionHistoryResponse;
  } catch {
    const compact = raw.replace(/\s+/g, " ").trim().slice(0, 300);
    throw new Error(compact || `El servidor devolvió HTTP ${response.status} sin JSON válido.`);
  }
  if (!response.ok) {
    throw new Error(payload.message ?? `HTTP ${response.status}`);
  }
  return payload;
}

export function ProjectionHistoryPanel() {
  const [data, setData] = useState<ProjectionHistoryResponse | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ProjectionHistoryStatus | "all">("all");
  const [country, setCountry] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<ProjectionHistoryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPage(1);
      setSearch(searchDraft.trim());
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [searchDraft]);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;

    async function load(showLoader: boolean) {
      if (showLoader) setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(page), status, country, search, from, to, _: String(Date.now()),
        });
        const response = await fetch(`/api/migration/projections?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await readHistoryResponse(response);
        if (!disposed) {
          setData(payload);
          setLastLoadedAt(new Date().toISOString());
          setError(null);
          setSelectedItem((current) => current
            ? payload.items.find((item) => item.id === current.id) ?? current
            : null);
        }
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        if (!disposed) {
          setError(loadError instanceof Error ? loadError.message : "No fue posible cargar las proyecciones.");
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
  }, [country, from, page, refreshNonce, search, status, to]);

  const showing = useMemo(() => {
    if (!data?.total) return "0 resultados";
    const first = (data.page - 1) * data.pageSize + 1;
    const last = Math.min(data.total, first + data.items.length - 1);
    return `${first}–${last} de ${data.total}`;
  }, [data]);

  function resetFilters() {
    setPage(1);
    setStatus("all");
    setCountry("");
    setSearchDraft("");
    setSearch("");
    setFrom("");
    setTo("");
    setSelectedItem(null);
  }

  function selectStatus(next: ProjectionHistoryStatus | "all") {
    setPage(1);
    setStatus(next);
    setSelectedItem(null);
  }

  return (
    <main className="projection-history-page">
      <header className="projection-history-head">
        <div>
          <span className="eyebrow">Registro y resultados</span>
          <h1>Historial de proyecciones</h1>
          <p>Tabla completa de proyecciones, ventanas de vigilancia, eventos precedentes y resultados observados. Toca “Explicar” para reconstruir qué sabía el modelo cuando emitió cada proyección y por qué se considera cumplida o no.</p>
        </div>
        <div className="projection-history-total">
          <span>Resultados filtrados</span>
          <strong>{data?.total.toLocaleString() ?? "—"}</strong>
        </div>
      </header>

      <section className="projection-status-summary" aria-label="Resumen por estado">
        <button className={status === "all" ? "active" : ""} onClick={() => selectStatus("all")}>
          <span>Todas</span><strong>{Object.values(data?.statusCounts ?? {}).reduce((sum, value) => sum + value, 0)}</strong>
        </button>
        {(Object.keys(STATUS_LABELS) as ProjectionHistoryStatus[]).map((key) => (
          <button key={key} className={`${key}${status === key ? " active" : ""}`} onClick={() => selectStatus(key)}>
            <span>{STATUS_LABELS[key]}</span><strong>{data?.statusCounts[key] ?? 0}</strong>
          </button>
        ))}
      </section>

      <section className="panel projection-history-filters" aria-label="Filtros de proyecciones">
        <label className="projection-search-field">
          <span>Buscar</span>
          <input type="search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="País, zona, lugar o ID" />
        </label>
        <label>
          <span>Estado</span>
          <select value={status} onChange={(event) => selectStatus(event.target.value as ProjectionHistoryStatus | "all")}>
            <option value="all">Todos</option>
            {(Object.keys(STATUS_LABELS) as ProjectionHistoryStatus[]).map((key) => <option key={key} value={key}>{STATUS_LABELS[key]}</option>)}
          </select>
        </label>
        <label>
          <span>País</span>
          <select value={country} onChange={(event) => { setPage(1); setCountry(event.target.value); setSelectedItem(null); }}>
            <option value="">Todos los países</option>
            {(data?.countries ?? []).map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
          </select>
        </label>
        <label>
          <span>Generada desde</span>
          <input type="date" value={from} onChange={(event) => { setPage(1); setFrom(event.target.value); setSelectedItem(null); }} />
        </label>
        <label>
          <span>Generada hasta</span>
          <input type="date" value={to} onChange={(event) => { setPage(1); setTo(event.target.value); setSelectedItem(null); }} />
        </label>
        <button type="button" className="projection-clear-filters" onClick={resetFilters}>Limpiar</button>
        <button type="button" className="projection-clear-filters" onClick={() => setRefreshNonce((value) => value + 1)}>Actualizar ahora</button>
      </section>

      <div className="quality-warning">
        <strong>Lectura segura:</strong> las proyecciones antiguas duplicadas por solapamiento de zonas se consolidan como una sola proyección por evento precedente + país. La probabilidad se conserva con dos decimales; la calidad de evidencia no es una segunda probabilidad.
        {lastLoadedAt ? ` Última lectura: ${formatDate(lastLoadedAt, true)} UTC.` : ""}
      </div>

      {error && <div className="warning-banner projection-history-error">Historial: {error}</div>}
      {selectedItem && <ProjectionExplanationCard item={selectedItem} onClose={() => setSelectedItem(null)} />}

      <section className="panel projection-history-list">
        <div className="projection-history-list-head">
          <div><span className="eyebrow">Tabla</span><h2>Proyecciones registradas</h2></div>
          <span>{loading ? "Actualizando…" : showing}</span>
        </div>

        <div className="projection-table-wrap">
          <table className="projection-history-table projection-history-table-expanded">
            <thead>
              <tr>
                <th>Estado</th><th>Generada</th><th>País</th><th>Zona</th>
                <th><ParameterLabel label="Prob." help={PROJECTION_PARAMETER_HELP.probability} /></th>
                <th><ParameterLabel label="Base" help={PROJECTION_PARAMETER_HELP.baseline} /></th>
                <th><ParameterLabel label="Dif." help={PROJECTION_PARAMETER_HELP.lift} /></th>
                <th><ParameterLabel label="Calidad evid." help={PROJECTION_PARAMETER_HELP.confidence} /></th>
                <th><ParameterLabel label="Escala" help={PROJECTION_PARAMETER_HELP.magnitude} /></th>
                <th><ParameterLabel label="Ventana" help={PROJECTION_PARAMETER_HELP.window} /></th>
                <th>Evento precedente</th><th>M origen</th><th>Fecha origen</th><th>Prof. origen</th>
                <th><ParameterLabel label="Evidencia" help={PROJECTION_PARAMETER_HELP.analogs} /></th>
                <th>Resultado</th><th>Evento observado</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).map((item) => {
                const observed = observedEvent(item);
                return (
                  <tr key={item.id}>
                    <td>
                      <span className={`projection-status-badge ${item.status}`}>{STATUS_LABELS[item.status]}</span>
                      <button type="button" className={projectionInfoStyles.detailButton} onClick={() => setSelectedItem(item)}>Explicar</button>
                    </td>
                    <td><strong>{formatDate(item.generatedAt, true)}</strong><small>{item.id}</small></td>
                    <td><strong>{item.countryName}</strong><small>{item.countryCode}</small></td>
                    <td><span>{item.zoneName}</span></td>
                    <td><strong className="projection-probability">{formatProbability(item.probabilityPct)}</strong></td>
                    <td><strong>{formatProbability(item.baselinePct)}</strong></td>
                    <td><strong>{formatSignedPercentagePoints(item.liftPct)}</strong></td>
                    <td><strong>{item.confidencePct.toFixed(0)}%</strong><small>escenario</small></td>
                    <td><strong>M{item.magnitudeMin.toFixed(1)}–M{item.magnitudeMax.toFixed(1)}</strong></td>
                    <td><strong>{formatDate(item.surveillanceStart)}</strong><span>hasta {formatDate(item.surveillanceEnd)}</span></td>
                    <td><strong>{item.sourceEvent.place}</strong><small>{item.sourceEvent.id}</small></td>
                    <td><strong>M{item.sourceEvent.magnitude.toFixed(1)}</strong></td>
                    <td><strong>{formatDate(item.sourceEvent.time, true)}</strong></td>
                    <td><strong>{item.sourceEvent.depthKm.toFixed(1)} km</strong></td>
                    <td><strong>{item.analogHits}/{item.analogsEvaluated || "—"} análogos</strong><span>{item.controlHits} controles</span><small>Mediana {item.medianLeadDays?.toFixed(1) ?? "—"} días</small></td>
                    <td>
                      <strong>{STATUS_LABELS[item.status]}</strong>
                      {item.outcome && <span>{item.outcome.eventCount} dentro del rango</span>}
                      {item.outcome?.outsideRangeEventCount ? <small>{item.outcome.outsideRangeEventCount} fuera del rango</small> : null}
                    </td>
                    <td>
                      {observed ? <><strong>M{observed.magnitude.toFixed(1)} · {observed.place}</strong><span>{formatDate(observed.time, true)}</span><small>{observed.note}{observed.days !== null && observed.days !== undefined ? ` · ${observed.days.toFixed(1)} días` : ""}</small></> : <span>Sin evento registrado</span>}
                    </td>
                  </tr>
                );
              })}
              {!loading && !data?.items.length && !error && <tr><td colSpan={17} className="projection-history-empty">No hay proyecciones que coincidan con los filtros.</td></tr>}
              {loading && !data?.items.length && <tr><td colSpan={17} className="projection-history-empty">Cargando las últimas proyecciones…</td></tr>}
            </tbody>
          </table>
        </div>

        <nav className="projection-pagination" aria-label="Paginación del historial">
          <button type="button" disabled={!data || data.page <= 1 || loading} onClick={() => { setPage((value) => Math.max(1, value - 1)); setSelectedItem(null); }}>Anterior</button>
          <span>Página <strong>{data?.page ?? page}</strong> de <strong>{Math.max(1, data?.totalPages ?? 1)}</strong></span>
          <button type="button" disabled={!data || data.page >= data.totalPages || loading} onClick={() => { setPage((value) => value + 1); setSelectedItem(null); }}>Siguiente</button>
        </nav>
      </section>

      <footer className="projection-history-note">
        “Cumplida fuera de rango” indica que hubo actividad en el área y dentro de la ventana temporal, pero su magnitud quedó fuera de la escala proyectada.
      </footer>
    </main>
  );
}
