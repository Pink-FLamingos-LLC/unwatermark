export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImagePlacement {
  name: string;
  box: BoundingBox;
}

export interface DetectionResult {
  watermark: BoundingBox | null;
  images: ImagePlacement[];
  gridImages: ImagePlacement[];
}

export interface PdfDebugInfo {
	pageCount: number;
	pageWidth: number;
	pageHeight: number;
	resources: Record<string, string[]>;
	xobjectNames: string[];
	xobjectTypes: Record<string, string>;
	contentStreamLength: number;
	contentStreamRaw?: string;
	imagePlacements: ImagePlacement[];
	detectionResult: DetectionResult | null;
}

export type WorkerProgressMessage = {
  type: "progress";
  stage: string;
  percent: number;
};

export type WorkerResultMessage = {
  type: "result";
  processedPdf: Uint8Array;
};

export type WorkerDebugMessage = {
  type: "debug";
  info: PdfDebugInfo;
};

export type WorkerErrorMessage = {
  type: "error";
  message: string;
};

export type WorkerMessage =
  | WorkerProgressMessage
  | WorkerResultMessage
  | WorkerDebugMessage
  | WorkerErrorMessage;
