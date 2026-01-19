import { readSingleBand } from "@/lib/analysis";

type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DetectionPolygon = {
  type: "Feature";
  geometry: {
    type: "Polygon";
    coordinates: number[][][];
  };
  properties: Record<string, unknown>;
};

type DetectionFeatureCollection = {
  type: "FeatureCollection";
  features: DetectionPolygon[];
};

export type UrbanFeatureCategory =
  | "building"
  | "border-wall"
  | "bridge"
  | "river"
  | "urban-feature";

const CATEGORY_LABELS: Record<UrbanFeatureCategory, string> = {
  building: "Building",
  "border-wall": "Border Wall",
  bridge: "Bridge",
  river: "River",
  "urban-feature": "Urban Feature",
};

const CATEGORY_COLORS: Record<UrbanFeatureCategory, { stroke: string; fill: string; accent: string }> = {
  building: {
    stroke: "rgba(0, 255, 164, 0.9)",
    fill: "rgba(0, 255, 164, 0.18)",
    accent: "#00ffa4",
  },
  "border-wall": {
    stroke: "rgba(255, 99, 71, 0.9)",
    fill: "rgba(255, 99, 71, 0.18)",
    accent: "#ff6347",
  },
  bridge: {
    stroke: "rgba(255, 179, 71, 0.9)",
    fill: "rgba(255, 179, 71, 0.18)",
    accent: "#ffb347",
  },
  river: {
    stroke: "rgba(65, 105, 225, 0.9)",
    fill: "rgba(65, 105, 225, 0.18)",
    accent: "#4169e1",
  },
  "urban-feature": {
    stroke: "rgba(173, 216, 230, 0.9)",
    fill: "rgba(173, 216, 230, 0.18)",
    accent: "#add8e6",
  },
};

export interface DetectionBox {
  id: string;
  label: string;
  categoryId: UrbanFeatureCategory;
  confidence: number;
  bbox: BoundingBox;
  previewBox: BoundingBox;
  areaPixels: number;
  centroid: { x: number; y: number };
  centroidPreview: { x: number; y: number };
  footprint?: DetectionPolygon | null;
  notes?: string;
}

export interface DetectionStatistics {
  totalDetections: number;
  threshold: number;
  minimumArea: number;
  averageConfidence: number;
}

export interface ObjectDetectionOptions {
  thresholdPercentile: number;
  minAreaPixels: number;
  maxDetections?: number;
}

export interface ObjectDetectionResult {
  thresholdValue: number;
  width: number;
  height: number;
  previewWidth: number;
  previewHeight: number;
  basePreviewUrl: string;
  overlayUrl: string;
  debugMaskUrls?: Record<string, string>;
  boxes: DetectionBox[];
  stats: DetectionStatistics;
  featureCollection: DetectionFeatureCollection;
  bounds?: [number, number, number, number];
  pixelScale?: [number, number];
}

const DEFAULT_OPTIONS: ObjectDetectionOptions = {
  thresholdPercentile: 95,
  minAreaPixels: 40,
  maxDetections: 200,
};

const DEFAULT_PREVIEW_EDGE = 1200;

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

function percentile(values: ArrayLike<number>, p: number): number {
  const copy = Array.from({ length: values.length }, (_, index) => values[index]).filter((v) => Number.isFinite(v));
  if (!copy.length) return 0;
  copy.sort((a, b) => a - b);
  const index = Math.min(copy.length - 1, Math.max(0, Math.round((p / 100) * (copy.length - 1))));
  return copy[index];
}

function normalize(values: Float32Array): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(values.length);
  const p2 = percentile(values, 2);
  const p99 = percentile(values, 99.5);
  const range = Math.max(1e-6, p99 - p2);
  for (let i = 0; i < values.length; i += 1) {
    const normalized = ((values[i] - p2) / range) * 255;
    dst[i] = Number.isFinite(normalized) ? Math.min(255, Math.max(0, Math.round(normalized))) : 0;
  }
  return dst;
}

