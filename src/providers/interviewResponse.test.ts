import { describe, expect, it } from "vitest";
import { parseInterviewFeedback, parseInterviewQuestions } from "./interviewResponse";
const jd = "北京·校招·正式·职位ID：A165667\n负责产品数据分析。";
const resume = "参与支付项目的需求分析。";
const answer = "我负责需求分析，结果通过验收。";
const feedback = { structure: "结构建议", jdMatch: "岗位匹配建议", resumeConsistency: "材料一致", evidenceStrength: "证据建议", overallSuggestion: "补充决策依据",
  answerFramework: ["结论", "行动", "结果"], referenceAnswer: "我在支付项目中负责需求分析，结果通过验收。决策依据是【待补充：真实选择理由】。",
  revisionNotes: ["先说明个人职责，再给出可验证结果"], missingFacts: ["真实选择理由"], supportingEvidence: [{ source: "resume", quote: resume }, { source: "answer", quote: answer }] };
describe("面试AI结果校验", () => {
  it("接受有依据的新问题，过滤元信息题和重复题", () => {
    const content = JSON.stringify({ questions: [{ text: "请讲一次你用数据推动产品决策的经历。", tag: "数据分析", jdEvidence: "负责产品数据分析", suggestedMinutes: 3 }, { text: "如何体现北京和校招职位ID？", tag: "元信息", jdEvidence: "北京·校招·正式·职位ID：A165667" }] });
    const parsed = parseInterviewQuestions(content, jd, resume, []);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].jdEvidence).toBe("负责产品数据分析");
    expect(() => parseInterviewQuestions(content, jd, resume, parsed)).toThrow("新的");
  });
  it("没有JD职责但有真实简历引用仍可出题", () => {
    const content = JSON.stringify({ questions: [{ text: "请展开支付项目的需求分析过程。", tag: "项目", resumeEvidence: resume }] });
    expect(parseInterviewQuestions(content, jd, resume, [])[0].resumeEvidence).toBe(resume);
    expect(() => parseInterviewQuestions(content, jd, "", [])).toThrow();
  });
  it("参考稿带框架、修改依据与原文快照，旧报告不冒充参考稿", () => {
    const result = parseInterviewFeedback(JSON.stringify(feedback), { resume, answer });
    expect(result.referenceAnswer).toBe(feedback.referenceAnswer);
    expect(result.answerSnapshot).toBe(answer);
    const legacy = { ...feedback, referenceAnswer: undefined };
    expect(parseInterviewFeedback(JSON.stringify(legacy), { resume, answer }).referenceAnswer).toBeUndefined();
  });
  it("拒绝虚构引用及材料中没有的数字", () => {
    expect(() => parseInterviewFeedback(JSON.stringify({ ...feedback, supportingEvidence: [{ source: "resume", quote: "主导国际项目" }] }), { resume, answer })).toThrow("不存在");
    expect(() => parseInterviewFeedback(JSON.stringify({ ...feedback, referenceAnswer: "我将收入提升了90%。" }), { resume, answer })).toThrow("数字");
  });
  it("缺失事实只能留作待补充，不自动填入模板数据", () => {
    const result = parseInterviewFeedback(JSON.stringify({ ...feedback, referenceAnswer: "结果为【待补充：验收指标与变化值】。", supportingEvidence: [] }), { resume, answer });
    expect(result.referenceAnswer).toContain("【待补充");
    expect(() => parseInterviewFeedback(JSON.stringify({ ...feedback, supportingEvidence: [], referenceAnswer: "我领导团队获得巨大成功。" }), { resume, answer })).toThrow("依据");
    expect(() => parseInterviewFeedback("{}", { resume, answer })).toThrow("不完整");
  });
});
