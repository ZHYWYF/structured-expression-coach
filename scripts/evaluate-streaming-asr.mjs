// Isolated candidate evaluation. Not imported by the app; does not install,
// download, write recordings, or change the active transcription provider.
import { createRequire } from "node:module";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

export function normalizeTranscript(text) {
  return text.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, "");
}

export function characterErrorRate(reference, hypothesis) {
  const expected = [...normalizeTranscript(reference)];
  const actual = [...normalizeTranscript(hypothesis)];
  if (!expected.length) return null;
  if (expected.length > 5000 || actual.length > 5000) throw new Error("请用不超过5000字的短录音进行字符错误率评估。");
  let previous = Array.from({ length: actual.length + 1 }, (_, index) => index);
  for (let row = 1; row <= expected.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= actual.length; column += 1) {
      current[column] = Math.min(current[column - 1] + 1, previous[column] + 1,
        previous[column - 1] + (expected[row - 1] === actual[column - 1] ? 0 : 1));
    }
    previous = current;
  }
  return { errors: previous[actual.length], referenceCharacters: expected.length, rate: previous[actual.length] / expected.length };
}

export function readPcmWav(buffer) {
  if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") throw new Error("需要16kHz单声道PCM16 WAV文件。");
  let format;
  let audio;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const name = buffer.toString("ascii", offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + length > buffer.length) throw new Error("WAV文件不完整。");
    if (name === "fmt " && length >= 16) format = { codec: buffer.readUInt16LE(start), channels: buffer.readUInt16LE(start + 2), rate: buffer.readUInt32LE(start + 4), bits: buffer.readUInt16LE(start + 14) };
    if (name === "data") audio = buffer.subarray(start, start + length);
    offset = start + length + length % 2;
  }
  if (format?.codec !== 1 || format.channels !== 1 || format.rate !== 16000 || format.bits !== 16 || !audio?.length || audio.length % 2) throw new Error("需要非空16kHz单声道PCM16 WAV文件，请先转换格式。");
  return Float32Array.from({ length: audio.length / 2 }, (_, index) => audio.readInt16LE(index * 2) / 32768);
}

export async function evaluateStreamingAsr({ runtimeDirectory, modelDirectory, audioFile, reference, chunkMs = 100, realtime = false }) {
  if (!Number.isInteger(chunkMs) || chunkMs < 20 || chunkMs > 1000) throw new Error("音频块需为20至1000毫秒的整数。");
  if (statSync(audioFile).size > 16_000 * 2 * 180 + 65536) throw new Error("候选评估仅接受三分钟以内的短录音。");
  const audio = readPcmWav(readFileSync(audioFile));
  if (audio.length > 16_000 * 180) throw new Error("候选评估仅接受三分钟以内的短录音。");
  const runtime = createRequire(resolve(runtimeDirectory, "package.json"))("sherpa-onnx-node");
  const files = ["encoder.int8.onnx", "decoder.int8.onnx", "tokens.txt"].map((file) => resolve(modelDirectory, file));
  const modelBytes = files.reduce((total, file) => total + statSync(file).size, 0);
  const startedAt = performance.now();
  const recognizer = new runtime.OnlineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: { paraformer: { encoder: files[0], decoder: files[1] }, tokens: files[2], numThreads: 1, provider: "cpu", debug: false },
    decodingMethod: "greedy_search", enableEndpoint: true,
    rule1MinTrailingSilence: 2.4, rule2MinTrailingSilence: 1.2, rule3MinUtteranceLength: 20,
  });
  const modelLoadMs = performance.now() - startedAt;
  const stream = recognizer.createStream();
  const events = [];
  const finalized = [];
  let partial = "";
  let decodeMs = 0;
  let peakRss = process.memoryUsage().rss;
  const streamingStart = performance.now();
  const blockSize = 16000 * chunkMs / 1000;
  async function feed(samples, audioSeconds, flush = false) {
    const workStart = performance.now();
    stream.acceptWaveform({ samples, sampleRate: 16000 });
    if (flush) stream.inputFinished();
    while (recognizer.isReady(stream)) recognizer.decode(stream);
    decodeMs += performance.now() - workStart;
    const text = (recognizer.getResult(stream).text ?? "").trim();
    const isFinal = flush || recognizer.isEndpoint(stream);
    if (text && (text !== partial || isFinal)) events.push({ audioSeconds, elapsedMs: performance.now() - streamingStart, text, isFinal, flush });
    partial = text;
    if (isFinal) {
      if (text) finalized.push(text);
      if (!flush) recognizer.reset(stream);
      partial = "";
    }
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }
  for (let offset = 0; offset < audio.length; offset += blockSize) {
    const end = Math.min(audio.length, offset + blockSize);
    if (realtime) {
      const waitMs = streamingStart + end / 16 - performance.now();
      if (waitMs > 0) await new Promise((done) => setTimeout(done, waitMs));
    }
    await feed(audio.subarray(offset, end), end / 16000);
  }
  // Right-context padding flushes the tail; it is excluded from audio duration.
  await feed(new Float32Array(16000), audio.length / 16000, true);
  const transcript = finalized.join("");
  return {
    candidate: "sherpa-onnx-streaming-paraformer-bilingual-zh-en-int8", platform: process.platform, architecture: process.arch,
    threads: 1, chunkMs, mode: realtime ? "模拟实时输入" : "快速离线馈入（非端到端延迟）", modelBytes,
    audioSeconds: audio.length / 16000, modelLoadMs, decodeMs, realtimeFactor: decodeMs / (audio.length / 16),
    firstText: events[0] ? { audioSeconds: events[0].audioSeconds, elapsedMs: events[0].elapsedMs } : null,
    peakSampledRssBytes: peakRss, transcript, events,
    characterErrorRate: reference === undefined ? null : characterErrorRate(reference, transcript),
    limitations: ["非Mac或Android实机验收", "无人工参考稿时不能评价准确率", "未与当前Whisper实现同机对照", "首字时间包含音频起始静音，不是逐词延迟", "仅测试识别，不代表批注响应速度", "未清理口头禅、重复或自我修正"],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const value = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
  const runtimeDirectory = value("--runtime"); const modelDirectory = value("--model-dir"); const audioFile = value("--audio");
  if (!runtimeDirectory || !modelDirectory || !audioFile) {
    console.error("用法：node scripts/evaluate-streaming-asr.mjs --runtime <独立运行库目录> --model-dir <INT8模型目录> --audio <16kHz单声道PCM16.wav> [--reference <人工逐字稿.txt>] [--chunk-ms 100] [--realtime]");
    process.exitCode = 1;
  } else {
    try {
      const referenceFile = value("--reference");
      const result = await evaluateStreamingAsr({ runtimeDirectory, modelDirectory, audioFile, reference: referenceFile ? readFileSync(referenceFile, "utf8").trim() : undefined,
        chunkMs: Number(value("--chunk-ms") ?? 100), realtime: args.includes("--realtime") });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } catch (error) { console.error(error instanceof Error ? error.message : "候选模型评估失败"); process.exitCode = 1; }
  }
}
