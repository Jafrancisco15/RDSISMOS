export async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";

  if (!text.trim()) {
    throw new Error(`HTTP ${response.status}: respuesta vacía del servidor.`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    const preview = text.replace(/\s+/g, " ").trim().slice(0, 220);
    const label = response.ok ? "La fuente devolvió una respuesta no JSON" : `HTTP ${response.status}`;
    throw new Error(`${label}${contentType ? ` (${contentType.split(";")[0]})` : ""}: ${preview}`);
  }
}
