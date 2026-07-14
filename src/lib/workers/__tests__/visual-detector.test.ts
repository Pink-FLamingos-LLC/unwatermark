import { describe, it, expect } from "vite-plus/test";
import { detectWatermarkRegion, floodFillRegion } from "../visual-detector";

function makeImageData(
  width: number,
  height: number,
  fill: [number, number, number] = [255, 255, 255],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = 255;
  }
  return data;
}

function fillRect(
  data: Uint8ClampedArray,
  imgWidth: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: [number, number, number],
) {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      const idx = (py * imgWidth + px) * 4;
      data[idx] = color[0];
      data[idx + 1] = color[1];
      data[idx + 2] = color[2];
      data[idx + 3] = 255;
    }
  }
}

describe("floodFillRegion", () => {
  it("returns null for out-of-bounds start", () => {
    const data = makeImageData(10, 10);
    expect(floodFillRegion(data, 10, 10, -1, 0, 30)).toBeNull();
    expect(floodFillRegion(data, 10, 10, 0, 10, 30)).toBeNull();
  });

  it("flood fills a colored rectangle on white background", () => {
    const w = 20;
    const h = 20;
    const data = makeImageData(w, h);
    fillRect(data, w, 5, 5, 6, 4, [200, 0, 0]);

    const result = floodFillRegion(data, w, h, 7, 6, 30);
    expect(result).not.toBeNull();
    expect(result!.x).toBe(5);
    expect(result!.y).toBe(5);
    expect(result!.width).toBe(6);
    expect(result!.height).toBe(4);
  });

  it("returns null when clicking on white background", () => {
    const w = 20;
    const h = 20;
    const data = makeImageData(w, h);
    fillRect(data, w, 5, 5, 6, 4, [0, 0, 0]);

    const result = floodFillRegion(data, w, h, 0, 0, 30);
    expect(result).toBeNull();
  });

  it("flood fills a dark region", () => {
    const w = 20;
    const h = 20;
    const data = makeImageData(w, h);
    fillRect(data, w, 3, 3, 5, 5, [100, 100, 100]);
    const result = floodFillRegion(data, w, h, 5, 5, 30);
    expect(result).not.toBeNull();
    expect(result!.x).toBe(3);
    expect(result!.y).toBe(3);
    expect(result!.width).toBe(5);
    expect(result!.height).toBe(5);
  });
});

describe("detectWatermarkRegion", () => {
  it("returns null for all-white image", () => {
    const w = 100;
    const h = 100;
    const data = makeImageData(w, h);
    expect(detectWatermarkRegion(data, w, h)).toBeNull();
  });

  it("detects a dark watermark on white background", () => {
    const w = 200;
    const h = 200;
    const data = makeImageData(w, h);
    fillRect(data, w, 50, 50, 40, 30, [30, 30, 30]);

    const result = detectWatermarkRegion(data, w, h);
    expect(result).not.toBeNull();
    expect(result!.x).toBeGreaterThanOrEqual(48);
    expect(result!.x).toBeLessThanOrEqual(52);
    expect(result!.y).toBeGreaterThanOrEqual(48);
    expect(result!.y).toBeLessThanOrEqual(52);
    expect(result!.width).toBeGreaterThanOrEqual(36);
    expect(result!.width).toBeLessThanOrEqual(44);
    expect(result!.height).toBeGreaterThanOrEqual(26);
    expect(result!.height).toBeLessThanOrEqual(34);
  });

  it("ignores small noise (below MIN_COMPONENT_AREA)", () => {
    const w = 200;
    const h = 200;
    const data = makeImageData(w, h);
    fillRect(data, w, 50, 50, 2, 2, [0, 0, 0]);

    const result = detectWatermarkRegion(data, w, h);
    expect(result).toBeNull();
  });

  it("detects watermark among card regions", () => {
    const w = 400;
    const h = 400;
    const data = makeImageData(w, h);

    fillRect(data, w, 10, 10, 80, 80, [200, 150, 100]);
    fillRect(data, w, 110, 10, 80, 80, [200, 150, 100]);
    fillRect(data, w, 10, 110, 80, 80, [200, 150, 100]);
    fillRect(data, w, 110, 110, 80, 80, [200, 150, 100]);

    fillRect(data, w, 250, 250, 100, 60, [50, 50, 50]);

    const result = detectWatermarkRegion(data, w, h);
    expect(result).not.toBeNull();
    expect(result!.width * result!.height).toBeGreaterThanOrEqual(100 * 60 - 10);
  });

  it("picks the largest region when multiple non-white regions exist", () => {
    const w = 200;
    const h = 200;
    const data = makeImageData(w, h);
    fillRect(data, w, 10, 10, 20, 20, [100, 100, 100]);
    fillRect(data, w, 100, 100, 50, 50, [50, 50, 50]);

    const result = detectWatermarkRegion(data, w, h);
    expect(result).not.toBeNull();
    expect(result!.width * result!.height).toBeGreaterThanOrEqual(50 * 50 - 2);
  });

  it("detects colored watermark on white background", () => {
    const w = 200;
    const h = 200;
    const data = makeImageData(w, h);
    fillRect(data, w, 30, 30, 100, 50, [0, 100, 200]);

    const result = detectWatermarkRegion(data, w, h);
    expect(result).not.toBeNull();
    expect(result!.width).toBeGreaterThanOrEqual(96);
    expect(result!.height).toBeGreaterThanOrEqual(46);
  });
});
