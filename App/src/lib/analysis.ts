import { fromArrayBuffer } from "geotiff";

export interface TiffReadResult {
  width: number;
  height: number;
  data: Float32Array;
  bbox?: [number, number, number, number];
  pixelScale?: [number, number];
}

export interface PostProcessOptions {
  openingRadius: number;
  closingRadius: number;
  fillHoles: boolean;
  minBlobArea: number;
}

export interface ChangeDetectionOptions {
  algorithm: "otsu" | "kmeans" | "adaptive" | "isolation_forest" | "lof" | "pca";
  kmeansClusters?: number;
  kmeansIterations?: number;
  contamination?: number;
  isolationTrees?: number;
  otsuManualThreshold?: number;
  speckleFilter?: "none" | "lee" | "kuan" | "frost";
  speckleSize?: number;
  postProcess: PostProcessOptions;
}

export interface ChangeDetectionPreview {
  width: number;
  height: number;
  beforePreviewUrl: string;
  afterPreviewUrl: string;
  diffHeatmapUrl: string;
  overlayUrl: string;
  maskPreviewUrl: string;
}

export interface ChangeDetectionResult {
  preview: ChangeDetectionPreview;
  mask: Uint8Array;
  diff: Uint8ClampedArray;
  changedPixels: number;
  changePercentage: number;
  changeAreaKm2?: number | null;
  bounds?: [number, number, number, number];
  originalWidth: number;
  originalHeight: number;
}

const DEFAULT_PREVIEW_MAX_EDGE = 1200;

export async function readSingleBand(file: File): Promise<TiffReadResult> {
  const buffer = await file.arrayBuffer();
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const raster = (await image.readRasters({ samples: [0], interleave: true })) as
    | Float32Array
    | Uint8Array
    | Int16Array
    | Uint16Array
    | Float64Array;

  const width = image.getWidth();
  const height = image.getHeight();
  const bbox = typeof image.getBoundingBox === "function" ? (image.getBoundingBox() as [number, number, number, number]) : undefined;
  const fileDirectory: any = image.fileDirectory ?? {};
  const scaleArray = Array.isArray(fileDirectory.ModelPixelScale) ? fileDirectory.ModelPixelScale : undefined;
  const scale = scaleArray && scaleArray.length >= 2 ? [Number(scaleArray[0]), Number(scaleArray[1])] as [number, number] : undefined;

  let data: Float32Array;
  if (raster instanceof Float32Array) {
    data = raster;
  } else if (raster instanceof Float64Array) {
    data = Float32Array.from(raster as Float64Array);
  } else {
    data = Float32Array.from(raster as Uint8Array | Uint16Array | Int16Array);
  }

  return { width, height, data, bbox, pixelScale: scale };
}

function percentile(values: Float32Array, p: number): number {
  const arr = Array.from(values).filter((v) => Number.isFinite(v));
  if (!arr.length) return 0;
  arr.sort((a, b) => a - b);
  const idx = Math.min(arr.length - 1, Math.max(0, Math.round((p / 100) * (arr.length - 1))));
  return arr[idx];
}

function normalizeToUint8(values: Float32Array): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(values.length);
  const p2 = percentile(values, 2);
  const p98 = percentile(values, 98);
  const range = Math.max(1e-6, p98 - p2);
  for (let i = 0; i < values.length; i += 1) {
    const v = ((values[i] - p2) / range) * 255;
    dst[i] = Number.isFinite(v) ? Math.min(255, Math.max(0, Math.round(v))) : 0;
  }
  return dst;
}

function resampleFloat32Nearest(
  data: Float32Array,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): Float32Array {
  if (srcWidth === dstWidth && srcHeight === dstHeight) {
    return new Float32Array(data);
  }
  const dst = new Float32Array(dstWidth * dstHeight);
  const xRatio = srcWidth / dstWidth;
  const yRatio = srcHeight / dstHeight;

  for (let y = 0; y < dstHeight; y += 1) {
    const srcY = Math.min(srcHeight - 1, Math.round((y + 0.5) * yRatio - 0.5));
    for (let x = 0; x < dstWidth; x += 1) {
      const srcX = Math.min(srcWidth - 1, Math.round((x + 0.5) * xRatio - 0.5));
      dst[y * dstWidth + x] = data[srcY * srcWidth + srcX];
    }
  }

  return dst;
}

