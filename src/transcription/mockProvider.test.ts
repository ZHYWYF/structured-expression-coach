import { afterEach, describe, expect, it, vi } from "vitest";
import { MockLocalTranscriptionProvider } from "./mockProvider";

describe("MockLocalTranscriptionProvider", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("按阶段回报进度，并返回带时间戳的中文分段", async () => {
    vi.useFakeTimers();
    const provider = new MockLocalTranscriptionProvider();
    const progress: number[] = [];

    const pending = provider.transcribe(
      { mode: "batch", audioName: "面试录音.wav", durationMs: 18_000 },
      (event) => progress.push(event.progress),
    );
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(progress).toEqual([0.12, 0.48, 0.82, 1]);
    expect(result.engine).toBe("mock-local");
    expect(result.model).toBe("high-accuracy-demo");
    expect(result.language).toBe("zh-CN");
    expect(result.segments).toHaveLength(3);
    expect(result.segments.every((segment) => segment.stable)).toBe(true);
    expect(result.segments.map((segment) => segment.text).join("")).toContain("任务完成率提升了九个百分点");
  });

  it("实时模式选择平衡模型并透传录音时长", async () => {
    vi.useFakeTimers();
    const provider = new MockLocalTranscriptionProvider();

    const pending = provider.transcribe({
      mode: "realtime",
      audioName: "实时练习.wav",
      durationMs: 7_500,
    });
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual(
      expect.objectContaining({
        engine: "mock-local",
        model: "balanced-demo",
        durationMs: 7_500,
        processingMs: 540,
      }),
    );
  });

  it("每次转写返回相互独立的分段对象", async () => {
    vi.useFakeTimers();
    const provider = new MockLocalTranscriptionProvider();

    const firstPending = provider.transcribe({
      mode: "batch",
      audioName: "第一次.wav",
      durationMs: 18_000,
    });
    await vi.runAllTimersAsync();
    const first = await firstPending;
    first.segments[0].text = "已被调用方修改";

    const secondPending = provider.transcribe({
      mode: "batch",
      audioName: "第二次.wav",
      durationMs: 18_000,
    });
    await vi.runAllTimersAsync();
    const second = await secondPending;

    expect(second.segments[0]).toEqual(
      expect.objectContaining({
        id: "demo-segment-1",
        text: "这次项目的目标，是降低新用户完成首次任务的操作成本。",
      }),
    );
    expect(second.segments[0]).not.toBe(first.segments[0]);
  });
});
