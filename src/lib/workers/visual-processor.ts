import { PDFDocument } from "pdf-lib";
import { detectWatermarkRegion, findBackgroundColor } from "./visual-detector";
import type { BoundingBox, PdfDebugInfo } from "./types";

interface PDFPageNode {
  normalize?(): void;
  get?(key: unknown): unknown;
  Resources():
    | {
        get(
          key: unknown,
        ): { entries?(): Iterable<[unknown, unknown]>; delete?(key: unknown): void } | undefined;
        entries?(): Iterable<[unknown, unknown]>;
      }
    | undefined;
  Contents(): unknown;
  set(key: unknown, value: unknown): void;
  MediaBox(): { get(index: number): number };
}

interface PDFStreamLike {
  getUnencodedContents?(): Uint8Array;
  getContents?(): Uint8Array;
}

function resolveStream(pdfDoc: PDFDocument, obj: unknown): PDFStreamLike | null {
  if (!obj || typeof obj !== "object") return null;
  if ("getUnencodedContents" in obj || "getContents" in obj) return obj as PDFStreamLike;
  try {
    const ctx = pdfDoc.context as any;
    const resolved = ctx.lookup?.(obj) ?? ctx.lookupMaybe?.(obj);
    if (
      resolved &&
      typeof resolved === "object" &&
      ("getUnencodedContents" in resolved || "getContents" in resolved)
    ) {
      return resolved as PDFStreamLike;
    }
  } catch {
    /* */
  }
  return null;
}

function readStreamBytes(stream: PDFStreamLike): Uint8Array | null {
  try {
    const bytes = stream.getUnencodedContents?.();
    if (bytes && bytes.length > 0) return bytes;
  } catch {
    /* */
  }
  try {
    const bytes = stream.getContents?.();
    if (bytes && bytes.length > 0) return bytes;
  } catch {
    /* */
  }
  return null;
}

function decodePdfName(raw: unknown): string {
  const rawName = raw as string | { decodeText?(): string };
  const name = typeof rawName === "string" ? rawName : (rawName.decodeText?.() ?? String(rawName));
  return name.startsWith("/") ? name.substring(1) : name;
}

async function decodeImageToCanvas(imageBytes: Uint8Array): Promise<HTMLCanvasElement> {
  const blob = new Blob([imageBytes.slice().buffer as ArrayBuffer]);
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

async function encodeCanvas(
  canvas: HTMLCanvasElement,
): Promise<{ bytes: Uint8Array; format: string }> {
  try {
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        "image/jpeg",
        0.92,
      );
    });
    return { bytes: new Uint8Array(await blob.arrayBuffer()), format: "jpeg" };
  } catch {
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
    });
    return { bytes: new Uint8Array(await blob.arrayBuffer()), format: "png" };
  }
}

async function paintOverRegion(
  canvas: HTMLCanvasElement,
  region: BoundingBox,
  bgColor: { r: number; g: number; b: number },
): Promise<void> {
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.getImageData(region.x, region.y, region.width, region.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    data[i] = bgColor.r;
    data[i + 1] = bgColor.g;
    data[i + 2] = bgColor.b;
    data[i + 3] = 255;
  }

  ctx.putImageData(imageData, region.x, region.y);
}

function hasCanvasContent(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d")!;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const step = Math.max(1, Math.floor(data.length / (4 * 10000)));
  let sampled = 0;
  let nonWhite = 0;
  for (let i = 0; i < data.length; i += 4 * step) {
    sampled++;
    const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    if (lum < 240) nonWhite++;
  }
  return sampled > 0 && nonWhite / sampled > 0.01;
}

async function tryRenderWithPdfjs(pdfBuffer: ArrayBuffer): Promise<HTMLCanvasElement | null> {
  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const workerUrl = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

    const doc = await pdfjsLib.getDocument({ data: pdfBuffer.slice(0) }).promise;
    const page = await doc.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const maxDim = Math.max(baseViewport.width, baseViewport.height);
    const scale = Math.max(1, Math.min(4, Math.ceil(2000 / maxDim)));
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d")!;

    await page.render({ canvas, canvasContext: ctx, viewport }).promise;

    if (hasCanvasContent(canvas)) {
      console.log("[visual] pdfjs render succeeded, canvas:", canvas.width, "x", canvas.height);
      return canvas;
    }

    console.log("[visual] pdfjs render produced blank canvas, falling back to pdf-lib");
    return null;
  } catch (err) {
    console.log("[visual] pdfjs render failed:", err, "- falling back to pdf-lib");
    return null;
  }
}

