import { PDFDocument } from "pdf-lib";
import { parseContentStream } from "./content-stream-parser";
import { detectWatermark } from "./structural-detector";
import type { WorkerMessage, ImagePlacement, DetectionMethod } from "./types";

interface PDFStreamLike {
  getUnencodedContents?(): Uint8Array;
  getContents?(): Uint8Array;
  dict?: { get?(key: unknown): unknown };
}

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

function post(msg: WorkerMessage) {
  postMessage(msg);
}

function decodePdfName(raw: unknown): string {
  const rawName = raw as string | { decodeText?(): string };
  const name = typeof rawName === "string" ? rawName : (rawName.decodeText?.() ?? String(rawName));
  return name.startsWith("/") ? name.substring(1) : name;
}

export function removeWatermarkFromContentStream(content: string, watermarkName: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let pending: string[] = [];
  let skipNextQ = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(/\s+/);
    const operator = parts[parts.length - 1];

    if (operator === "q") {
      result.push(...pending);
      pending = [line];
      skipNextQ = false;
    } else if (operator === "Q") {
      if (skipNextQ) {
        pending = [];
        skipNextQ = false;
      } else {
        result.push(...pending);
        result.push(line);
        pending = [];
      }
    } else if (operator === "Do") {
      const name = parts.length >= 2 ? parts[parts.length - 2].replace(/^\//, "") : "";
      if (name === watermarkName) {
        pending = [];
        skipNextQ = true;
      } else {
        result.push(...pending);
        result.push(line);
        pending = [];
      }
    } else {
      pending.push(line);
    }
  }

  result.push(...pending);
  return result.join("\n");
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

async function decompressFlate(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    const ds = new DecompressionStream("deflate");
    const writer = ds.writable.getWriter();
    writer.write(data.slice());
    writer.close();
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  } catch {
    return null;
  }
}