function downscale(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  maxEdge: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  if (Math.max(width, height) <= maxEdge) {
    return { data, width, height };
  }
  const scale = maxEdge / Math.max(width, height);
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const dst = new Uint8ClampedArray(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const srcY = Math.min(height - 1, Math.round((y + 0.5) * (height / targetHeight) - 0.5));
    for (let x = 0; x < targetWidth; x += 1) {
      const srcX = Math.min(width - 1, Math.round((x + 0.5) * (width / targetWidth) - 0.5));
      dst[y * targetWidth + x] = data[srcY * width + srcX];
    }
  }
  return { data: dst, width: targetWidth, height: targetHeight };
}

function resampleNearest(
  data: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(dstW * dstH);
  for (let y = 0; y < dstH; y += 1) {
    const srcY = Math.min(srcH - 1, Math.round((y + 0.5) * (srcH / dstH) - 0.5));
    for (let x = 0; x < dstW; x += 1) {
      const srcX = Math.min(srcW - 1, Math.round((x + 0.5) * (srcW / dstW) - 0.5));
      dst[y * dstW + x] = data[srcY * srcW + srcX];
    }
  }
  return dst;
}

function canvasFromGray(
  values: Uint8ClampedArray,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Unable to initialise canvas context");
  }
  const imageData = ctx.createImageData(width, height);
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    const idx = i * 4;
    imageData.data[idx + 0] = value;
    imageData.data[idx + 1] = value;
    imageData.data[idx + 2] = value;
    imageData.data[idx + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function drawOverlay(
  base: Uint8ClampedArray,
  width: number,
  height: number,
  boxes: DetectionBox[],
): string {
  const canvas = canvasFromGray(base, width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable");
  ctx.lineWidth = 2;
  ctx.font = "14px 'Segoe UI', sans-serif";
  ctx.textBaseline = "top";

  boxes.forEach((box) => {
    const { x, y, width: bw, height: bh } = box.previewBox;
    const styles = CATEGORY_COLORS[box.categoryId] ?? CATEGORY_COLORS["urban-feature"];
    ctx.strokeStyle = styles.stroke;
    ctx.fillStyle = styles.fill;
    ctx.beginPath();
    ctx.rect(x, y, bw, bh);
    ctx.fill();
    ctx.stroke();

    const label = `${box.label} ${(box.confidence * 100).toFixed(1)}%`;
    const padding = 4;
    const textWidth = ctx.measureText(label).width + padding * 2;
    const textHeight = 18;
    const textY = Math.max(0, y - textHeight);
    ctx.fillStyle = "rgba(10, 15, 20, 0.85)";
    ctx.fillRect(x, textY, textWidth, textHeight);
    ctx.fillStyle = styles.accent;
    ctx.fillText(label, x + padding, textY + 2);
  });

  return canvas.toDataURL("image/png");
}

function buildPolygon(
  bbox: BoundingBox,
  imageBounds: [number, number, number, number] | undefined,
  width: number,
  height: number,
): DetectionPolygon | null {
  if (!imageBounds) return null;
  const [minX, minY, maxX, maxY] = imageBounds;
  const lonSpan = maxX - minX;
  const latSpan = maxY - minY;
  if (!Number.isFinite(lonSpan) || !Number.isFinite(latSpan)) return null;

  const toLon = (px: number) => minX + (px / Math.max(width - 1, 1)) * lonSpan;
  const toLat = (py: number) => maxY - (py / Math.max(height - 1, 1)) * latSpan;

  const x0 = bbox.x;
  const y0 = bbox.y;
  const x1 = bbox.x + bbox.width;
  const y1 = bbox.y + bbox.height;

  const polygon: DetectionPolygon = {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [[
        [toLon(x0), toLat(y1)],
        [toLon(x1), toLat(y1)],
        [toLon(x1), toLat(y0)],
        [toLon(x0), toLat(y0)],
        [toLon(x0), toLat(y1)],
      ]],
    },
    properties: {},
  };

  return polygon;
}

function floodFillComponents(
  mask: Uint8Array,
  width: number,
  height: number,
): number[][] {
  const visited = new Uint8Array(mask.length);
  const components: number[][] = [];
  const stack: number[] = [];

  const push = (index: number) => {
    if (index < 0 || index >= mask.length) return;
    if (!mask[index] || visited[index]) return;
    visited[index] = 1;
    stack.push(index);
  };

  for (let idx = 0; idx < mask.length; idx += 1) {
    if (!mask[idx] || visited[idx]) continue;
    stack.length = 0;
    visited[idx] = 1;
    stack.push(idx);
    const component: number[] = [];

    while (stack.length) {
      const current = stack.pop()!;
      component.push(current);
      const y = Math.floor(current / width);
      const x = current % width;
      push(current - 1);
      push(current + 1);
      push(current - width);
      push(current + width);
      push(current - width - 1);
      push(current - width + 1);
      push(current + width - 1);
      push(current + width + 1);
    }

    components.push(component);
  }

  return components;
}

function computeIntegralImage(values: Uint8ClampedArray, width: number, height: number): Uint32Array {
  const ii = new Uint32Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0;
    for (let x = 1; x <= width; x += 1) {
      const v = values[(y - 1) * width + (x - 1)];
      rowSum += v;
      ii[y * (width + 1) + x] = ii[(y - 1) * (width + 1) + x] + rowSum;
    }
  }
  return ii;
}

