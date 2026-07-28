import type { SyncStatus } from "./types";

const globalStore = globalThis as typeof globalThis & { __rdsismosSync?: Map<string, SyncStatus> };
const store = globalStore.__rdsismosSync ?? new Map<string, SyncStatus>();
globalStore.__rdsismosSync = store;

export function createSyncStatus(input: Pick<SyncStatus, "startTime" | "endTime">) {
  const id = crypto.randomUUID();
  const status: SyncStatus = {
    id,
    state: "running",
    startTime: input.startTime,
    endTime: input.endTime,
    processed: 0,
    inserted: 0,
    updated: 0,
    errors: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stopped: false,
  };
  store.set(id, status);
  return status;
}

export function getSyncStatus(id: string) { return store.get(id) ?? null; }
export function updateSyncStatus(id: string, patch: Partial<SyncStatus>) {
  const current = store.get(id);
  if (!current) return null;
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  store.set(id, next);
  return next;
}
export function listSyncStatuses() { return [...store.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
