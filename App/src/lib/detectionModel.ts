import type { ObjectDetectionResult, DetectionBox } from "./objectDetection";

export async function inferWithModel(file: File): Promise<{ boxes: DetectionBox[] } | null> {
  // Try a server-side inference endpoint: POST /api/infer with form data
  try {
    const fd = new FormData();
    fd.append("file", file);
    const resp = await fetch("/api/infer", { method: "POST", body: fd });
    if (!resp.ok) return null;
    const json = await resp.json();
    // Expecting { boxes: [...] } where boxes match DetectionBox shape or a simplified form
    return { boxes: json.boxes as DetectionBox[] };
  } catch (err) {
    console.warn("Model inference not available", err);
    return null;
  }
}
