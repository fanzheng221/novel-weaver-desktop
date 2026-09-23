/**
 * 上手与空状态文案唯一来源（WF-025 定稿）。
 * 原则：不说教、不堆形容词、每句都给下一步动作。
 */

export const WIZARD = {
	title: "开始你的第一本书",
	steps: ["新建项目", "选个起点", "进入写作台"],
	createNameLabel: "书名",
	createNamePlaceholder: "起个书名，以后能改",
	createLanguageLabel: "主要创作语言",
	createAction: "创建项目",
	presetTitle: "选一个起点",
	presetHint: "每个题材自带节奏范本和里程碑路标，进了大纲随时能改。",
	presetAction: "就用这个",
	doneTitle: "项目建好了",
	doneBody:
		"第一次生成在写作台做：写一句你想要的开场，点生成。\n还没连模型的话，会先弹卡片让你贴 Key，存进钥匙串就自动接着跑。",
	doneAction: "进入写作台 ›",
} as const;

export const LAUNCHER = {
	brand: "文织助手",
	newAction: "新建一部书",
	searchPlaceholder: "搜书名或目录…",
	recentSection: "最近打开",
	allSection: "全部作品",
	unreachable: "目录无法访问——可能被移动或删除",
	openAction: "打开书籍",
	removeLabel: "移除",
	removeConfirmTitle: "从书架移除？",
	removeConfirmBody: "只移出书架，不删除目录里的任何稿子。",
	pickDirectoryTitle: "选择新书所在文件夹",
	coverSetAction: "设置封面",
	coverReplaceAction: "更换封面",
	coverRemoveAction: "移除封面",
	coverPickTitle: "选择封面图片",
} as const;

export const LORE = {
	searchPlaceholder: "搜设定：名称、描述、性格、备注、标签、关系…",
	noResults: "没有命中的设定。换个更短的词试试。",
} as const;

/**
 * 写作台（WF5-06）：专注默认态文案。
 * 原则延续 WF-025：不说教、每句都给下一步动作。
 */
export const WRITING = {
	railTitle: "章节与场景",
	taskLabel: "本场任务",
	taskNone: "本场还没有计划任务——可以直接写，或去大纲补一个场景计划。",
	nextStepGenerate: "为此场景生成候选",
	nextStepGenerateDone: "已按这场计划填好生成设置——在右侧确认后生成。",
	nextStepPlanLink: "查看章节大纲",
	nextStepPlannedHint:
		"这一场只有计划、还没有正文。生成候选不会动你的正文；确认后才入正典。",
	nextStepEmptyTitle: "正文和场景计划都还是空的",
	nextStepEmptyAction: "从总纲开始规划",
	briefingTab: "本场简报",
	briefingIdle: "在左栏选中一个场景后，这里汇总本场的任务与归属。",
	briefingStateCanonical: "已成正文",
	briefingStatePlanned: "待写（仅有计划）",
	briefingDraftPending: " · 有本地草稿待提交",
	resizeHint: "拖动调整 · ← → 微调 · 双击复位",
} as const;

export const EMPTY = {
	loreRules: {
		glyph: "律",
		title: "还没有硬规则",
		hint: "硬规则是这个世界推不翻的底线，比如「人死不能复生」。先立一条。",
		actionLabel: "写第一条规则",
	},
	outline: {
		glyph: "纲",
		title: "大纲还是空的",
		hint: "一句话说清这一卷讲什么，再把几幕列出来。场景计划会挂在它下面。",
	},
	candidateBand: {
		idle: "生成的候选会出现在这里。采用才算数，送审才能入正典。",
	},
	reviewInbox: {
		glyph: "审",
		title: "没有需要处理的事",
		hint: "待确认的稿子、审校问题、过期提醒都会汇集到这里；各工作区就地确认后，这里也会同步消失。",
		actionLabel: "去写作台生成候选",
	},
	publish: {
		glyph: "刊",
		title: "还没有可以发布的内容",
		hint: "一章的场景全部确认入正典后，这里会带你检查、定版并导出。先去写作台完成第一章。",
		actionLabel: "去写作台",
	},
	foreshadow: {
		glyph: "诺",
		title: "一张白纸",
		hint: "埋一句承诺，等后面某章兑现它。登记之后，这张表替你盯着。",
		actionLabel: "去大纲登记",
	},
	timeline: {
		glyph: "时",
		title: "时间线上还没有东西",
		hint: "场景确认入正典后，按故事时间落位；关系变化也标在同一根轴上。",
		actionLabel: "去写作台生成开场",
	},
	board: {
		glyph: "更",
		title: "还没有章节计划",
		hint: "在大纲里建章节、挂上场景。之后这里替你盯更新：存稿几章、欠更几天，一眼看清。",
		actionLabel: "去大纲建章节",
	},
	launcher: {
		glyph: "书",
		title: "书架是空的",
		hint: "从一本新书开始：选个文件夹，三十秒后就能写第一章。",
	},
	loreWorld: {
		glyph: "界",
		title: "世界还是一张白纸",
		hint: "地点、势力、信物……先立几根世界的柱子。批准提案后在此列出。",
		actionLabel: "新建世界观条目",
	},
	loreCharacters: {
		glyph: "人",
		title: "还没有人物",
		hint: "立一个角色：性格、外貌、能力各给一笔，标签留着给生成时批量引用。",
		actionLabel: "新建人物",
	},
	loreGraph: {
		glyph: "网",
		title: "关系网还没织起来",
		hint: "给人物之间牵一条客观关系（师徒、血亲、敌对），图谱会把他们连成网。",
		actionLabel: "去人物页看看",
	},
	// These empty states use semantic icons at their call sites.
	pacing: {
		title: "还没有自建范本",
		hint: "官方精编已就绪。把用顺手的节拍存成模板，批准后入库，可反复复用。",
		actionLabel: "新建模板",
	},
	usage: {
		title: "还没有用量记录",
		hint: "第一次生成后，token 与费用曲线会从这里长出来。",
		actionLabel: "去写作台试一次生成",
	},
	versions: {
		title: "这一幕还没有版本历史",
		hint: "生成候选或保存草稿后，每个版本都会按时间留痕。",
		actionLabel: "去正文面写一段",
	},
} as const;

export const HINTS = {
	studioPlanningIdle: "规划还是空的——先去「大纲」写第一份大纲。",
	studioCandidatesIdle: EMPTY.candidateBand.idle,
	byokComingBody:
		"配置页在做最后打磨。现在就可以开写：写作台第一次生成时，内联卡片会引导你贴 Key 存进钥匙串。",
	foreshadowFooter:
		"数据来自规划图中的故事承诺工件；跨页跳转将在统一导航中接通。",
	boardFooter: "存稿箱与滞后都是打开时的实时计算，不落库、不推送。",
	loreEditNote:
		"修订会以新提案提交，批准后覆盖原条目；未批准前原条目照旧生效。",
	rightPanelAiIdle:
		"生成设置、上下文预览、候选带会收进这一列——写作面保持干净，AI 在旁边待命。",
	rightPanelAiAction: "去中栏生成第一个场景候选",
	// WF5-03：AI 主操作的场景门禁——有场景未选必须解释，零场景冷启动不得死路。
	aiNeedsScene: "先在左侧选择一个场景，AI 才能装配人物、规则与大纲上下文。",
	aiFirstScene: "这本书还没有场景：填好标题，直接生成第一个开场。",
} as const;
