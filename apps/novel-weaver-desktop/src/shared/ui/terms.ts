/**
 * 领域术语字典（WF3-05）：把核心层的英文类型码翻译成作者可读的自然语言。
 * 全站唯一来源——关系工作区、设定库、时间线都从这里取词；
 * 未知码一律「自定义：xxx」兜底，不猜语义。
 */

const ENTITY_TYPES: Record<string, string> = {
	character: "人物",
	location: "地点",
	faction: "势力",
	region: "地域",
	realm: "界",
	institution: "机构",
	term: "词条",
	item: "物品",
	creature: "生灵",
	ability: "能力",
};

/** 本项目语料优先，其后为通用基础关系类型。 */
const RELATIONSHIP_TYPES: Record<string, string> = {
	garrison_commander_of: "驻守其地",
	nominal_ruler_of: "名义共主",
	serves_under: "隶属",
	political_rival_of: "政敌",
	parent_of: "生父母",
	controls: "掌控",
	northern_regional_commander_within: "北境都督",
	contests_control_of: "争夺其地",
	deployed_to: "驻防",
	captures_or_contests: "攻夺或相持",
	censures: "声讨",
	amplifies_censure_by: "响应声讨",
	ally_of: "盟友",
	enemy_of: "敌对",
	married_to: "配偶",
	sibling_of: "手足",
	child_of: "子女",
	member_of: "成员",
	located_in: "位于",
};

const ATTITUDE_DIMENSIONS: Record<string, string> = {
	parental_responsibility: "养育",
	disciplinary_strictness: "严管",
	affection: "疼爱",
	reverence: "敬重",
	trust: "信任",
	fear: "畏惧",
	dependence: "依赖",
	hostility: "敌意",
};

function custom(raw: string): string {
	return `自定义：${raw}`;
}

export function entityTypeLabel(type: string): string {
	return ENTITY_TYPES[type] ?? custom(type);
}

export function relationshipTypeLabel(type: string): string {
	return RELATIONSHIP_TYPES[type] ?? custom(type);
}

export function attitudeDimensionLabel(dimension: string): string {
	return ATTITUDE_DIMENSIONS[dimension] ?? custom(dimension);
}

/** 态度强度五档中文（淡/有/明显/强烈/极深）；无强度或非法值返回 null 由调用方省略。 */
export function attitudeIntensityLabel(intensity?: number): string | null {
	if (typeof intensity !== "number" || Number.isNaN(intensity)) return null;
	if (intensity <= 0.2) return "淡";
	if (intensity <= 0.4) return "有";
	if (intensity <= 0.6) return "明显";
	if (intensity <= 0.8) return "强烈";
	return "极深";
}

export function narrativeModeLabel(mode: string): string {
	return ({ first_person: "第一人称", third_person_limited: "第三人称限知", omniscient: "全知视角" } as Record<string, string>)[mode] ?? custom(mode);
}
