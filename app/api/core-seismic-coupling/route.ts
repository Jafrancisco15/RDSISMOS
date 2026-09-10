import { NextResponse } from "next/server";
import {
  GEOMAGNETIC_JERKS,
  analyzeCoupling,
  buildAnnualCoupling,
  prospectiveCountScore,
  type PolePoint,
  type PredictorKey,
  type SeismicEventPoint,
} from "@/lib/coreSeismicCoupling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NOAA_POLE_URL = "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/ArcGIS/rest/services/dip_poles_modeled/FeatureServer/0/query";
const USGS_EVENT_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query";

async function loadNorthDipPole(): Promise<PolePoint[]> {
  const params = new URLSearchParams({
    where: "NORTH_SOUTH='N' AND YEAR>=1900",
    outFields: "YEAR,LONGITUDE,LATITUDE,NORTH_SOUTH",
    orderByFields: "YEAR ASC",
    returnGeometry: "false",
    f: "json",
  });
  const response = await fetch(`${NOAA_POLE_URL}?${params}`, {
    signal: AbortSignal.timeout(20_000),
    next: { revalidate: 7 * 24 * 3600 },
  });
  if (!response.ok) throw new Error(`NOAA dip-pole service HTTP ${response.status}`);
  const body = await response.json() as { features?: Array<{ attributes?: Record<string, unknown> }>; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "NOAA dip-pole query failed");
  return (body.features ?? []).map(item => {
    const a = item.attributes ?? {};
    return { year: Number(a.YEAR), lat: Number(a.LATITUDE), lon: Number(a.LONGITUDE) };
  }).filter(p => Number.isFinite(p.year + p.lat + p.lon));
}

async function loadGlobalM7(now: Date): Promise<{ events: SeismicEventPoint[]; latestEventUtc: string | null }> {
  const tomorrow = new Date(now.getTime() + 24 * 3600_000).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    format: "geojson",
    starttime: "1904-01-01",
    endtime: tomorrow,
    minmagnitude: "7",
    orderby: "time-asc",
    limit: "20000",
  });
  const response = await fetch(`${USGS_EVENT_URL}?${params}`, {
    signal: AbortSignal.timeout(25_000),
    next: { revalidate: 6 * 3600 },
    headers: { Accept: "application/geo+json" },
  });
  if (!response.ok) throw new Error(`USGS FDSN event service HTTP ${response.status}`);
  const body = await response.json() as {
    features?: Array<{ properties?: { mag?: number | null; time?: number | null; type?: string | null } }>;
  };
  let latest: number | null = null;
  const events: SeismicEventPoint[] = [];
  for (const feature of body.features ?? []) {
    const p = feature.properties ?? {};
    const mag = Number(p.mag), time = Number(p.time);
    if (!Number.isFinite(mag) || !Number.isFinite(time) || mag < 7) continue;
    if (p.type && p.type !== "earthquake") continue;
    const year = new Date(time).getUTCFullYear();
    events.push({ year, magnitude: mag });
    latest = latest === null ? time : Math.max(latest, time);
  }
  return { events, latestEventUtc: latest === null ? null : new Date(latest).toISOString() };
}

function yearExposure(now: Date) {
  const y = now.getUTCFullYear();
  const start = Date.UTC(y, 0, 1), end = Date.UTC(y + 1, 0, 1);
  return Math.max(0, Math.min(1, (now.getTime() - start) / (end - start)));
}