async function processPdf(pdfBuffer: ArrayBuffer, detectionMethod: DetectionMethod) {
  if (detectionMethod === "visual") {
    post({
      type: "error",
      message: "Visual detection is not yet implemented. Please use Structural detection.",
    });
    return;
  }

  post({ type: "progress", stage: "Loading PDF...", percent: 0 });

  const pdfDoc = await PDFDocument.load(pdfBuffer, { parseSpeed: 0 });
  const pages = pdfDoc.getPages();

  if (pages.length === 0) {
    post({ type: "error", message: "PDF has no pages" });
    return;
  }

  const page = pages[0];
  const pageNode = page.node as unknown as PDFPageNode;
  pageNode.normalize?.();

  const mediaBox = pageNode.MediaBox();
  const pageWidth = Number(mediaBox.get(2));
  const pageHeight = Number(mediaBox.get(3));

  const resources = pageNode.Resources();

  const debugResources: Record<string, string[]> = {};
  if (resources?.entries) {
    for (const [key, value] of resources.entries()) {
      const name = decodePdfName(key);
      if (value && typeof value === "object" && "entries" in value) {
        const subKeys: string[] = [];
        for (const [subKey] of (value as { entries(): Iterable<[unknown, unknown]> }).entries()) {
          subKeys.push(decodePdfName(subKey));
        }
        debugResources[name] = subKeys;
      } else {
        debugResources[name] = [];
      }
    }
  }

  if (!resources) {
    post({
      type: "debug",
      info: {
        pageCount: pages.length,
        pageWidth,
        pageHeight,
        resources: debugResources,
        xobjectNames: [],
        xobjectTypes: {},
        contentStreamLength: 0,
        imagePlacements: [],
        detectionResult: null,
      },
    });
    post({ type: "error", message: "Page has no resources" });
    return;
  }

  let xobjectDict = resources.get(pdfDoc.context.obj("/XObject"));
  if (!xobjectDict && resources.entries) {
    for (const [key, value] of resources.entries()) {
      if (decodePdfName(key) === "XObject") {
        xobjectDict = value as {
          entries?(): Iterable<[unknown, unknown]>;
          delete?(key: unknown): void;
        };
        break;
      }
    }
  }
  if (!xobjectDict) {
    post({
      type: "debug",
      info: {
        pageCount: pages.length,
        pageWidth,
        pageHeight,
        resources: debugResources,
        xobjectNames: [],
        xobjectTypes: {},
        contentStreamLength: 0,
        imagePlacements: [],
        detectionResult: null,
      },
    });
    post({ type: "error", message: "No XObjects found on page" });
    return;
  }

  post({ type: "progress", stage: "Parsing image XObjects...", percent: 20 });

  const xobjectNames: string[] = [];
  const xobjectTypes: Record<string, string> = {};
  const dictMap = xobjectDict.entries ? xobjectDict.entries() : [];

  for (const [key, value] of dictMap) {
    const cleanName = decodePdfName(key);
    xobjectNames.push(cleanName);
    if (value && typeof value === "object") {
      const dict = value as { get?(key: unknown): unknown };
      const subtype = dict.get?.("/Subtype");
      xobjectTypes[cleanName] = subtype ? decodePdfName(subtype) : "unknown";
    } else {
      xobjectTypes[cleanName] = "unknown";
    }
  }

  // Resolve Contents — may be a PDFArray with indirect refs, a single stream, or undefined
  let contentsRaw = pageNode.Contents();
  let resolvedStreams: PDFStreamLike[] = [];
  let contentsInfo = "none";

  if (
    contentsRaw &&
    typeof contentsRaw === "object" &&
    "size" in contentsRaw &&
    "get" in contentsRaw
  ) {
    const arr = contentsRaw as { size(): number; get(index: number): unknown };
    const size = arr.size();
    contentsInfo = `array(${size})`;
    for (let i = 0; i < size; i++) {
      const elem = arr.get(i);
      const stream = resolveStream(pdfDoc, elem);
      if (stream) {
        resolvedStreams.push(stream);
        const bytes = readStreamBytes(stream);
        contentsInfo += ` [${i}: resolved, ${bytes?.length ?? 0} bytes]`;
      } else {
        const keys =
          elem && typeof elem === "object"
            ? Object.keys(elem as object)
                .slice(0, 5)
                .join(",")
            : typeof elem;
        contentsInfo += ` [${i}: unresolved (${keys})]`;
      }
    }
  } else if (contentsRaw) {
    const stream = resolveStream(pdfDoc, contentsRaw);
    if (stream) {
      resolvedStreams.push(stream);
      contentsInfo = "single stream";
    }
  }

  // Fallback: try direct dict access
  if (resolvedStreams.length === 0 && pageNode.get) {
    const raw = pageNode.get(pdfDoc.context.obj("/Contents"));
    if (raw && typeof raw === "object" && "size" in raw && "get" in raw) {
      const arr = raw as { size(): number; get(index: number): unknown };
      contentsInfo = `fallback-array(${arr.size()})`;
      for (let i = 0; i < arr.size(); i++) {
        const stream = resolveStream(pdfDoc, arr.get(i));
        if (stream) resolvedStreams.push(stream);
      }
    } else {
      const stream = resolveStream(pdfDoc, raw);
      if (stream) {
        resolvedStreams.push(stream);
        contentsInfo = "fallback-direct";
      }
    }
  }

  // Read bytes from resolved streams, try decompression if needed
  let contentStr = "";
  for (const stream of resolvedStreams) {
    const bytes = readStreamBytes(stream);
    if (!bytes) continue;

    const text = new TextDecoder().decode(bytes);
    const isReadable = /^[\x20-\x7E\r\n\t]*$/.test(text.substring(0, 100));
    if (isReadable) {
      contentStr += text + "\n";
    } else {
      const decompressed = await decompressFlate(bytes);
      if (decompressed) {
        contentStr += new TextDecoder().decode(decompressed) + "\n";
      } else {
        contentStr += text + "\n";
      }
    }
  }

  if (!contentStr && resolvedStreams.length > 0) {
    const stream = resolvedStreams[0];
    const keys = Object.getOwnPropertyNames(Object.getPrototypeOf(stream));
    contentsInfo += ` (0 bytes, proto keys: ${keys.join(",")})`;
  }

  if (!contentStr) {
    post({
      type: "debug",
      info: {
        pageCount: pages.length,
        pageWidth,
        pageHeight,
        resources: { ...debugResources, _contents: [contentsInfo] },
        xobjectNames,
        xobjectTypes,
        contentStreamLength: 0,
        imagePlacements: [],
        detectionResult: null,
      },
    });
    post({
      type: "error",
      message:
        "Could not read page content stream (Contents: " +
        contentsInfo +
        ", XObjects found: " +
        xobjectNames.length +
        ")",
    });
    return;
  }

  post({ type: "progress", stage: "Detecting watermark...", percent: 40 });

  const images: ImagePlacement[] = parseContentStream(contentStr, new Set(xobjectNames));

  const detectionResult =
    images.length > 0
      ? (() => {
          const watermark = detectWatermark(images);
          const gridImages = images.filter((img) => img !== watermark);
          return { watermark: watermark?.box ?? null, images, gridImages };
        })()
      : null;

  post({
    type: "debug",
    info: {
      pageCount: pages.length,
      pageWidth,
      pageHeight,
      resources: debugResources,
      xobjectNames,
      xobjectTypes,
      contentStreamLength: contentStr.length,
      contentStreamRaw: contentStr,
      imagePlacements: images,
      detectionResult,
    },
  });

  if (images.length === 0) {
    post({ type: "error", message: "No images found on page" });
    return;
  }

  const watermark = detectWatermark(images);
  if (!watermark) {
    post({ type: "error", message: "No watermark detected" });
    return;
  }

  post({ type: "progress", stage: "Removing watermark...", percent: 60 });

  const watermarkName = watermark.name;
  xobjectDict.delete?.(pdfDoc.context.obj(`/${watermarkName}`));

  const cleanedContent = removeWatermarkFromContentStream(contentStr, watermarkName);

  if (resolvedStreams.length > 0) {
    const stream = resolvedStreams[0];
    if (stream.dict) {
      const encoder = new TextEncoder();
      const newBytes = encoder.encode(cleanedContent);
      const newStream = pdfDoc.context.stream(newBytes, { Type: "XObject", Subtype: "Form" });
      const streamRef = pdfDoc.context.register(newStream);
      pageNode.set(pdfDoc.context.obj("Contents"), pdfDoc.context.obj([streamRef]));
    }
  }

  post({ type: "progress", stage: "Saving PDF...", percent: 80 });
  const processedPdf = await pdfDoc.save();
  post({ type: "result", processedPdf });
}

if (typeof self !== "undefined") {
  self.onmessage = async (
    e: MessageEvent<{ pdfBuffer: ArrayBuffer; detectionMethod: DetectionMethod }>,
  ) => {
    try {
      await processPdf(e.data.pdfBuffer, e.data.detectionMethod);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error during processing";
      post({ type: "error", message });
    }
  };
}
