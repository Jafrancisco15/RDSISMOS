import type { EarthquakeEvent, EarthquakeStats } from "./types";

export function calculateEarthquakeStats(events: EarthquakeEvent[], now = new Date()): EarthquakeStats {
  const sorted = [...events].sort((a, b) => new Date(b.timeUtc).getTime() - new Date(a.timeUtc).getTime());
  const magnitudes = events.map((event) => event.magnitude).filter(Number.isFinite);
  const depths = events.map((event) => event.depthKm).filter(Number.isFinite);
  const age = (event: EarthquakeEvent) => (now.getTime() - new Date(event.timeUtc).getTime()) / 86_400_000;
  const byYear = new Map<string, { count: number; maxMagnitude: number }>();
  const byMonth = new Map<string, number>();
  const byRegion = new Map<string, number>();
  for (const event of events) {
    const date = new Date(event.timeUtc);
    const year = String(date.getUTCFullYear());
    const month = `${year}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const yearValue = byYear.get(year) ?? { count: 0, maxMagnitude: -Infinity };
    yearValue.count += 1;
    yearValue.maxMagnitude = Math.max(yearValue.maxMagnitude, event.magnitude);
    byYear.set(year, yearValue);
    byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
    byRegion.set(event.countryOrRegion, (byRegion.get(event.countryOrRegion) ?? 0) + 1);
  }
  const strongestEvent = events.reduce<EarthquakeEvent | null>((best, event) => !best || event.magnitude > best.magnitude ? event : best, null);
  return {
    total: events.length,
    maxMagnitude: magnitudes.length ? Math.max(...magnitudes) : null,
    averageMagnitude: average(magnitudes),
    averageDepthKm: average(depths),
    last24Hours: events.filter((event) => age(event) <= 1).length,
    last7Days: events.filter((event) => age(event) <= 7).length,
    last30Days: events.filter((event) => age(event) <= 30).length,
    latestEvent: sorted[0] ?? null,
    strongestEvent,
    byYear: [...byYear.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({ key, ...value })),
    byMonth: [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => ({ key, count })),
    magnitudeBuckets: bucket(events, (event) => Math.floor(event.magnitude), (value) => `M${value}–${value + 0.9}`),
    depthBuckets: bucket(events, (event) => event.depthKm < 70 ? 0 : event.depthKm < 300 ? 70 : 300, (value) => value === 0 ? "0–69 km" : value === 70 ? "70–299 km" : "300+ km"),
    byRegion: [...byRegion.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([key, count]) => ({ key, count })),
    scatter: events.slice(0, 2_000).map((event) => ({ magnitude: event.magnitude, depthKm: event.depthKm, timeUtc: event.timeUtc })),
  };
}

function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function bucket(events: EarthquakeEvent[], selector: (event: EarthquakeEvent) => number, label: (value: number) => string) {
  const counts = new Map<number, number>();
  for (const event of events) { const key = selector(event); counts.set(key, (counts.get(key) ?? 0) + 1); }
  return [...counts.entries()].sort(([a], [b]) => a - b).map(([key, count]) => ({ key: label(key), count }));
}
