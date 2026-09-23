/**
 * 爽点模板（WF2-16 / WF-006 决议）：变长节拍序列 hook/build/payoff × 相对位置 × 强度。
 * 官方首批 12 条人工精编为应用层静态目录；用户自建走 pacing_template 工件提案链入库。
 */

export type BeatKind = "hook" | "build" | "payoff";

export interface PacingBeat {
	kind: BeatKind;
	/** 相对位置 0–100（章节内进度）。 */
	position: number;
	/** 强度 1–5，对齐节奏范本 intensity 刻度。 */
	intensity: number;
}

export interface PacingTemplate {
	id: string;
	name: string;
	genre: string;
	/** 适用场景描述：什么时候用这套节拍。 */
	applicable: string;
	beats: PacingBeat[];
}

export const GENRE_FILTERS = [
	"全部",
	"都市",
	"玄幻",
	"系统流",
	"通用",
] as const;

export const OFFICIAL_TEMPLATES: PacingTemplate[] = [
	{
		id: "off-001",
		name: "扮猪吃虎打脸",
		genre: "都市",
		applicable:
			"主角被轻视贬低，围观者越傲慢，反转越响。适合每卷开局的立威戏。",
		beats: [
			{ kind: "build", position: 10, intensity: 2 },
			{ kind: "build", position: 40, intensity: 3 },
			{ kind: "payoff", position: 75, intensity: 5 },
			{ kind: "hook", position: 95, intensity: 3 },
		],
	},
	{
		id: "off-002",
		name: "商战绝地反杀",
		genre: "都市",
		applicable: "资金链/合同/舆论三面受敌时，靠提前埋好的暗手一击翻盘。",
		beats: [
			{ kind: "build", position: 15, intensity: 4 },
			{ kind: "build", position: 45, intensity: 4 },
			{ kind: "hook", position: 60, intensity: 2 },
			{ kind: "payoff", position: 85, intensity: 5 },
		],
	},
	{
		id: "off-003",
		name: "身份反转揭秘",
		genre: "都市",
		applicable: "隐瞒的身份在关键场合被揭开，敌我关系当场重排。",
		beats: [
			{ kind: "build", position: 20, intensity: 3 },
			{ kind: "hook", position: 50, intensity: 4 },
			{ kind: "payoff", position: 80, intensity: 5 },
		],
	},
	{
		id: "off-004",
		name: "废柴觉醒逆袭",
		genre: "玄幻",
		applicable: "资质被判死后获得转机，当众证明自己的经典闭环。",
		beats: [
			{ kind: "build", position: 12, intensity: 2 },
			{ kind: "hook", position: 38, intensity: 4 },
			{ kind: "build", position: 60, intensity: 3 },
			{ kind: "payoff", position: 88, intensity: 5 },
		],
	},
	{
		id: "off-005",
		name: "秘境夺宝争锋",
		genre: "玄幻",
		applicable: "多方势力抢一件至宝，主角渔翁得利顺手结仇树敌。",
		beats: [
			{ kind: "build", position: 15, intensity: 3 },
			{ kind: "payoff", position: 45, intensity: 4 },
			{ kind: "build", position: 65, intensity: 4 },
			{ kind: "payoff", position: 90, intensity: 5 },
		],
	},
	{
		id: "off-006",
		name: "宗门大比连胜",
		genre: "玄幻",
		applicable: "擂台连战：一场一个对手，强度递增到压轴对决。",
		beats: [
			{ kind: "payoff", position: 25, intensity: 2 },
			{ kind: "payoff", position: 50, intensity: 3 },
			{ kind: "build", position: 70, intensity: 4 },
			{ kind: "payoff", position: 92, intensity: 5 },
		],
	},
	{
		id: "off-007",
		name: "新手礼包暴击",
		genre: "系统流",
		applicable: "系统激活/首次奖励兑现，用超预期回报钩住读者。",
		beats: [
			{ kind: "hook", position: 8, intensity: 3 },
			{ kind: "payoff", position: 30, intensity: 5 },
			{ kind: "build", position: 60, intensity: 3 },
			{ kind: "hook", position: 90, intensity: 4 },
		],
	},
	{
		id: "off-008",
		name: "隐藏任务连锁",
		genre: "系统流",
		applicable: "触发隐藏条件连环奖励，展示系统的深度与主角的嗅觉。",
		beats: [
			{ kind: "hook", position: 15, intensity: 3 },
			{ kind: "payoff", position: 40, intensity: 3 },
			{ kind: "payoff", position: 65, intensity: 4 },
			{ kind: "payoff", position: 88, intensity: 5 },
		],
	},
	{
		id: "off-009",
		name: "权限升级碾压",
		genre: "系统流",
		applicable: "新权限解锁后回头碾平旧麻烦，落差感即爽点。",
		beats: [
			{ kind: "build", position: 18, intensity: 3 },
			{ kind: "hook", position: 42, intensity: 4 },
			{ kind: "payoff", position: 70, intensity: 5 },
			{ kind: "payoff", position: 92, intensity: 4 },
		],
	},
	{
		id: "off-010",
		name: "绝境翻盘",
		genre: "通用",
		applicable: "山穷水尽处亮出保命底牌。高潮章或卷末大兑现通用。",
		beats: [
			{ kind: "build", position: 20, intensity: 5 },
			{ kind: "build", position: 45, intensity: 4 },
			{ kind: "payoff", position: 80, intensity: 5 },
		],
	},
	{
		id: "off-011",
		name: "仇人见面分外眼红",
		genre: "通用",
		applicable: "宿敌重逢的压迫感铺垫与冲突引爆，适合过渡章收尾。",
		beats: [
			{ kind: "build", position: 25, intensity: 3 },
			{ kind: "build", position: 55, intensity: 4 },
			{ kind: "payoff", position: 85, intensity: 4 },
		],
	},
	{
		id: "off-012",
		name: "当众立威",
		genre: "通用",
		applicable: "新人入局被刁难，当众定规矩。团队扩张期反复可用。",
		beats: [
			{ kind: "build", position: 15, intensity: 2 },
			{ kind: "build", position: 45, intensity: 3 },
			{ kind: "payoff", position: 78, intensity: 5 },
			{ kind: "hook", position: 95, intensity: 2 },
		],
	},
];

export const BEAT_KIND_LABEL: Record<BeatKind, string> = {
	hook: "钩子",
	build: "蓄力",
	payoff: "兑现",
};
