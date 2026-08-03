import { timingSafeEqual } from "node:crypto";

export function normalizeCronSecret(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim().replace(/^Bearer\s+/i, "").trim();
  return normalized || null;
}

export function extractBearerSecret(value: string | null | undefined) {
  if (!value) return null;
  const match = value.trim().match(/^Bearer\s+(.+)$/i);
  return normalizeCronSecret(match?.[1]);
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer);
}

export function cronSecretMatches(
  candidate: string | null | undefined,
  configuredSecrets: Array<string | null | undefined>,
) {
  const normalizedCandidate = normalizeCronSecret(candidate);
  if (!normalizedCandidate) return false;

  return configuredSecrets
    .map(normalizeCronSecret)
    .filter((value): value is string => Boolean(value))
    .some((secret) => constantTimeEqual(normalizedCandidate, secret));
}
