import { predictionHref } from "@/lib/learning/predictionLink";
import type { EventProjection } from "@/lib/earthquakes/types";

export function EventProjectionStatus({ projection }: { projection?: EventProjection }) {
  const match = projection?.status === "projected" ? projection.matches.find((item) => predictionHref(item.id)) : undefined;
  if (!match) return <span className="event-projection-empty" title={projection?.status === "not_projected"
    ? "Sin proyección cumplida asociada a este sismo" : "Archivo de proyecciones no disponible"}>N/A</span>;
  return <a className="event-projection-link" href={predictionHref(match.id)!} target="_blank" rel="noreferrer"
      onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}
      title={`Emitida ${match.generatedAt} · ${match.probabilityPct.toFixed(1)}% · M${match.magnitudeMin}–M${match.magnitudeMax}`}>
      Proyección cumplida ↗
    </a>;
}