function localMean(ii: Uint32Array, x0: number, y0: number, x1: number, y1: number, widthPlus1: number): number {
  const A = ii[y0 * widthPlus1 + x0];
  const B = ii[y0 * widthPlus1 + x1];
  const C = ii[y1 * widthPlus1 + x0];
  const D = ii[y1 * widthPlus1 + x1];
  return (D - B - C + A) / ((x1 - x0) * (y1 - y0));
}

function adaptiveBinaryMask(values: Uint8ClampedArray, width: number, height: number, window = 64, offset = 10): Uint8Array {
  const mask = new Uint8Array(values.length);
  const ii = computeIntegralImage(values, width, height);
  const wp1 = width + 1;
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - Math.floor(window / 2));
    const y1 = Math.min(height, y0 + window);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - Math.floor(window / 2));
      const x1 = Math.min(width, x0 + window);
      const mean = localMean(ii, x0, y0, x1, y1, wp1);
      mask[y * width + x] = values[y * width + x] >= Math.max(0, mean - offset) ? 1 : 0;
    }
  }
  return mask;
}

export function iou(a: BoundingBox, b: BoundingBox): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);
  const inter = w * h;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

export function nonMaximumSuppression(boxes: DetectionBox[], threshold = 0.3): DetectionBox[] {
  const sorted = boxes.slice().sort((a, b) => b.confidence - a.confidence);
  const keep: DetectionBox[] = [];
  for (const box of sorted) {
    let skip = false;
    for (const k of keep) {
      if (iou(box.bbox, k.bbox) >= threshold) {
        skip = true;
        break;
      }
    }
    if (!skip) keep.push(box);
  }
  return keep;
}

function createBinaryMask(
  data: Uint8ClampedArray,
  threshold: number,
): Uint8Array {
  const mask = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 1) {
    mask[i] = data[i] >= threshold ? 1 : 0;
  }
  return mask;
}