async function extractAndDecodeFromPdfLib(
  pdfDoc: PDFDocument,
): Promise<{ canvas: HTMLCanvasElement; xobjectName: string } | null> {
  const pages = pdfDoc.getPages();
  if (pages.length === 0) return null;

  const page = pages[0];
  const pageNode = page.node as unknown as PDFPageNode;
  const resources = pageNode.Resources();
  if (!resources) return null;

  let xobjectDict: { entries?(): Iterable<[unknown, unknown]> } | undefined;
  if (resources.entries) {
    for (const [key, value] of resources.entries()) {
      if (decodePdfName(key) === "XObject") {
        xobjectDict = value as { entries?(): Iterable<[unknown, unknown]> };
        break;
      }
    }
  }
  if (!xobjectDict?.entries) return null;

  for (const [key, value] of xobjectDict.entries()) {
    const name = decodePdfName(key);
    const stream = resolveStream(pdfDoc, value);
    if (!stream) continue;
    const bytes = readStreamBytes(stream);
    if (!bytes || bytes.length < 100) continue;

    try {
      const canvas = await decodeImageToCanvas(bytes);
      console.log(
        "[visual] pdf-lib extracted XObject",
        name,
        "size:",
        bytes.length,
        "-> canvas:",
        canvas.width,
        "x",
        canvas.height,
      );
      return { canvas, xobjectName: name };
    } catch {
      continue;
    }
  }

  return null;
}

