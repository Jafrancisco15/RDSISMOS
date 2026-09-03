const HAPI_BASE = "https://amda.irap.omp.eu/service/hapi";
const DATASET = "ground-based-sme";

type HapiInfo = { startDate?: unknown; stopDate?: unknown; status?: { message?: unknown } };

export interface SuperMagContext {
  source: "SuperMAG via CDPP/AMDA HAPI";
  dataset: "ground-based-sme";
  availableStart: string | null;
  availableStop: string | null;
  latestTimeUtc: string | null;
  latestSmeNt: number | null;
  latestSmuNt: number | null;
  latestSmlNt: number | null;
  maxSmeNt: number | null;
  minSmlNt: number | null;
  current: boolean;
  note: string;
}

function validDate(value: unknown) {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? null : date;
}
function numberOrNull(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.abs(parsed) < 1e20 ? parsed : null;
}

export async function fetchSuperMagContext(signal?: AbortSignal): Promise<SuperMagContext> {
  const infoResponse = await fetch(`${HAPI_BASE}/info?${new URLSearchParams({ id: DATASET })}`, {
    signal,
    next: { revalidate: 3_600 },
    headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" },
  });
  if (!infoResponse.ok) throw new Error(`SuperMAG/AMDA info HTTP ${infoResponse.status}`);
  const info = await infoResponse.json() as HapiInfo;
  const availableStart = validDate(info.startDate);
  const availableStop = validDate(info.stopDate);
  if (!availableStart || !availableStop || availableStart >= availableStop) throw new Error("SuperMAG/AMDA no publicó un rango temporal válido.");

  const stop = availableStop;
  const start = new Date(Math.max(availableStart.getTime(), stop.getTime() - 6 * 3_600_000));
  const params = new URLSearchParams({
    id: DATASET,
    parameters: "sme,smu,sml",
    "time.min": start.toISOString(),
    "time.max": stop.toISOString(),
  });
  const response = await fetch(`${HAPI_BASE}/data?${params}`, {
    signal,
    next: { revalidate: 3_600 },
    headers: { Accept: "text/csv", "User-Agent": "RDSISMOS/1.0" },
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`SuperMAG/AMDA data HTTP ${response.status}: ${raw.replace(/\s+/g, " ").slice(0, 120)}`);
  let latestTimeUtc: string | null = null;
  let latestSmeNt: number | null = null;
  let latestSmuNt: number | null = null;
  let latestSmlNt: number | null = null;
  const smeValues: number[] = [];
  const smlValues: number[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const columns = line.split(",").map((value) => value.replace(/^"|"$/g, "").trim());
    if (columns.length < 4 || Number.isNaN(Date.parse(columns[0]))) continue;
    const sme = numberOrNull(columns[1]); const smu = numberOrNull(columns[2]); const sml = numberOrNull(columns[3]);
    latestTimeUtc = columns[0]; latestSmeNt = sme; latestSmuNt = smu; latestSmlNt = sml;
    if (sme !== null) smeValues.push(sme);
    if (sml !== null) smlValues.push(sml);
  }
  const ageMs = Date.now() - availableStop.getTime();
  const current = ageMs >= 0 && ageMs <= 48 * 3_600_000;
  return {
    source: "SuperMAG via CDPP/AMDA HAPI",
    dataset: DATASET,
    availableStart: availableStart.toISOString(),
    availableStop: availableStop.toISOString(),
    latestTimeUtc,
    latestSmeNt,
    latestSmuNt,
    latestSmlNt,
    maxSmeNt: smeValues.length ? Math.max(...smeValues) : null,
    minSmlNt: smlValues.length ? Math.min(...smlValues) : null,
    current,
    note: current
      ? "Índices SME/SMU/SML disponibles como contexto global de perturbación."
      : "SuperMAG se integra como contexto histórico porque el espejo público AMDA no alcanza la fecha actual. Los vectores directos por estación requieren acceso/identificador de SuperMAG.",
  };
}