function downscaleGray(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  maxEdge: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  if (Math.max(width, height) <= maxEdge) {
    return { data: src, width, height };
  }
  const scale = maxEdge / Math.max(width, height);
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const dst = new Uint8ClampedArray(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const srcY = Math.min(height - 1, Math.round((y / targetHeight) * height));
    for (let x = 0; x < targetWidth; x += 1) {
      const srcX = Math.min(width - 1, Math.round((x / targetWidth) * width));
      dst[y * targetWidth + x] = src[srcY * width + srcX];
    }
  }
  return { data: dst, width: targetWidth, height: targetHeight };
}

function ensureDocument(): void {
  if (typeof document === "undefined") {
    throw new Error("Document context is not available. Run this analysis in a browser environment.");
  }
}

function canvasFromGray(data: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
  ensureDocument();
  ensureDocument();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable");
  const imageData = ctx.createImageData(width, height);
  for (let i = 0; i < data.length; i += 1) {
    const v = data[i];
    const idx = i * 4;
    imageData.data[idx + 0] = v;
    imageData.data[idx + 1] = v;
    imageData.data[idx + 2] = v;
    imageData.data[idx + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function canvasFromRGBA(data: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
  ensureDocument();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable");
  const imageData = new ImageData(data, width, height);
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function createHeatmap(data: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 1) {
    const value = data[i] / 255;
    const idx = i * 4;
    const r = Math.min(255, Math.max(0, value * 255));
    const g = Math.min(255, Math.max(0, Math.pow(value, 0.8) * 200));
    const b = Math.min(255, Math.max(0, (1 - value) * 120));
    out[idx + 0] = r;
    out[idx + 1] = g;
    out[idx + 2] = b;
    out[idx + 3] = 230;
  }
  return out;
}

function overlayMask(
  baseGray: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number,
  color: [number, number, number] = [255, 64, 64],
  alpha: number = 0.6,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < mask.length; i += 1) {
    const idx = i * 4;
    const v = baseGray[i];
    if (mask[i]) {
      out[idx + 0] = Math.round(color[0] * alpha + v * (1 - alpha));
      out[idx + 1] = Math.round(color[1] * alpha + v * (1 - alpha));
      out[idx + 2] = Math.round(color[2] * alpha + v * (1 - alpha));
      out[idx + 3] = 255;
    } else {
      out[idx + 0] = v;
      out[idx + 1] = v;
      out[idx + 2] = v;
      out[idx + 3] = 255;
    }
  }
  return out;
}

function absoluteDifference(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i += 1) {
    out[i] = Math.abs((b[i] ?? 0) - (a[i] ?? 0));
  }
  return out;
}

function otsuThreshold(values: Uint8ClampedArray): number {
  const histogram = new Array(256).fill(0);
  values.forEach((v) => {
    histogram[v] += 1;
  });
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i];
  let sumB = 0;
  let wB = 0;
  let varMax = 0;
  let threshold = 0;
  for (let i = 0; i < 256; i += 1) {
    wB += histogram[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * histogram[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) * (mB - mF);
    if (variance > varMax) {
      varMax = variance;
      threshold = i;
    }
  }
  return threshold;
}

function kmeans1D(
  values: Uint8ClampedArray,
  clusters: number,
  iterations: number,
): { centers: number[]; labels: Uint8Array } {
  const n = values.length;
  const centers: number[] = [];
  const labels = new Uint8Array(n);
  const step = Math.max(1, Math.floor(n / clusters));
  for (let i = 0; i < clusters; i += 1) {
    centers.push(values[Math.min(n - 1, i * step)]);
  }
  for (let iter = 0; iter < iterations; iter += 1) {
    for (let i = 0; i < n; i += 1) {
      let minDist = Number.POSITIVE_INFINITY;
      let idx = 0;
      for (let c = 0; c < centers.length; c += 1) {
        const dist = Math.abs(values[i] - centers[c]);
        if (dist < minDist) {
          minDist = dist;
          idx = c;
        }
      }
      labels[i] = idx;
    }
    const sums = new Array(centers.length).fill(0);
    const counts = new Array(centers.length).fill(0);
    for (let i = 0; i < n; i += 1) {
      const label = labels[i];
      sums[label] += values[i];
      counts[label] += 1;
    }
    for (let c = 0; c < centers.length; c += 1) {
      centers[c] = counts[c] ? sums[c] / counts[c] : centers[c];
    }
  }
  return { centers, labels };
}

function localAverage(values: Uint8ClampedArray, width: number, height: number, radius: number): Float32Array {
  const out = new Float32Array(values.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          sum += values[yy * width + xx];
          count += 1;
        }
      }
      out[y * width + x] = count ? sum / count : values[y * width + x];
    }
  }
  return out;
}

