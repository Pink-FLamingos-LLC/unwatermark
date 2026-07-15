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
  onProgress("Loading PDF for visual detection...", 0);

  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const workerUrl = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

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

  onProgress("Rendering page to canvas...", 10);

  const doc = await pdfjsLib.getDocument({ data: pdfBuffer.slice(0) }).promise;
  const pdfPage = await doc.getPage(1);
  const baseViewport = pdfPage.getViewport({ scale: 1 });
  const maxDim = Math.max(baseViewport.width, baseViewport.height);
  const renderScale = Math.max(1, Math.min(4, Math.ceil(2000 / maxDim)));
  const viewport = pdfPage.getViewport({ scale: renderScale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d")!;

  await pdfPage.render({
    canvas,
    canvasContext: ctx,
    viewport,
  }).promise;

  console.log("[visual] canvas:", canvas.width, "x", canvas.height);
  console.log("[visual] viewport:", viewport.width, "x", viewport.height);

  const dbgPixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let nonWhiteCount = 0;
  let minLum = 255;
  let darkestX = 0;
  let darkestY = 0;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const idx = (y * canvas.width + x) * 4;
      const lum = dbgPixels[idx] * 0.299 + dbgPixels[idx + 1] * 0.587 + dbgPixels[idx + 2] * 0.114;
      if (lum < 245) nonWhiteCount++;
      if (lum < minLum) {
        minLum = lum;
        darkestX = x;
        darkestY = y;
      }
    }
  }
  console.log("[visual] non-white pixels:", nonWhiteCount, "/", canvas.width * canvas.height);
  console.log("[visual] min luminance:", minLum, "at", darkestX, darkestY);
  if (nonWhiteCount > 0) {
    const didx = (darkestY * canvas.width + darkestX) * 4;
    console.log("[visual] darkest RGB:", dbgPixels[didx], dbgPixels[didx + 1], dbgPixels[didx + 2]);
  }

  onProgress("Analyzing image pixels...", 40);

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
        renderScale,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        watermarkBox: { x: 0, y: 0, width: 0, height: 0 },
        bgColor,
        imageFormat: "none",
        imageSizeBytes: 0,
        diagnostic: `non-white pixels: ${nonWhiteCount}/${totalSampled} sampled, luminance range: ${minLum.toFixed(0)}-${maxLum.toFixed(0)}`,
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
      renderScale,
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

  let imageBytes: Uint8Array;
  let imageFormat = "jpeg";
  try {
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        "image/jpeg",
        0.92,
      );
    });
    const buf = await blob.arrayBuffer();
    imageBytes = new Uint8Array(buf);
  } catch {
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
    });
    const buf = await blob.arrayBuffer();
    imageBytes = new Uint8Array(buf);
    imageFormat = "png";
  }

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
      renderScale,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      watermarkBox,
      bgColor,
      imageFormat,
      imageSizeBytes: imageBytes.length,
    },
  });

  onProgress("Building new PDF...", 80);

  const xobjectDict = pageNode.Resources()?.get?.(pdfDoc.context.obj("/XObject"));
  if (xobjectDict?.entries) {
    for (const [key] of xobjectDict.entries()) {
      xobjectDict.delete?.(key);
    }
  }

  const newImage = pdfDoc.context.stream(imageBytes, {
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

  const imgDict = pageNode.Resources()?.get?.(pdfDoc.context.obj("/XObject"));
  if (imgDict) {
    (imgDict as { set(key: unknown, value: unknown): void }).set(
      pdfDoc.context.obj("/img"),
      imageRef,
    );
  }

  onProgress("Saving PDF...", 90);
  return pdfDoc.save();
}
