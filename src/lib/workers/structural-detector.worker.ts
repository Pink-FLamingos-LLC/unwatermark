import { PDFDocument } from "pdf-lib";
import { parseContentStream } from "./content-stream-parser";
import { detectWatermark, clusterImages } from "./structural-detector";
import type { WorkerMessage, ImagePlacement } from "./types";

interface PDFPageNode {
  Resources():
    | { get(key: unknown): { entries?(): Iterable<[unknown, unknown]> } | undefined }
    | undefined;
  Contents():
    | { getUnencodedContents?(): Uint8Array; getContents?(): Uint8Array }
    | { getUnencodedContents?(): Uint8Array; getContents?(): Uint8Array }[]
    | undefined;
}

function post(msg: WorkerMessage) {
  postMessage(msg);
}

async function processPdf(pdfBuffer: ArrayBuffer) {
  post({ type: "progress", stage: "Loading PDF..." });

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

  post({ type: "progress", stage: "Parsing image XObjects..." });

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

  post({ type: "progress", stage: "Detecting watermark..." });

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

  const { gridImages } = clusterImages(images);

  post({
    type: "result",
    watermark: watermark.box,
    images,
    gridImages,
  });
}

self.onmessage = async (e: MessageEvent<{ pdfBuffer: ArrayBuffer }>) => {
  try {
    await processPdf(e.data.pdfBuffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error during detection";
    post({ type: "error", message });
  }
};
