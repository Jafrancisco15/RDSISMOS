export type CanonicalProjectionStatus =
  | "scheduled"
  | "active"
  | "fulfilled"
  | "not_fulfilled"
  | "pending_evaluation";

export interface ProjectionLifecycleInput {
  issuedAt: string;
  surveillanceStart: string;
  surveillanceEnd: string;
  hasOutcome?: boolean;
  occurred?: boolean;
  storedStatus?: string | null;
  resolvedAt?: string | null;
}

function milliseconds(value: string | null | undefined) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * Single lifecycle definition shared by History and the 3D map.
 *
 * Scheduled projections have been issued but their surveillance interval has not
 * started. Active means the interval is currently open and no result exists.
 */
export function canonicalProjectionStatus(
  input: ProjectionLifecycleInput,
  asOf: Date | string | number = new Date(),
): CanonicalProjectionStatus {
  const instant = asOf instanceof Date
    ? asOf.getTime()
    : typeof asOf === "number"
      ? asOf
      : milliseconds(asOf);
  const storedStatus = input.storedStatus?.trim().toLowerCase();
  const resolved = Boolean(input.resolvedAt) || input.hasOutcome
    || storedStatus === "fulfilled"
    || storedStatus === "not_fulfilled";

  if (resolved) {
    if (input.occurred === true || storedStatus === "fulfilled") return "fulfilled";
    return "not_fulfilled";
  }

  const issuedAt = milliseconds(input.issuedAt);
  const surveillanceStart = milliseconds(input.surveillanceStart);
  const surveillanceEnd = milliseconds(input.surveillanceEnd);

  if (Number.isFinite(issuedAt) && issuedAt > instant) return "scheduled";
  if (Number.isFinite(surveillanceStart) && surveillanceStart > instant) return "scheduled";
  if (Number.isFinite(surveillanceEnd) && surveillanceEnd < instant) return "pending_evaluation";
  return "active";
}

export function projectionIsActiveAt(
  input: ProjectionLifecycleInput,
  asOf: Date | string | number = new Date(),
) {
  return canonicalProjectionStatus(input, asOf) === "active";
}
