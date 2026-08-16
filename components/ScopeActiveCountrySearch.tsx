"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { COUNTRIES } from "@/lib/countries";
import type { ScopeProjectionDestination } from "@/lib/scopeProjection";
import type { SeismicEvent } from "@/lib/types";
import styles from "./ScopeActiveCountrySearch.module.css";

interface ActiveScopeProjectionItem {
  id: string;
  source: SeismicEvent;
  destination: ScopeProjectionDestination;
  generatedAt: string;
  evidenceQualityPct: number;
  analogsEvaluated: number;
  earthScopeSupportedAnalogs: number;
  waveformConfirmedAnalogs: number;
}

interface ActiveScopeProjectionResponse {
  generatedAt: string;
  target: {
    code: string;
    name: string;
  };
  databaseConfigured: boolean;
  databaseConnected: boolean;
  checkedCapsules: number;
  maximumCapsulesChecked: number;
  projections: ActiveScopeProjectionItem[];
  warning?: string;
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function pct(value: number) {
  return `${value.toFixed(2)}%`;
}

function signedPct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)} pp`;
}

function formatDate(value: string, withTime = false) {
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const } : {}),
    timeZone: "UTC",
  }).format(new Date(value));
}

async function readJson<T>(response: Response): Promise<T> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(raw || `HTTP ${response.status}`);
  }
}

export function ScopeActiveCountrySearch() {
  const [query, setQuery] = useState("República Dominicana");
  const [countryCode, setCountryCode] = useState("DO");
  const [data, setData] = useState<ActiveScopeProjectionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredCountries = useMemo(() => {
    const term = normalize(query);
    const values = !term
      ? COUNTRIES
      : COUNTRIES.filter((country) => (
          normalize(country.name).includes(term)
          || country.code.toLowerCase().includes(term)
        ));
    return values.slice(0, 12);
  }, [query]);

  const load = useCallback(async (code: string) => {
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 58_000);
    try {
      const response = await fetch(`/api/scope-projection/active?country=${encodeURIComponent(code)}&_=${Date.now()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = await readJson<ActiveScopeProjectionResponse & { error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setData(payload);
    } catch (loadError) {
      setData(null);
      setError(
        loadError instanceof DOMException && loadError.name === "AbortError"
          ? "La consulta Scope tardó demasiado. Intenta de nuevo; EarthScope puede estar respondiendo lentamente."
          : loadError instanceof Error
            ? loadError.message
            : "No fue posible consultar las proyecciones Scope activas.",
      );
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load("DO");
  }, [load]);

  function chooseCountry(code: string, name: string) {
    setCountryCode(code);
    setQuery(name);
    void load(code);
  }

  return (
    <section className={styles.section} aria-label="Buscador de proyecciones Scope activas por país">
      <div className={styles.heading}>
        <div>
          <span>Consulta por país</span>
          <h2>Proyecciones Scope activas</h2>
          <p>
            Busca un país para comprobar si alguna cápsula todavía activa conserva una señal positiva
            después de volver a ponderar sus análogos con evidencia EarthScope.
          </p>
        </div>
        <div className={styles.selectedCountry}>
          <small>País seleccionado</small>
          <strong>{data?.target.name ?? COUNTRIES.find((country) => country.code === countryCode)?.name ?? countryCode}</strong>
        </div>
      </div>

      <div className={styles.searchRow}>
        <label>
          Buscar país
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ej. República Dominicana, Perú, Japón…"
            autoComplete="off"
          />
        </label>
        <button type="button" onClick={() => void load(countryCode)} disabled={loading}>
          {loading ? "Consultando Scope + EarthScope…" : "Actualizar país seleccionado"}
        </button>
      </div>

      <div className={styles.countryMatches}>
        {filteredCountries.map((country) => (
          <button
            type="button"
            key={country.code}
            className={country.code === countryCode ? styles.activeCountry : ""}
            onClick={() => chooseCountry(country.code, country.name)}
            disabled={loading && country.code === countryCode}
          >
            <strong>{country.name}</strong>
            <span>{country.code}</span>
          </button>
        ))}
        {!filteredCountries.length && <p>No encontramos un país con ese texto.</p>}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {data && !data.databaseConnected ? (
        <div className={styles.warning}>
          <strong>Memoria de proyecciones no disponible.</strong>
          <span>{data.warning || "No se pudo consultar la base; esto no significa que el país tenga cero proyecciones."}</span>
        </div>
      ) : null}

      {data?.databaseConnected && (
        <div className={styles.results}>
          <div className={styles.resultSummary}>
            <div>
              <span>Resultado para {data.target.name}</span>
              <strong>{data.projections.length} proyección{data.projections.length === 1 ? "" : "es"} Scope activa{data.projections.length === 1 ? "" : "s"}</strong>
            </div>
            <small>
              {data.checkedCapsules} cápsula{data.checkedCapsules === 1 ? "" : "s"} activa{data.checkedCapsules === 1 ? "" : "s"} revisada{data.checkedCapsules === 1 ? "" : "s"}
              {data.checkedCapsules >= data.maximumCapsulesChecked ? ` · máximo ${data.maximumCapsulesChecked} por consulta` : ""}
            </small>
          </div>

          {data.projections.length ? (
            <div className={styles.cards}>
              {data.projections.map((item) => (
                <article key={item.id}>
                  <div className={styles.cardHead}>
                    <div>
                      <span>ACTIVA · hasta {formatDate(item.destination.surveillanceEnd)}</span>
                      <h3>{data.target.name}</h3>
                    </div>
                    <strong>{pct(item.destination.probabilityPct)}</strong>
                  </div>
                  <p>
                    Proyectada desde <b>M{item.source.magnitude.toFixed(1)}</b> · {item.source.place},
                    {" "}{formatDate(item.source.time, true)} UTC.
                  </p>
                  <div className={styles.stats}>
                    <div><span>Prob. Scope</span><strong>{pct(item.destination.probabilityPct)}</strong></div>
                    <div><span>Base</span><strong>{pct(item.destination.baselinePct)}</strong></div>
                    <div><span>Diferencia</span><strong>{signedPct(item.destination.liftPct)}</strong></div>
                    <div><span>Evidencia Scope</span><strong>{item.evidenceQualityPct}%</strong></div>
                    <div><span>Hits</span><strong>{item.destination.analogHits}/{item.analogsEvaluated}</strong></div>
                    <div><span>Magnitud</span><strong>M{item.destination.magnitudeMin.toFixed(1)}–M{item.destination.magnitudeMax.toFixed(1)}</strong></div>
                  </div>
                  <small className={styles.evidenceLine}>
                    EarthScope soporta {item.earthScopeSupportedAnalogs}/{item.analogsEvaluated} análogos · {item.waveformConfirmedAnalogs} con waveform confirmada · ventana {formatDate(item.destination.surveillanceStart)} → {formatDate(item.destination.surveillanceEnd)}.
                  </small>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              <strong>Sin proyección Scope activa positiva para {data.target.name}.</strong>
              <span>{data.warning || "Las cápsulas activas revisadas no mantienen Probabilidad Scope por encima de su línea base."}</span>
            </div>
          )}
        </div>
      )}

      <p className={styles.footnote}>
        Esta consulta parte de cápsulas históricas que todavía están dentro de su ventana de vigilancia y vuelve a calcular la señal con Scope Projection. Una señal activa sigue siendo recurrencia histórica ponderada, no certeza de que ocurrirá un terremoto.
      </p>
    </section>
  );
}
