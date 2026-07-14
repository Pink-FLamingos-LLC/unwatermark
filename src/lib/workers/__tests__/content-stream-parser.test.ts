import { describe, it, expect } from "vite-plus/test";
import { parseContentStream } from "../content-stream-parser";

describe("parseContentStream", () => {
  it("returns empty array for empty content", () => {
    const result = parseContentStream("", new Set(["Im1"]));
    expect(result).toEqual([]);
  });

  it("returns empty array when no XObjects match", () => {
    const content = "q 1 0 0 1 0 0 cm /Im1 Do Q";
    const result = parseContentStream(content, new Set());
    expect(result).toEqual([]);
  });

  it("parses a single image placement with identity transform", () => {
    const content = "q 1 0 0 1 0 0 cm /Im1 Do Q";
    const result = parseContentStream(content, new Set(["Im1"]));
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Im1");
    expect(result[0].box).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("parses image placement with scaling transform", () => {
    const content = "q 200 0 0 100 50 60 cm /Im1 Do Q";
    const result = parseContentStream(content, new Set(["Im1"]));
    expect(result).toHaveLength(1);
    expect(result[0].box.x).toBeCloseTo(50);
    expect(result[0].box.y).toBeCloseTo(60);
    expect(result[0].box.width).toBeCloseTo(200);
    expect(result[0].box.height).toBeCloseTo(100);
  });

  it("parses multiple image placements", () => {
    const content = [
      "q 100 0 0 80 10 20 cm /Card1 Do Q",
      "q 100 0 0 80 120 20 cm /Card2 Do Q",
      "q 100 0 0 80 230 20 cm /Card3 Do Q",
    ].join("\n");
    const result = parseContentStream(content, new Set(["Card1", "Card2", "Card3"]));
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe("Card1");
    expect(result[1].name).toBe("Card2");
    expect(result[2].name).toBe("Card3");
  });

  it("saves and restores graphics state with q/Q", () => {
    const content = [
      "q 100 0 0 100 0 0 cm",
      "/Im1 Do",
      "Q",
      "q 200 0 0 200 50 50 cm",
      "/Im2 Do",
      "Q",
    ].join("\n");
    const result = parseContentStream(content, new Set(["Im1", "Im2"]));
    expect(result).toHaveLength(2);
    expect(result[0].box).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(result[1].box).toEqual({ x: 50, y: 50, width: 200, height: 200 });
  });

  it("handles nested graphics state saves", () => {
    const content = [
      "q 100 0 0 100 0 0 cm",
      "q 0.5 0 0 0.5 0 0 cm",
      "/Im1 Do",
      "Q",
      "/Im2 Do",
      "Q",
    ].join("\n");
    const result = parseContentStream(content, new Set(["Im1", "Im2"]));
    expect(result).toHaveLength(2);
    expect(result[0].box.width).toBeCloseTo(50);
    expect(result[0].box.height).toBeCloseTo(50);
    expect(result[1].box.width).toBeCloseTo(100);
    expect(result[1].box.height).toBeCloseTo(100);
  });

  it("ignores non-matching XObject names", () => {
    const content = "q 100 0 0 100 0 0 cm /Im1 Do /Im2 Do Q";
    const result = parseContentStream(content, new Set(["Im1"]));
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Im1");
  });

  it("ignores comments", () => {
    const content = "q % this is a comment\n100 0 0 100 0 0 cm /Im1 Do Q";
    const result = parseContentStream(content, new Set(["Im1"]));
    expect(result).toHaveLength(1);
  });

  it("handles skewed transforms", () => {
    const content = "q 100 10 5 80 100 200 cm /Im1 Do Q";
    const result = parseContentStream(content, new Set(["Im1"]));
    expect(result).toHaveLength(1);
    expect(result[0].box.width).toBeGreaterThan(0);
    expect(result[0].box.height).toBeGreaterThan(0);
  });
});
