import Link from "next/link";
import { ProjectionExplanationCard } from "./ProjectionExplanationCard";
import { loadProjectionHistory } from "@/lib/learning/projectionHistory";

export async function ArchivedPredictionDetail({ id }: { id?: string }) {
  const archive = id?.trim() ? await loadProjectionHistory({ predictionId: id }) : null;
  const item = archive?.items.find((prediction) => prediction.id === id);
  return <main style={{ maxWidth: 1100, margin: "32px auto", padding: 20 }}>
    <Link href="/">Volver a RDSISMOS</Link>
    <h1>Predicción archivada</h1>
    {item ? <>
      <p>Emitida: {new Date(item.generatedAt).toLocaleString("es-DO", { timeZone: "UTC" })} UTC · ID: {item.id}</p>
      <ProjectionExplanationCard item={item} />
    </> : <p role="alert">{archive && !archive.databaseConnected
      ? "El archivo de predicciones no está disponible temporalmente. Intenta nuevamente."
      : "N/A · No hay una proyección archivada relacionada con este enlace."}</p>}
  </main>;
}
