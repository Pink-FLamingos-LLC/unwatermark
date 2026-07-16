import type { BoundingBox, WatermarkDetectionConfig } from "./types";
import { getLuminance } from "./flood-fill";

const WHITE_THRESHOLD = 245;
const COLOR_TOLERANCE = 40;
const SIZE_SIMILARITY_THRESHOLD = 0.01;

const DEFAULT_CARD_PROXIMITY_FACTOR = 0.04;
const DEFAULT_WM_PROXIMITY_FACTOR = 0.04;
const DEFAULT_MIN_WATERMARK_AREA_RATIO = 0.001;

export interface ComponentDebug {
  index: number;
  bounds: BoundingBox;
  pixelCount: number;
  area: number;
  isCardBlock: boolean;
  isWatermarkCandidate: boolean;
}

export interface DetectionDebug {
  componentsFound: number;
  clustersFound: number;
  cardBlockPixels: number;
  cardBlockComponents: number;
  watermarkCandidates: number;
  selectedWatermarkPixels: number;
  totalPixels: number;
  proximityThreshold: number;
  samplingStep: number;
  cardProximityFactor?: number;
  wmProximityFactor?: number;
  minWatermarkAreaRatio?: number;
  components?: ComponentDebug[];
}

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

export interface Component {
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

function clusterComponents(
  components: Component[],
  imgWidth: number,
  proximityFactor: number = DEFAULT_CARD_PROXIMITY_FACTOR,
): ComponentCluster[] {
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

  const proximityThreshold = imgWidth * proximityFactor;

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
  config?: WatermarkDetectionConfig,
  debug?: DetectionDebug,
): BoundingBox | null {
  const totalPixels = imgWidth * imgHeight;
  const samplingStep = 2;
  const bg = findBackgroundColor(data, imgWidth, imgHeight);
  const components = findComponents(data, imgWidth, imgHeight, bg, samplingStep);

  const cardProximityFactor = config?.cardProximityFactor ?? DEFAULT_CARD_PROXIMITY_FACTOR;
  const wmProximityFactor = config?.wmProximityFactor ?? DEFAULT_WM_PROXIMITY_FACTOR;
  const minWatermarkAreaRatio = config?.minWatermarkAreaRatio ?? DEFAULT_MIN_WATERMARK_AREA_RATIO;

  if (debug) {
    debug.totalPixels = totalPixels;
    debug.proximityThreshold = imgWidth * cardProximityFactor;
    debug.samplingStep = samplingStep;
    debug.cardProximityFactor = cardProximityFactor;
    debug.wmProximityFactor = wmProximityFactor;
    debug.minWatermarkAreaRatio = minWatermarkAreaRatio;
  }

  if (components.length === 0) {
    if (debug) {
      debug.componentsFound = 0;
      debug.clustersFound = 0;
      debug.cardBlockPixels = 0;
      debug.cardBlockComponents = 0;
      debug.watermarkCandidates = 0;
      debug.selectedWatermarkPixels = 0;
    }
    return null;
  }

  const clusters = clusterComponents(components, imgWidth, cardProximityFactor);

  if (clusters.length === 0) {
    if (debug) {
      debug.componentsFound = components.length;
      debug.clustersFound = 0;
      debug.cardBlockPixels = 0;
      debug.cardBlockComponents = 0;
      debug.watermarkCandidates = 0;
      debug.selectedWatermarkPixels = 0;
    }
    return null;
  }

  clusters.sort((a, b) => b.combinedPixelCount - a.combinedPixelCount);
  const cardBlockCluster = clusters[0];

  const cardComponentSet = new Set(cardBlockCluster.components);

  let cardBlockMinX = Infinity,
    cardBlockMinY = Infinity,
    cardBlockMaxX = -Infinity,
    cardBlockMaxY = -Infinity;
  for (const comp of cardBlockCluster.components) {
    if (comp.bounds.x < cardBlockMinX) cardBlockMinX = comp.bounds.x;
    if (comp.bounds.y < cardBlockMinY) cardBlockMinY = comp.bounds.y;
    if (comp.bounds.x + comp.bounds.width > cardBlockMaxX)
      cardBlockMaxX = comp.bounds.x + comp.bounds.width;
    if (comp.bounds.y + comp.bounds.height > cardBlockMaxY)
      cardBlockMaxY = comp.bounds.y + comp.bounds.height;
  }
  const cardBlockBounds: BoundingBox = {
    x: cardBlockMinX,
    y: cardBlockMinY,
    width: cardBlockMaxX - cardBlockMinX,
    height: cardBlockMaxY - cardBlockMinY,
  };

  function isOverlapping(a: BoundingBox, b: BoundingBox): boolean {
    return !(
      a.x + a.width <= b.x ||
      b.x + b.width <= a.x ||
      a.y + a.height <= b.y ||
      b.y + b.height <= a.y
    );
  }

  const remainingComponents = components.filter(
    (c) => !cardComponentSet.has(c) && !isOverlapping(c.bounds, cardBlockBounds),
  );

  const remainingCount = remainingComponents.length;

  console.log(
    `[watermark] Remaining components after card block filter: ${remainingComponents.length}`,
  );
  console.log(
    `[watermark] Remaining component bounds:`,
    remainingComponents.map((c) => ({
      x: c.bounds.x,
      y: c.bounds.y,
      w: c.bounds.width,
      h: c.bounds.height,
      pixels: c.pixelCount,
    })),
  );

  const wmParent = Array.from({ length: remainingCount }, (_, i) => i);

  function findWmRoot(i: number): number {
    let root = i;
    while (root !== wmParent[root]) root = wmParent[root];
    return root;
  }

  const wmProximityThreshold = imgWidth * wmProximityFactor;

  console.log(
    `[watermark] wmProximityThreshold: ${wmProximityThreshold} (factor: ${wmProximityFactor})`,
  );

  for (let i = 0; i < remainingCount; i++) {
    for (let j = i + 1; j < remainingCount; j++) {
      const dist = boxDistance(remainingComponents[i].bounds, remainingComponents[j].bounds);
      if (dist <= wmProximityThreshold) {
        const ri = findWmRoot(i);
        const rj = findWmRoot(j);
        console.log(
          `[watermark] Merging comp ${i} (${JSON.stringify(remainingComponents[i].bounds)}) with comp ${j} (${JSON.stringify(remainingComponents[j].bounds)}) — distance: ${dist}`,
        );
        if (ri !== rj) wmParent[ri] = rj;
      }
    }
  }

  const mergedWatermarks = new Map<number, Component & { originalComps: Component[] }>();

  for (let i = 0; i < remainingCount; i++) {
    const root = findWmRoot(i);
    const comp = remainingComponents[i];

    if (!mergedWatermarks.has(root)) {
      mergedWatermarks.set(root, {
        bounds: { ...comp.bounds },
        pixelCount: comp.pixelCount,
        originalComps: [comp], // Store originals for the debug readout
      });
    } else {
      const cluster = mergedWatermarks.get(root)!;
      const minX = Math.min(cluster.bounds.x, comp.bounds.x);
      const minY = Math.min(cluster.bounds.y, comp.bounds.y);
      const maxX = Math.max(
        cluster.bounds.x + cluster.bounds.width,
        comp.bounds.x + comp.bounds.width,
      );
      const maxY = Math.max(
        cluster.bounds.y + cluster.bounds.height,
        comp.bounds.y + comp.bounds.height,
      );

      cluster.bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
      cluster.pixelCount += comp.pixelCount;
      cluster.originalComps.push(comp);
    }
  }

  console.log(
    `[watermark] Merged clusters (${mergedWatermarks.size}):`,
    Array.from(mergedWatermarks.values()).map((c) => ({
      bounds: c.bounds,
      pixelCount: c.pixelCount,
      numComps: c.originalComps.length,
    })),
  );

  const minAreaPixels = totalPixels * minWatermarkAreaRatio;
  console.log(
    `[watermark] Min area ratio: ${minWatermarkAreaRatio} -> ${minAreaPixels} pixels (total pixels: ${totalPixels})`,
  );
  const watermarkCandidates = Array.from(mergedWatermarks.values()).filter((c) => {
    const passes = c.pixelCount >= minAreaPixels;
    console.log(
      `[watermark] Cluster (${c.bounds.x},${c.bounds.y} ${c.bounds.width}x${c.bounds.height}) — pixelCount: ${c.pixelCount}, threshold: ${minAreaPixels} — ${passes ? "PASSES" : "FAILS"}`,
    );
    return passes;
  });

  if (debug) {
    debug.componentsFound = components.length;
    debug.clustersFound = clusters.length;
    debug.cardBlockPixels = cardBlockCluster.combinedPixelCount;
    debug.cardBlockComponents = cardBlockCluster.components.length;
    debug.watermarkCandidates = watermarkCandidates.length;
    debug.selectedWatermarkPixels =
      watermarkCandidates.length > 0 ? watermarkCandidates[0].pixelCount : 0;
    debug.proximityThreshold = wmProximityThreshold;
    const validWatermarkOriginalComps = new Set(
      watermarkCandidates.flatMap((c) => c.originalComps),
    );
    debug.components = components.map((c, i) => ({
      index: i,
      bounds: c.bounds,
      pixelCount: c.pixelCount,
      area: c.bounds.width * c.bounds.height,
      isCardBlock: cardComponentSet.has(c),
      isWatermarkCandidate: validWatermarkOriginalComps.has(c),
    }));
  }

  if (watermarkCandidates.length === 0) return null;

  // Return the largest contiguous watermark cluster found
  watermarkCandidates.sort((a, b) => b.pixelCount - a.pixelCount);
  return watermarkCandidates[0].bounds;
}
