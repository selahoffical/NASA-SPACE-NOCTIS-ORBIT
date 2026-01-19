import { fromArrayBuffer } from 'geotiff';

export interface TifData {
  data: Float32Array | Uint8Array;
  width: number;
  height: number;
  bounds?: [number, number, number, number];
  transform?: any;
}

export async function readTifFile(file: File): Promise<TifData> {
  const arrayBuffer = await file.arrayBuffer();
  const tiff = await fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();
  const data = await image.readRasters();
  
  const width = image.getWidth();
  const height = image.getHeight();
  
  // Get geospatial metadata
  const bbox = image.getBoundingBox();
  const bounds = bbox ? [bbox[0], bbox[1], bbox[2], bbox[3]] as [number, number, number, number] : undefined;
  
  return {
    data: data[0] as Float32Array | Uint8Array,
    width,
    height,
    bounds,
  };
}

export function convertToUint8(data: Float32Array | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) return data;
  
  // Convert float data to uint8 with percentile stretching
  const validData = Array.from(data).filter(v => isFinite(v) && v > 0);
  if (validData.length === 0) return new Uint8Array(data.length);
  
  validData.sort((a, b) => a - b);
  const p2 = validData[Math.floor(validData.length * 0.02)];
  const p98 = validData[Math.floor(validData.length * 0.98)];
  
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const val = data[i];
    if (!isFinite(val) || val <= 0) {
      result[i] = 0;
    } else {
      const normalized = Math.max(0, Math.min(1, (val - p2) / (p98 - p2)));
      result[i] = Math.round(normalized * 255);
    }
  }
  return result;
}

export function computeDifference(before: Uint8Array, after: Uint8Array): Uint8Array {
  const diff = new Uint8Array(before.length);
  for (let i = 0; i < before.length; i++) {
    diff[i] = Math.abs(after[i] - before[i]);
  }
  return diff;
}

export function otsuThreshold(data: Uint8Array): number {
  const histogram = new Array(256).fill(0);
  for (let i = 0; i < data.length; i++) {
    histogram[data[i]]++;
  }
  
  const total = data.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    sum += i * histogram[i];
  }
  
  let sumB = 0;
  let wB = 0;
  let wF = 0;
  let maxVariance = 0;
  let threshold = 0;
  
  for (let i = 0; i < 256; i++) {
    wB += histogram[i];
    if (wB === 0) continue;
    
    wF = total - wB;
    if (wF === 0) break;
    
    sumB += i * histogram[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    
    const variance = wB * wF * (mB - mF) * (mB - mF);
    
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = i;
    }
  }
  
  return threshold;
}

export function applyOtsuThreshold(diff: Uint8Array): Uint8Array {
  const threshold = otsuThreshold(diff);
  const mask = new Uint8Array(diff.length);
  for (let i = 0; i < diff.length; i++) {
    mask[i] = diff[i] > threshold ? 255 : 0;
  }
  return mask;
}

export function createImageDataUrl(data: Uint8Array, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  
  const imageData = ctx.createImageData(width, height);
  for (let i = 0; i < data.length; i++) {
    const idx = i * 4;
    imageData.data[idx] = data[i];
    imageData.data[idx + 1] = data[i];
    imageData.data[idx + 2] = data[i];
    imageData.data[idx + 3] = 255;
  }
  
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

export function createColorMaskDataUrl(mask: Uint8Array, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  
  const imageData = ctx.createImageData(width, height);
  for (let i = 0; i < mask.length; i++) {
    const idx = i * 4;
    if (mask[i] > 0) {
      imageData.data[idx] = 255;     // Red
      imageData.data[idx + 1] = 0;
      imageData.data[idx + 2] = 0;
      imageData.data[idx + 3] = 180; // Semi-transparent
    } else {
      imageData.data[idx + 3] = 0;   // Transparent
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}