export async function processPdfVisual(
  pdfBuffer: ArrayBuffer,
  manualSelection: BoundingBox | null,
  onProgress: (stage: string, percent: number) => void,
  onDebug: (info: PdfDebugInfo) => void,
): Promise<Uint8Array> {
  onProgress("Loading PDF...", 0);

  const pdfDoc = await PDFDocument.load(pdfBuffer, { parseSpeed: 0 });
  const pages = pdfDoc.getPages();

  if (pages.length === 0) {
    throw new Error("PDF has no pages");
  }

  const page = pages[0];
  const pageNode = page.node as unknown as PDFPageNode;
  const mediaBox = pageNode.MediaBox();
  const pageWidth = Number(mediaBox.get(2));
  const pageHeight = Number(mediaBox.get(3));

  onProgress("Rendering page...", 10);

  let canvas: HTMLCanvasElement;
  let renderSource: string;

  const pdfLibResult = await extractAndDecodeFromPdfLib(pdfDoc);
  if (pdfLibResult) {
    canvas = pdfLibResult.canvas;
    renderSource = `pdf-lib (${pdfLibResult.xobjectName})`;
    console.log("[visual] using pdf-lib extracted image:", pdfLibResult.xobjectName);
  } else {
    const pdfjsCanvas = await tryRenderWithPdfjs(pdfBuffer);
    if (pdfjsCanvas) {
      canvas = pdfjsCanvas;
      renderSource = "pdfjs";
      console.log("[visual] using pdfjs render (no extractable images found)");
    } else {
      throw new Error(
        "Could not render page: no image XObjects found and pdfjs produced blank canvas",
      );
    }
  }

  const ctx = canvas.getContext("2d")!;

  console.log("[visual] render source:", renderSource, "canvas:", canvas.width, "x", canvas.height);

  onProgress("Analyzing pixels...", 40);

  let watermarkBox: BoundingBox | null = null;

  if (manualSelection) {
    const scaleX = canvas.width / pageWidth;
    const scaleY = canvas.height / pageHeight;

    watermarkBox = {
      x: Math.round(manualSelection.x * scaleX),
      y: Math.round((pageHeight - manualSelection.y - manualSelection.height) * scaleY),
      width: Math.round(manualSelection.width * scaleX),
      height: Math.round(manualSelection.height * scaleY),
    };

    watermarkBox.x = Math.max(0, Math.min(watermarkBox.x, canvas.width - 1));
    watermarkBox.y = Math.max(0, Math.min(watermarkBox.y, canvas.height - 1));
    watermarkBox.width = Math.min(watermarkBox.width, canvas.width - watermarkBox.x);
    watermarkBox.height = Math.min(watermarkBox.height, canvas.height - watermarkBox.y);
  } else {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    watermarkBox = detectWatermarkRegion(imageData.data, canvas.width, canvas.height);
  }

  const pixelData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const bgColor = findBackgroundColor(pixelData, canvas.width, canvas.height);

  if (!watermarkBox) {
    let nonWhiteCount = 0;
    let minLum = 255;
    let maxLum = 0;
    const sampleStep = 4;
    for (let i = 0; i < pixelData.length; i += 4 * sampleStep) {
      const lum = pixelData[i] * 0.299 + pixelData[i + 1] * 0.587 + pixelData[i + 2] * 0.114;
      if (lum < 245) nonWhiteCount++;
      if (lum < minLum) minLum = lum;
      if (lum > maxLum) maxLum = lum;
    }
    const totalSampled = Math.floor(pixelData.length / (4 * sampleStep));

    onDebug({
      pageCount: pages.length,
      pageWidth,
      pageHeight,
      resources: {},
      xobjectNames: [],
      xobjectTypes: {},
      contentStreamLength: 0,
      imagePlacements: [],
      detectionResult: { watermark: null, images: [], gridImages: [] },
      visual: {
        detectionMethod: manualSelection ? "manual" : "automatic",
        renderScale: 1,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        watermarkBox: { x: 0, y: 0, width: 0, height: 0 },
        bgColor,
        imageFormat: "none",
        imageSizeBytes: 0,
        diagnostic: `source: ${renderSource}, non-white: ${nonWhiteCount}/${totalSampled}, lum: ${minLum.toFixed(0)}-${maxLum.toFixed(0)}`,
      },
    });
    throw new Error(
      "No watermark detected visually. Try manual selection or structural detection.",
    );
  }

  onProgress("Removing watermark from image...", 60);

  onDebug({
    pageCount: pages.length,
    pageWidth,
    pageHeight,
    resources: {},
    xobjectNames: [],
    xobjectTypes: {},
    contentStreamLength: 0,
    imagePlacements: [],
    detectionResult: null,
    visual: {
      detectionMethod: manualSelection ? "manual" : "automatic",
      renderScale: 1,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      watermarkBox,
      bgColor,
      imageFormat: "pending",
      imageSizeBytes: 0,
    },
  });

  await paintOverRegion(canvas, watermarkBox, bgColor);

  onProgress("Encoding modified image...", 70);

  const encoded = await encodeCanvas(canvas);

  onDebug({
    pageCount: pages.length,
    pageWidth,
    pageHeight,
    resources: {},
    xobjectNames: [],
    xobjectTypes: {},
    contentStreamLength: 0,
    imagePlacements: [],
    detectionResult: null,
    visual: {
      detectionMethod: manualSelection ? "manual" : "automatic",
      renderScale: 1,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      watermarkBox,
      bgColor,
      imageFormat: encoded.format,
      imageSizeBytes: encoded.bytes.length,
    },
  });

  onProgress("Replacing image in PDF...", 80);

  if (renderSource === "pdfjs") {
    const newImage = pdfDoc.context.stream(encoded.bytes, {
      Type: "XObject",
      Subtype: "Image",
      Width: canvas.width,
      Height: canvas.height,
    });
    const imageRef = pdfDoc.context.register(newImage);

    const contentStr = `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /img Do Q`;
    const contentBytes = new TextEncoder().encode(contentStr);
    const contentStream = pdfDoc.context.stream(contentBytes);
    const contentRef = pdfDoc.context.register(contentStream);

    pageNode.set(pdfDoc.context.obj("Contents"), pdfDoc.context.obj([contentRef]));

    const resources = pageNode.Resources();
    if (resources?.entries) {
      for (const [key, value] of resources.entries()) {
        if (decodePdfName(key) === "XObject") {
          const xobjectDict = value as any;
          const existing = xobjectDict.entries ? [...xobjectDict.entries()] : [];
          for (const [k] of existing) {
            xobjectDict.delete?.(k);
          }
          xobjectDict.set(pdfDoc.context.obj("/img"), imageRef);
          break;
        }
      }
    }
  } else {
    const resources = pageNode.Resources();
    if (resources?.entries) {
      for (const [key, value] of resources.entries()) {
        if (decodePdfName(key) === "XObject") {
          const xobjectDict = value as any;
          for (const [xoKey, xoValue] of xobjectDict.entries()) {
            const stream = resolveStream(pdfDoc, xoValue);
            if (stream && readStreamBytes(stream)) {
              const newStream = pdfDoc.context.stream(encoded.bytes, {
                Type: "XObject",
                Subtype: "Image",
                Width: canvas.width,
                Height: canvas.height,
                Filter: encoded.format === "jpeg" ? "DCTDecode" : "FlateDecode",
              });
              const streamRef = pdfDoc.context.register(newStream);
              xobjectDict.set(xoKey, streamRef);
              break;
            }
          }
          break;
        }
      }
    }
  }

  onProgress("Saving PDF...", 90);
  return pdfDoc.save();
}
