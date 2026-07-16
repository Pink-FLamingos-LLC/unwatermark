import { PDFDocument } from "pdf-lib";
import { detectWatermarkRegion, findBackgroundColor, type DetectionDebug } from "./visual-detector";
import type {
  BoundingBox,
  PdfDebugInfo,
  AlgorithmStageLog,
  WatermarkDetectionConfig,
} from "./types";

interface PDFPageNode {
  normalize(): void;
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

function canvasToDebugDataUrl(canvas: HTMLCanvasElement): string {
  const maxDim = 600;
  let w = canvas.width;
  let h = canvas.height;
  if (w > maxDim || h > maxDim) {
    const ratio = Math.min(maxDim / w, maxDim / h);
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);
  }
  const scaled = document.createElement("canvas");
  scaled.width = w;
  scaled.height = h;
  const ctx = scaled.getContext("2d")!;
  ctx.drawImage(canvas, 0, 0, w, h);
  return scaled.toDataURL("image/jpeg", 0.7);
}

function highlightWatermarkRegion(sourceCanvas: HTMLCanvasElement, box: BoundingBox): string {
  const canvas = document.createElement("canvas");
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(sourceCanvas, 0, 0);
  ctx.strokeStyle = "#FF0000";
  ctx.lineWidth = Math.max(3, Math.ceil(Math.max(canvas.width, canvas.height) / 500));
  ctx.strokeRect(box.x, box.y, box.width, box.height);
  return canvasToDebugDataUrl(canvas);
}

function cropComponentToDataUrl(sourceCanvas: HTMLCanvasElement, box: BoundingBox): string {
  const pad = Math.max(2, Math.ceil(Math.min(box.width, box.height) * 0.05));
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  const w = Math.min(box.width + pad * 2, sourceCanvas.width - x);
  const h = Math.min(box.height + pad * 2, sourceCanvas.height - y);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(sourceCanvas, x, y, w, h, 0, 0, w, h);

  ctx.strokeStyle = "#FF5500";
  ctx.lineWidth = Math.max(1, Math.ceil(Math.max(w, h) / 150));
  ctx.strokeRect(pad, pad, box.width, box.height);

  return canvasToDebugDataUrl(canvas);
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

    console.log("[visual] pdfjs render produced blank canvas");
    return null;
  } catch (err) {
    console.log("[visual] pdfjs render failed:", err, "(pdf-lib mode disabled)");
    return null;
  }
}

export interface VisualResult {
  processedPdf: Uint8Array;
  modifiedImage: Uint8Array;
}

