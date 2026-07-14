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
};

export type WorkerResultMessage = {
  type: "result";
} & DetectionResult;

export type WorkerErrorMessage = {
  type: "error";
  message: string;
};

export type WorkerMessage = WorkerProgressMessage | WorkerResultMessage | WorkerErrorMessage;
