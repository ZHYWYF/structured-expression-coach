import { describe, expect, it } from "vitest";
import { buildInterviewAnswerPrompt, buildRecordingReportPrompt } from "./scenarioPrompts";

describe("scenario prompts", () => {
  it("uses different evaluation criteria for each recording scenario", () => {
    const interview = buildRecordingReportPrompt("interview", "回答").map((item) => item.content).join("\n");
    const report = buildRecordingReportPrompt("report", "汇报").map((item) => item.content).join("\n");
    const retrospective = buildRecordingReportPrompt("retrospective", "复盘").map((item) => item.content).join("\n");

    expect(interview).toContain("STAR");
    expect(report).toContain("结论先行");
    expect(retrospective).toContain("根因证据");
    expect(new Set([interview, report, retrospective]).size).toBe(3);
  });

  it("keeps JD, resume, question and answer in interview analysis", () => {
    const prompt = buildInterviewAnswerPrompt({ jobDescription: "JD", resume: "RESUME", question: "QUESTION", answer: "ANSWER" });
    const content = prompt.map((item) => item.content).join("\n");
    expect(content).toContain("JD");
    expect(content).toContain("RESUME");
    expect(content).toContain("QUESTION");
    expect(content).toContain("ANSWER");
  });
});