function applyMorphology(
  mask: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const temp = new Uint8Array(mask.length);
  const result = new Uint8Array(mask.length);

  const operate = (
    source: Uint8Array,
    target: Uint8Array,
    operation: "dilate" | "erode",
  ) => {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const idx = y * width + x;
        let value = operation === "dilate" ? 0 : 1;
        for (let dy = -1; dy <= 1; dy += 1) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          let stop = false;
          for (let dx = -1; dx <= 1; dx += 1) {
            const xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            const neighbor = source[yy * width + xx];
            if (operation === "dilate" && neighbor) {
              value = 1;
              stop = true;
              break;
            }
            if (operation === "erode" && !neighbor) {
              value = 0;
              stop = true;
              break;
            }
          }
          if (stop) break;
        }
        target[idx] = value;
      }
    }
  };

  operate(mask, temp, "dilate");
  operate(temp, result, "erode");
  return result;
}

// Zhang-Suen thinning algorithm for skeletonization (returns new mask)
function zhangSuenThin(mask: Uint8Array, width: number, height: number): Uint8Array {
  const img = new Uint8Array(mask); // copy
  let changing = true;
  const idx = (x: number, y: number) => y * width + x;

  const neighborCoords = [
    [-1, -1], [0, -1], [1, -1],
    [1, 0], [1, 1], [0, 1],
    [-1, 1], [-1, 0],
  ];

  const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;

  while (changing) {
    changing = false;
    const toRemove: number[] = [];

    for (let pass = 0; pass < 2; pass += 1) {
      toRemove.length = 0;
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const p = img[idx(x, y)];
          if (!p) continue;
          // count neighbors
          let neighbors = 0;
          const vals: number[] = [];
          for (let k = 0; k < 8; k += 1) {
            const nx = x + neighborCoords[k][0];
            const ny = y + neighborCoords[k][1];
            const v = img[idx(nx, ny)] ? 1 : 0;
            vals.push(v);
            neighbors += v;
          }
          if (neighbors < 2 || neighbors > 6) continue;
          // transitions from 0 to 1
          let transitions = 0;
          for (let k = 0; k < 8; k += 1) {
            if (vals[k] === 0 && vals[(k + 1) % 8] === 1) transitions += 1;
          }
          if (transitions !== 1) continue;
          const p2 = vals[1] && vals[3] && vals[5];
          const p4 = vals[3] && vals[5] && vals[7];
          if (pass === 0) {
            if (p2) continue;
            if (p4) continue;
          } else {
            if (p2) continue;
            if (p4) continue;
          }
          toRemove.push(idx(x, y));
        }
      }
      if (toRemove.length) changing = true;
      toRemove.forEach((i) => { img[i] = 0; });
    }
  }

  return img;
}

// Count skeleton length inside a component mask
function skeletonLength(component: number[], width: number, mask: Uint8Array): number {
  let count = 0;
  for (const idx of component) {
    if (mask[idx]) count += 1;
  }
  return count;
}

