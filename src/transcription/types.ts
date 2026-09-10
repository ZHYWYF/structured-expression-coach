export type TranscriptionMode = "realtime" | "batch";
export type TranscriptionEngine = "mock-local" | "whisper-cpp" | "sherpa-onnx" | "online";

export interface TranscriptSegment {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  stable: boolean;
  speakerLabel?: string;
}

export interface TranscriptionProgress {
  stage: "preparing" | "running" | "finalizing" | "completed" | "failed";
  progress: number;
  message: string;
}

export interface TranscriptionResult {
  revisionId: string;
  engine: TranscriptionEngine;
  model: string;
  language: string;
  segments: TranscriptSegment[];
  durationMs: number;
  processingMs: number;
}

export interface TranscriptionRequest {
  mode: TranscriptionMode;
  audioName: string;
  durationMs: number;
  hotwords?: string[];
}

export interface TranscriptionProvider {
  readonly id: TranscriptionEngine;
  readonly displayName: string;
  transcribe(
    request: TranscriptionRequest,
    onProgress?: (progress: TranscriptionProgress) => void,
  ): Promise<TranscriptionResult>;
}

export interface ModelProfile {
  id: string;
  label: string;
  engine: TranscriptionEngine;
  accuracyTier: "balanced" | "high";
  installed: boolean;
  sizeLabel: string;
  recommendation: string;
}
