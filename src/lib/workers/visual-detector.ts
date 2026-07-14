import type { BoundingBox } from "./types";
import { getLuminance } from "./flood-fill";

const WHITE_THRESHOLD = 245;
const COLOR_TOLERANCE = 40;
const GRID_LINE_THRESHOLD = 200;
const MIN_COMPONENT_AREA = 50;

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

function detectGeneral(
  data: Uint8ClampedArray,
  imgWidth: number,
  imgHeight: number,
): BoundingBox | null {
  const bg = findBackgroundColor(data, imgWidth, imgHeight);
  const components = findComponents(data, imgWidth, imgHeight, bg, 2);

  const largeComponents = components.filter(
    (c) => c.bounds.width * c.bounds.height >= MIN_COMPONENT_AREA,
  );

  if (largeComponents.length === 0) return null;

  largeComponents.sort(
    (a, b) => b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height,
  );
  return largeComponents[0].bounds;
}

function detectGridBased(
  data: Uint8ClampedArray,
  imgWidth: number,
  imgHeight: number,
): BoundingBox | null {
  const rowWhiteCount = new Uint32Array(imgHeight);
  for (let y = 0; y < imgHeight; y++) {
    let count = 0;
    for (let x = 0; x < imgWidth; x++) {
      const idx = (y * imgWidth + x) * 4;
      if (getLuminance(data, idx) > GRID_LINE_THRESHOLD) count++;
    }
    rowWhiteCount[y] = count;
  }

  const colWhiteCount = new Uint32Array(imgWidth);
  for (let x = 0; x < imgWidth; x++) {
    let count = 0;
    for (let y = 0; y < imgHeight; y++) {
      const idx = (y * imgWidth + x) * 4;
      if (getLuminance(data, idx) > GRID_LINE_THRESHOLD) count++;
    }
    colWhiteCount[x] = count;
  }

  const whiteRowThreshold = imgWidth * 0.7;
  const whiteColThreshold = imgHeight * 0.7;

  const gridRows: number[] = [0];
  let inWhiteRun = true;
  for (let y = 1; y < imgHeight - 1; y++) {
    if (rowWhiteCount[y] >= whiteRowThreshold) {
      if (!inWhiteRun) {
        gridRows.push(y);
        inWhiteRun = true;
      }
    } else {
      inWhiteRun = false;
    }
  }
  gridRows.push(imgHeight - 1);

  const gridCols: number[] = [0];
  inWhiteRun = true;
  for (let x = 1; x < imgWidth - 1; x++) {
    if (colWhiteCount[x] >= whiteColThreshold) {
      if (!inWhiteRun) {
        gridCols.push(x);
        inWhiteRun = true;
      }
    } else {
      inWhiteRun = false;
    }
  }
  gridCols.push(imgWidth - 1);

  if (gridRows.length < 3 || gridCols.length < 3) return null;

  const cells: BoundingBox[] = [];
  for (let ri = 0; ri < gridRows.length - 1; ri++) {
    for (let ci = 0; ci < gridCols.length - 1; ci++) {
      const x1 = gridCols[ci];
      const y1 = gridRows[ri];
      const x2 = gridCols[ci + 1];
      const y2 = gridRows[ri + 1];
      if (x2 - x1 > 20 && y2 - y1 > 20) {
        cells.push({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
      }
    }
  }

  if (cells.length < 2) return null;

  const bg = findBackgroundColor(data, imgWidth, imgHeight);
  const components = findComponents(data, imgWidth, imgHeight, bg, 3);

  const watermarkCandidates: BoundingBox[] = [];

  for (const comp of components) {
    if (comp.bounds.width * comp.bounds.height < MIN_COMPONENT_AREA) continue;

    let overlapsAnyCell = false;
    for (const cell of cells) {
      const ix = Math.max(
        0,
        Math.min(comp.bounds.x + comp.bounds.width, cell.x + cell.width) -
          Math.max(comp.bounds.x, cell.x),
      );
      const iy = Math.max(
        0,
        Math.min(comp.bounds.y + comp.bounds.height, cell.y + cell.height) -
          Math.max(comp.bounds.y, cell.y),
      );
      if (ix > 0 && iy > 0) {
        overlapsAnyCell = true;
        break;
      }
    }

    if (!overlapsAnyCell) {
      watermarkCandidates.push(comp.bounds);
    }
  }

  if (watermarkCandidates.length === 0) return null;

  return watermarkCandidates.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
}

export function detectWatermarkRegion(
  data: Uint8ClampedArray,
  imgWidth: number,
  imgHeight: number,
): BoundingBox | null {
  return detectGridBased(data, imgWidth, imgHeight) ?? detectGeneral(data, imgWidth, imgHeight);
}
