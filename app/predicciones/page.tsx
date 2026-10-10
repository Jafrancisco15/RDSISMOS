import { ArchivedPredictionDetail } from "@/components/ArchivedPredictionDetail";

export const dynamic = "force-dynamic";

export default async function PredictionPage({ searchParams }: {
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  const { id } = await searchParams;
  return <ArchivedPredictionDetail id={typeof id === "string" ? id : undefined} />;
}
