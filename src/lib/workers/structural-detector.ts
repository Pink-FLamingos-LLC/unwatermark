import type { BoundingBox, ImagePlacement } from "./types";

const CLUSTER_THRESHOLD = 1.5;

function area(box: BoundingBox): number {
  return box.width * box.height;
}

function centerDistance(a: BoundingBox, b: BoundingBox): number {
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

function sizeRatio(a: BoundingBox, b: BoundingBox): number {
  const areaA = area(a);
  const areaB = area(b);
  if (areaA === 0 || areaB === 0) return 0;
  return Math.min(areaA, areaB) / Math.max(areaA, areaB);
}

function distance(a: ImagePlacement, b: ImagePlacement): number {
  const spatialDist = centerDistance(a.box, b.box);
  const sizeSim = sizeRatio(a.box, b.box);

  const maxDim = Math.max(a.box.width, a.box.height, b.box.width, b.box.height);
  const normalizedSpatial = maxDim > 0 ? spatialDist / maxDim : spatialDist;

  return normalizedSpatial * (2 - sizeSim);
}

function findLargestCluster(images: ImagePlacement[], threshold: number): ImagePlacement[] {
  if (images.length === 0) return [];

  const visited = new Set<number>();
  let largestCluster: ImagePlacement[] = [];

  for (let i = 0; i < images.length; i++) {
    if (visited.has(i)) continue;

    const cluster: ImagePlacement[] = [images[i]];
    visited.add(i);
    const queue = [i];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (let j = 0; j < images.length; j++) {
        if (visited.has(j)) continue;
        if (distance(images[current], images[j]) < threshold) {
          visited.add(j);
          cluster.push(images[j]);
          queue.push(j);
        }
      }
    }

    if (cluster.length > largestCluster.length) {
      largestCluster = cluster;
    }
  }

  return largestCluster;
}

function computeBoundingBox(boxes: BoundingBox[]): BoundingBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function clusterImages(images: ImagePlacement[]): {
  gridImages: ImagePlacement[];
  outliers: ImagePlacement[];
} {
  if (images.length <= 1) return { gridImages: [], outliers: [...images] };

  const gridImages = findLargestCluster(images, CLUSTER_THRESHOLD);
  const outliers = images.filter((img) => !gridImages.includes(img));

  return { gridImages, outliers };
}

export function detectWatermark(images: ImagePlacement[]): ImagePlacement | null {
  if (images.length <= 1) return null;

  const { gridImages, outliers } = clusterImages(images);

  if (outliers.length === 0) {
    return null;
  }

  if (outliers.length === 1) {
    return outliers[0];
  }

  const gridBbox = computeBoundingBox(gridImages.map((i) => i.box));
  let bestOutlier = outliers[0];
  let bestScore = -Infinity;

  for (const outlier of outliers) {
    const dist = centerDistance(outlier.box, gridBbox);
    const sizeDiff = 1 - sizeRatio(outlier.box, gridBbox);
    const score = dist * sizeDiff;

    if (score > bestScore) {
      bestScore = score;
      bestOutlier = outlier;
    }
  }

  return bestOutlier;
}