export async function GET() {
  const now = new Date();
  const warnings: string[] = [];
  const [poleResult, seismicResult] = await Promise.allSettled([loadNorthDipPole(), loadGlobalM7(now)]);
  const poles = poleResult.status === "fulfilled" ? poleResult.value : [];
  if (poleResult.status === "rejected") warnings.push(`Polo magnético: ${String(poleResult.reason)}`);
  if (seismicResult.status === "rejected") {
    return NextResponse.json({ error: `No se pudo cargar el catálogo sísmico real: ${String(seismicResult.reason)}` }, { status: 502 });
  }

  const currentYear = now.getUTCFullYear();
  const lastCompletedYear = currentYear - 1;
  const annual = buildAnnualCoupling(poles, seismicResult.value.events, 1904, currentYear);
  const retrospective = annual.filter(row => row.year <= Math.min(2025, lastCompletedYear));
  const predictors: PredictorKey[] = ["poleSpeedKmYr", "poleAccelerationKmYr2", "jerkIntensity"];
  const analyses = predictors.flatMap(predictor => ["countM7", "logMoment"] as const)
    .map(endpoint => analyzeCoupling(retrospective, predictor, endpoint))
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const exposure = yearExposure(now);
  const prospective = analyses
    .filter(a => a.endpoint === "countM7")
    .map(a => prospectiveCountScore(annual, a.predictor, a.bestLagYears, currentYear, exposure))
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const latestPoleYear = poles.length ? Math.max(...poles.map(p => p.year)) : null;
  const historicalEvents = seismicResult.value.events.filter(e => e.year <= 2025).length;
  const currentObserved = annual.find(row => row.year === currentYear)?.countM7 ?? 0;

  return NextResponse.json({
    generatedAtUtc: now.toISOString(),
    experimentVersion: "core-seismic-v0.1",
    retrospectiveFreezeThrough: 2025,
    currentProspectiveYear: currentYear,
    summary: {
      annualRows: retrospective.length,
      historicalM7Events: historicalEvents,
      polePoints: poles.length,
      latestPoleYear,
      currentYearM7Observed: currentObserved,
      currentYearExposure: exposure,
      latestEventUtc: seismicResult.value.latestEventUtc,
    },
    sources: {
      northDipPole: {
        name: "NOAA/NCEI modeled magnetic dip poles",
        coverage: latestPoleYear ? `1900–${latestPoleYear}` : "unavailable",
        url: "https://www.ncei.noaa.gov/products/wandering-geomagnetic-poles",
        service: NOAA_POLE_URL,
        note: "1590–1890 gUFM; 1900 onward IGRF in the NOAA modeled-pole layer. This module uses 1900 onward.",
      },
      seismicity: {
        name: "USGS ANSS ComCat / FDSN Event",
        coverage: `1904–${currentYear} live`,
        url: "https://earthquake.usgs.gov/fdsnws/event/1/",
        filter: "natural earthquakes, M≥7",
        momentNote: "ΣM0 is an explicitly labeled magnitude-derived proxy using 10^(1.5M+9.05); direct GCMT/ISC scalar moment remains a planned replication tier.",
      },
      jerks: {
        name: "Versioned literature-consensus jerk epochs",
        epochs: GEOMAGNETIC_JERKS,
        note: "Jerk epochs are not assumed globally simultaneous; 2024 is down-weighted because its global status is still provisional in this v0.1 catalog.",
      },
      secularAcceleration: {
        status: "planned-direct-ingestion",
        name: "BGS WDC monthly means / INTERMAGNET / CHAOS-8",
        note: "H_SA is intentionally not synthesized from IGRF five-year epochs. It will activate only after direct high-resolution SA ingestion.",
      },
    },
    hypotheses: {
      H0: "geomagnetic variables add no seismic information",
      H_pole: "dip-pole kinematics add information",
      H_SA: "secular acceleration adds information — pending direct high-resolution ingestion",
      H_jerk: "independently defined jerk timing adds information",
    },
    annual,
    analyses,
    prospective,
    warnings,
    interpretationRules: {
      positiveLag: "geomagnetic predictor precedes the seismic response",
      negativeLag: "seismic response precedes the geomagnetic predictor; reverse-direction falsification test",
      significance: "lag-corrected circular-surrogate p-value; not a causal claim",
      validation: "best lag selected before the 1990–2025 OOS block; OOS information gain is reported separately",
      causalClaim: false,
      predictionClaim: false,
    },
  }, { headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" } });
}
