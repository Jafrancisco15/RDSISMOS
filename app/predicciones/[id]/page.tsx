import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectionExplanationCard } from "@/components/ProjectionExplanationCard";
import { loadProjectionHistory } from "@/lib/learning/projectionHistory";

export const dynamic = "force-dynamic";

export default async function PredictionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const archive = await loadProjectionHistory({ predictionId: id });
  const item = archive.items.find((prediction) => prediction.id === id);
  if (archive.databaseConnected && !item) notFound();
  return <main style={{ maxWidth: 1100, margin: "32px auto", padding: 20 }}>
    <Link href="/">Volver a RDSISMOS</Link>
    <h1>Predicción archivada</h1>
    {item ? <>
      <p>Emitida: {new Date(item.generatedAt).toLocaleString("es-DO", { timeZone: "UTC" })} UTC · ID: {item.id}</p>
      <ProjectionExplanationCard item={item} />
    </> : <p role="alert">El archivo de predicciones no está disponible temporalmente. Intenta nuevamente.</p>}
  </main>;
}
