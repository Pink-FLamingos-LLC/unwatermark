import type { BoundingBox } from "./types";

export function getLuminance(data: Uint8ClampedArray, idx: number): number {
  return data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
}

export function floodFillBoundary(
  imageData: Uint8ClampedArray,
  imgWidth: number,
  imgHeight: number,
  startX: number,
  startY: number,
  tolerance: number,
): BoundingBox | null {
  const startIdx = (startY * imgWidth + startX) * 4;
  const startLum = getLuminance(imageData, startIdx);

  if (startLum > 255 - tolerance) {
    return null;
  }

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

      const nIdx = nPos * 4;
      const nLum = getLuminance(imageData, nIdx);
      if (nLum <= 255 - tolerance) {
        queue.push(nPos);
      }
    }
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}
