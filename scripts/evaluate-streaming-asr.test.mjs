import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ readFileSync: vi.fn(), statSync: vi.fn(), createRequire: vi.fn() }));
vi.mock("node:fs", () => ({ readFileSync: io.readFileSync, statSync: io.statSync }));
vi.mock("node:module", () => ({ createRequire: io.createRequire }));

import { characterErrorRate, evaluateStreamingAsr, normalizeTranscript, readPcmWav } from "./evaluate-streaming-asr.mjs";

function chunk(name, data) {
  const result = Buffer.alloc(8 + data.length + data.length % 2);
  result.write(name); result.writeUInt32LE(data.length, 4); data.copy(result, 8);
  return result;
}

function wav({ samples = [-32768, 0, 16384, 32767], codec = 1, channels = 1, rate = 16000, bits = 16, data, omitFormat = false, omitData = false } = {}) {
  const format = Buffer.alloc(16);
  format.writeUInt16LE(codec); format.writeUInt16LE(channels, 2); format.writeUInt32LE(rate, 4);
  format.writeUInt32LE(rate * channels * bits / 8, 8); format.writeUInt16LE(channels * bits / 8, 12); format.writeUInt16LE(bits, 14);
  const pcm = data ?? Buffer.alloc(samples.length * 2);
  if (!data) samples.forEach((value, index) => pcm.writeInt16LE(value, index * 2));
  const chunks = [chunk("JUNK", Buffer.from([1, 2, 3]))];
  if (!omitFormat) chunks.push(chunk("fmt ", format));
  if (!omitData) chunks.push(chunk("data", pcm));
  const header = Buffer.alloc(12); header.write("RIFF"); header.writeUInt32LE(chunks.reduce((sum, item) => sum + item.length, 4), 4); header.write("WAVE", 8);
  return Buffer.concat([header, ...chunks]);
}

beforeEach(() => vi.resetAllMocks());

describe("字符错误率", () => {
  it("统一全角、大小写和标点空白，保留有意义的口头禅与重复", () => {
    expect(normalizeTranscript(" ＡＢＣ，嗯……我 我！\n")).toBe("abc嗯我我");
    expect(characterErrorRate("ＡＢＣ，你好！", "abc你好")).toEqual({ errors: 0, referenceCharacters: 5, rate: 0 });
  });

  it.each([
    ["甲乙丙", "甲丁丙", 1, 3], ["甲乙丙", "甲丙", 1, 3], ["甲乙", "甲中乙", 1, 2],
    ["甲乙", "", 2, 2], ["甲", "甲乙丙", 2, 1], ["𠀀乙", "𠀁乙", 1, 2],
  ])("按字符计算编辑距离：%s → %s", (reference, hypothesis, errors, count) => {
    expect(characterErrorRate(reference, hypothesis)).toEqual({ errors, referenceCharacters: count, rate: errors / count });
  });

  it("空参考稿不伪报准确率，任一文本超过5000字符时拒绝计算", () => {
    expect(characterErrorRate(" ，\n", "合成结果")).toBeNull();
    expect(() => characterErrorRate("字".repeat(5001), "字")).toThrow("5000字");
    expect(() => characterErrorRate("字", "字".repeat(5001))).toThrow("5000字");
    expect(characterErrorRate("字".repeat(5000), "")).toEqual({ errors: 5000, referenceCharacters: 5000, rate: 1 });
  });
});

describe("readPcmWav", () => {
  it("跳过奇数字节附加块并将单声道PCM16端点正确归一化，不修改输入", () => {
    const buffer = wav(); const before = Buffer.from(buffer);
    const samples = readPcmWav(buffer);
    expect(samples).toBeInstanceOf(Float32Array);
    expect([...samples]).toEqual([-1, 0, 0.5, 32767 / 32768]);
    expect(buffer).toEqual(before);
  });

  it("拒绝非WAV头、截断块、缺失格式或音频块", () => {
    expect(() => readPcmWav(Buffer.from("非音频"))).toThrow("WAV");
    const brokenHeader = wav(); brokenHeader.write("MP3!", 0);
    expect(() => readPcmWav(brokenHeader)).toThrow("WAV");
    expect(() => readPcmWav(wav().subarray(0, wav().length - 1))).toThrow("不完整");
    expect(() => readPcmWav(wav({ omitFormat: true }))).toThrow("WAV");
    expect(() => readPcmWav(wav({ omitData: true }))).toThrow("WAV");
  });

  it.each([{ codec: 3 }, { channels: 2 }, { rate: 44100 }, { bits: 8 }, { data: Buffer.alloc(0) }, { data: Buffer.from([1]) }])("拒绝不符合非空16k单声道PCM16约束的输入：%j", (options) => {
    expect(() => readPcmWav(wav(options))).toThrow("非空16kHz单声道PCM16");
  });
});