function computeMask(
  diff: Uint8ClampedArray,
  width: number,
  height: number,
  options: ChangeDetectionOptions,
): Uint8Array {
  const mask = new Uint8Array(diff.length);
  const contamination = Math.min(0.5, Math.max(0.0005, options.contamination ?? 0.01));

  if (options.algorithm === "otsu") {
    const manual = options.otsuManualThreshold;
    const threshold = manual !== undefined ? Math.round(manual * 255) : otsuThreshold(diff);
    for (let i = 0; i < diff.length; i += 1) {
      mask[i] = diff[i] > threshold ? 1 : 0;
    }
    return mask;
  }

  if (options.algorithm === "adaptive") {
    const local = localAverage(diff, width, height, 3);
    for (let i = 0; i < diff.length; i += 1) {
      mask[i] = diff[i] > local[i] + 8 ? 1 : 0;
    }
    return mask;
  }

  if (options.algorithm === "kmeans") {
    const clusters = Math.max(2, options.kmeansClusters ?? 2);
    const iterations = Math.max(1, options.kmeansIterations ?? 6);
    const { centers, labels } = kmeans1D(diff, clusters, iterations);
    const sorted = centers.map((value, idx) => ({ value, idx })).sort((a, b) => a.value - b.value);
    const changeCluster = sorted[sorted.length - 1].idx;
    for (let i = 0; i < diff.length; i += 1) {
      mask[i] = labels[i] === changeCluster ? 1 : 0;
    }
    return mask;
  }

  if (options.algorithm === "isolation_forest") {
    const sorted = Array.from(diff).sort((a, b) => a - b);
    const threshold = sorted[Math.max(0, Math.min(sorted.length - 1, Math.round(sorted.length * (1 - contamination))))];
    for (let i = 0; i < diff.length; i += 1) {
      mask[i] = diff[i] >= threshold ? 1 : 0;
    }
    return mask;
  }

  if (options.algorithm === "lof") {
    const local = localAverage(diff, width, height, 2);
    for (let i = 0; i < diff.length; i += 1) {
      const score = diff[i] - local[i];
      mask[i] = score > 12 ? 1 : 0;
    }
    return mask;
  }

  if (options.algorithm === "pca") {
    let mean = 0;
    diff.forEach((v) => {
      mean += v;
    });
    mean /= diff.length;
    let variance = 0;
    diff.forEach((v) => {
      variance += (v - mean) ** 2;
    });
    variance /= diff.length;
    const std = Math.max(Math.sqrt(variance), 1e-6);
    const scores = Array.from(diff, (value) => Math.abs((value - mean) / std));
    const sorted = [...scores].sort((a, b) => a - b);
    const threshold = sorted[Math.max(0, Math.min(sorted.length - 1, Math.round(sorted.length * (1 - contamination))))];
    for (let i = 0; i < diff.length; i += 1) {
      mask[i] = scores[i] >= threshold ? 1 : 0;
    }
    return mask;
  }

  return mask;
}

function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return new Uint8Array(mask);
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let val = 0;
      for (let dy = -radius; dy <= radius && val === 0; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          if (mask[yy * width + xx]) {
            val = 1;
            break;
          }
        }
      }
      out[y * width + x] = val;
    }
  }
  return out;
}

function erode(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return new Uint8Array(mask);
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let val = 1;
      for (let dy = -radius; dy <= radius && val === 1; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          if (!mask[yy * width + xx]) {
            val = 0;
            break;
          }
        }
      }
      out[y * width + x] = val;
    }
  }
  return out;
}

function removeSmallComponents(mask: Uint8Array, width: number, height: number, minArea: number): Uint8Array {
  if (minArea <= 1) return mask;
  const out = new Uint8Array(mask);
  const visited = new Uint8Array(mask.length);
  const queue: number[] = [];
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i] || visited[i]) continue;
    queue.length = 0;
    queue.push(i);
    visited[i] = 1;
    const component: number[] = [];
    while (queue.length) {
      const idx = queue.pop()!;
      component.push(idx);
      const y = Math.floor(idx / width);
      const x = idx % width;
      const neighbours = [idx - 1, idx + 1, idx - width, idx + width];
      for (const n of neighbours) {
        if (n < 0 || n >= mask.length) continue;
        if (!mask[n] || visited[n]) continue;
        const ny = Math.floor(n / width);
        const nx = n % width;
        if (Math.abs(nx - x) + Math.abs(ny - y) > 1) continue;
        visited[n] = 1;
        queue.push(n);
      }
    }
    if (component.length < minArea) {
      component.forEach((idx) => {
        out[idx] = 0;
      });
    }
  }
  return out;
}

