import { randomUUID } from "node:crypto";

export type ExtractStatus = "processing" | "complete" | "error";

export type ExtractRecord = {
  id: string;
  status: ExtractStatus;
  documentType: string;
  phone: string;
  createdAt: number;
  result?: {
    saved: boolean;
    section: string | null;
    error: string | null;
  };
  error?: string;
};

const store = new Map<string, ExtractRecord>();
const TTL_MS = 60 * 60 * 1000;

function gc() {
  const now = Date.now();
  for (const [id, rec] of store) {
    if (now - rec.createdAt > TTL_MS) store.delete(id);
  }
}

export function createExtractRequest(documentType: string, phone: string): ExtractRecord {
  gc();
  const rec: ExtractRecord = {
    id: randomUUID(),
    status: "processing",
    documentType,
    phone,
    createdAt: Date.now(),
  };
  store.set(rec.id, rec);
  return rec;
}

export function getExtractRequest(id: string): ExtractRecord | null {
  return store.get(id) ?? null;
}

export function completeExtractRequest(
  id: string,
  result: { saved: boolean; section: string | null; error: string | null },
): void {
  const rec = store.get(id);
  if (!rec) return;
  rec.status = "complete";
  rec.result = result;
}

export function failExtractRequest(id: string, error: string): void {
  const rec = store.get(id);
  if (!rec) return;
  rec.status = "error";
  rec.error = error;
}
