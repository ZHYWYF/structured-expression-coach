import { describe, expect, it } from "vitest";
import { whisperChunkProgress } from "./chunkProgress";

describe("Whisper分段处理进度", () => {
  it.each([[1, 1], [30, 1], [31, 2], [50, 2], [51, 3], [877, 44]])("%s秒音频对应%s段", (seconds, chunks) => {
    expect(whisperChunkProgress(seconds * 16000, 0).totalChunks).toBe(chunks);
  });
  it("长录音仅在实际处理分段完成后增加进度，合并前不显示100%", () => {
    const counts = Array.from({ length: 45 }, (_, index) => whisperChunkProgress(877 * 16000, index));
    expect(counts[0].progress).toBe(0);
    expect(counts[1].processedSeconds).toBe(25);
    expect(counts[43].processedSeconds).toBe(865);
    expect(counts[44]).toMatchObject({ processedSeconds: 877, progress: 99, completedChunks: 44 });
    expect(counts.every((item, index) => !index || item.progress >= counts[index - 1].progress)).toBe(true);
  });
});
