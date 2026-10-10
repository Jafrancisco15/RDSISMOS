import { ArchivedPredictionDetail } from "@/components/ArchivedPredictionDetail";

export const dynamic = "force-dynamic";

// Keep previously shared archived links working.
export default async function PredictionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ArchivedPredictionDetail id={id} />;
}
