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

  it("returns null for a single blob with no Card Block context", () => {
    const w = 200;
    const h = 200;
    const data = makeImageData(w, h);
    fillRect(data, w, 50, 50, 40, 30, [30, 30, 30]);

    const result = detectWatermarkRegion(data, w, h);
    expect(result).toBeNull();
  });

  it("detects watermark with a monolithic Card Block", () => {
    const w = 400;
    const h = 400;
    const data = makeImageData(w, h);
    fillRect(data, w, 50, 55, 300, 300, [200, 150, 100]);
    fillRect(data, w, 10, 10, 50, 40, [30, 30, 30]);

    const result = detectWatermarkRegion(data, w, h);
    expect(result).not.toBeNull();
    expect(result!.x).toBeGreaterThanOrEqual(8);
    expect(result!.x).toBeLessThanOrEqual(12);
    expect(result!.y).toBeGreaterThanOrEqual(8);
    expect(result!.y).toBeLessThanOrEqual(12);
    expect(result!.width).toBeGreaterThanOrEqual(46);
    expect(result!.width).toBeLessThanOrEqual(54);
    expect(result!.height).toBeGreaterThanOrEqual(36);
    expect(result!.height).toBeLessThanOrEqual(44);
  });

  it("detects watermark among clustered card blobs", () => {
    const w = 500;
    const h = 500;
    const data = makeImageData(w, h);

    fillRect(data, w, 10, 10, 80, 80, [200, 150, 100]);
    fillRect(data, w, 95, 10, 80, 80, [200, 150, 100]);
    fillRect(data, w, 10, 95, 80, 80, [200, 150, 100]);
    fillRect(data, w, 95, 95, 80, 80, [200, 150, 100]);

    fillRect(data, w, 400, 400, 60, 50, [50, 50, 50]);

    const result = detectWatermarkRegion(data, w, h);
    expect(result).not.toBeNull();
    expect(result!.width * result!.height).toBeGreaterThanOrEqual(60 * 50 - 10);
  });

  it("picks the largest non-Card-Block blob as watermark", () => {
    const w = 200;
    const h = 200;
    const data = makeImageData(w, h);
    fillRect(data, w, 100, 100, 50, 50, [50, 50, 50]);
    fillRect(data, w, 10, 10, 20, 20, [100, 100, 100]);

    const result = detectWatermarkRegion(data, w, h);
    expect(result).not.toBeNull();
    expect(result!.width * result!.height).toBeGreaterThanOrEqual(20 * 20 - 2);
  });

  it("returns null when remaining blobs are below the 1% area threshold", () => {
    const w = 200;
    const h = 200;
    const data = makeImageData(w, h);
    fillRect(data, w, 25, 25, 150, 150, [200, 150, 100]);
    fillRect(data, w, 180, 10, 5, 5, [30, 30, 30]);

    const result = detectWatermarkRegion(data, w, h);
    expect(result).toBeNull();
  });

  it("detects colored watermark with a Card Block present", () => {
    const w = 350;
    const h = 300;
    const data = makeImageData(w, h);
    fillRect(data, w, 50, 50, 200, 200, [200, 150, 100]);
    fillRect(data, w, 260, 20, 60, 40, [0, 100, 200]);

    const result = detectWatermarkRegion(data, w, h);
    expect(result).not.toBeNull();
    expect(result!.width).toBeGreaterThanOrEqual(56);
    expect(result!.height).toBeGreaterThanOrEqual(36);
  });

  it("returns null when only small noise specks exist outside Card Block", () => {
    const w = 300;
    const h = 300;
    const data = makeImageData(w, h);
    fillRect(data, w, 25, 25, 250, 250, [200, 150, 100]);

    const result = detectWatermarkRegion(data, w, h);
    expect(result).toBeNull();
  });
});
