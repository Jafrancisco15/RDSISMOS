import { unzipSync, strFromU8 } from "fflate";
import { parseBgsMonthlyMeansText, type BgsMonthlyPoint } from "./coreSeismicMonitor";
const BGS_ORIGIN = "https://wdcapi.bgs.ac.uk";
function collectStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
    return output;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectStrings(item, output);
  }
  return output;
}

function maybeDecodeBase64(value: string) {
  if (value.length < 300 || value.includes(" ") || !/^[A-Za-z0-9+/=\r\n]+$/.test(value)) return null;
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    return decoded.includes("\n") ? decoded : null;
  } catch {
    return null;
  }
}

function resolveBgsUrl(value: string) {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed, BGS_ORIGIN);
    if (url.protocol !== "https:" || !(url.hostname === "bgs.ac.uk" || url.hostname.endsWith(".bgs.ac.uk"))) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function parsePayloadText(raw: string): { chunks: string[]; urls: string[] } {
  let chunks = [raw];
  try {
    const parsed = JSON.parse(raw) as unknown;
    chunks = collectStrings(parsed);
  } catch {
    // The monthly-means endpoint may return the IAGA-style payload directly.
  }

  const expanded = [...chunks];
  for (const chunk of chunks) {
    const decoded = maybeDecodeBase64(chunk);
    if (decoded) expanded.push(decoded);
  }

  const urls = new Set<string>();
  for (const chunk of expanded) {
    const trimmed = chunk.trim();
    if (/^https?:\/\//i.test(trimmed) || /^\//.test(trimmed)) {
      const resolved = resolveBgsUrl(trimmed);
      if (resolved) urls.add(resolved);
    }
    for (const match of chunk.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
      const resolved = resolveBgsUrl(match[0]);
      if (resolved) urls.add(resolved);
    }
  }

  return { chunks: expanded, urls: [...urls] };
}

function decimalYearFromIso(dateText: string, timeText?: string) {
  const year = Number(dateText.slice(0, 4));
  if (!Number.isFinite(year)) return null;
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  const isoTime = timeText && /^\d{2}:\d{2}/.test(timeText) ? timeText.replace(/\|$/, "") : "00:00:00";
  const instant = Date.parse(`${dateText}T${isoTime.endsWith("Z") ? isoTime : `${isoTime}Z`}`);
  if (!Number.isFinite(instant)) return null;
  return year + (instant - start) / (end - start);
}

/**
 * BGS monthly files are a modified IAGA2002-style format. Depending on the API
 * representation, rows may be returned with decimal year first, or with ISO
 * DATE/TIME/DOY fields before XYZ. The core parser intentionally accepts the
 * compact decimal-year layout, so this adapter normalizes both layouts.
 */
export function parseBgsMonthlyChunk(text: string): BgsMonthlyPoint[] {
  const direct = parseBgsMonthlyMeansText(text);
  if (direct.length >= 24) return direct;

  const normalized: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("|") || line.startsWith("%")) continue;
    const tokens = line.replace(/\|/g, " ").split(/[\s,;]+/).filter(Boolean);
    if (tokens.length < 4) continue;

    // Some BGS payloads include the decimal-year sample after DATE/TIME.
    const decimalIndex = tokens.findIndex(token => {
      const value = Number(token);
      return Number.isFinite(value) && value >= 1800 && value <= 2100;
    });
    if (decimalIndex >= 0) {
      const decimalYear = Number(tokens[decimalIndex]);
      const values: number[] = [];
      for (const token of tokens.slice(decimalIndex + 1)) {
        const value = Number(token);
        if (Number.isFinite(value)) values.push(value);
        if (values.length >= 3) break;
      }
      if (values.length >= 3 && values.every(value => Math.abs(value) < 99990)) {
        normalized.push(`${decimalYear} ${values[0]} ${values[1]} ${values[2]}`);
        continue;
      }
    }

    // Conventional IAGA-style DATE TIME DOY X Y Z rows: derive decimal year.
    const dateIndex = tokens.findIndex(token => /^\d{4}-\d{2}-\d{2}$/.test(token));
    if (dateIndex < 0) continue;
    const timeToken = /^\d{2}:\d{2}/.test(tokens[dateIndex + 1] ?? "") ? tokens[dateIndex + 1] : undefined;
    const decimalYear = decimalYearFromIso(tokens[dateIndex], timeToken);
    if (decimalYear === null) continue;

    const start = dateIndex + (timeToken ? 2 : 1);
    const numericTail = tokens.slice(start).map(Number).filter(Number.isFinite);
    if (numericTail.length >= 4 && numericTail[0] >= 1 && numericTail[0] <= 366) numericTail.shift();
    if (numericTail.length < 3) continue;
    const [x, y, z] = numericTail;
    if ([x, y, z].some(value => Math.abs(value) >= 99990)) continue;
    normalized.push(`${decimalYear.toFixed(6)} ${x} ${y} ${z}`);
  }

  return parseBgsMonthlyMeansText(normalized.join("\n"));
}

export function dedupeMonthly(points: BgsMonthlyPoint[]) {
  const seen = new Set<string>();
  return points
    .sort((a, b) => a.decimalYear - b.decimalYear)
    .filter(point => {
      const key = point.decimalYear.toFixed(4);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}


/** Decode BGS's ZIP response in memory; never interpret compressed bytes as text. */
export function decodeBgsPayload(bytes: Uint8Array): string[] {
  if (bytes.length > 8_000_000) throw new Error("BGS: respuesta demasiado grande");
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return [strFromU8(bytes)];
  let total = 0;
  const files = unzipSync(bytes, { filter: entry => {
    if (!/\.(dat|txt)$/i.test(entry.name)) return false;
    total += entry.originalSize;
    if (total > 16_000_000) throw new Error("BGS: archivo descomprimido demasiado grande");
    return true;
  }});
  const chunks = Object.values(files).map(bytes => strFromU8(bytes));
  if (!chunks.length) throw new Error("BGS: ZIP sin archivos mensuales");
  return chunks;
}
