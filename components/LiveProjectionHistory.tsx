"use client";

import { useEffect, useState } from "react";
import { ProjectionHistoryPanel } from "./ProjectionHistoryPanel";

const REFRESH_MS = 10 * 60_000;

export function LiveProjectionHistory() {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setRevision((value) => value + 1);
    }, REFRESH_MS);
    return () => window.clearInterval(interval);
  }, []);

  return <ProjectionHistoryPanel key={revision} />;
}
