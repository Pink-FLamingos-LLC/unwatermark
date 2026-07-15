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

  const resources = pageNode.Resources();
  if (!resources) {
    throw new Error("Page has no resources");
  }

  let xobjectDict: { entries?(): Iterable<[unknown, unknown]> } | undefined;
  if (resources.entries) {
    for (const [key, value] of resources.entries()) {
      if (decodePdfName(key) === "XObject") {
        xobjectDict = value as { entries?(): Iterable<[unknown, unknown]> };
        break;
      }
    }
  }
  if (!xobjectDict?.entries) {
    throw new Error("No XObjects found on page");
  }

  onProgress("Extracting image XObjects...", 10);

  const xobjects: { name: string; bytes: Uint8Array; stream: PDFStreamLike }[] = [];
  for (const [key, value] of xobjectDict.entries()) {
    const name = decodePdfName(key);
    const stream = resolveStream(pdfDoc, value);
    if (!stream) continue;
    const bytes = readStreamBytes(stream);
    if (!bytes || bytes.length < 100) continue;
    xobjects.push({ name, bytes, stream });
  }

  if (xobjects.length === 0) {
    throw new Error("No image XObject streams found");
  }

  console.log("[visual] found", xobjects.length, "XObject streams");
  for (const xo of xobjects) {
    console.log(
      "[visual] XObject",
      xo.name,
      "size:",
      xo.bytes.length,
      "first bytes:",
      xo.bytes.slice(0, 8),
    );
  }

  onProgress("Decoding image...", 30);

  const xobject = xobjects[0];
  const canvas = await decodeImageToCanvas(xobject.bytes);
  const ctx = canvas.getContext("2d")!;

  console.log("[visual] decoded image:", canvas.width, "x", canvas.height);

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
      xobjectNames: xobjects.map((x) => x.name),
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
        diagnostic: `XObject: ${xobject.name} (${xobject.bytes.length} bytes), non-white: ${nonWhiteCount}/${totalSampled}, lum: ${minLum.toFixed(0)}-${maxLum.toFixed(0)}`,
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
    xobjectNames: xobjects.map((x) => x.name),
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
    xobjectNames: xobjects.map((x) => x.name),
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

  const newStream = pdfDoc.context.stream(encoded.bytes);
  const streamRef = pdfDoc.context.register(newStream);

  const xobjectDictObj = resources.get(pdfDoc.context.obj("/XObject"));
  if (xobjectDictObj) {
    (xobjectDictObj as { set(key: unknown, value: unknown): void }).set(
      pdfDoc.context.obj(`/${xobject.name}`),
      streamRef,
    );
  }

  onProgress("Saving PDF...", 90);
  return pdfDoc.save();
}