function canvasFromBinary(mask: Uint8Array, width: number, height: number, color = [0, 255, 0]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to create canvas context');
  const imageData = ctx.createImageData(width, height);
  for (let i = 0; i < mask.length; i += 1) {
    const v = mask[i] ? 255 : 0;
    const idx = i * 4;
    if (v) {
      imageData.data[idx + 0] = color[0];
      imageData.data[idx + 1] = color[1];
      imageData.data[idx + 2] = color[2];
      imageData.data[idx + 3] = 200;
    } else {
      imageData.data[idx + 0] = 0;
      imageData.data[idx + 1] = 0;
      imageData.data[idx + 2] = 0;
      imageData.data[idx + 3] = 0;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

interface ClassificationMetrics {
  areaPixels: number;
  boundingArea: number;
  fillRatio: number;
  aspectRatio: number;
  majorAxis: number;
  minorAxis: number;
}

function classifyUrbanFeature(metrics: ClassificationMetrics): {
  categoryId: UrbanFeatureCategory;
  notes?: string;
  shapeScore: number;
} {
  const { areaPixels, fillRatio, aspectRatio, majorAxis, minorAxis } = metrics;

  const candidates: Array<{ categoryId: UrbanFeatureCategory; score: number; notes: string }> = [];

  const buildingSize = clamp((areaPixels - 1200) / 7000);
  const buildingDensity = clamp((fillRatio - 0.22) / 0.4);
  const buildingAspect = clamp(1 - Math.abs(aspectRatio - 1.6) / 3);
  const buildingScore = clamp(buildingSize * 0.4 + buildingDensity * 0.4 + buildingAspect * 0.2);
  if (buildingScore > 0.25 && areaPixels >= 1000) {
    candidates.push({
      categoryId: "building",
      score: 0.55 + 0.45 * buildingScore,
      notes: "Dense rectangular scatter consistent with building footprint",
    });
  }

  const bridgeElongation = clamp((aspectRatio - 3.5) / 6.5);
  const bridgeSpan = clamp((majorAxis - 40) / 140);
  const bridgeWidth = clamp(1 - Math.abs(minorAxis - 18) / 28);
  const bridgeDensity = clamp((fillRatio - 0.2) / 0.45);
  const bridgeScore = clamp(bridgeElongation * 0.35 + bridgeSpan * 0.25 + bridgeDensity * 0.25 + bridgeWidth * 0.15);
  if (bridgeScore > 0.25 && majorAxis >= 40 && minorAxis <= 80) {
    candidates.push({
      categoryId: "bridge",
      score: 0.5 + 0.5 * bridgeScore,
      notes: "Linear span with strong return suggests bridge or elevated crossing",
    });
  }

  const wallElongation = clamp((aspectRatio - 6) / 8);
  const wallSlenderness = clamp(1 - (minorAxis - 3) / 22);
  const wallDiffusion = clamp((0.35 - fillRatio) / 0.35);
  const wallScore = clamp(wallElongation * 0.45 + wallSlenderness * 0.35 + wallDiffusion * 0.2);
  if (wallScore > 0.2 && majorAxis >= 35) {
    candidates.push({
      categoryId: "border-wall",
      score: 0.5 + 0.5 * wallScore,
      notes: "Long, narrow scatter consistent with defensive wall or perimeter",
    });
  }

  const riverArea = clamp(areaPixels / 20000);
  const riverDiffuse = clamp((0.3 - fillRatio) / 0.3);
  const riverElongation = clamp((aspectRatio - 2) / 8);
  const riverWidth = clamp((minorAxis - 6) / 40);
  const riverScore = clamp(riverArea * 0.35 + riverDiffuse * 0.35 + riverElongation * 0.2 + riverWidth * 0.1);
  if (riverScore > 0.2 && areaPixels >= 900) {
    candidates.push({
      categoryId: "river",
      score: 0.5 + 0.5 * riverScore,
      notes: "Broad, diffuse return likely from river or drainage channel",
    });
  }

  if (candidates.length) {
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (best) {
      return {
        categoryId: best.categoryId,
        notes: best.notes,
        shapeScore: clamp(best.score),
      };
    }
  }

  const fallbackScore = clamp(clamp(areaPixels / 6000) * 0.5 + clamp(fillRatio / 0.45) * 0.5);
  return {
    categoryId: "urban-feature",
    notes: "Irregular scatter requires analyst confirmation",
    shapeScore: 0.35 + 0.4 * fallbackScore,
  };
}

function buildDetectionBoxes(
  components: number[][],
  mask: Uint8Array,
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: ObjectDetectionOptions,
): DetectionBox[] {
  const boxes: DetectionBox[] = [];
  const thresholdValue = percentile(data, options.thresholdPercentile);

  for (let index = 0; index < components.length; index += 1) {
    const pixels = components[index];
    if (pixels.length < options.minAreaPixels) continue;

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let sum = 0;

    pixels.forEach((idx) => {
      const y = Math.floor(idx / width);
      const x = idx % width;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      sum += data[idx];
    });

    const bbox: BoundingBox = {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    };

    const area = bbox.width * bbox.height;
    if (area < options.minAreaPixels) continue;

    const averageIntensity = sum / pixels.length;
    const baseConfidence = clamp(
      (averageIntensity - thresholdValue) / Math.max(1, 255 - thresholdValue),
    );

    const centroidX = pixels.reduce((acc, idx) => acc + (idx % width), 0) / pixels.length;
    const centroidY = pixels.reduce((acc, idx) => acc + Math.floor(idx / width), 0) / pixels.length;

    const detectionArea = area;
    const fillRatio = pixels.length / Math.max(1, detectionArea);
    const major = Math.max(bbox.width, bbox.height);
    const minor = Math.max(1, Math.min(bbox.width, bbox.height));
    const aspectRatio = major / minor;

    const classification = classifyUrbanFeature({
      areaPixels: pixels.length,
      boundingArea: detectionArea,
      fillRatio,
      aspectRatio,
      majorAxis: major,
      minorAxis: minor,
    });

    // create a local mask for this component to run skeletonization and estimate linearity
    const compMask = new Uint8Array(detectionArea);
    for (let py = 0; py < bbox.height; py += 1) {
      for (let px = 0; px < bbox.width; px += 1) {
        const gx = bbox.x + px;
        const gy = bbox.y + py;
        const i = gy * width + gx;
        compMask[py * bbox.width + px] = mask[i] ? 1 : 0;
      }
    }
    const skel = zhangSuenThin(compMask, bbox.width, bbox.height);
    const sklen = skeletonLength(pixels.map((idx) => (idx - bbox.y * width - bbox.x)), bbox.width, skel) || 0;
    const linearity = clamp(sklen / Math.max(1, pixels.length));

    // if linearity is high, prefer bridge/wall categories
    let adjustedShapeScore = classification.shapeScore;
    let forcedCategory: UrbanFeatureCategory | null = null;
    if (linearity > 0.25 && major >= 20) {
      // elongated and linear: boost bridge/wall
      if (aspectRatio > 3 || major > 50) {
        forcedCategory = "bridge";
        adjustedShapeScore = clamp(Math.max(adjustedShapeScore, 0.6 + linearity * 0.4));
      } else {
        forcedCategory = "border-wall";
        adjustedShapeScore = clamp(Math.max(adjustedShapeScore, 0.55 + linearity * 0.35));
      }
    }

    const confidence = clamp(
      baseConfidence * 0.5 + adjustedShapeScore * 0.5,
    );

    boxes.push({
      id: `det-${boxes.length + 1}`,
  label: CATEGORY_LABELS[forcedCategory ?? classification.categoryId],
  categoryId: forcedCategory ?? classification.categoryId,
      confidence,
      bbox,
      previewBox: { x: 0, y: 0, width: 0, height: 0 },
      areaPixels: pixels.length,
      centroid: { x: centroidX, y: centroidY },
      centroidPreview: { x: 0, y: 0 },
      footprint: null,
      notes: classification.notes,
    });

    if (options.maxDetections && boxes.length >= options.maxDetections) {
      break;
    }
  }

  return boxes;
}

function toFeatureCollection(boxes: DetectionBox[]): DetectionFeatureCollection {
  return {
    type: "FeatureCollection",
    features: boxes
      .map((box) => box.footprint)
      .filter((poly): poly is DetectionPolygon => Boolean(poly)),
  };
}

export async function detectObjects(
  afterFile: File,
  incomingOptions?: Partial<ObjectDetectionOptions>,
): Promise<ObjectDetectionResult> {
  if (typeof window === "undefined") {
    throw new Error("Object detection must run in a browser environment.");
  }

  const options: ObjectDetectionOptions = { ...DEFAULT_OPTIONS, ...(incomingOptions ?? {}) };
  const { data, width, height, bbox, pixelScale } = await readSingleBand(afterFile);

  const normalized = normalize(data);
  const thresholdValue = percentile(normalized, options.thresholdPercentile);
  // Multi-scale detection: run at several scales and merge
  const scaleFactors = [1, 0.5, 0.25];
  const allBoxes: DetectionBox[] = [];
  const perScaleMasks: Record<string, Uint8Array> = {};

  for (const s of scaleFactors) {
    const targetW = Math.max(1, Math.round(width * s));
    const targetH = Math.max(1, Math.round(height * s));
    const scaled = s === 1 ? normalized : resampleNearest(normalized, width, height, targetW, targetH);
    const scaledThreshold = percentile(scaled, options.thresholdPercentile);
    let mask = applyMorphology(createBinaryMask(scaled, scaledThreshold), targetW, targetH);
    perScaleMasks[`scale_${s}`] = mask;
    const comps = floodFillComponents(mask, targetW, targetH);
    const boxesAtScale = buildDetectionBoxes(comps, mask, scaled, targetW, targetH, options).map((b) => {
      // map bbox back to original image coordinates
      const factor = targetW / width; // same for height
      const mapped: DetectionBox = {
        ...b,
        bbox: {
          x: Math.round(b.bbox.x / factor),
          y: Math.round(b.bbox.y / factor),
          width: Math.max(1, Math.round(b.bbox.width / factor)),
          height: Math.max(1, Math.round(b.bbox.height / factor)),
        },
        centroid: {
          x: b.centroid.x / factor,
          y: b.centroid.y / factor,
        },
      };
      return mapped;
    });
    allBoxes.push(...boxesAtScale);
  }

  // primary merged mask (from full scale) used later as binaryMask
  let binaryMask = perScaleMasks['scale_1'] ?? applyMorphology(createBinaryMask(normalized, thresholdValue), width, height);
  // initial merge and NMS across scales
  let boxes = nonMaximumSuppression(allBoxes.map((b, i) => ({ ...b, id: `ms-${i + 1}` })), 0.35);

  // If detections are sparse or clustered near the image top, try adaptive/multi-scale fallback
  const averageY = boxes.length ? boxes.reduce((s, b) => s + b.bbox.y + b.bbox.height / 2, 0) / boxes.length : height;
  // keep references for debug masking
  let altMask: Uint8Array | null = null;
  let localMask: Uint8Array | null = null;

  if (boxes.length < 12 || averageY < height * 0.2) {
    // try a slightly lower percentile run
    const altThreshold = Math.max(0, options.thresholdPercentile - 8);
    const altValue = percentile(normalized, altThreshold);
    altMask = applyMorphology(createBinaryMask(normalized, altValue), width, height);
    const altComponents = floodFillComponents(altMask, width, height);
    const altBoxes = buildDetectionBoxes(altComponents, altMask, normalized, width, height, { ...options, thresholdPercentile: altThreshold });

    // try adaptive local threshold mask (helps with uneven illumination/artifacts)
    localMask = applyMorphology(adaptiveBinaryMask(normalized, width, height, 64, 12), width, height);
    const localComponents = floodFillComponents(localMask, width, height);
    const localBoxes = buildDetectionBoxes(localComponents, localMask, normalized, width, height, options);

    // merge boxes and pick best with NMS
    const merged = [...boxes, ...altBoxes, ...localBoxes];
    // deduplicate by id-free merging: renumber later
    const dedup = merged.map((b, i) => ({ ...b, id: `m-${i + 1}` }));
    boxes = nonMaximumSuppression(dedup, 0.35);
  }

  // create debug mask urls (primary, alt, local, merged union)
  try {
    const debug: Record<string, string> = {};
    const primaryCanvas = canvasFromBinary(binaryMask, width, height, [255, 255, 255]);
    debug.primary = primaryCanvas.toDataURL('image/png');
    // per-scale masks
    for (const key of Object.keys(perScaleMasks)) {
      try {
        const mask = perScaleMasks[key];
        if (!mask) continue;
        // if scale differs from original, we upscale mask for preview
        const parts = key.split("_");
        const s = Number(parts[1] ?? 1);
        if (s === 1) {
          debug[key] = canvasFromBinary(mask, width, height, [200, 200, 200]).toDataURL('image/png');
        } else {
          // upsample nearest to original size for display
          const targetW = width;
          const targetH = height;
          const srcW = Math.max(1, Math.round(width * s));
          const srcH = Math.max(1, Math.round(height * s));
          const clamped = new Uint8ClampedArray(mask.buffer, mask.byteOffset, mask.length);
          const up = resampleNearest(clamped, srcW, srcH, targetW, targetH);
          const upMask = new Uint8Array(up.buffer.slice(0));
          const upCanvas = canvasFromBinary(upMask, targetW, targetH, [150, 150, 255]);
          debug[key] = upCanvas.toDataURL('image/png');
        }
      } catch (e) {
        // noop
      }
    }
    if (altMask) {
      const altCanvas = canvasFromBinary(altMask, width, height, [255, 180, 0]);
      debug.alt = altCanvas.toDataURL('image/png');
    }
    if (localMask) {
      const localCanvas = canvasFromBinary(localMask, width, height, [0, 180, 255]);
      debug.local = localCanvas.toDataURL('image/png');
    }
    // merged mask by union of available masks
    const mergedMask = new Uint8Array(width * height);
    for (let i = 0; i < mergedMask.length; i += 1) {
      mergedMask[i] = binaryMask[i] || (altMask ? altMask[i] : 0) || (localMask ? localMask[i] : 0) ? 1 : 0;
    }
    const mergedCanvas = canvasFromBinary(mergedMask, width, height, [0, 255, 0]);
    debug.merged = mergedCanvas.toDataURL('image/png');

    // attach debug urls to result via closure - will be returned below
    // store to a temp variable in this scope by capturing 'debug'
    (detectObjects as any).__lastDebug = debug;
  } catch (err) {
    // ignore canvas creation errors in non-browser contexts
    (detectObjects as any).__lastDebug = undefined;
  }

  const downscaled = downscale(normalized, width, height, DEFAULT_PREVIEW_EDGE);
  const scaleX = downscaled.width / width;
  const scaleY = downscaled.height / height;

  boxes.forEach((box) => {
    box.previewBox = {
      x: box.bbox.x * scaleX,
      y: box.bbox.y * scaleY,
      width: box.bbox.width * scaleX,
      height: box.bbox.height * scaleY,
    };
    box.centroidPreview = {
      x: box.centroid.x * scaleX,
      y: box.centroid.y * scaleY,
    };
    box.footprint = buildPolygon(box.bbox, bbox, width, height);
    if (box.footprint) {
      box.footprint.properties = {
        id: box.id,
        categoryId: box.categoryId,
        categoryLabel: box.label,
        label: box.label,
        confidence: box.confidence,
        areaPixels: box.areaPixels,
      };
      if (pixelScale) {
        const pixelArea = Math.abs(pixelScale[0] * pixelScale[1]);
        if (Number.isFinite(pixelArea)) {
          box.footprint.properties.area_m2 = box.areaPixels * pixelArea;
        }
      }
    }
  });

  const basePreviewCanvas = canvasFromGray(downscaled.data, downscaled.width, downscaled.height);
  const basePreviewUrl = basePreviewCanvas.toDataURL("image/png");
  const overlayUrl = drawOverlay(downscaled.data, downscaled.width, downscaled.height, boxes);

  const featureCollection = toFeatureCollection(boxes);

  const stats: DetectionStatistics = {
    totalDetections: boxes.length,
    threshold: options.thresholdPercentile,
    minimumArea: options.minAreaPixels,
    averageConfidence: boxes.length
      ? boxes.reduce((acc, box) => acc + box.confidence, 0) / boxes.length
      : 0,
  };

  return {
    thresholdValue,
    width,
    height,
    previewWidth: downscaled.width,
    previewHeight: downscaled.height,
    basePreviewUrl,
    overlayUrl,
    boxes,
    stats,
    featureCollection,
    bounds: bbox,
    pixelScale,
  };
}



