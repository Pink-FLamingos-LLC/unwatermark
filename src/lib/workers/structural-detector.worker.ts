import { PDFDocument } from "pdf-lib";
import { parseContentStream } from "./content-stream-parser";
import { detectWatermark } from "./structural-detector";
import type { WorkerMessage, ImagePlacement } from "./types";

interface PDFStreamLike {
  getUnencodedContents?(): Uint8Array;
  getContents?(): Uint8Array;
  dict?: { get?(key: unknown): unknown };
}

interface PDFPageNode {
  Resources():
    | {
        get(
          key: unknown,
        ): { entries?(): Iterable<[unknown, unknown]>; delete?(key: unknown): void } | undefined;
      }
    | undefined;
  Contents(): PDFStreamLike | PDFStreamLike[] | undefined;
  set(key: unknown, value: unknown): void;
}

function post(msg: WorkerMessage) {
  postMessage(msg);
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

async function processPdf(pdfBuffer: ArrayBuffer) {
  post({ type: "progress", stage: "Loading PDF...", percent: 0 });

  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages = pdfDoc.getPages();

  if (pages.length === 0) {
    post({ type: "error", message: "PDF has no pages" });
    return;
  }

  const page = pages[0];
  const pageNode = page.node as unknown as PDFPageNode;

  const resources = pageNode.Resources();
  if (!resources) {
    post({ type: "error", message: "Page has no resources" });
    return;
  }

  const xobjectDict = resources.get(pdfDoc.context.obj("/XObject"));
  if (!xobjectDict) {
    post({ type: "error", message: "No XObjects found on page" });
    return;
  }

  post({ type: "progress", stage: "Parsing image XObjects...", percent: 20 });

  const xobjectNames = new Set<string>();
  const dictMap = xobjectDict.entries ? xobjectDict.entries() : [];

  for (const [key] of dictMap) {
    const rawName = key as string | { decodeText?(): string };
    const name =
      typeof rawName === "string" ? rawName : (rawName.decodeText?.() ?? String(rawName));
    const cleanName = name.startsWith("/") ? name.substring(1) : name;
    xobjectNames.add(cleanName);
  }

  const contents = pageNode.Contents();
  let contentStr = "";

  if (contents) {
    if (Array.isArray(contents)) {
      for (const stream of contents) {
        const bytes = stream.getUnencodedContents?.() ?? stream.getContents?.();
        if (bytes) {
          contentStr += new TextDecoder().decode(bytes) + "\n";
        }
      }
    } else {
      const bytes = contents.getUnencodedContents?.() ?? contents.getContents?.();
      if (bytes) {
        contentStr = new TextDecoder().decode(bytes);
      }
    }
  }

  if (!contentStr) {
    post({ type: "error", message: "Could not read page content stream" });
    return;
  }

  post({ type: "progress", stage: "Detecting watermark...", percent: 40 });

  const images: ImagePlacement[] = parseContentStream(contentStr, xobjectNames);

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

  if (contents) {
    const streams = Array.isArray(contents) ? contents : [contents];
    for (const stream of streams) {
      if (stream.dict) {
        const encoder = new TextEncoder();
        const newBytes = encoder.encode(cleanedContent);

        const newStream = pdfDoc.context.stream(newBytes, {
          Type: "XObject",
          Subtype: "Form",
        });

        const streamRef = pdfDoc.context.register(newStream);
        pageNode.set(pdfDoc.context.obj("Contents"), pdfDoc.context.obj([streamRef]));
        break;
      }
    }
  }

  post({ type: "progress", stage: "Saving PDF...", percent: 80 });

  const processedPdf = await pdfDoc.save();

  post({
    type: "result",
    processedPdf,
  });
}

if (typeof self !== "undefined") {
  self.onmessage = async (e: MessageEvent<{ pdfBuffer: ArrayBuffer }>) => {
    try {
      await processPdf(e.data.pdfBuffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error during processing";
      post({ type: "error", message });
    }
  };
}
