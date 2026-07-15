import type { BoundingBox } from "./types";
import { getLuminance } from "./flood-fill";

const WHITE_THRESHOLD = 245;
const COLOR_TOLERANCE = 40;
const SIZE_SIMILARITY_THRESHOLD = 0.01;
const MIN_WATERMARK_AREA_RATIO = 0.01;

function colorMatch(
  data: Uint8ClampedArray,
  idx: number,
  tr: number,
  tg: number,
  tb: number,
  tolerance: number,
): boolean {
  const a = data[idx + 3] / 255;
  const r = data[idx] * a + 255 * (1 - a);
  const g = data[idx + 1] * a + 255 * (1 - a);
  const b = data[idx + 2] * a + 255 * (1 - a);
  return (
    Math.abs(r - tr) <= tolerance && Math.abs(g - tg) <= tolerance && Math.abs(b - tb) <= tolerance
  );
}

export function floodFillRegion(
  data: Uint8ClampedArray,
  imgWidth: number,
  imgHeight: number,
  startX: number,
  startY: number,
  tolerance: number,
): BoundingBox | null {
  if (startX < 0 || startX >= imgWidth || startY < 0 || startY >= imgHeight) return null;

  const startIdx = (startY * imgWidth + startX) * 4;
  if (getLuminance(data, startIdx) > WHITE_THRESHOLD) return null;

  const tr = data[startIdx];
  const tg = data[startIdx + 1];
  const tb = data[startIdx + 2];

  const visited = new Uint8Array(imgWidth * imgHeight);
  const queue: number[] = [startY * imgWidth + startX];
  visited[queue[0]] = 1;

  let minX = startX;
  let maxX = startX;
  let minY = startY;
  let maxY = startY;

  while (queue.length > 0) {
    const pos = queue.pop()!;
    const px = pos % imgWidth;
    const py = (pos - px) / imgWidth;

    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;

    const neighbors = [
      [px - 1, py],
      [px + 1, py],
      [px, py - 1],
      [px, py + 1],
    ];

    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= imgWidth || ny < 0 || ny >= imgHeight) continue;
      const nPos = ny * imgWidth + nx;
      if (visited[nPos]) continue;
      visited[nPos] = 1;

      if (colorMatch(data, nPos * 4, tr, tg, tb, tolerance)) {
        queue.push(nPos);
      }
    }
  }

  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function findBackgroundColor(
  data: Uint8ClampedArray,
  imgWidth: number,
  imgHeight: number,
): { r: number; g: number; b: number } {
  const samples: { r: number; g: number; b: number }[] = [];

  for (let x = 0; x < imgWidth; x += 10) {
    const idx = x * 4;
    const lum = getLuminance(data, idx);
    if (lum > WHITE_THRESHOLD) {
      samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  }

  for (let x = 0; x < imgWidth; x += 10) {
    const idx = ((imgHeight - 1) * imgWidth + x) * 4;
    const lum = getLuminance(data, idx);
    if (lum > WHITE_THRESHOLD) {
      samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  }

  for (let y = 0; y < imgHeight; y += 10) {
    const idx = y * imgWidth * 4;
    const lum = getLuminance(data, idx);
    if (lum > WHITE_THRESHOLD) {
      samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  }

  for (let y = 0; y < imgHeight; y += 10) {
    const idx = (y * imgWidth + imgWidth - 1) * 4;
    const lum = getLuminance(data, idx);
    if (lum > WHITE_THRESHOLD) {
      samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  }

  if (samples.length === 0) return { r: 255, g: 255, b: 255 };

  const avgR = samples.reduce((s, c) => s + c.r, 0) / samples.length;
  const avgG = samples.reduce((s, c) => s + c.g, 0) / samples.length;
  const avgB = samples.reduce((s, c) => s + c.b, 0) / samples.length;

  return { r: Math.round(avgR), g: Math.round(avgG), b: Math.round(avgB) };
}

interface Component {
  bounds: BoundingBox;
  pixelCount: number;
}

function findComponents(
  data: Uint8ClampedArray,
  imgWidth: number,
  imgHeight: number,
  bg: { r: number; g: number; b: number },
  step: number,
): Component[] {
  const visited = new Uint8Array(imgWidth * imgHeight);
  const components: Component[] = [];

  for (let y = 0; y < imgHeight; y += step) {
    for (let x = 0; x < imgWidth; x += step) {
      const pos = y * imgWidth + x;
      if (visited[pos]) continue;

      const idx = pos * 4;
      const lum = getLuminance(data, idx);
      if (lum > WHITE_THRESHOLD) continue;

      if (colorMatch(data, idx, bg.r, bg.g, bg.b, COLOR_TOLERANCE)) continue;

      const queue = [pos];
      visited[pos] = 1;

      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let count = 0;

      while (queue.length > 0) {
        const p = queue.pop()!;
        const px = p % imgWidth;
        const py = (p - px) / imgWidth;
        count++;

        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;

        for (const [nx, ny] of [
          [px - 1, py],
          [px + 1, py],
          [px, py - 1],
          [px, py + 1],
        ]) {
          if (nx < 0 || nx >= imgWidth || ny < 0 || ny >= imgHeight) continue;
          const nPos = ny * imgWidth + nx;
          if (visited[nPos]) continue;
          visited[nPos] = 1;

          const nIdx = nPos * 4;
          const nLum = getLuminance(data, nIdx);
          if (nLum > WHITE_THRESHOLD) continue;
          if (colorMatch(data, nIdx, bg.r, bg.g, bg.b, COLOR_TOLERANCE)) continue;

          queue.push(nPos);
        }
      }

      components.push({
        bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
        pixelCount: count,
      });
    }
  }

  return components;
}

interface ComponentCluster {
  components: Component[];
  combinedPixelCount: number;
}

function boxDistance(a: BoundingBox, b: BoundingBox): number {
  const ax1 = a.x;
  const ax2 = a.x + a.width;
  const ay1 = a.y;
  const ay2 = a.y + a.height;
  const bx1 = b.x;
  const bx2 = b.x + b.width;
  const by1 = b.y;
  const by2 = b.y + b.height;
  const dx = Math.max(0, bx1 - ax2, ax1 - bx2);
  const dy = Math.max(0, by1 - ay2, ay1 - by2);
  return Math.sqrt(dx * dx + dy * dy);
}

function areasSimilar(a: Component, b: Component): boolean {
  const areaA = a.bounds.width * a.bounds.height;
  const areaB = b.bounds.width * b.bounds.height;
  if (areaA === 0 && areaB === 0) return true;
  const maxArea = Math.max(areaA, areaB);
  return Math.abs(areaA - areaB) / maxArea <= SIZE_SIMILARITY_THRESHOLD;
}

function clusterComponents(components: Component[], imgWidth: number): ComponentCluster[] {
  const n = components.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }

  function union(i: number, j: number) {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  }

  const proximityThreshold = imgWidth * 0.02;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!areasSimilar(components[i], components[j])) continue;
      if (boxDistance(components[i].bounds, components[j].bounds) <= proximityThreshold) {
        union(i, j);
      }
    }
  }

  const clusterMap = new Map<number, Component[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!clusterMap.has(root)) clusterMap.set(root, []);
    clusterMap.get(root)!.push(components[i]);
  }

  return Array.from(clusterMap.values()).map((comps) => ({
    components: comps,
    combinedPixelCount: comps.reduce((s, c) => s + c.pixelCount, 0),
  }));
}

export function detectWatermarkRegion(
  data: Uint8ClampedArray,
  imgWidth: number,
  imgHeight: number,
): BoundingBox | null {
  const totalPixels = imgWidth * imgHeight;
  const bg = findBackgroundColor(data, imgWidth, imgHeight);
  const components = findComponents(data, imgWidth, imgHeight, bg, 2);

  if (components.length === 0) return null;

  const clusters = clusterComponents(components, imgWidth);

  if (clusters.length === 0) return null;

  clusters.sort((a, b) => b.combinedPixelCount - a.combinedPixelCount);
  const cardBlockCluster = clusters[0];

  const cardComponentSet = new Set(cardBlockCluster.components);
  const watermarkComponents = components.filter(
    (c) => !cardComponentSet.has(c) && c.pixelCount >= totalPixels * MIN_WATERMARK_AREA_RATIO,
  );

  if (watermarkComponents.length === 0) return null;

  watermarkComponents.sort((a, b) => b.pixelCount - a.pixelCount);
  return watermarkComponents[0].bounds;
}
