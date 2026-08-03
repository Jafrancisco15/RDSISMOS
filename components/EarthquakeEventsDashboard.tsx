"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { COUNTRIES } from "@/lib/countries";
import { EarthquakeCharts } from "./EarthquakeCharts";
import type { EarthquakeEvent, EarthquakePage, EarthquakeStats } from "@/lib/earthquakes/types";

const EarthquakeEventsMap = dynamic(
  () => import("./EarthquakeEventsMap").then((module) => module.EarthquakeEventsMap),
  { ssr: false, loading: () => <div className="map-loading">Cargando mapa mundial…</div> },
);

interface FormState {
  starttime: string;
  endtime: string;
  minmagnitude: string;
  maxmagnitude: string;
  mindepth: string;
  maxdepth: string;
  country: string;
  latitude: string;
  longitude: string;
  maxradiuskm: string;
  magnitudetype: string;
  eventtype: string;
  source: string;
  search: string;
  reviewed: string;
  orderby: string;
  limit: string;
}

const MAGNITUDES = ["", "2", "3", "4", "4.2", "4.5", "5", "5.5", "6", "6.5", "7", "7.5", "8"];
const DEPTHS = ["", "0", "10", "30", "70", "150", "300", "500", "700"];
const MAGNITUDE_TYPES = ["", "mw", "mww", "mwc", "mb", "ml", "md", "mb_lg"];

const emptyForm = (): FormState => {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 30);
  return {
    starttime: dateInput(start),
    endtime: dateInput(end),
    minmagnitude: "4.2",
    maxmagnitude: "",
    mindepth: "",
    maxdepth: "",
    country: "",
    latitude: "",
    longitude: "",
    maxradiuskm: "",
    magnitudetype: "",
    eventtype: "earthquake",
    source: "all",
    search: "",
    reviewed: "all",
    orderby: "time",
    limit: "50",
  };
};

