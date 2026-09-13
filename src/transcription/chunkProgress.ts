// Mirrors Transformers.js Whisper's 30-second window / 5-second overlap.
// Only completed inference windows advance the progress; time elapsed does not.
export function whisperChunkProgress(sampleCount: number, completedChunks: number) {
  const durationSeconds = sampleCount / 16_000;
  const totalChunks = Math.max(1, Math.ceil((durationSeconds - 30) / 20) + 1);
  const completed = Math.min(totalChunks, Math.max(0, completedChunks));
  const processedSeconds = completed === totalChunks ? durationSeconds : completed ? Math.min(durationSeconds, completed * 20 + 5) : 0;
  return { totalChunks, completedChunks: completed, processedSeconds, durationSeconds,
    progress: durationSeconds > 0 ? Math.min(99, Math.floor(processedSeconds / durationSeconds * 100)) : 0 };
}
