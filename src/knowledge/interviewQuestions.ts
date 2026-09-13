import type { InterviewQuestion } from "../core/types";

export const QUESTION_RULE_VERSION = 2;
const metadata = /(?:职位|岗位|job)\s*(?:ID|编号|编码)|(?:招聘|工作|办公)地点|薪资|薪酬|福利|投递|申请职位|发布时间|更新日期|招聘人数|分享职位|收藏职位|隐私政策|招聘官网/i;
const action = /负责|主导|设计|分析|研究|调研|规划|推进|优化|开发|测试|运营|沟通|协调|能力|熟悉|掌握|搭建|制定|评估|管理|协作|解决|具备|理解|跟踪|洞察|维护|落地|验证|复盘|改进/;
const locationOnly = /^(?:北京|上海|深圳|广州|杭州|成都|校招|社招|实习|正式|全职|兼职|应届|本科|硕士|博士|职位描述|岗位职责|任职要求|职位要求|工作职责|任职资格|职位信息|岗位信息)(?:[\s·•|｜/、，,：:-].*)?$/;

export function extractJobRequirements(jd: string): string[] {
  return [...new Set(jd.split(/[。；;\n\r]+/).map((line) => line.replace(/^\s*(?:[-*•·]|\d+[.)、]|[一二三四五六七八九十]+[、.])\s*/, "").trim())
    .map((line) => line.replace(/^(?:岗位职责|任职要求|职位描述|工作职责|任职资格|职位要求)\s*[:：]\s*/, ""))
    .filter((line) => line.length >= 6 && !metadata.test(line) && action.test(line) && (!locationOnly.test(line) || action.test(line.split(/[:：]/).slice(1).join("：")))))];
}

