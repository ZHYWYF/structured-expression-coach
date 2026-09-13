import type { AnalysisFinding, KnowledgeScenario } from "./types";

export interface CoachingCard {
  id: string;
  scenarios: KnowledgeScenario[];
  title: string;
  trigger: RegExp;
  satisfied: RegExp;
  reason: string;
  suggestion: string;
  positive: string;
  negative: string;
}

const all: KnowledgeScenario[] = ["general", "interview", "report", "retrospective"];
// AI-authored coaching heuristics, not research findings or claims about the speaker.
// Each card has an observable trigger, an exemption, and paired examples.
export const coachingCards: CoachingCard[] = [
  { id: "CTX-G01", scenarios: all, title: "百分比变化缺少参照", trigger: /(?:提升|增长|下降|降低|减少)了?\s*\d+(?:\.\d+)?\s*[%％]/, satisfied: /(?:相比|相较|同比|环比|从.{1,16}到|基准|基线|对照|百分点)/, reason: "百分比变化需要说明相对哪个基准，不等同于百分点变化。", suggestion: "补充原值、现值或对比周期，并明确相对百分比还是百分点；没有数据时说明待核实。", positive: "项目转化率提升了20%，表现很好。", negative: "相比上月，转化率从10%升至12%，相对提升20%。" },
  { id: "CTX-G02", scenarios: all, title: "因果判断需要验证", trigger: /(?:上线后|改版后|调整后|发布后).{0,50}(?:因此|所以|证明)/, satisfied: /(?:对照组|随机实验|排除.{1,16}因素|尚不能|不能证明|仅相关)/, reason: "先发生与后发生并不自动构成因果。", suggestion: "说明对照或验证方式；尚未验证时将结论标为相关性或待验证假设。", positive: "改版后留存增加了，所以证明改版有效。", negative: "改版后留存增加了，但仅相关，尚不能证明因果。" },
  { id: "CTX-G03", scenarios: all, title: "小样本不能直接代表所有人", trigger: /(?:一个|一位|两位|几个|几位)用户.{0,40}(?:所有|大家都|用户都)/, satisfied: /(?:不能代表|不代表|样本有限|待扩大|仅代表)/, reason: "个别反馈可能提供线索，但不足以代表整体用户。", suggestion: "限定样本和适用范围，补充采样方式；把总体判断列为待验证。", positive: "几位用户喜欢这个入口，所以所有用户都需要它。", negative: "几位用户喜欢这个入口，但样本有限，不能代表所有用户。" },
  { id: "CTX-G04", scenarios: all, title: "比较对象和标准不明确", trigger: /(?:比以前好|比之前好|比竞品好|优于竞品|行业领先)/, satisfied: /(?:响应时间|完成率|错误率|转化率|成本|时长|基准测试|评估标准)/, reason: "比较结论未说明比较哪个维度，难以复核。", suggestion: "指出比较对象、评价维度和同等条件下的证据，避免笼统优劣判断。", positive: "新方案整体比竞品好，值得推广。", negative: "新方案响应时间比竞品好，同等负载下从两秒缩短到一秒。" },
  { id: "CTX-G05", scenarios: all, title: "把解释留给了听者", trigger: /(?:你懂的|大家应该明白|不用多说|就不解释了)/, satisfied: /(?:具体指|也就是|例如|举例|含义是)/, reason: "默认对方拥有相同背景，可能留下理解缺口。", suggestion: "用一句话补齐关键前提或具体含义，不必重复全部背景。", positive: "这个方案的价值你懂的，就不解释了。", negative: "这个方案的价值具体指减少人工录入，不用多说背景。" },
  { id: "CTX-G06", scenarios: all, title: "方法选择缺少权衡", trigger: /(?:直接选择|直接采用|最终采用|最终选择)了?/, satisfied: /(?:因为|考虑到|相比|权衡|成本|约束|为了|原因|预算)/, reason: "只说选择结果，听者看不到判断过程。", suggestion: "补充关键约束、一个备选方案，以及选择当前方案的主要理由。", positive: "我们讨论后最终选择了方案甲，然后推进。", negative: "考虑到预算，我们最终选择了方案甲，接受较长的交付周期。" },
  { id: "CTX-R01", scenarios: ["report"], title: "工作量与成果需要区分", trigger: /(?:开了|组织了|参加了).{0,12}(?:会议|评审)|(?:写了|整理了).{0,12}(?:文档|材料)/, satisfied: /(?:达成|决定|确认|解决|减少|交付|形成.{1,12}(?:决策|方案|清单))/, reason: "活动数量不等于业务成果。", suggestion: "补充活动带来的决策、交付物或解决的问题；没有成果时如实标记仍在进行。", positive: "本周我参加了三场会议，整理了两份材料。", negative: "本周参加了三场评审，确认上线范围并解决两个依赖问题。" },
  { id: "CTX-R02", scenarios: ["report"], title: "延期缺少影响和应对", trigger: /(?:可能延期|预计延期|将延期|交付推迟)/, satisfied: /(?:影响|阻塞|预案|调整.{0,12}(?:范围|排期)|不影响)/, reason: "只有延期信号，听者无法判断严重程度及如何处理。", suggestion: "说明受影响的里程碑和业务范围，再给出补救动作或需要的决策。", positive: "当前接口未完成，项目预计延期。", negative: "项目预计延期两天，但不影响发布窗口，预案是先交付核心范围。" },
  { id: "CTX-R03", scenarios: ["report"], title: "审批请求缺少决策时间", trigger: /(?:请批准|申请批准|申请增加|请确认方案)/, satisfied: /(?:截止|之前|前确认|周[一二三四五六日天]|\d+[日号]|今天|明天|本周|下周)/, reason: "决策请求没有时限，可能影响后续安排。", suggestion: "说明最晚决策时间及超时影响，不替对方预设同意。", positive: "为保证项目推进，请批准增加两个人。", negative: "请在周五前批准增加两个人，否则里程碑需顺延。" },
  { id: "CTX-R04", scenarios: ["report"], title: "目标需要可核验的完成标准", trigger: /(?:目标是|本期目标|本周目标).{0,30}(?:提升|优化|改善|加强)/, satisfied: /(?:\d|百分之|验收|标准|达到|降至|提高到)/, reason: "只有改善方向，没有说明怎样算完成。", suggestion: "为目标补充可观察交付物或验收条件；不要为了量化编造数字。", positive: "本期目标是优化体验，加强用户理解。", negative: "本期目标是优化体验，以关键任务完成率达到90%为验收标准。" },
  { id: "CTX-R05", scenarios: ["report"], title: "依赖项缺少负责方", trigger: /(?:等待|依赖).{0,15}(?:确认|接口|反馈|审批|资源)/, satisfied: /(?:由.{1,12}(?:负责|提供|确认)|研发|产品|设计|运营|客户|供应商|负责人)/, reason: "未说明需要谁解除依赖，不易跟进。", suggestion: "点明依赖负责方、交付内容和期望反馈节点。", positive: "现在还在等待接口确认，项目无法继续。", negative: "现在等待研发负责人确认接口，由研发在周五前提供。" },
  { id: "CTX-R06", scenarios: ["report"], title: "风险判断缺少触发条件", trigger: /(?:可能超支|预算有风险|可能不达标|可能来不及)/, satisfied: /(?:如果|一旦|超过|低于|阈值|触发|当.{1,16}时)/, reason: "仅给出担忧，无法判断何时需要行动。", suggestion: "说明风险触发信号、观察指标和触发后的应对措施。", positive: "现在预算有风险，后面可能超支。", negative: "如果单价超过预算上限就可能超支，触发后缩减采购范围。" },
  { id: "CTX-T01", scenarios: ["retrospective"], title: "复盘结果缺少原始目标", trigger: /(?:项目|这次|本次).{0,30}(?:成功|失败|延期|超支|未达标)/, satisfied: /(?:目标|原计划|预期|原定|验收标准)/, reason: "没有原目标，无法客观判断偏差。", suggestion: "先说明当时约定的目标和实际结果，再比较差距。", positive: "这次项目失败了，团队非常失望。", negative: "这次项目未达标：原计划周一上线，实际延期两天。" },
  { id: "CTX-T02", scenarios: ["retrospective"], title: "归因需要独立证据", trigger: /(?:根因是|原因就是|主要原因是)/, satisfied: /(?:日志|记录|复现|验证|对照|时间线|证据|测试|访谈)/, reason: "原因判断还没有对应可检查的证据。", suggestion: "补充日志、事件记录或复现结果；尚未证实时注明假设。", positive: "主要原因是需求边界变化，大家没有反应过来。", negative: "日志和变更记录验证了根因是配置遗漏。" },
  { id: "CTX-T03", scenarios: ["retrospective"], title: "单一归因应检查其他条件", trigger: /(?:唯一原因|完全归因于|全是因为|只要.{1,15}就不会)/, satisfied: /(?:其他因素|排除|共同作用|多因素|尚不确定|不能|不是)/, reason: "复杂问题往往受多个条件共同影响。", suggestion: "区分触发事件、放大条件和防线缺口，再说明哪些已有证据。", positive: "这次失败的唯一原因是人员经验不足。", negative: "不能把经验不足当唯一原因，还需要检查其他因素。" },
  { id: "CTX-T04", scenarios: ["retrospective"], title: "补救完成不等于防止复发", trigger: /(?:已经修复|已恢复|已经回滚|已补救)/, satisfied: /(?:预防|防复发|监控|告警|检查点|准入|验证|复测)/, reason: "恢复当次问题与消除复发条件是两件事。", suggestion: "将应急恢复与长期改进分开，补充预防措施和复查标准。", positive: "线上问题已经修复，这个问题就结束了。", negative: "问题已经修复，新增监控告警并在周五复测验证。" },
  { id: "CTX-T05", scenarios: ["retrospective"], title: "成功经验需要适用边界", trigger: /(?:以后都|所有项目都|以后直接).{0,20}(?:照搬|照做|复用|采用)/, satisfied: /(?:前提|适用|不适用|边界|条件|当.{1,16}时)/, reason: "一次成功不能保证在不同条件下仍然有效。", suggestion: "说明可复用方法、必要条件和不适用的情境。", positive: "这次上线成功，所有项目都照搬这个方案。", negative: "在需求稳定的前提下复用，不适用于高频变更项目。" },
  { id: "CTX-T06", scenarios: ["retrospective"], title: "改进任务需要责任归属", trigger: /(?:新增|建立|增加).{0,20}(?:检查表|复查机制|检查点|预警机制)/, satisfied: /(?:由.{1,16}(?:负责|维护|执行)|我负责|负责人|责任人)/, reason: "机制有了名称，还需要明确谁维护和执行。", suggestion: "给出责任角色、触发条件和复查时间，避免把任务留给所有人。", positive: "下次新增检查表，建立复查机制。", negative: "新增检查表，由测试负责人维护，每周五复查。" },
  { id: "CTX-I01", scenarios: ["interview"], title: "案例需要交代任务目标", trigger: /(?:当时|曾经|有一次).{0,50}(?:负责|主导|参与)/, satisfied: /(?:目标|为了解决|需要解决|任务是|要求是)/, reason: "缺少任务背景时，面试官难以判断行动的意义。", suggestion: "用一句话说明业务挑战和你承担的目标，再展开关键行动。", positive: "当时我主导了整个项目，做了很多沟通。", negative: "当时我主导项目，目标是在两周内解决支付失败问题。" },
  { id: "CTX-I02", scenarios: ["interview"], title: "主导范围需要说明", trigger: /(?:独立负责|全程主导|从零到一负责|全权负责)/, satisfied: /(?:决策|负责.{1,20}(?:设计|分析|验证|协调)|边界|分工|产出)/, reason: "主导是角色描述，不等于具体贡献。", suggestion: "说明你拥有的决策权、亲自完成的工作及与他人的分工。", positive: "这个项目由我全程主导，最后顺利完成。", negative: "我全程主导，负责方案设计与验证，研发负责实现，明确了分工。" },
  { id: "CTX-I03", scenarios: ["interview"], title: "经历需要关联岗位职责", trigger: /(?:我很适合|我能胜任|我匹配这个岗位)/, satisfied: /(?:岗位要求|JD|职责|对应|这段经历|相关经验)/, reason: "只有匹配结论，缺少职位要求与经历之间的对应。", suggestion: "选取 JD 中一项关键职责，用真实经历说明对应能力。", positive: "我很适合这个岗位，愿意努力投入。", negative: "我能胜任，因为岗位要求数据分析，我的相关经验是负责留存实验。" },
  { id: "CTX-I04", scenarios: ["interview"], title: "冲突处理需要双方诉求", trigger: /(?:说服了对方|让对方接受|最终大家听我的)/, satisfied: /(?:对方担心|对方希望|共同目标|约束|双方|分歧在)/, reason: "仅描述赢得争论，未体现理解差异和合作过程。", suggestion: "说明双方目标或约束、采用的证据以及如何形成共同决定。", positive: "发生分歧后，我说服了对方，按我的想法执行。", negative: "对方担心成本，我用试点数据说服了对方，双方约定复查节点。" },
  { id: "CTX-I05", scenarios: ["interview"], title: "能力迁移不能只靠保证", trigger: /(?:很快就能学会|肯定能做好|上手不会有问题)/, satisfied: /(?:曾经|此前|例如|学习计划|验证|相似)/, reason: "保证不能替代学习能力和迁移能力的证据。", suggestion: "提供相似任务中的学习过程，说明当前差距和上手计划。", positive: "这个技术我没做过，但很快就能学会。", negative: "此前我通过相似项目完成迁移，新的学习计划包含试做与验证。" },
  { id: "CTX-I06", scenarios: ["interview"], title: "离职原因需要建设性表达", trigger: /(?:前公司太差|领导不行|同事都不行|公司没前途)/, satisfied: /(?:不应|不要|不能|不是)/, reason: "贬低前环境难以说明你下一步的职业选择。", suggestion: "描述客观不匹配和希望承担的职责，避免揣测他人动机或披露敏感信息。", positive: "我想离开，因为前公司太差。", negative: "不能说前公司太差，我希望承担更完整的产品职责。" },
];