export function EarthquakeEventsDashboard() {
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [page, setPage] = useState<EarthquakePage | null>(null);
  const [stats, setStats] = useState<EarthquakeStats | null>(null);
  const [selected, setSelected] = useState<EarthquakeEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const offset = page?.offset ?? 1;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const restored = { ...emptyForm() };
    for (const key of Object.keys(restored) as Array<keyof FormState>) {
      if (params.has(key)) restored[key] = params.get(key) ?? "";
    }
    if (!["25", "50", "100", "250", "500"].includes(restored.limit)) restored.limit = "50";
    if (!["all", "reviewed"].includes(restored.reviewed)) restored.reviewed = "all";
    setForm(restored);
    void load(restored, 1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeFilters = useMemo(
    () => Object.entries(form).filter(([key, value]) => {
      if (["limit", "orderby", "eventtype"].includes(key)) return false;
      if (key === "source") return value !== "all";
      if (key === "reviewed") return value !== "all";
      return value !== "";
    }).length,
    [form],
  );

  async function load(nextForm = form, nextOffset = 1, includeStats = false) {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    const params = buildParams(nextForm, nextOffset);
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
    try {
      const response = await fetch(`/api/earthquakes?${params}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      const payload = await response.json() as EarthquakePage & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `Error HTTP ${response.status}`);
      setPage(payload);
      setSelected((current) => current && payload.events.some((event) => event.id === current.id) ? current : null);
      if (includeStats) void loadStats(nextForm);
    } catch (fetchError) {
      if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
      setError(fetchError instanceof Error ? fetchError.message : "No fue posible cargar los eventos.");
    } finally {
      setLoading(false);
    }
  }

  async function loadStats(nextForm = form) {
    setStatsLoading(true);
    try {
      const params = buildParams(nextForm, 1);
      params.delete("limit");
      params.delete("offset");
      const response = await fetch(`/api/earthquakes/stats?${params}`, { cache: "no-store" });
      const payload = await response.json() as EarthquakeStats & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No fue posible calcular estadísticas.");
      setStats(payload);
    } catch (statsError) {
      setError(statsError instanceof Error ? statsError.message : "Error estadístico.");
    } finally {
      setStatsLoading(false);
    }
  }

  function quickRange(days: number, minMagnitude?: number) {
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - days);
    const next = {
      ...form,
      starttime: dateInput(start),
      endtime: dateInput(end),
      minmagnitude: minMagnitude !== undefined ? String(minMagnitude) : form.minmagnitude,
    };
    setForm(next);
    void load(next, 1, true);
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function clearFilters() {
    const next = emptyForm();
    setForm(next);
    void load(next, 1, true);
  }

  function exportData(format: "csv" | "json" | "geojson") {
    const params = buildParams(form, 1);
    params.set("format", format);
    window.location.href = `/api/earthquakes/export?${params}`;
  }

  return (
    <section className="earthquake-module">
      <div className="earthquake-module-head">
        <div>
          <span className="eyebrow">USGS · EMSC · Raspberry Shake</span>
          <h1>Eventos Sísmicos</h1>
          <p>Catálogo multifuente reciente y consulta histórica de hasta 50 años.</p>
        </div>
        <div className="active-filter-count">{activeFilters} filtros activos</div>
      </div>

      <div className="quality-warning">
        Las consultas de hasta 370 días combinan varias fuentes y eliminan duplicados. Los periodos más largos utilizan USGS ComCat para conservar cobertura histórica y paginación estable.
      </div>

      <div className="quick-filters">
        <button onClick={() => quickRange(1)}>24 horas</button>
        <button onClick={() => quickRange(7)}>7 días</button>
        <button onClick={() => quickRange(30)}>30 días</button>
        <button onClick={() => quickRange(90)}>90 días</button>
        <button onClick={() => quickRange(365)}>1 año</button>
        <button onClick={() => quickRange(3650)}>10 años</button>
        <button onClick={() => quickRange(365 * 50)}>50 años</button>
        <button onClick={() => quickRange(daysBetween(form), 4.2)}>M4.2+</button>
        <button onClick={() => quickRange(daysBetween(form), 5.5)}>M5.5+</button>
        <button onClick={() => quickRange(daysBetween(form), 7)}>M7.0+</button>
      </div>

      <form className="earthquake-filters earthquake-select-filters" onSubmit={(event) => { event.preventDefault(); void load(form, 1, true); }}>
        <Field label="Fecha inicial"><input type="date" value={form.starttime} onChange={(event) => update("starttime", event.target.value)} /></Field>
        <Field label="Fecha final"><input type="date" value={form.endtime} onChange={(event) => update("endtime", event.target.value)} /></Field>
        <Field label="País o área">
          <select value={form.country} onChange={(event) => update("country", event.target.value)}>
            <option value="">Mundo completo</option>
            {COUNTRIES.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
          </select>
        </Field>
        <Field label="Fuente">
          <select value={form.source} onChange={(event) => update("source", event.target.value)}>
            <option value="all">Todas las fuentes</option>
            <option value="usgs">USGS</option>
            <option value="emsc">EMSC</option>
            <option value="raspberry">Raspberry Shake</option>
          </select>
        </Field>
        <Field label="Magnitud mínima">
          <select value={form.minmagnitude} onChange={(event) => update("minmagnitude", event.target.value)}>
            {MAGNITUDES.map((value) => <option key={`min-${value || "all"}`} value={value}>{value ? `M${value}` : "Sin mínimo"}</option>)}
          </select>
        </Field>
        <Field label="Magnitud máxima">
          <select value={form.maxmagnitude} onChange={(event) => update("maxmagnitude", event.target.value)}>
            {MAGNITUDES.map((value) => <option key={`max-${value || "all"}`} value={value}>{value ? `M${value}` : "Sin máximo"}</option>)}
          </select>
        </Field>
        <Field label="Profundidad mínima">
          <select value={form.mindepth} onChange={(event) => update("mindepth", event.target.value)}>
            {DEPTHS.map((value) => <option key={`mind-${value || "all"}`} value={value}>{value ? `${value} km` : "Sin mínimo"}</option>)}
          </select>
        </Field>
        <Field label="Profundidad máxima">
          <select value={form.maxdepth} onChange={(event) => update("maxdepth", event.target.value)}>
            {DEPTHS.map((value) => <option key={`maxd-${value || "all"}`} value={value}>{value ? `${value} km` : "Sin máximo"}</option>)}
          </select>
        </Field>
        <Field label="Tipo de magnitud">
          <select value={form.magnitudetype} onChange={(event) => update("magnitudetype", event.target.value)}>
            {MAGNITUDE_TYPES.map((value) => <option key={value || "all"} value={value}>{value ? value.toUpperCase() : "Todos"}</option>)}
          </select>
        </Field>
        <Field label="Tipo de evento">
          <select value={form.eventtype} onChange={(event) => update("eventtype", event.target.value)}>
            <option value="earthquake">Terremoto</option>
            <option value="all">Todos los tipos</option>
          </select>
        </Field>
        <Field label="Revisión">
          <select value={form.reviewed} onChange={(event) => update("reviewed", event.target.value)}>
            <option value="all">Todos los estados</option>
            <option value="reviewed">Solo revisados</option>
          </select>
        </Field>
        <Field label="Orden">
          <select value={form.orderby} onChange={(event) => update("orderby", event.target.value)}>
            <option value="time">Más recientes</option>
            <option value="time-asc">Más antiguos</option>
            <option value="magnitude">Mayor magnitud</option>
            <option value="magnitude-asc">Menor magnitud</option>
          </select>
        </Field>
        <Field label="Filas por página">
          <select value={form.limit} onChange={(event) => update("limit", event.target.value)}>
            <option>25</option><option>50</option><option>100</option><option>250</option><option>500</option>
          </select>
        </Field>
        <Field label="Buscar en el lugar">
          <input value={form.search} onChange={(event) => update("search", event.target.value)} placeholder="Nombre, región o red" />
        </Field>

        <details className="earthquake-advanced-location">
          <summary>Ubicación personalizada por coordenadas</summary>
          <div>
            <Field label="Latitud"><input type="number" step="any" value={form.latitude} onChange={(event) => update("latitude", event.target.value)} /></Field>
            <Field label="Longitud"><input type="number" step="any" value={form.longitude} onChange={(event) => update("longitude", event.target.value)} /></Field>
            <Field label="Radio">
              <select value={form.maxradiuskm} onChange={(event) => update("maxradiuskm", event.target.value)}>
                <option value="">Sin radio</option><option value="50">50 km</option><option value="100">100 km</option><option value="250">250 km</option><option value="500">500 km</option><option value="1000">1,000 km</option><option value="2000">2,000 km</option>
              </select>
            </Field>
          </div>
        </details>

        <div className="filter-actions">
          <button type="submit">Aplicar filtros</button>
          <button type="button" onClick={clearFilters}>Limpiar</button>
          <button type="button" onClick={() => void loadStats(form)}>Actualizar gráficos</button>
        </div>
      </form>

      {page?.provider && (
        <div className="earthquake-provider-strip">
          <strong>{page.provider}</strong>
          <span>{page.catalogMode === "multisource" ? "Catálogo reciente combinado" : "Catálogo histórico USGS"}</span>
          {(page.providerStatus ?? []).map((status) => <small key={status}>{status}</small>)}
        </div>
      )}
      {(page?.warnings?.length ?? 0) > 0 && <div className="warning-banner">{page?.warnings?.join(" · ")}</div>}
      {error && <div className="warning-banner">{error} <button onClick={() => void load(form, offset, true)}>Reintentar</button></div>}

      <SummaryCards stats={stats} page={page} loading={statsLoading} />

      <div className="earthquake-map-table-grid">
        <article className="map-card earthquake-map-card">
          <div className="section-heading"><div><span className="eyebrow">Mapa interactivo</span><h2>Eventos de la página actual</h2></div><span>{page?.events.length ?? 0} marcadores</span></div>
          <EarthquakeEventsMap events={page?.events ?? []} selectedId={selected?.id ?? null} onSelect={setSelected} />
        </article>
        <article className="panel event-detail-panel">
          {selected ? <EventDetail event={selected} /> : <><span className="eyebrow">Detalle</span><h2>Selecciona un evento</h2><p>Haz clic en una fila o marcador para revisar sus metadatos completos.</p></>}
        </article>
      </div>

      <article className="panel earthquake-table-panel">
        <div className="section-heading">
          <div><span className="eyebrow">Resultados paginados</span><h2>{page ? page.total.toLocaleString() : "—"} eventos encontrados</h2></div>
          <div className="export-actions"><button onClick={() => exportData("csv")}>CSV</button><button onClick={() => exportData("json")}>JSON</button><button onClick={() => exportData("geojson")}>GeoJSON</button></div>
        </div>
        {loading ? <div className="table-skeleton">Cargando eventos…</div> : page?.events.length ? (
          <div className="table-scroll"><table><thead><tr><th>UTC</th><th>Hora local</th><th>Lugar</th><th>Región</th><th>Magnitud</th><th>Tipo</th><th>Prof. km</th><th>Lat/Lon</th><th>Fuente</th><th>Red</th><th>Estado</th><th /></tr></thead><tbody>
            {page.events.map((event) => (
              <tr key={`${event.sourceCatalog}:${event.id}`} className={selected?.id === event.id ? "selected" : ""} onClick={() => setSelected(event)} tabIndex={0} onKeyDown={(keyboard) => { if (keyboard.key === "Enter") setSelected(event); }}>
                <td>{formatUtc(event.timeUtc)}</td><td>{new Date(event.timeUtc).toLocaleString()}</td><td>{event.place}</td><td>{event.countryOrRegion}</td><td><strong>M{event.magnitude.toFixed(1)}</strong></td><td>{event.magnitudeType}</td><td>{event.depthKm.toFixed(1)}</td>
                <td><button className="link-button" onClick={(click) => { click.stopPropagation(); void navigator.clipboard.writeText(`${event.latitude}, ${event.longitude}`); }}>{event.latitude.toFixed(3)}, {event.longitude.toFixed(3)}</button></td>
                <td>{event.sourceCatalog}</td><td>{event.network}</td><td>{event.status}</td><td>{event.sourceUrl && <a href={event.sourceUrl} target="_blank" rel="noreferrer">Abrir</a>}</td>
              </tr>
            ))}
          </tbody></table></div>
        ) : <div className="empty-state">No hay resultados para los filtros seleccionados.</div>}
        <div className="pagination"><button disabled={!page || page.offset <= 1} onClick={() => void load(form, Math.max(1, offset - Number(form.limit)), false)}>Anterior</button><span>Página {page ? Math.floor((page.offset - 1) / page.limit) + 1 : 1}</span><button disabled={!page?.hasMore} onClick={() => void load(form, offset + Number(form.limit), false)}>Siguiente</button></div>
      </article>

      <section className="charts-section"><div className="section-heading"><div><span className="eyebrow">Análisis visual</span><h2>Gráficos según los filtros</h2></div>{statsLoading && <span>Calculando…</span>}</div><EarthquakeCharts stats={stats} /></section>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label><span>{label}</span>{children}</label>;
}

function SummaryCards({ stats, page, loading }: { stats: EarthquakeStats | null; page: EarthquakePage | null; loading: boolean }) {
  const values = [
    ["Total", stats?.total ?? page?.total ?? null],
    ["Magnitud máxima", stats?.maxMagnitude?.toFixed(1) ?? null],
    ["Magnitud promedio", stats?.averageMagnitude?.toFixed(2) ?? null],
    ["Profundidad promedio", stats?.averageDepthKm !== null && stats?.averageDepthKm !== undefined ? `${stats.averageDepthKm.toFixed(1)} km` : null],
    ["Últimas 24 h", stats?.last24Hours ?? null],
    ["Últimos 7 días", stats?.last7Days ?? null],
    ["Últimos 30 días", stats?.last30Days ?? null],
    ["Evento más reciente", stats?.latestEvent ? `M${stats.latestEvent.magnitude.toFixed(1)} · ${stats.latestEvent.place}` : null],
    ["Más fuerte del rango", stats?.strongestEvent ? `M${stats.strongestEvent.magnitude.toFixed(1)} · ${stats.strongestEvent.place}` : null],
  ];
  return <div className="earthquake-summary-grid">{values.map(([label, value]) => <article key={String(label)}><span>{label}</span><strong>{loading ? "…" : value ?? "—"}</strong></article>)}</div>;
}

function EventDetail({ event }: { event: EarthquakeEvent }) {
  const fields = [
    ["ID", event.id], ["Fuente", event.sourceCatalog], ["UTC", formatUtc(event.timeUtc)],
    ["Hora local", new Date(event.timeUtc).toLocaleString()], ["Lugar", event.place],
    ["Coordenadas", `${event.latitude}, ${event.longitude}`], ["Magnitud", `${event.magnitudeType} ${event.magnitude}`],
    ["Profundidad", `${event.depthKm} km`], ["Red", event.network], ["Estado", event.status],
    ["Estaciones", event.stationCount], ["Gap", event.gap], ["RMS", event.rms],
    ["Error horizontal", event.horizontalError], ["Error profundidad", event.depthError],
    ["Error magnitud", event.magnitudeError], ["Actualizado", formatUtc(event.updatedUtc)],
  ];
  return <><span className="eyebrow">Detalle del evento</span><h2>{event.place}</h2><dl>{fields.map(([key, value]) => <div key={String(key)}><dt>{key}</dt><dd>{value ?? "—"}</dd></div>)}</dl>{event.sourceUrl && <a href={event.sourceUrl} target="_blank" rel="noreferrer">Abrir evento en la fuente original</a>}</>;
}

function buildParams(form: FormState, offset: number) {
  const params = new URLSearchParams();
  Object.entries(form).forEach(([key, value]) => {
    if (key === "reviewed") {
      if (value === "reviewed") params.set("reviewed", "true");
      return;
    }
    if (value !== "" && value !== "all") params.set(key, value);
  });
  params.set("offset", String(Math.max(1, Math.trunc(offset) || 1)));
  return params;
}

function dateInput(date: Date) { return date.toISOString().slice(0, 10); }
function daysBetween(form: FormState) { return Math.max(1, Math.ceil((new Date(form.endtime).getTime() - new Date(form.starttime).getTime()) / 86_400_000)); }
function formatUtc(value: string) { return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)); }
