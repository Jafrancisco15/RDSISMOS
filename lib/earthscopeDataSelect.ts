export const EARTHSCOPE_DATASELECT_URL = "https://service.earthscope.org/fdsnws/dataselect/1/query";

function locationParam(value: string) {
  return !value || value === "--" ? "--" : value;
}

export function buildEarthScopeGeoCsvQuery(options: {
  network: string;
  station: string;
  location: string;
  channel: string;
  startTimeUtc: string;
  endTimeUtc: string;
  scaleAuto?: boolean;
}) {
  const params = new URLSearchParams({
    net: options.network,
    sta: options.station,
    loc: locationParam(options.location),
    cha: options.channel,
    starttime: options.startTimeUtc,
    endtime: options.endTimeUtc,
    format: "geocsv.tspair",
    nodata: "404",
  });
  if (options.scaleAuto !== false) params.set("scale", "AUTO");
  return params;
}

async function requestGeoCsv(options: {
  network: string;
  station: string;
  location: string;
  channel: string;
  startTimeUtc: string;
  endTimeUtc: string;
  userAgent: string;
  signal?: AbortSignal;
}, scaleAuto: boolean) {
  const params = buildEarthScopeGeoCsvQuery({ ...options, scaleAuto });
  return fetch(`${EARTHSCOPE_DATASELECT_URL}?${params}`, {
    headers: {
      Accept: "text/plain,text/csv;q=0.9,*/*;q=0.1",
      "User-Agent": options.userAgent,
    },
    signal: options.signal,
    cache: "no-store",
  });
}

/**
 * Current EarthScope waveform access. irisws-timeseries was retired in 2026;
 * FDSN dataselect now provides GeoCSV directly. Prefer scale=AUTO, but retain
 * a raw-count fallback because arrival picking does not require calibrated
 * amplitudes and some legacy channels lack usable sensitivity metadata.
 */
export async function fetchEarthScopeGeoCsv(options: {
  network: string;
  station: string;
  location: string;
  channel: string;
  startTimeUtc: string;
  endTimeUtc: string;
  userAgent: string;
  signal?: AbortSignal;
}) {
  let response = await requestGeoCsv(options, true);
  let scaledBySensitivity = true;

  if (!response.ok && ![204, 404].includes(response.status)) {
    response = await requestGeoCsv(options, false);
    scaledBySensitivity = false;
  }
  if (!response.ok) throw new Error(`EarthScope dataselect waveform HTTP ${response.status}`);

  const text = await response.text();
  if (!text.trim()) throw new Error("EarthScope dataselect devolvió un waveform vacío.");
  return { text, scaledBySensitivity };
}
