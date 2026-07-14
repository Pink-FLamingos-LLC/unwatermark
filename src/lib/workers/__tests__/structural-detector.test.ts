import { describe, it, expect } from "vite-plus/test";
import { detectWatermark, clusterImages } from "../structural-detector";
import type { ImagePlacement } from "../types";

function makeImage(name: string, x: number, y: number, w: number, h: number): ImagePlacement {
  return { name, box: { x, y, width: w, height: h } };
}

describe("detectWatermark", () => {
  it("returns null for empty images", () => {
    expect(detectWatermark([])).toBeNull();
  });

  it("returns null when only one image exists (no grid to compare against)", () => {
    const images = [makeImage("Im1", 0, 0, 100, 100)];
    const result = detectWatermark(images);
    expect(result).toBeNull();
  });

  it("detects watermark as outlier from a grid of similar images", () => {
    const gridImages = [
      makeImage("Card1", 10, 10, 80, 100),
      makeImage("Card2", 100, 10, 80, 100),
      makeImage("Card3", 190, 10, 80, 100),
      makeImage("Card4", 10, 120, 80, 100),
      makeImage("Card5", 100, 120, 80, 100),
      makeImage("Card6", 190, 120, 80, 100),
    ];
    const watermark = makeImage("Logo", 350, 400, 50, 30);
    const images = [...gridImages, watermark];

    const result = detectWatermark(images);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Logo");
  });

  it("detects watermark below the grid", () => {
    const gridImages = [
      makeImage("Card1", 10, 10, 80, 100),
      makeImage("Card2", 100, 10, 80, 100),
      makeImage("Card3", 190, 10, 80, 100),
      makeImage("Card4", 10, 120, 80, 100),
      makeImage("Card5", 100, 120, 80, 100),
      makeImage("Card6", 190, 120, 80, 100),
    ];
    const watermark = makeImage("Logo", 100, 350, 120, 40);
    const images = [...gridImages, watermark];

    const result = detectWatermark(images);
    expect(result!.name).toBe("Logo");
  });

  it("detects watermark in corner", () => {
    const gridImages = [
      makeImage("Card1", 10, 10, 80, 100),
      makeImage("Card2", 100, 10, 80, 100),
      makeImage("Card3", 10, 120, 80, 100),
      makeImage("Card4", 100, 120, 80, 100),
    ];
    const watermark = makeImage("Logo", 400, 0, 60, 40);
    const images = [...gridImages, watermark];

    const result = detectWatermark(images);
    expect(result!.name).toBe("Logo");
  });

  it("returns null when all images form a single cluster", () => {
    const images = [
      makeImage("Card1", 10, 10, 80, 100),
      makeImage("Card2", 100, 10, 80, 100),
      makeImage("Card3", 190, 10, 80, 100),
    ];

    const result = detectWatermark(images);
    expect(result).toBeNull();
  });

  it("picks the most distant outlier when multiple outliers exist", () => {
    const gridImages = [
      makeImage("Card1", 100, 100, 80, 100),
      makeImage("Card2", 190, 100, 80, 100),
      makeImage("Card3", 280, 100, 80, 100),
      makeImage("Card4", 100, 210, 80, 100),
      makeImage("Card5", 190, 210, 80, 100),
      makeImage("Card6", 280, 210, 80, 100),
    ];
    const nearOutlier = makeImage("Near", 400, 200, 30, 20);
    const farOutlier = makeImage("Far", 600, 500, 50, 30);
    const images = [...gridImages, nearOutlier, farOutlier];

    const result = detectWatermark(images);
    expect(result!.name).toBe("Far");
  });
});

describe("clusterImages", () => {
  it("returns empty clusters for empty input", () => {
    const result = clusterImages([]);
    expect(result.gridImages).toEqual([]);
    expect(result.outliers).toEqual([]);
  });

  it("returns single image as outlier", () => {
    const images = [makeImage("Im1", 0, 0, 100, 100)];
    const result = clusterImages(images);
    expect(result.gridImages).toEqual([]);
    expect(result.outliers).toHaveLength(1);
  });

  it("clusters similar-sized nearby images", () => {
    const gridImages = [
      makeImage("Card1", 10, 10, 80, 100),
      makeImage("Card2", 100, 10, 80, 100),
      makeImage("Card3", 190, 10, 80, 100),
      makeImage("Card4", 10, 120, 80, 100),
      makeImage("Card5", 100, 120, 80, 100),
      makeImage("Card6", 190, 120, 80, 100),
    ];
    const watermark = makeImage("Logo", 400, 400, 50, 30);
    const images = [...gridImages, watermark];

    const result = clusterImages(images);
    expect(result.gridImages).toHaveLength(6);
    expect(result.outliers).toHaveLength(1);
    expect(result.outliers[0].name).toBe("Logo");
  });

  it("handles no grid (all outliers)", () => {
    const images = [makeImage("A", 0, 0, 10, 10), makeImage("B", 500, 500, 200, 200)];

    const result = clusterImages(images);
    expect(result.gridImages.length + result.outliers.length).toBe(2);
  });
});
