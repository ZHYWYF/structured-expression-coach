import { describe, expect, it } from "vitest";
import { answerFramework, extractJobRequirements, localFollowUp, localQuestions } from "./interviewQuestions";

const jd = "产品经理\n北京·校招·正式·职位 ID：A165667\n职位描述\n1.负责产品需求分析与用户调研。\n2.通过数据分析优化转化指标。\n3.协调研发设计推进项目交付。\n薪资面议，立即投递";
describe("岗位能力出题", () => {
  it("过滤截图中的地点招聘类型编号，保留真正职责", () => {
    expect(extractJobRequirements(jd)).toEqual(["负责产品需求分析与用户调研", "通过数据分析优化转化指标", "协调研发设计推进项目交付"]);
    const questions = localQuestions(jd, "我参与了支付项目的需求调研。");
    expect(questions).toHaveLength(6);
    expect(questions.map((item) => item.tag)).toEqual(expect.arrayContaining(["数据分析", "需求判断", "项目推进"]));
    expect(JSON.stringify(questions)).not.toMatch(/A165667|校招|北京/);
    for (const item of questions) if (item.jdEvidence) expect(jd.includes(item.jdEvidence)).toBe(true);
  });
  it("材料只有元信息时使用明确的通用练习，不制造定制依据", () => {
    const questions = localQuestions("北京·校招·正式·职位 ID：A165667");
    expect(questions).toHaveLength(6);
    expect(questions.every((item) => item.tag.startsWith("通用练习") && !item.jdEvidence)).toBe(true);
  });
  it("新问题去重，题库用尽返回空而不是重复填充", () => {
    let generated = localQuestions(jd);
    for (let index = 0; index < 8; index++) generated = [...generated, ...localQuestions(jd, "", generated)];
    expect(new Set(generated.map((item) => item.text)).size).toBe(generated.length);
    expect(localQuestions(jd, "", generated)).toEqual([]);
  });
  it("追问从回答缺口出发，携带原问题关联", () => {
    const question = localQuestions(jd)[0];
    const followUp = localFollowUp(question, "我们做了一个项目，最后效果不错。", []);
    expect(followUp).toHaveLength(2);
    expect(followUp[0].text).toContain("个人负责");
    expect(followUp.every((item) => item.parentQuestionId === question.id)).toBe(true);
    const remaining = localFollowUp(question, "我们做了一个项目，最后效果不错。", followUp);
    expect(remaining.every((item) => !followUp.some((old) => old.text === item.text))).toBe(true);
  });
  it("假设题和经历题采用不同框架，不编造经验", () => {
    expect(answerFramework("如果指标下降，你会怎么做？")[0]).toContain("澄清");
    expect(answerFramework("请讲一次项目经历")[1]).toContain("真实情境");
  });
  it("需求分析不冒充数据分析，问题解决与复盘均有对应能力题", () => {
    const requirements = "能力要求：需求分析（澄清目标和验收标准）；沟通协作（解释分歧并形成共识）；问题解决（拆解原因并选择方案）；复盘改进（核对反馈并调整做法）。";
    const questions = localQuestions(requirements);
    expect(questions.map((item) => item.tag)).not.toContain("数据分析");
    expect(questions.map((item) => item.tag)).toEqual(expect.arrayContaining(["需求判断", "问题解决", "复盘改进", "跨团队协作"]));
    expect(extractJobRequirements(requirements)).toContain("复盘改进（核对反馈并调整做法）");
    expect(localQuestions("通过数据分析优化转化指标").some((item) => item.tag === "数据分析")).toBe(true);
  });
  it("追问引用当前反馈与分歧，编辑回答后不沿用旧细节", () => {
    const question = localQuestions(jd).find((item) => item.tag === "需求判断")!;
    const firstAnswer = "我在校园借阅练习中整理了反馈，发现登记说明容易被误解。我先确认问题，再和同学讨论修改说明。还没有统计效果，我负责的是整理反馈和记录讨论。";
    const first = localFollowUp(question, firstAnswer, []);
    expect(first).toHaveLength(2);
    expect(first[0].text).toContain("登记说明容易被误解");
    expect(first[1].text).toContain("没有统计效果");
    const secondAnswer = "我与同学对先改登记说明还是先做归还提醒有分歧。我列出依据，请大家比较影响后确定顺序；结果还没有做量化统计。";
    const second = localFollowUp(question, secondAnswer, first);
    expect(second).toHaveLength(2);
    expect(second[0].text).toContain("归还提醒有分歧");
    expect(second[1].text).toContain("确定顺序");
    expect(second.every((item) => !item.text.includes("容易被误解"))).toBe(true);
    expect(second.every((item) => item.parentQuestionId === question.id)).toBe(true);
  });
});