describe("evaluateStreamingAsr", () => {
  const options = { runtimeDirectory: "/synthetic/runtime", modelDirectory: "/synthetic/model", audioFile: "/synthetic/audio.wav" };

  function runtime(texts = ["合", "合成", "合成文本"]) {
    const stream = { acceptWaveform: vi.fn(), inputFinished: vi.fn() };
    const recognizer = { createStream: vi.fn(() => stream), isReady: vi.fn(() => false), decode: vi.fn(),
      getResult: vi.fn(), isEndpoint: vi.fn(() => false), reset: vi.fn() };
    texts.forEach((text) => recognizer.getResult.mockReturnValueOnce({ text }));
    const OnlineRecognizer = vi.fn(function () { return recognizer; });
    const requireRuntime = vi.fn(() => ({ OnlineRecognizer }));
    io.createRequire.mockReturnValue(requireRuntime);
    const buffer = wav({ samples: Array(1700).fill(0) });
    io.readFileSync.mockReturnValue(buffer);
    io.statSync.mockImplementation((path) => ({ size: path === options.audioFile ? buffer.length : 10 }));
    return { stream, recognizer, OnlineRecognizer, requireRuntime };
  }

  it("块大小及超长音频在加载识别运行时前被拒绝", async () => {
    for (const chunkMs of [19, 1001, 20.5, NaN]) await expect(evaluateStreamingAsr({ ...options, chunkMs })).rejects.toThrow("20至1000毫秒");
    expect(io.statSync).not.toHaveBeenCalled();
    io.statSync.mockReturnValue({ size: 16_000 * 2 * 180 + 65537 });
    await expect(evaluateStreamingAsr(options)).rejects.toThrow("三分钟以内");
    expect(io.readFileSync).not.toHaveBeenCalled();
    io.statSync.mockReturnValue({ size: 1 });
    io.readFileSync.mockReturnValue(wav({ data: Buffer.alloc((16_000 * 180 + 1) * 2) }));
    await expect(evaluateStreamingAsr(options)).rejects.toThrow("三分钟以内");
    expect(io.createRequire).not.toHaveBeenCalled();
  });

  it("用合成音频分块和尾部刷新计算CER，识别器只使用一个线程", async () => {
    const { stream, recognizer, OnlineRecognizer, requireRuntime } = runtime();
    recognizer.isReady.mockReturnValueOnce(true).mockReturnValueOnce(false);
    const result = await evaluateStreamingAsr({ ...options, reference: "合成文本" });
    expect(requireRuntime).toHaveBeenCalledWith("sherpa-onnx-node");
    expect(OnlineRecognizer).toHaveBeenCalledWith(expect.objectContaining({ modelConfig: expect.objectContaining({ numThreads: 1, provider: "cpu" }) }));
    expect(stream.acceptWaveform.mock.calls.map(([item]) => item.samples.length)).toEqual([1600, 100, 16000]);
    expect(stream.inputFinished).toHaveBeenCalledTimes(1);
    expect(recognizer.decode).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ threads: 1, chunkMs: 100, transcript: "合成文本", modelBytes: 30, audioSeconds: 1700 / 16000,
      characterErrorRate: { errors: 0, referenceCharacters: 4, rate: 0 } });
    expect(result.events.at(-1)).toMatchObject({ isFinal: true, flush: true, audioSeconds: 1700 / 16000 });
    expect(result.firstText.audioSeconds).toBe(0.1);
    expect(result.realtimeFactor).toBeGreaterThanOrEqual(0);
    expect(result.mode).toContain("非端到端延迟");
    expect(result.limitations).toContain("未与当前Whisper实现同机对照");
  });

  it("端点重置后按顺序合并分段，没有参考稿时不输出准确率", async () => {
    const { recognizer } = runtime(["第一段", "第二", "第二段"]);
    recognizer.isEndpoint.mockReturnValueOnce(true);
    const result = await evaluateStreamingAsr(options);
    expect(recognizer.reset).toHaveBeenCalledTimes(1);
    expect(result.transcript).toBe("第一段第二段");
    expect(result.characterErrorRate).toBeNull();
    expect(result.events[0].isFinal).toBe(true);
  });

  it("静音合成输入不伪造首字或转写结果", async () => {
    runtime(["", "", ""]);
    const result = await evaluateStreamingAsr(options);
    expect(result.transcript).toBe("");
    expect(result.events).toEqual([]);
    expect(result.firstText).toBeNull();
    expect(result.characterErrorRate).toBeNull();
  });
});
