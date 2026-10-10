// Query parameters preserve archived IDs containing colons, slashes or percent signs.
export function predictionHref(id: string | null | undefined): string | null {
  if (typeof id !== "string" || !id.trim()) return null;
  return `/predicciones?${new URLSearchParams({ id }).toString()}`;
}