function fillHoles(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask);
  const visited = new Uint8Array(mask.length);
  const queue: number[] = [];

  const pushIfBackground = (idx: number) => {
    if (idx < 0 || idx >= out.length) return;
    if (out[idx] || visited[idx]) return;
    visited[idx] = 1;
    queue.push(idx);
  };

  for (let x = 0; x < width; x += 1) {
    pushIfBackground(x);
    pushIfBackground((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    pushIfBackground(y * width);
    pushIfBackground(y * width + (width - 1));
  }

  while (queue.length) {
    const idx = queue.pop()!;
    const y = Math.floor(idx / width);
    const x = idx % width;
    const neighbours = [idx - 1, idx + 1, idx - width, idx + width];
    for (const n of neighbours) {
      if (n < 0 || n >= out.length) continue;
      const ny = Math.floor(n / width);
      const nx = n % width;
      if (Math.abs(nx - x) + Math.abs(ny - y) > 1) continue;
      pushIfBackground(n);
    }
  }

  for (let i = 0; i < out.length; i += 1) {
    if (!out[i] && !visited[i]) {
      out[i] = 1;
    }
  }
  return out;
}

function postProcessMask(mask: Uint8Array, width: number, height: number, options: PostProcessOptions): Uint8Array {
  let out = new Uint8Array(mask);
  if (options.openingRadius > 0) {
    out = dilate(erode(out, width, height, options.openingRadius), width, height, options.openingRadius);
  }
  if (options.closingRadius > 0) {
    out = erode(dilate(out, width, height, options.closingRadius), width, height, options.closingRadius);
  }
  if (options.fillHoles) {
    out = fillHoles(out, width, height);
  }
  if (options.minBlobArea > 1) {
    out = removeSmallComponents(out, width, height, options.minBlobArea);
  }
  return out;
}

function applySpeckleFilter(
  values: Float32Array,
  width: number,
  height: number,
  filter: "none" | "lee" | "kuan" | "frost" = "none",
  size: number = 3,
): Float32Array {
  if (filter === "none" || size <= 1) {
    return new Float32Array(values);
  }
  const radius = Math.max(1, Math.floor(size / 2));
  const meanCache = new Float32Array(values.length);
  const varCache = new Float32Array(values.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let sumSq = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const value = values[yy * width + xx];
          sum += value;
          sumSq += value * value;
          count += 1;
        }
      }
      const idx = y * width + x;
      meanCache[idx] = count ? sum / count : values[idx];
      varCache[idx] = Math.max(0, count ? sumSq / count - meanCache[idx] ** 2 : 0);
    }
  }

  const overallMean = values.reduce((acc, val) => acc + val, 0) / values.length;
  let overallVar = 0;
  values.forEach((val) => {
    overallVar += (val - overallMean) ** 2;
  });
  overallVar /= values.length;

  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    const mean = meanCache[i];
    const variance = varCache[i];
    if (filter === "lee") {
      const w = variance / (variance + overallVar + 1e-6);
      out[i] = mean + w * (value - mean);
    } else if (filter === "kuan") {
      const enl = 4;
      const ci2 = variance / Math.max(mean * mean, 1e-6);
      const sigmaS2 = 1 / enl;
      const w = Math.max(0, Math.min(1, 1 - sigmaS2 / Math.max(ci2, 1e-6)));
      out[i] = mean + w * (value - mean);
    } else if (filter === "frost") {
      const damping = 2.0;
      const coeff = Math.exp((-damping * variance) / Math.max(overallVar, 1e-6));
      out[i] = coeff * mean + (1 - coeff) * value;
    } else {
      out[i] = value;
    }
  }
  return out;
}

