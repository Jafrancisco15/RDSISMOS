export interface SpaceWeatherSummary {
  btNt: number | null;
  bzGsmNt: number | null;
  protonSpeedKmS: number | null;
  magneticTimeUtc: string | null;
  speedTimeUtc: string | null;
  source: string;
}

function numeric(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function jsonArray(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal, cache: "no-store", headers: { Accept: "application/json", "User-Agent": "RDSISMOS/1.0" } });
  if (!response.ok) throw new Error(`NOAA SWPC HTTP ${response.status}`);
  const payload = await response.json() as unknown;
  return Array.isArray(payload) ? payload : [];
}

export async function fetchSpaceWeatherSummary(signal?: AbortSignal): Promise<SpaceWeatherSummary> {
  const [magResult, speedResult] = await Promise.allSettled([
    jsonArray("https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json", signal),
    jsonArray("https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json", signal),
  ]);
  const magnetic = magResult.status === "fulfilled" && magResult.value[0] && typeof magResult.value[0] === "object" ? magResult.value[0] as Record<string, unknown> : {};
  const speed = speedResult.status === "fulfilled" && speedResult.value[0] && typeof speedResult.value[0] === "object" ? speedResult.value[0] as Record<string, unknown> : {};
  return {
    btNt: numeric(magnetic.bt),
    bzGsmNt: numeric(magnetic.bz_gsm),
    protonSpeedKmS: numeric(speed.proton_speed),
    magneticTimeUtc: magnetic.time_tag ? String(magnetic.time_tag) : null,
    speedTimeUtc: speed.time_tag ? String(speed.time_tag) : null,
    source: "NOAA SWPC Real-Time Solar Wind",
  };
}
