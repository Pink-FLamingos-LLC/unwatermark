import { describe, it, expect } from "vite-plus/test";
import { removeWatermarkFromContentStream } from "../structural-detector.worker";

describe("removeWatermarkFromContentStream", () => {
  it("removes watermark Do operator and surrounding q/Q block", () => {
    const content = [
      "q 100 0 0 100 0 0 cm",
      "/Card1 Do",
      "Q",
      "q 50 0 0 50 300 400 cm",
      "/Logo Do",
      "Q",
      "q 100 0 0 100 100 0 cm",
      "/Card2 Do",
      "Q",
    ].join("\n");

    const result = removeWatermarkFromContentStream(content, "Logo");
    const lines = result.split("\n").filter((l) => l.trim());

    expect(lines).toHaveLength(6);
    expect(lines.join("\n")).not.toContain("Logo");
    expect(lines.join("\n")).toContain("Card1");
    expect(lines.join("\n")).toContain("Card2");
  });

  it("preserves non-watermark content", () => {
    const content = [
      "q",
      "100 0 0 100 0 0 cm",
      "/Card1 Do",
      "Q",
      "BT",
      "/F1 12 Tf",
      "100 100 Td",
      "(Hello) Tj",
      "ET",
    ].join("\n");

    const result = removeWatermarkFromContentStream(content, "Logo");
    expect(result).toContain("BT");
    expect(result).toContain("(Hello) Tj");
    expect(result).toContain("ET");
  });

  it("returns empty string for content with only watermark", () => {
    const content = ["q 50 0 0 50 0 0 cm", "/Logo Do", "Q"].join("\n");

    const result = removeWatermarkFromContentStream(content, "Logo");
    const lines = result.split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(0);
  });

  it("handles empty content", () => {
    const result = removeWatermarkFromContentStream("", "Logo");
    expect(result).toBe("");
  });

  it("does not remove non-matching Do operators", () => {
    const content = ["q 100 0 0 100 0 0 cm", "/Im1 Do", "Q"].join("\n");

    const result = removeWatermarkFromContentStream(content, "Logo");
    expect(result).toContain("/Im1 Do");
  });
});
