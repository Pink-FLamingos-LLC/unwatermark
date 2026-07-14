import { describe, it, expect } from "vite-plus/test";
import { floodFillBoundary } from "../flood-fill";

function makeImageData(
  width: number,
  height: number,
  pixels: number[][],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const val = pixels[y][x];
      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
      data[idx + 3] = 255;
    }
  }
  return data;
}

describe("floodFillBoundary", () => {
  it("returns null for click on white pixel", () => {
    const width = 10;
    const height = 10;
    const pixels = Array.from({ length: height }, () =>
      Array(width).fill(255),
    );
    const data = makeImageData(width, height, pixels);
    const result = floodFillBoundary(data, width, height, 5, 5, 30);
    expect(result).toBeNull();
  });

  it("detects a simple dark rectangle on white background", () => {
    const width = 20;
    const height = 20;
    const pixels = Array.from({ length: height }, () =>
      Array(width).fill(255),
    );
    // Draw a 6x4 dark block at (5, 5)
    for (let y = 5; y < 9; y++) {
      for (let x = 5; x < 11; x++) {
        pixels[y][x] = 0;
      }
    }
    const data = makeImageData(width, height, pixels);
    const result = floodFillBoundary(data, width, height, 7, 6, 30);
    expect(result).not.toBeNull();
    expect(result!.x).toBe(5);
    expect(result!.y).toBe(5);
    expect(result!.width).toBe(6);
    expect(result!.height).toBe(4);
  });

  it("respects tolerance - ignores light gray when tolerance is low", () => {
    const width = 10;
    const height = 10;
    const pixels = Array.from({ length: height }, () =>
      Array(width).fill(255),
    );
    // Light gray block (240) - luminance 240 > 255-20=235, so considered "white" with tolerance 20
    for (let y = 3; y < 7; y++) {
      for (let x = 3; x < 7; x++) {
        pixels[y][x] = 240;
      }
    }
    const data = makeImageData(width, height, pixels);
    const result = floodFillBoundary(data, width, height, 4, 4, 20);
    expect(result).toBeNull();
  });

  it("includes dark gray when tolerance is high enough", () => {
    const width = 10;
    const height = 10;
    const pixels = Array.from({ length: height }, () =>
      Array(width).fill(255),
    );
    // Dark gray block (100)
    for (let y = 3; y < 7; y++) {
      for (let x = 3; x < 7; x++) {
        pixels[y][x] = 100;
      }
    }
    const data = makeImageData(width, height, pixels);
    const result = floodFillBoundary(data, width, height, 4, 4, 30);
    expect(result).not.toBeNull();
    expect(result!.x).toBe(3);
    expect(result!.y).toBe(3);
    expect(result!.width).toBe(4);
    expect(result!.height).toBe(4);
  });

  it("handles L-shaped regions", () => {
    const width = 15;
    const height = 15;
    const pixels = Array.from({ length: height }, () =>
      Array(width).fill(255),
    );
    // L-shape: horizontal bar + vertical bar
    for (let x = 2; x < 10; x++) pixels[2][x] = 0;
    for (let x = 2; x < 10; x++) pixels[3][x] = 0;
    for (let y = 2; y < 10; y++) pixels[y][2] = 0;
    for (let y = 2; y < 10; y++) pixels[y][3] = 0;

    const data = makeImageData(width, height, pixels);
    const result = floodFillBoundary(data, width, height, 5, 2, 30);
    expect(result).not.toBeNull();
    expect(result!.x).toBe(2);
    expect(result!.y).toBe(2);
    expect(result!.width).toBe(8);
    expect(result!.height).toBe(8);
  });

  it("clamps bounding box to image bounds", () => {
    const width = 10;
    const height = 10;
    const pixels = Array.from({ length: height }, () =>
      Array(width).fill(255),
    );
    // Dark pixel at corner
    pixels[0][0] = 0;
    pixels[0][1] = 0;
    pixels[1][0] = 0;

    const data = makeImageData(width, height, pixels);
    const result = floodFillBoundary(data, width, height, 0, 0, 30);
    expect(result).not.toBeNull();
    expect(result!.x).toBe(0);
    expect(result!.y).toBe(0);
    expect(result!.width).toBe(2);
    expect(result!.height).toBe(2);
  });

  it("stops at background boundary", () => {
    const width = 20;
    const height = 20;
    const pixels = Array.from({ length: height }, () =>
      Array(width).fill(255),
    );
    // Two separate dark blocks
    for (let y = 2; y < 6; y++) {
      for (let x = 2; x < 6; x++) pixels[y][x] = 0;
    }
    for (let y = 10; y < 14; y++) {
      for (let x = 10; x < 14; x++) pixels[y][x] = 0;
    }

    const data = makeImageData(width, height, pixels);
    const result = floodFillBoundary(data, width, height, 3, 3, 30);
    expect(result).not.toBeNull();
    expect(result!.x).toBe(2);
    expect(result!.y).toBe(2);
    expect(result!.width).toBe(4);
    expect(result!.height).toBe(4);
  });

  it("handles click on edge of dark region", () => {
    const width = 15;
    const height = 15;
    const pixels = Array.from({ length: height }, () =>
      Array(width).fill(255),
    );
    for (let y = 5; y < 10; y++) {
      for (let x = 5; x < 10; x++) pixels[y][x] = 0;
    }

    const data = makeImageData(width, height, pixels);
    const result = floodFillBoundary(data, width, height, 5, 5, 30);
    expect(result).not.toBeNull();
    expect(result!.x).toBe(5);
    expect(result!.y).toBe(5);
    expect(result!.width).toBe(5);
    expect(result!.height).toBe(5);
  });
});