type Competency = { tag: string; match: RegExp; questions: string[] };
const competencies: Competency[] = [
  { tag: "数据分析", match: /数据|指标|实验|SQL|统计|量化/, questions: ["请讲一次你用数据定位业务问题的经历。如何定义指标、验证原因，并据此推动决策？", "如果核心指标突然下降，你会如何排查？请说明分析顺序、需要的数据和验证方式。"] },
  { tag: "需求判断", match: /需求|用户|调研|访谈|洞察/, questions: ["请讲一个你从用户反馈中识别真实需求的案例。如何验证问题、排优先级，并判断方案有效？", "当用户提出的需求与业务目标不一致时，你会怎样判断是否要做？请结合真实经历说明。"] },
  { tag: "产品决策", match: /产品|方案|规划|设计|策略/, questions: ["请选一个你参与设计的方案，说明目标、约束、备选路径和关键取舍。你个人做了哪些判断？", "面对多个可行方案，你如何选择？请说明评价标准，以及最终结果是否验证了你的判断。"] },
  { tag: "项目推进", match: /项目|推进|落地|交付|排期|里程碑/, questions: ["请讲一次有较大不确定性的项目交付。你如何拆解目标、识别依赖并处理偏差？", "项目面临延期但范围不能全部砍掉时，你会如何协商取舍？请说明决策依据与沟通方式。"] },
  { tag: "跨团队协作", match: /协作|协调|沟通|跨部门|合作|团队/, questions: ["请讲一次跨团队意见不一致的经历。各方关注什么，你用什么证据推动共同决定？", "当合作方无法按约定交付时，你如何推动解决？请说明沟通、升级和替代方案。"] },
  { tag: "问题解决", match: /问题解决|排查|根因|定位.{0,8}(?:原因|问题)|故障|诊断|拆解原因/, questions: ["请讲一次你解决实际问题的经历。怎样区分表面现象与真正原因，你用什么信息验证判断？", "遇到信息不完整的问题时，你会先确认什么、如何缩小范围，再决定下一步行动？"] },
  { tag: "复盘改进", match: /复盘|反思|改进|迭代|总结/, questions: ["请讲一次你根据反馈调整做法的经历。原先的判断哪里不足，后来改变了什么，如何检查改进是否有效？", "回顾一个结果未达预期的任务，你如何区分事实与猜测，并把复盘结论转为具体行动？"] },
  { tag: "增长运营", match: /增长|运营|转化|留存|活动|获客/, questions: ["请讲一次你推动增长或运营改善的经历。如何找到机会、执行验证，并区分真实增量与外部影响？", "如果一个活动参与率高但留存没有改善，你会怎样解释并安排下一步验证？"] },
  { tag: "技术实现", match: /开发|编码|架构|系统|算法|工程|性能/, questions: ["请讲一个与你实际经历相关的技术难题。你如何定位原因、比较方案并验证正确性？", "当交付速度与系统质量冲突时，你会如何权衡？请说明边界、风险与后续治理。"] },
  { tag: "质量风险", match: /测试|质量|风险|安全|稳定|合规/, questions: ["请讲一次你提前发现风险的经历。如何评估影响、安排验证并制定兜底措施？", "请用一个真实案例说明你如何验证交付质量。覆盖了哪些关键场景，遗漏如何发现？"] },
  { tag: "商业判断", match: /商业|收入|成本|预算|市场|竞品|盈利/, questions: ["请讲一次你参与商业取舍的经历。如何平衡用户价值、成本与预期收益？", "评估一个业务机会时，你会先验证哪些假设？请说明信息来源和停止投入的条件。"] },
  { tag: "客户沟通", match: /客户|销售|售前|服务|客诉/, questions: ["请讲一次处理客户诉求的经历。你如何澄清问题、管理预期并确认问题解决？", "客户提出无法兑现的要求时，你会如何回应？请说明边界与替代方案。"] },
  { tag: "内容策略", match: /内容|创意|文案|品牌|传播/, questions: ["请讲一次内容或传播项目。你如何定义受众、形成方案并评估实际效果？", "内容获得大量曝光却没有产生预期行为，你会如何分析原因和调整策略？"] },
  { tag: "团队管理", match: /管理|培养|带领|组织|人才/, questions: ["请讲一次你协调多人完成目标的经历。如何分工、处理分歧并检查执行效果？", "当团队成员表现未达预期时，你会如何判断原因、提供支持并跟进改进？"] },
];
const generalQuestions = [
  ["岗位动机", "结合这份岗位职责，你最希望解决什么问题？请用一段真实经历说明你的相关能力和仍需补齐的差距。"],
  ["个人贡献", "请从简历中选一个最相关的项目，用目标、个人行动和结果介绍它，明确你与团队各自的贡献。"],
  ["决策权衡", "请讲一次你必须在两个方案之间做取舍的经历。约束是什么，为什么这样选，结果如何？"],
  ["复盘学习", "请讲一次结果未达预期的经历。你承担了什么责任，如何找到原因，后来改变了什么？"],
  ["证据意识", "请讲一项你认为最有价值的成果。你如何证明它带来了效果，而不是仅仅完成了工作？"],
  ["岗位实践", "如果加入这个岗位，你会先澄清哪些目标和约束？如何安排最初的学习、验证与交付？"],
  ["问题解决", "请讲一次你在信息不完整时推动问题解决的经历。哪些是假设，哪些经过了验证？"],
  ["学习迁移", "请讲一次你学习陌生领域并用于实际任务的经历。如何验证自己真正掌握，而不是只了解概念？"],
];
const normalize = (text: string) => text.replace(/[\s，。！？、；：“”"'?,.!:;]/g, "").toLowerCase();
const resumeAnchor = (resume: string) => resume.split(/[。；;\n]/).map((line) => line.trim()).find((line) => line.length >= 10 && /项目|负责|参与|主导|设计|分析|开发|运营/.test(line) && !/电话|邮箱|@|身份证/.test(line));

export function localQuestions(jd: string, resume = "", existing: InterviewQuestion[] = []): InterviewQuestion[] {
  const requirements = extractJobRequirements(jd);
  const candidates: Array<Omit<InterviewQuestion, "id">> = [];
  for (const round of [0, 1]) {
    for (const competency of competencies) {
      const evidence = requirements.find((line) => competency.match.test(line));
      if (evidence) candidates.push({ tag: competency.tag, text: competency.questions[round], jdEvidence: evidence, source: "local", suggestedMinutes: 3, ruleVersion: QUESTION_RULE_VERSION });
    }
  }
  for (const [tag, text] of generalQuestions) candidates.push({ tag: requirements.length ? tag : `通用练习 · ${tag}`, text, jdEvidence: requirements[0], source: "local", suggestedMinutes: 3, ruleVersion: QUESTION_RULE_VERSION });
  const anchor = resumeAnchor(resume);
  const known = new Set(existing.map((item) => normalize(item.text)));
  return candidates.filter((item) => { const key = normalize(item.text); if (known.has(key)) return false; known.add(key); return true; }).slice(0, 6)
    .map((item) => ({ ...item, id: `question-${crypto.randomUUID()}`, ...(item.tag.includes("个人贡献") && anchor ? { resumeEvidence: anchor } : {}) }));
}

export function localFollowUp(question: InterviewQuestion, answer: string, existing: InterviewQuestion[]): InterviewQuestion[] {
  if (!answer.trim()) return [];
  const candidates: Array<[string, string]> = [];
  const segments = answer.split(/[。！？!?；;\n]/).map((part) => part.trim()).filter(Boolean);
  const addContextQuestion = (tag: string, pattern: RegExp, prompt: string) => {
    const segment = segments.find((part) => pattern.test(part));
    if (!segment) return;
    const excerpt = segment.length > 90 ? `${segment.slice(0, 90)}…` : segment;
    candidates.push([tag, `你提到“${excerpt}”。${prompt}`]);
  };
  // Concrete details in this answer take priority over generic gap prompts.
  addContextQuestion("分歧处理", /分歧|意见不一|冲突|不同意/, "双方分别依据什么做判断？你个人如何比较这些依据、推动共识，而不只是转述团队决定？");
  addContextQuestion("优先级取舍", /优先|顺序|取舍|比较/, "你比较了哪些方案与影响，用什么标准确定先后？如果关键约束变化，顺序会怎样调整？");
  addContextQuestion("反馈验证", /反馈|访谈|调研|用户诉求/, "这些反馈怎样帮助你确认具体问题？如何区分个别意见与共同需求，并检查修改是否解决了原问题？");
  addContextQuestion("证据缺口", /(?:没有|尚未|还没|未).{0,12}(?:统计|量化|验证|数据|结果)/, "在没有量化结论的情况下，已有的观察或反馈能说明什么、还不能说明什么？你准备如何继续验证，不需要补造数字。");
  if (!/我(?:负责|主导|设计|分析|决策|推动|实现)|我的(?:职责|贡献)/.test(answer)) candidates.push(["个人贡献", "你刚才提到了团队的行动。其中你个人负责哪一部分、做了什么关键判断，产出了什么？"]);
  if (!/因为|基于|考虑|权衡|对比|相比|为了/.test(answer)) candidates.push(["决策依据", "针对刚才描述的做法，你为什么选择这条路径？有没有比较过其他方案，主要约束是什么？"]);
  if (!/\d|百分之|反馈|验收|验证|数据|指标|记录/.test(answer)) candidates.push(["结果证据", "你刚才的结果如何验证？请给出已有的事实、反馈或数据；没有量化记录也可以说明验证方式。"]);
  if (/失败|延期|问题|冲突|困难/.test(answer) && !/复盘|改进|下次|学到|后来改变/.test(answer)) candidates.push(["改进闭环", "针对刚才提到的困难，你后来具体改了什么？如何确认这项改变有效？"]);
  candidates.push(["细节深挖", `你在回答中提到“${answer.trim().slice(0, 70)}${answer.trim().length > 70 ? "…" : ""}”。请补充一个关键决策点：当时掌握哪些信息，如何判断下一步？`]);
  const known = new Set(existing.map((item) => normalize(item.text)));
  return candidates.filter(([, text]) => !known.has(normalize(text))).slice(0, 2).map(([tag, text]) => ({
    id: `question-${crypto.randomUUID()}`, tag: `追问 · ${tag}`, text, suggestedMinutes: 2, source: "local", ruleVersion: QUESTION_RULE_VERSION,
    parentQuestionId: question.id, jdEvidence: question.jdEvidence,
  }));
}

export function answerFramework(question: string): string[] {
  if (/如果|你会|假设|加入/.test(question)) return ["先澄清目标、对象和约束，不急于给唯一方案。", "列出关键假设与需要补充的信息，区分已知和未知。", "给出可行路径与取舍理由，说明优先验证什么。", "说明验证标准、风险预案与下一步。"];
  if (/动机|为什么.*岗位|希望解决/.test(question)) return ["明确岗位中吸引你的具体职责或问题。", "选择简历中相关经历作为能力证据。", "解释经历与职责的对应关系，避免空泛赞美。", "如实说明差距和学习计划。"];
  return ["先用一句话直接回答问题，点明你想证明的能力。", "简述真实情境与目标，明确你负责的边界。", "展开个人行动、关键决策和取舍，而非团队流水账。", "给出可核验结果，再补充反思或与岗位的关联。"];
}