export async function processPdfVisual(
  pdfBuffer: ArrayBuffer,
  manualSelections: BoundingBox[],
  onProgress: (stage: string, percent: number) => void,
  onDebug: (info: PdfDebugInfo) => void,
  detectionConfig?: WatermarkDetectionConfig,
): Promise<VisualResult> {
  const t0 = performance.now();
  const algorithmLogs: AlgorithmStageLog[] = [];

  function logStage(stage: string, details: Record<string, unknown> = {}) {
    algorithmLogs.push({
      stage,
      timestamp: (performance.now() - t0).toFixed(1) as unknown as number,
      details,
    });
  }

  onProgress("Loading PDF...", 0);

  const pdfDoc = await PDFDocument.load(pdfBuffer, { parseSpeed: 0 });
  const pages = pdfDoc.getPages();

  if (pages.length === 0) {
    throw new Error("PDF has no pages");
  }

  const page = pages[0];
  const pageNode = page.node as unknown as PDFPageNode;
  const mediaBox = pageNode.MediaBox();
  const llx = Number(mediaBox.get(0));
  const lly = Number(mediaBox.get(1));
  const urx = Number(mediaBox.get(2));
  const ury = Number(mediaBox.get(3));
  const pageWidth = urx - llx;
  const pageHeight = ury - lly;
  console.log(
    "[visual] PDF page dims: mediaBox=[",
    llx,
    lly,
    urx,
    ury,
    "] pageWidth=",
    pageWidth,
    "pageHeight=",
    pageHeight,
  );

  logStage("pdf-loaded", {
    pageCount: pages.length,
    pageWidth,
    pageHeight,
  });

  onProgress("Rendering page...", 10);

  let canvas: HTMLCanvasElement;
  const renderSource = "pdfjs";

  const pdfjsCanvas = await tryRenderWithPdfjs(pdfBuffer);
  if (pdfjsCanvas) {
    canvas = pdfjsCanvas;
    logStage("image-extraction", {
      source: "pdfjs (full page render)",
      canvasWidth: pdfjsCanvas.width,
      canvasHeight: pdfjsCanvas.height,
    });
    console.log("[visual] using pdfjs render");
  } else {
    logStage("image-extraction-failed", {
      reason: "pdfjs produced blank canvas",
    });
    console.log("[visual] pdfjs render failed, pdf-lib mode disabled");
    throw new Error("Could not render page: pdfjs produced blank canvas (pdf-lib mode disabled)");
  }

  const ctx = canvas.getContext("2d")!;
  const originalImageDataUrl = canvasToDebugDataUrl(canvas);

  logStage("render-source", {
    source: renderSource,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
  });

  console.log("[visual] render source:", renderSource, "canvas:", canvas.width, "x", canvas.height);

  onProgress("Analyzing pixels...", 40);

  let watermarkBoxes: BoundingBox[] = [];

  if (manualSelections.length > 0) {
    const scaleX = canvas.width / pageWidth;
    const scaleY = canvas.height / pageHeight;

    console.log(
      "[visual] MANUAL SELECTIONS count=",
      manualSelections.length,
      "pageWidth=",
      pageWidth,
      "pageHeight=",
      pageHeight,
    );
    console.log("[visual] MANUAL SELECTIONS canvas=", canvas.width, "x", canvas.height);
    console.log("[visual] MANUAL SELECTIONS scale=", scaleX, scaleY);

    for (const sel of manualSelections) {
      const box: BoundingBox = {
        x: Math.max(0, Math.min(Math.round(sel.x * scaleX), canvas.width - 1)),
        y: Math.max(0, Math.min(Math.round(sel.y * scaleY), canvas.height - 1)),
        width: Math.min(
          Math.round(sel.width * scaleX),
          canvas.width - Math.max(0, Math.min(Math.round(sel.x * scaleX), canvas.width - 1)),
        ),
        height: Math.min(
          Math.round(sel.height * scaleY),
          canvas.height - Math.max(0, Math.min(Math.round(sel.y * scaleY), canvas.height - 1)),
        ),
      };

      if (box.width > 0 && box.height > 0) {
        watermarkBoxes.push(box);
      }
    }

    console.log("[visual] MANUAL SELECTIONS canvas boxes:", JSON.stringify(watermarkBoxes));

    if (watermarkBoxes.length > 0) {
      logStage("manual-selections", {
        count: watermarkBoxes.length,
        selections: watermarkBoxes,
      });
    } else {
      logStage("manual-selections-empty", {
        reason: "all selections had zero area after clamping",
      });
    }
  } else {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const detectionDebug: DetectionDebug = {} as DetectionDebug;

    logStage("background-detection-start", {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    });

    const detected = detectWatermarkRegion(
      imageData.data,
      canvas.width,
      canvas.height,
      detectionConfig,
      detectionDebug,
    );
    watermarkBoxes = detected ? [detected] : [];

    const componentBreakdown = (detectionDebug.components || []).map((c) => ({
      ...c,
      imageDataUrl: cropComponentToDataUrl(canvas, c.bounds),
    }));

    logStage("component-detection", {
      componentsFound: detectionDebug.componentsFound || 0,
      clustersFound: detectionDebug.clustersFound || 0,
      cardBlockPixels: detectionDebug.cardBlockPixels || 0,
      cardBlockComponents: detectionDebug.cardBlockComponents || 0,
      watermarkCandidates: detectionDebug.watermarkCandidates || 0,
      selectedWatermarkPixels: detectionDebug.selectedWatermarkPixels || 0,
      totalPixels: detectionDebug.totalPixels || 0,
      proximityThreshold: detectionDebug.proximityThreshold || 0,
      samplingStep: detectionDebug.samplingStep || 0,
      componentBreakdown,
    });
  }

  const pixelData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const bgColor = findBackgroundColor(pixelData, canvas.width, canvas.height);

  logStage("background-color-detected", {
    r: bgColor.r,
    g: bgColor.g,
    b: bgColor.b,
  });

  const watermarkHighlightDataUrl =
    watermarkBoxes.length > 0 ? highlightWatermarkRegion(canvas, watermarkBoxes[0]) : undefined;

  if (watermarkBoxes.length === 0) {
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

    const diagnostic = `source: ${renderSource}, non-white: ${nonWhiteCount}/${totalSampled}, lum: ${minLum.toFixed(0)}-${maxLum.toFixed(0)}`;
    logStage("detection-failed", {
      diagnostic,
      totalTime: `${(performance.now() - t0).toFixed(0)}ms`,
    });

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
        detectionMethod: manualSelections.length > 0 ? "manual" : "automatic",
        renderScale: 1,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        watermarkBox: { x: 0, y: 0, width: 0, height: 0 },
        bgColor,
        imageFormat: "none",
        imageSizeBytes: 0,
        diagnostic,
        renderSource,
        algorithmLogs,
        originalImageDataUrl,
      },
    });
    throw new Error("No watermark detected visually. Try manual selection.");
  }

  const firstBox = watermarkBoxes[0];
  logStage("watermark-identified", {
    count: watermarkBoxes.length,
    firstBox: firstBox
      ? { x: firstBox.x, y: firstBox.y, width: firstBox.width, height: firstBox.height }
      : undefined,
    method: manualSelections.length > 0 ? "manual" : "automatic",
  });

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
      detectionMethod: manualSelections.length > 0 ? "manual" : "automatic",
      renderScale: 1,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      watermarkBox: firstBox || { x: 0, y: 0, width: 0, height: 0 },
      bgColor,
      imageFormat: "pending",
      imageSizeBytes: 0,
      renderSource,
      algorithmLogs,
      originalImageDataUrl,
      watermarkHighlightDataUrl,
    },
  });

  const paintStart = performance.now();
  const paintedRegions: Record<string, unknown>[] = [];
  for (const box of watermarkBoxes) {
    await paintOverRegion(canvas, box, bgColor);
    paintedRegions.push({
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    });
  }
  logStage("paint-over-complete", {
    regions: paintedRegions,
    bgColor,
    timeMs: `${(performance.now() - paintStart).toFixed(0)}ms`,
  });

  onProgress("Encoding modified image...", 70);

  const encodeStart = performance.now();
  const encoded = await encodeCanvas(canvas);
  logStage("encode-complete", {
    format: encoded.format,
    sizeBytes: encoded.bytes.length,
    timeMs: `${(performance.now() - encodeStart).toFixed(0)}ms`,
  });

  logStage("summary", {
    totalTime: `${(performance.now() - t0).toFixed(0)}ms`,
    detectionMethod: manualSelections.length > 0 ? "manual" : "automatic",
    renderSource,
    finalImageFormat: encoded.format,
    finalImageSize: encoded.bytes.length,
  });

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
      detectionMethod: manualSelections.length > 0 ? "manual" : "automatic",
      renderScale: 1,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      watermarkBox: firstBox || { x: 0, y: 0, width: 0, height: 0 },
      bgColor,
      imageFormat: encoded.format,
      imageSizeBytes: encoded.bytes.length,
      renderSource,
      algorithmLogs,
      originalImageDataUrl,
      watermarkHighlightDataUrl,
    },
  });

  onProgress("Replacing image in PDF...", 80);

  const newImage = pdfDoc.context.stream(encoded.bytes, {
    Type: "XObject",
    Subtype: "Image",
    Width: canvas.width,
    Height: canvas.height,
    BitsPerComponent: 8,
    ColorSpace: "DeviceRGB",
    Filter: encoded.format === "jpeg" ? "DCTDecode" : "FlateDecode",
  });
  const imageRef = pdfDoc.context.register(newImage);

  const contentStr = `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /img Do Q`;
  const contentBytes = new TextEncoder().encode(contentStr);
  const contentStream = pdfDoc.context.stream(contentBytes);
  const contentRef = pdfDoc.context.register(contentStream);

  pageNode.normalize();

  // Clear old XObject entries to avoid decoder warnings on orphaned images
  const leaf = pageNode as any;
  const xobjectDict = leaf.normalizedEntries().XObject;
  if (xobjectDict) {
    const keys = xobjectDict.keys();
    for (const key of keys) {
      xobjectDict.delete(key);
    }
  }
  xobjectDict.set(pdfDoc.context.obj("img"), imageRef);

  pageNode.set(pdfDoc.context.obj("Contents"), pdfDoc.context.obj([contentRef]));

  onProgress("Saving PDF...", 90);
  const processedPdf = await pdfDoc.save();
  return { processedPdf, modifiedImage: encoded.bytes };
}
