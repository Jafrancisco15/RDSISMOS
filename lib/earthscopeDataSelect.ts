export const EARTHSCOPE_DATASELECT_URL = "https://service.earthscope.org/fdsnws/dataselect/1/query";

function locationParam(value: string) {
  return !value || value === "--" ? "--" : value;
}

/**
 * Current EarthScope waveform access. irisws-timeseries was retired in 2026;
 * FDSN dataselect now provides GeoCSV directly and can apply instrument
 * sensitivity scaling with scale=AUTO.
 */
export function buildEarthScopeGeoCsvQuery(options: {
  network: string;
  station: string;
  location: string;
  channel: string;
  startTimeUtc: string;
  endTimeUtc: string;
}) {
  return new URLSearchParams({
    net: options.network,
    sta: options.station,
    loc: locationParam(options.location),
    cha: options.channel,
    starttime: options.startTimeUtc,
    endtime: options.endTimeUtc,
    format: "geocsv.tspair",
    scale: "AUTO",
    nodata: "404",
  });
}

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
  const params = buildEarthScopeGeoCsvQuery(options);
  const response = await fetch(`${EARTHSCOPE_DATASELECT_URL}?${params}`, {
    headers: {
      Accept: "text/plain,text/csv;q=0.9,*/*;q=0.1",
      "User-Agent": options.userAgent,
    },
    signal: options.signal,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`EarthScope dataselect waveform HTTP ${response.status}`);
  }
  const text = await response.text();
  if (!text.trim()) throw new Error("EarthScope dataselect devolvió un waveform vacío.");
  return text;
}