export async function analyzeChange(
  beforeFile: File,
  afterFile: File,
  options: ChangeDetectionOptions,
): Promise<ChangeDetectionResult> {
  const before = await readSingleBand(beforeFile);
  const after = await readSingleBand(afterFile);

  const targetWidth = after.width;
  const targetHeight = after.height;
  const beforeWidth = before.width;
  const beforeHeight = before.height;

  const alignedBefore = (beforeWidth === targetWidth && beforeHeight === targetHeight)
    ? new Float32Array(before.data)
    : resampleFloat32Nearest(before.data, beforeWidth, beforeHeight, targetWidth, targetHeight);

  const alignedAfter = new Float32Array(after.data);

  const width = targetWidth;
  const height = targetHeight;

  const filteredBefore = applySpeckleFilter(alignedBefore, width, height, options.speckleFilter ?? "none", options.speckleSize ?? 3);
  const filteredAfter = applySpeckleFilter(alignedAfter, width, height, options.speckleFilter ?? "none", options.speckleSize ?? 3);

  const diff = absoluteDifference(filteredBefore, filteredAfter);
  const beforeDisplay = normalizeToUint8(filteredBefore);
  const afterDisplay = normalizeToUint8(filteredAfter);
  const diffDisplay = normalizeToUint8(diff);

  const rawMask = computeMask(diffDisplay, width, height, options);
  const processedMask = postProcessMask(rawMask, width, height, options.postProcess);

  const changedPixels = processedMask.reduce((acc, value) => acc + (value ? 1 : 0), 0);
  const changePercentage = (changedPixels / (width * height)) * 100;

  let changeAreaKm2: number | null = null;
  const pixelScale = after.pixelScale ?? before.pixelScale;
  if (pixelScale) {
    const pixelArea = Math.abs(pixelScale[0] * pixelScale[1]);
    if (Number.isFinite(pixelArea) && pixelArea > 0) {
      changeAreaKm2 = (changedPixels * pixelArea) / 1e6;
    }
  }

  const beforePreview = downscaleGray(beforeDisplay, width, height, DEFAULT_PREVIEW_MAX_EDGE);
  const afterPreview = downscaleGray(afterDisplay, width, height, DEFAULT_PREVIEW_MAX_EDGE);
  const diffPreview = downscaleGray(diffDisplay, width, height, DEFAULT_PREVIEW_MAX_EDGE);

  const maskPreviewDown = downscaleMask(processedMask, width, height, afterPreview.width, afterPreview.height);
  const heatmap = createHeatmap(diffPreview.data, diffPreview.width, diffPreview.height);
  const overlay = overlayMask(afterPreview.data, maskPreviewDown, afterPreview.width, afterPreview.height);
  const maskPreviewRgba = createMaskPreview(maskPreviewDown, afterPreview.width, afterPreview.height);
  const bounds = after.bbox ?? before.bbox ?? null;

  const preview: ChangeDetectionPreview = {
    width: afterPreview.width,
    height: afterPreview.height,
    beforePreviewUrl: canvasFromGray(beforePreview.data, beforePreview.width, beforePreview.height).toDataURL("image/png"),
    afterPreviewUrl: canvasFromGray(afterPreview.data, afterPreview.width, afterPreview.height).toDataURL("image/png"),
    diffHeatmapUrl: canvasFromRGBA(heatmap, diffPreview.width, diffPreview.height).toDataURL("image/png"),
    overlayUrl: canvasFromRGBA(overlay, afterPreview.width, afterPreview.height).toDataURL("image/png"),
    maskPreviewUrl: canvasFromRGBA(maskPreviewRgba, afterPreview.width, afterPreview.height).toDataURL("image/png"),
  };

  return {
    preview,
    mask: processedMask,
    diff: diffDisplay,
    changedPixels,
    changePercentage,
    changeAreaKm2,
    bounds: bounds ? [bounds[0], bounds[1], bounds[2], bounds[3]] : undefined,
    originalWidth: width,
    originalHeight: height,
  };
}

function downscaleMask(
  mask: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  targetWidth: number,
  targetHeight: number,
): Uint8Array {
  const out = new Uint8Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const srcY0 = Math.floor((y / targetHeight) * srcHeight);
    const srcY1 = Math.min(srcHeight - 1, Math.floor(((y + 1) / targetHeight) * srcHeight));
    for (let x = 0; x < targetWidth; x += 1) {
      const srcX0 = Math.floor((x / targetWidth) * srcWidth);
      const srcX1 = Math.min(srcWidth - 1, Math.floor(((x + 1) / targetWidth) * srcWidth));
      let count = 0;
      let total = 0;
      for (let yy = srcY0; yy <= srcY1; yy += 1) {
        for (let xx = srcX0; xx <= srcX1; xx += 1) {
          total += mask[yy * srcWidth + xx] ? 1 : 0;
          count += 1;
        }
      }
      out[y * targetWidth + x] = total > count / 2 ? 1 : 0;
    }
  }
  return out;
}

function createMaskPreview(mask: Uint8Array, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < mask.length; i += 1) {
    const idx = i * 4;
    out[idx + 0] = mask[i] ? 255 : 0;
    out[idx + 1] = mask[i] ? 80 : 0;
    out[idx + 2] = mask[i] ? 80 : 0;
    out[idx + 3] = mask[i] ? 160 : 0;
  }
  return out;
}
