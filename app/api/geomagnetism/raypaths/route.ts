import { NextRequest, NextResponse } from "next/server";
import { EARTH_RADIUS_KM, localRayModel, traceRayFamilies, type LocalRayPath } from "@/lib/localSeismicRayTracer";
import type { TravelTimeModel } from "@/lib/seismicWavefronts";

const MODELS = new Set<TravelTimeModel>(["ak135", "prem", "iasp91"]);
const CX = 450;
const CY = 314;
const R = 250;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

function boundedNumber(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function modelParam(value: string | null): TravelTimeModel {
  const model = (value ?? "ak135").toLowerCase() as TravelTimeModel;
  return MODELS.has(model) ? model : "ak135";
}

function radiusAtDepth(depthKm: number) {
  return R * Math.max(0, EARTH_RADIUS_KM - depthKm) / EARTH_RADIUS_KM;
}

function xy(depthKm: number, thetaRad: number, mirror = false) {
  const radius = radiusAtDepth(depthKm);
  const sign = mirror ? -1 : 1;
  return {
    x: CX + sign * radius * Math.sin(thetaRad),
    y: CY - radius * Math.cos(thetaRad),
  };
}

function pathD(ray: LocalRayPath, mirror = false) {
  return ray.points.map((point, index) => {
    const position = xy(point.depthKm, point.thetaRad, mirror);
    return `${index ? "L" : "M"}${position.x.toFixed(1)},${position.y.toFixed(1)}`;
  }).join(" ");
}

function phaseStyle(phase: LocalRayPath["phase"]) {
  if (phase === "P") return { stroke: "#0284c7", width: 1.45, dash: "" };
  if (phase === "S") return { stroke: "#f59e0b", width: 1.45, dash: "" };
  if (phase === "PcP") return { stroke: "#06b6d4", width: 1.25, dash: "5 3" };
  if (phase === "ScS") return { stroke: "#f97316", width: 1.25, dash: "5 3" };
  if (phase === "PKP") return { stroke: "#7c3aed", width: 1.55, dash: "" };
  if (phase === "SKS") return { stroke: "#db2777", width: 1.45, dash: "4 2" };
  return { stroke: "#dc2626", width: 1.65, dash: "" };
}

function evenly<T>(items: T[], maximum: number) {
  if (items.length <= maximum) return items;
  return Array.from({ length: maximum }, (_, index) => items[Math.round(index * (items.length - 1) / Math.max(1, maximum - 1))]);
}

function selectedRays(rays: LocalRayPath[], detail: "basic" | "full") {
  const phases: LocalRayPath["phase"][] = detail === "basic"
    ? ["P", "S"]
    : ["P", "S", "PcP", "ScS", "PKP", "SKS", "PKIKP"];
  return phases.flatMap((phase) => evenly(rays.filter((ray) => ray.phase === phase), phase === "P" || phase === "S" ? 11 : 7));
}

function escapeXml(value: string) {
  return value.replace(/[<>&"]/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[character] ?? character);
}

function renderSvg(modelName: TravelTimeModel, depthKm: number, detail: "basic" | "full") {
  const model = localRayModel(modelName);
  const rays = selectedRays(traceRayFamilies(modelName, depthKm, detail === "basic" ? 34 : 42), detail);
  if (!rays.length) throw new Error("El trazador local no produjo rayos válidos para esta profundidad.");

  const mantleR = radiusAtDepth(model.cmbDepthKm);
  const innerCoreR = radiusAtDepth(model.icbDepthKm);
  const focus = xy(depthKm, 0);
  const paths = rays.map((ray) => {
    const style = phaseStyle(ray.phase);
    const dash = style.dash ? ` stroke-dasharray="${style.dash}"` : "";
    const opacity = ray.phase === "P" || ray.phase === "S" ? 0.68 : 0.78;
    return `<path d="${pathD(ray)}" fill="none" stroke="${style.stroke}" stroke-width="${style.width}"${dash} opacity="${opacity}"/><path d="${pathD(ray, true)}" fill="none" stroke="${style.stroke}" stroke-width="${style.width}"${dash} opacity="${opacity}"/>`;
  }).join("");

  const distanceTicks = [20,40,60,80,100,120,140,160,180].map((distance) => {
    const angle = distance * Math.PI / 180;
    const x = CX + (R + 15) * Math.sin(angle);
    const y = CY - (R + 15) * Math.cos(angle);
    const xm = CX - (R + 15) * Math.sin(angle);
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="10" fill="#475569" text-anchor="middle">${distance}°</text>${distance < 180 ? `<text x="${xm.toFixed(1)}" y="${y.toFixed(1)}" font-size="10" fill="#475569" text-anchor="middle">${distance}°</text>` : ""}`;
  }).join("");

  const legend = detail === "basic"
    ? [["P","#0284c7"],["S","#f59e0b"]]
    : [["P","#0284c7"],["S","#f59e0b"],["PcP","#06b6d4"],["ScS","#f97316"],["PKP","#7c3aed"],["SKS","#db2777"],["PKIKP","#dc2626"]];
  const legendSvg = legend.map(([name,color], index) => {
    const x = 76 + (index % 4) * 120;
    const y = 583 + Math.floor(index / 4) * 20;
    return `<line x1="${x}" y1="${y - 4}" x2="${x + 26}" y2="${y - 4}" stroke="${color}" stroke-width="3"/><text x="${x + 33}" y="${y}" font-size="11" fill="#334155" font-weight="700">${name}</text>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 620" role="img" aria-label="Trayectorias sísmicas locales ${escapeXml(modelName.toUpperCase())}">
  <rect width="900" height="620" fill="#fffaf2"/>
  <text x="32" y="30" fill="#0f172a" font-family="sans-serif" font-size="17" font-weight="800">RDSISMOS · trazado de rayos sísmicos 1-D</text>
  <text x="32" y="49" fill="#64748b" font-family="sans-serif" font-size="11">${escapeXml(modelName.toUpperCase())} · foco ${depthKm.toFixed(1)} km · cálculo local por ley de Snell esférica</text>
  <circle cx="${CX}" cy="${CY}" r="${R}" fill="#e69a4b" stroke="#0f172a" stroke-width="1.5"/>
  <circle cx="${CX}" cy="${CY}" r="${mantleR.toFixed(2)}" fill="#ef6336" stroke="#9a3412" stroke-width="1"/>
  <circle cx="${CX}" cy="${CY}" r="${innerCoreR.toFixed(2)}" fill="#facc15" stroke="#a16207" stroke-width="1"/>
  <text x="${CX}" y="${CY - 145}" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="800" fill="#7c2d12">MANTO</text>
  <text x="${CX}" y="${CY + 20}" text-anchor="middle" font-family="sans-serif" font-size="11" font-weight="800" fill="#fff7ed">NÚCLEO EXTERNO</text>
  <text x="${CX}" y="${CY + 4}" text-anchor="middle" font-family="sans-serif" font-size="8" font-weight="900" fill="#713f12">NÚCLEO INTERNO</text>
  ${paths}
  <circle cx="${focus.x.toFixed(1)}" cy="${focus.y.toFixed(1)}" r="5" fill="#dc2626" stroke="white" stroke-width="1.5"/>
  <circle cx="${CX}" cy="${CY - R}" r="6" fill="#dc2626" stroke="white" stroke-width="1.5"/>
  <text x="${CX + 10}" y="${CY - R + 6}" font-family="sans-serif" font-size="10" font-weight="800" fill="#7f1d1d">FOCO</text>
  ${distanceTicks}
  <text x="${CX}" y="${CY + R + 28}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#475569">180° · antípoda</text>
  ${legendSvg}
  <text x="868" y="606" text-anchor="end" font-family="sans-serif" font-size="9" fill="#94a3b8">Perfiles estándar AK135 / PREM / IASP91 · cálculo local, no irisws-traveltime</text>
</svg>`;
}

function errorSvg(message: string) {
  const safe = escapeXml(message);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 620"><rect width="900" height="620" fill="#07111d"/><circle cx="450" cy="315" r="220" fill="#151d2e" stroke="#334155" stroke-width="2"/><text x="450" y="290" text-anchor="middle" fill="#fca5a5" font-family="sans-serif" font-size="22" font-weight="700">Trazado local no disponible</text><text x="450" y="325" text-anchor="middle" fill="#cbd5e1" font-family="sans-serif" font-size="14">${safe}</text><text x="450" y="355" text-anchor="middle" fill="#64748b" font-family="sans-serif" font-size="12">RDSISMOS · motor sísmico local</text></svg>`;
}

export async function GET(request: NextRequest) {
  const depthKm = boundedNumber(request.nextUrl.searchParams.get("depth"), 10, 0, 700);
  const model = modelParam(request.nextUrl.searchParams.get("model"));
  const detail = request.nextUrl.searchParams.get("detail") === "basic" ? "basic" : "full";
  try {
    const svg = renderSvg(model, depthKm, detail);
    return new NextResponse(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, s-maxage=2592000, stale-while-revalidate=7776000",
        "X-Content-Type-Options": "nosniff",
        "X-RDSISMOS-Model": model,
        "X-RDSISMOS-Engine": "local-spherical-ray-tracer",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No fue posible calcular las trayectorias sísmicas.";
    return new NextResponse(errorSvg(message), {
      status: 500,
      headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  }
}
