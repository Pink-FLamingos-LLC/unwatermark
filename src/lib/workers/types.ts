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

export type WorkerProgressMessage = {
  type: "progress";
  stage: string;
  percent: number;
};

export type WorkerResultMessage = {
  type: "result";
  processedPdf: Uint8Array;
};

export type WorkerErrorMessage = {
  type: "error";
  message: string;
};

export type WorkerMessage = WorkerProgressMessage | WorkerResultMessage | WorkerErrorMessage;
