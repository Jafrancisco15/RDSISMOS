import { NextRequest, NextResponse } from "next/server";
import { countryByCode } from "@/lib/countries";
import { buildCountryOutlook } from "@/lib/countryOutlook";
import { loadActiveCountryCapsules } from "@/lib/learning/outlookStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const countryCode = request.nextUrl.searchParams.get("country")?.toUpperCase() ?? "DO";
  const target = countryByCode(countryCode);
  const generatedAt = new Date();
  const stored = await loadActiveCountryCapsules(target.code, 12);
  const outlook = buildCountryOutlook(stored.capsules, target.code, generatedAt);

  return NextResponse.json({
    generatedAt: generatedAt.toISOString(),
    target,
    capsules: stored.capsules,
    outlook,
    databaseConfigured: stored.databaseConfigured,
    databaseConnected: stored.databaseConnected,
    warning: stored.warning,
  }, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
