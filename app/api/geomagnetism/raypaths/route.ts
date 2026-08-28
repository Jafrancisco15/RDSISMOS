import { NextRequest, NextResponse } from "next/server";

const TRAVELTIME_URL = "https://service.earthscope.org/irisws/traveltime/1/query";
const USER_AGENT = "RDSISMOS/1.0 TauP-ray-diagram";
const MODELS = new Set(["ak135", "prem", "iasp91"]);
const BASIC_PHASES = "P,S,Pdiff,Sdiff";
const FULL_PHASES = "P,S,PP,SS,PcP,ScS,Pdiff,Sdiff,PKP,SKS,PKiKP,SKiKS,PKIKP,SKIKS";
const DISTANCES = [20, 40, 60, 80, 100, 120, 140, 160, 180];
const XML_ENTITIES: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

function boundedNumber(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function modelParam(value: string | null) {
  const model = (value ?? "ak135").toLowerCase();
  return MODELS.has(model) ? model : "ak135";
}

function sanitizeSvg(svg: string) {
  return svg
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\s(?:href|xlink:href)\s*=\s*"https?:[^"]*"/gi, "")
    .replace(/\s(?:href|xlink:href)\s*=\s*'https?:[^']*'/gi, "");
}

function errorSvg(message: string) {
  const safe = message.replace(/[<>&"]/g, (character) => XML_ENTITIES[character] ?? character);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 620"><rect width="900" height="620" fill="#07111d"/><circle cx="450" cy="315" r="220" fill="#151d2e" stroke="#334155" stroke-width="2"/><text x="450" y="290" text-anchor="middle" fill="#fca5a5" font-family="sans-serif" font-size="22" font-weight="700">TauP no disponible</text><text x="450" y="325" text-anchor="middle" fill="#cbd5e1" font-family="sans-serif" font-size="14">${safe}</text><text x="450" y="355" text-anchor="middle" fill="#64748b" font-family="sans-serif" font-size="12">RDSISMOS · EarthScope NSF SAGE</text></svg>`;
}

export async function GET(request: NextRequest) {
  const depthKm = boundedNumber(request.nextUrl.searchParams.get("depth"), 10, 0, 700);
  const model = modelParam(request.nextUrl.searchParams.get("model"));
  const detail = request.nextUrl.searchParams.get("detail") === "basic" ? "basic" : "full";
  const phases = detail === "basic" ? BASIC_PHASES : FULL_PHASES;

  const params = new URLSearchParams({
    distdeg: DISTANCES.join(","),
    evdepth: depthKm.toFixed(1),
    model,
    phases,
    format: "svg",
  });

  try {
    const response = await fetch(`${TRAVELTIME_URL}?${params}`, {
      headers: { Accept: "image/svg+xml,text/xml;q=0.9,*/*;q=0.5", "User-Agent": USER_AGENT },
      next: { revalidate: 2_592_000 },
      signal: AbortSignal.timeout(18_000),
    });
    if (!response.ok) throw new Error(`EarthScope traveltime HTTP ${response.status}`);
    const raw = await response.text();
    if (!/<svg[\s>]/i.test(raw)) throw new Error("EarthScope no devolvió un SVG TauP válido.");
    const svg = sanitizeSvg(raw);

    return new NextResponse(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, s-maxage=2592000, stale-while-revalidate=7776000",
        "X-Content-Type-Options": "nosniff",
        "X-RDSISMOS-Model": model,
        "X-RDSISMOS-Phases": phases,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No fue posible calcular las trayectorias sísmicas.";
    return new NextResponse(errorSvg(message), {
      status: 502,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
}
