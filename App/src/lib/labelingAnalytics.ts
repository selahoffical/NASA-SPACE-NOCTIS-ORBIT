import { LabelExportPayload, LabelingSummary } from "@/types/semantic";

const SNAPSHOT_KEY = "noctis-orbit.semantic.snapshots";
const EXPORT_KEY = "noctis-orbit.semantic.exports";

function getWindow(): Window | null {
  return typeof window !== "undefined" ? window : null;
}

function readStore<T>(key: string): T[] {
  const win = getWindow();
  if (!win) return [];
  try {
    const raw = win.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch (error) {
    console.warn("Failed to read labeling analytics store", error);
    return [];
  }
}

function writeStore<T>(key: string, value: T[]): void {
  const win = getWindow();
  if (!win) return;
  try {
    win.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn("Failed to write labeling analytics store", error);
  }
}

export function persistLabelingSnapshot(summary: LabelingSummary): void {
  const history = readStore<LabelingSummary>(SNAPSHOT_KEY);
  history.unshift(summary);
  writeStore(SNAPSHOT_KEY, history.slice(0, 50));
}

export function persistLabelExport(payload: LabelExportPayload): void {
  const history = readStore<LabelExportPayload>(EXPORT_KEY);
  history.unshift(payload);
  writeStore(EXPORT_KEY, history.slice(0, 50));
}

export function getRecentLabelingSnapshots(): LabelingSummary[] {
  return readStore<LabelingSummary>(SNAPSHOT_KEY);
}

export function getRecentLabelExports(): LabelExportPayload[] {
  return readStore<LabelExportPayload>(EXPORT_KEY);
}
