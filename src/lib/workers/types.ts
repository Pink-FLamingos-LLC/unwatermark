export interface WatermarkDetectionConfig {
  cardProximityFactor?: number; // fraction of imgWidth (default 0.02)
  wmProximityFactor?: number; // fraction of imgWidth (default 0.02)
  minWatermarkAreaRatio?: number; // fraction of totalPixels (default 0.01)
}

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
  visual?: VisualDebugInfo;
}

export interface AlgorithmStageLog {
  stage: string;
  timestamp: number;
  details: Record<string, unknown>;
}

export interface VisualDebugInfo {
  detectionMethod: "automatic" | "manual";
  renderScale: number;
  canvasWidth: number;
  canvasHeight: number;
  watermarkBox: BoundingBox;
  bgColor: { r: number; g: number; b: number };
  imageFormat: string;
  imageSizeBytes: number;
  diagnostic?: string;
  renderSource?: string;
  algorithmLogs?: AlgorithmStageLog[];
  originalImageDataUrl?: string;
  watermarkHighlightDataUrl?: string;
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