export function coachingContext(text: string, start: number, end: number) {
  const before = text.slice(0, start).split(/[。！？!?；;\n]/).pop() ?? "";
  const after = text.slice(end).split(/[。！？!?；;\n]/).slice(0, 2).join("。");
  return `${before}${text.slice(start, end)}${after}`.slice(0, 360);
}

export function collectContextualFindings(text: string, scenario: KnowledgeScenario): AnalysisFinding[] {
  const findings: AnalysisFinding[] = [];
  for (const card of coachingCards) {
    if (!card.scenarios.includes(scenario)) continue;
    for (const match of text.matchAll(new RegExp(card.trigger.source, "g"))) {
      const start = match.index;
      const end = start + match[0].length;
      if (card.satisfied.test(coachingContext(text, start, end))) continue;
      if (/(?:不能说|不要说|不代表|不是|并非)[“"「]?\s*$/.test(text.slice(Math.max(0, start - 12), start))) continue;
      findings.push({ ruleId: card.id, range: { start, end }, matchedText: match[0], scope: "span", issueType: card.title,
        reason: card.reason, suggestion: card.suggestion, replacements: [],
        source: { type: "ai_generated", ref: "AI生成知识/上下文条件规则", reviewStatus: "sample_review" } });
    }
  }
  return findings;
}

export function retrieveCoachingKnowledge(text: string, scenario: KnowledgeScenario): string {
  return coachingCards.filter((card) => card.scenarios.includes(scenario))
    .map((card) => ({ card, rank: card.trigger.test(text) ? 2 : card.scenarios.length === 1 ? 1 : 0 }))
    .sort((a, b) => b.rank - a.rank).slice(0, 8)
    .map(({ card }) => `${card.id} ${card.title}：${card.suggestion} 当上下文已有相关依据时不要重复提醒。`).join("\n");
}
